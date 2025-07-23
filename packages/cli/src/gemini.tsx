/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render } from 'ink';
import { AppWrapper } from './ui/App.js';
import { loadCliConfig } from './config/config.js';
import { readStdin } from './utils/readStdin.js';
import { basename } from 'node:path';
import v8 from 'node:v8';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { start_sandbox } from './utils/sandbox.js';
import {
  LoadedSettings,
  loadSettings,
  SettingScope,
  USER_SETTINGS_PATH,
} from './config/settings.js';
import { themeManager } from './ui/themes/theme-manager.js';
import { getStartupWarnings } from './utils/startupWarnings.js';
import { getUserStartupWarnings } from './utils/userStartupWarnings.js';
import { runNonInteractive } from './nonInteractiveCli.js';
import { loadExtensions, Extension } from './config/extension.js';
import { cleanupCheckpoints } from './utils/cleanup.js';
import {
  ApprovalMode,
  Config,
  EditTool,
  ShellTool,
  WriteFileTool,
  sessionId,
  GeminiClient,
  GeminiEventType as ServerGeminiEventType,
  ServerGeminiStreamEvent as GeminiEvent,
  ServerGeminiContentEvent as ContentEvent,
  ServerGeminiErrorEvent as ErrorEvent,
  ServerGeminiChatCompressedEvent,
  getErrorMessage,
  isNodeError,
  MessageSenderType,
  ToolCallRequestInfo,
  logUserPrompt,
  AuthType,
} from '@google/gemini-cli-core';
import { Content, FunctionCall, GenerateContentResponse } from '@google/genai';
import { validateAuthMethod } from './config/auth.js';
import { setMaxSizedBoxDebugging } from './ui/components/shared/MaxSizedBox.js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

function getNodeMemoryArgs(config: Config): string[] {
  const totalMemoryMB = os.totalmem() / (1024 * 1024);
  const heapStats = v8.getHeapStatistics();
  const currentMaxOldSpaceSizeMb = Math.floor(
    heapStats.heap_size_limit / 1024 / 1024,
  );

  // Set target to 50% of total memory
  const targetMaxOldSpaceSizeInMB = Math.floor(totalMemoryMB * 0.5);
  if (config.getDebugMode()) {
    console.debug(
      `Current heap size ${currentMaxOldSpaceSizeMb.toFixed(2)} MB`,
    );
  }

  if (process.env.GEMINI_CLI_NO_RELAUNCH) {
    return [];
  }

  if (targetMaxOldSpaceSizeInMB > currentMaxOldSpaceSizeMb) {
    if (config.getDebugMode()) {
      console.debug(
        `Need to relaunch with more memory: ${targetMaxOldSpaceSizeInMB.toFixed(2)} MB`,
      );
    }
    return [`--max-old-space-size=${targetMaxOldSpaceSizeInMB}`];
  }

  return [];
}

async function relaunchWithAdditionalArgs(additionalArgs: string[]) {
  const nodeArgs = [...additionalArgs, ...process.argv.slice(1)];
  const newEnv = { ...process.env, GEMINI_CLI_NO_RELAUNCH: 'true' };

  const child = spawn(process.execPath, nodeArgs, {
    stdio: 'inherit',
    env: newEnv,
  });

  await new Promise((resolve) => child.on('close', resolve));
  process.exit(0);
}

const argv = yargs(hideBin(process.argv))
  .option('plain', { type: 'boolean', default: false })
  .option('json', { type: 'boolean', default: false })
  .parseSync();

export async function main() {
  const workspaceRoot = process.cwd();
  const settings = loadSettings(workspaceRoot);

  await cleanupCheckpoints();
  if (settings.errors.length > 0) {
    for (const error of settings.errors) {
      let errorMessage = `Error in ${error.path}: ${error.message}`;
      if (!process.env.NO_COLOR) {
        errorMessage = `\x1b[31m${errorMessage}\x1b[0m`;
      }
      console.error(errorMessage);
      console.error(`Please fix ${error.path} and try again.`);
    }
    process.exit(1);
  }

  const extensions = loadExtensions(workspaceRoot);
  const config = await loadCliConfig(settings.merged, extensions, sessionId);

  // set default fallback to gemini api key
  // this has to go after load cli because that's where the env is set
  if (!settings.merged.selectedAuthType && process.env.GEMINI_API_KEY) {
    settings.setValue(
      SettingScope.User,
      'selectedAuthType',
      AuthType.USE_GEMINI,
    );
  }

  setMaxSizedBoxDebugging(config.getDebugMode());

  // Initialize centralized FileDiscoveryService
  config.getFileService();
  if (config.getCheckpointingEnabled()) {
    try {
      await config.getGitService();
    } catch {
      // For now swallow the error, later log it.
    }
  }

  if (settings.merged.theme) {
    if (!themeManager.setActiveTheme(settings.merged.theme)) {
      // If the theme is not found during initial load, log a warning and continue.
      // The useThemeCommand hook in App.tsx will handle opening the dialog.
      console.warn(`Warning: Theme "${settings.merged.theme}" not found.`);
    }
  }

  const memoryArgs = settings.merged.autoConfigureMaxOldSpaceSize
    ? getNodeMemoryArgs(config)
    : [];

  // hop into sandbox if we are outside and sandboxing is enabled
  if (!process.env.SANDBOX) {
    const sandboxConfig = config.getSandbox();
    if (sandboxConfig) {
      if (settings.merged.selectedAuthType) {
        // Validate authentication here because the sandbox will interfere with the Oauth2 web redirect.
        try {
          const err = validateAuthMethod(settings.merged.selectedAuthType);
          if (err) {
            throw new Error(err);
          }
          await config.refreshAuth(settings.merged.selectedAuthType);
        } catch (err) {
          console.error('Error authenticating:', err);
          process.exit(1);
        }
      }
      await start_sandbox(sandboxConfig, memoryArgs);
      process.exit(0);
    } else {
      // Not in a sandbox and not entering one, so relaunch with additional
      // arguments to control memory usage if needed.
      if (memoryArgs.length > 0) {
        await relaunchWithAdditionalArgs(memoryArgs);
        process.exit(0);
      }
    }
  }

  // --- plain/json 自动化多轮对话模式 ---
  if (argv.plain || argv.json) {
    // Initialize authentication and GeminiClient for plain mode
    const selectedAuthType = settings.merged.selectedAuthType || AuthType.USE_GEMINI;
    const err = validateAuthMethod(selectedAuthType);
    if (err != null) {
      console.error(err);
      process.exit(1);
    }
    
    await config.refreshAuth(selectedAuthType);
    
    // 使用原有的gemini-cli上下文管理机制
    const geminiClient = config.getGeminiClient();
    const toolRegistry = await config.getToolRegistry();
    const chat = await geminiClient.getChat();
    
    // Helper to extract text from response parts
    function getResponseText(resp: GenerateContentResponse): string | undefined {
      if (resp.candidates && resp.candidates.length > 0) {
        const candidate = resp.candidates[0];
        if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
          return candidate.content.parts[0].text || '';
        }
      }
      return undefined;
    }

    // 处理多轮对话
    async function processMultiTurnConversation() {
      const readline = await import('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      
      // 显示提示符
      if (!argv.json) {
        process.stdout.write('> ');
      }
      
      // 使用事件监听器实现真正的交互式一问一答
      rl.on('line', async (line) => {
        const trimmedLine = line.trim();
        if (trimmedLine === '') {
          if (!argv.json) {
            process.stdout.write('> ');
          }
          return; // 跳过空行
        }
        
        try {
          // 使用原有的gemini-cli机制处理消息
          const abortController = new AbortController();
          const currentMessages: Content[] = [{ role: 'user', parts: [{ text: trimmedLine }] }];
          
          const functionCalls: FunctionCall[] = [];
          let hasToolCalls = false;
          let responseText = '';
          
          const responseStream = await chat.sendMessageStream({
            message: currentMessages[0]?.parts || [],
            config: {
              abortSignal: abortController.signal,
              tools: [
                { functionDeclarations: toolRegistry.getFunctionDeclarations() },
              ],
            },
          });
          
          for await (const resp of responseStream) {
            if (abortController.signal.aborted) {
              console.error('Operation cancelled.');
              return;
            }
            
            const textPart = getResponseText(resp);
            if (textPart) {
              responseText += textPart;
              if (!argv.json) {
                process.stdout.write(textPart);
              }
            }
            
            if (resp.functionCalls) {
              hasToolCalls = true;
              functionCalls.length = 0; // 清空之前的调用
              functionCalls.push(...resp.functionCalls);
            }
          }
          
          // 处理工具调用
          if (hasToolCalls && functionCalls.length > 0) {
            for (const functionCall of functionCalls) {
              const tool = toolRegistry.getTool(functionCall.name || '');
              if (tool) {
                try {
                  const argsString = typeof functionCall.args === 'string' ? functionCall.args : JSON.stringify(functionCall.args || {});
                  const args = JSON.parse(argsString) as Record<string, unknown>;
                  const result = await tool.execute(args, abortController.signal);
                  
                  // 将工具结果发送回模型
                  const toolResponse: Content[] = [
                    {
                      role: 'user',
                      parts: [
                        {
                          functionResponse: {
                            name: functionCall.name,
                            response: { output: result.llmContent || '' }
                          }
                        }
                      ]
                    }
                  ];
                  
                  // 继续对话，让模型处理工具结果
                  const continueStream = await chat.sendMessageStream({
                    message: toolResponse[0]?.parts || [],
                    config: {
                      abortSignal: abortController.signal,
                    },
                  });
                  
                  for await (const continueResp of continueStream) {
                    const continueText = getResponseText(continueResp);
                    if (continueText) {
                      responseText += continueText;
                      if (!argv.json) {
                        process.stdout.write(continueText);
                      }
                    }
                  }
                } catch (error) {
                  console.error(`Error executing tool ${functionCall.name}:`, error);
                }
              }
            }
          }
          
          // 输出最终结果
          if (argv.json) {
            console.log(JSON.stringify({ response: responseText }));
          } else {
            console.log(); // 换行
            process.stdout.write('> ');
          }
          
        } catch (error) {
          console.error('Error processing message:', error);
          if (!argv.json) {
            process.stdout.write('> ');
          }
        }
      });
      
      // 等待用户输入结束
      await new Promise((resolve) => {
        rl.on('close', resolve);
        process.stdin.on('end', resolve);
      });
    }
    
    // 启动多轮对话
    await processMultiTurnConversation();
    return;
  }

  let input = config.getQuestion();
  const startupWarnings = [
    ...(await getStartupWarnings()),
    ...(await getUserStartupWarnings(workspaceRoot)),
  ];

  // Render UI, passing necessary config values. Check that there is no command line question.
  if (process.stdin.isTTY && input?.length === 0) {
    setWindowTitle(basename(workspaceRoot), settings);
    render(
      <React.StrictMode>
        <AppWrapper
          config={config}
          settings={settings}
          startupWarnings={startupWarnings}
        />
      </React.StrictMode>,
      { exitOnCtrlC: false },
    );
    return;
  }
  // If not a TTY, read from stdin
  // This is for cases where the user pipes input directly into the command
  if (!process.stdin.isTTY && !input) {
    input += await readStdin();
  }
  if (!input) {
    console.error('No input provided via stdin.');
    process.exit(1);
  }

  logUserPrompt(config, {
    'event.name': 'user_prompt',
    'event.timestamp': new Date().toISOString(),
    prompt: input,
    prompt_length: input.length,
  });

  // Non-interactive mode handled by runNonInteractive
  const nonInteractiveConfig = await loadNonInteractiveConfig(
    config,
    extensions,
    settings,
  );

  await runNonInteractive(nonInteractiveConfig, input);
  process.exit(0);
}

function setWindowTitle(title: string, settings: LoadedSettings) {
  if (!settings.merged.hideWindowTitle) {
    process.stdout.write(`\x1b]2; Gemini - ${title} \x07`);

    process.on('exit', () => {
      process.stdout.write(`\x1b]2;\x07`);
    });
  }
}

// --- Global Unhandled Rejection Handler ---
process.on('unhandledRejection', (reason, _promise) => {
  // Log other unexpected unhandled rejections as critical errors
  console.error('=========================================');
  console.error('CRITICAL: Unhandled Promise Rejection!');
  console.error('=========================================');
  console.error('Reason:', reason);
  console.error('Stack trace may follow:');
  if (!(reason instanceof Error)) {
    console.error(reason);
  }
  // Exit for genuinely unhandled errors
  process.exit(1);
});

async function loadNonInteractiveConfig(
  config: Config,
  extensions: Extension[],
  settings: LoadedSettings,
) {
  let finalConfig = config;
  if (config.getApprovalMode() !== ApprovalMode.YOLO) {
    // Everything is not allowed, ensure that only read-only tools are configured.
    const existingExcludeTools = settings.merged.excludeTools || [];
    const interactiveTools = [
      ShellTool.Name,
      EditTool.Name,
      WriteFileTool.Name,
    ];

    const newExcludeTools = [
      ...new Set([...existingExcludeTools, ...interactiveTools]),
    ];

    const nonInteractiveSettings = {
      ...settings.merged,
      excludeTools: newExcludeTools,
    };
    finalConfig = await loadCliConfig(
      nonInteractiveSettings,
      extensions,
      config.getSessionId(),
    );
  }

  return await validateNonInterActiveAuth(
    settings.merged.selectedAuthType,
    finalConfig,
  );
}

async function validateNonInterActiveAuth(
  selectedAuthType: AuthType | undefined,
  nonInteractiveConfig: Config,
) {
  // making a special case for the cli. many headless environments might not have a settings.json set
  // so if GEMINI_API_KEY is set, we'll use that. However since the oauth things are interactive anyway, we'll
  // still expect that exists
  if (!selectedAuthType && !process.env.GEMINI_API_KEY) {
    console.error(
      `Please set an Auth method in your ${USER_SETTINGS_PATH} OR specify GEMINI_API_KEY env variable file before running`,
    );
    process.exit(1);
  }

  selectedAuthType = selectedAuthType || AuthType.USE_GEMINI;
  const err = validateAuthMethod(selectedAuthType);
  if (err != null) {
    console.error(err);
    process.exit(1);
  }

  await nonInteractiveConfig.refreshAuth(selectedAuthType);
  return nonInteractiveConfig;
}
