/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CountTokensResponse,
  GenerateContentResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
} from '@google/genai';

export interface OpenAIAdapterConfig {
  provider: 'openai' | 'deepseek' | 'ollama' | 'local';
  model: string;
  baseUrl: string;
  apiKey?: string;
  apiVersion?: string;
  stream?: boolean;
  verify?: boolean; // 是否启用 SSL 验证
}

export class OpenAIAdapter {
  private config: OpenAIAdapterConfig;
  private openai: any;

  constructor(config: OpenAIAdapterConfig) {
    this.config = config;
    
    // 清除所有代理设置，确保不使用代理
    const proxyVars = ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'all_proxy'];
    for (const varName of proxyVars) {
      if (process.env[varName]) {
        delete process.env[varName];
      }
    }
    

    // 如果禁用验证，设置环境变量
    if (this.config.verify === false) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }
  }

  private async getOpenAI() {
    if (!this.openai) {
      const { OpenAI } = await import('openai');
      
      const openaiConfig: any = {
        apiKey: this.config.apiKey || 'dummy-key',
        baseURL: this.config.baseUrl,
      };

      // 根据 provider 设置不同的配置
      switch (this.config.provider) {
        case 'openai':
          if (this.config.apiVersion) {
            openaiConfig.defaultHeaders = { 'OpenAI-Version': this.config.apiVersion };
          }
          break;
        case 'deepseek':
          // DeepSeek 使用标准的 OpenAI 格式
          break;
        case 'ollama':
          // Ollama 使用标准的 OpenAI 格式，但需要确保 baseURL 正确
          if (!this.config.baseUrl.endsWith('/v1')) {
            openaiConfig.baseURL = this.config.baseUrl.replace(/\/+$/, '') + '/v1';
          }
          break;
        case 'local':
          // Local 使用标准的 OpenAI 格式，但需要确保 baseURL 正确
          if (!this.config.baseUrl.endsWith('/v1')) {
            openaiConfig.baseURL = this.config.baseUrl.replace(/\/+$/, '') + '/v1';
          }
          // Local provider 可能不需要 API key
          if (!this.config.apiKey) {
            openaiConfig.apiKey = 'dummy-key';
          }
          break;
      }

      this.openai = new OpenAI(openaiConfig);
    }
    return this.openai;
  }

  private toMessages(contents: any) {
    if (!Array.isArray(contents)) return [];
    return contents.map((c: any) => {
      const message: any = {
        role: c.role === 'model' ? 'assistant' : c.role,
      };
      
      if (Array.isArray(c.parts)) {
        // 检查是否有 functionResponse
        const functionResponse = c.parts.find((p: any) => p.functionResponse);
        if (functionResponse) {
          // 如果有 functionResponse，使用它
          message.content = functionResponse.functionResponse?.response?.output || '';
        } else {
          // 检查是否有 functionCall
          const functionCall = c.parts.find((p: any) => p.functionCall);
          if (functionCall) {
            // 如果有 functionCall，使用它
            message.content = JSON.stringify(functionCall.functionCall);
          } else {
            // 否则使用文本内容，即使为空也要保留
            const textContent = c.parts.map((p: any) => p.text || '').join('');
            message.content = textContent;
          }
        }
      } else {
        message.content = '';
      }
      
      return message;
    });
  }

  private convertToOpenAITools(geminiTools: any[]): any[] {
    if (!geminiTools || !Array.isArray(geminiTools)) {
      return [];
    }

    const openaiTools = [];
    
    for (const toolGroup of geminiTools) {
      if (toolGroup.functionDeclarations) {
        for (const funcDecl of toolGroup.functionDeclarations) {
          openaiTools.push({
            type: "function",
            function: {
              name: funcDecl.name,
              description: funcDecl.description,
              parameters: funcDecl.parameters
            }
          });
        }
      }
    }
    
    return openaiTools;
  }

  private shouldSkipTools(): boolean {
    // 根据 provider 和 model 判断是否跳过工具调用
    switch (this.config.provider) {
      case 'ollama':
        // Ollama 的某些模型不支持工具调用
        // qwen3-coder 支持工具调用，其他 qwen 模型可能不支持
        if (this.config.model.includes('qwen') && !this.config.model.includes('qwen3-coder')) {
          return true;
        }
        break;
      case 'local':
        // Local provider 可能不支持某些工具调用
        if (this.config.model.includes('deepseek-chat')) {
          // 检查是否支持工具调用
          return false; // 默认支持
        }
        break;
      case 'deepseek':
        // DeepSeek 支持工具调用
        return false;
      case 'openai':
        // OpenAI 支持工具调用
        return false;
    }
    return false;
  }

  async generateContent(request: GenerateContentParameters): Promise<GenerateContentResponse> {
    const openai = await this.getOpenAI();
    const messages = this.toMessages(request.contents);
    const requestAny = request as unknown as Record<string, unknown>;
    const config = requestAny?.config as Record<string, unknown> | undefined;
    
    const requestConfig: any = {
      model: this.config.model,
      messages,
    };

    // 添加可选参数
    if (config?.temperature !== undefined) {
      requestConfig.temperature = config.temperature;
    }
    if (config?.maxOutputTokens !== undefined) {
      requestConfig.max_tokens = config.maxOutputTokens;
    }
    if (config?.top_p !== undefined) {
      requestConfig.top_p = config.top_p;
    }
    
    // 处理工具调用 - 将Gemini格式转换为OpenAI格式
    if ((request as any).config?.tools && !this.shouldSkipTools()) {
      const geminiTools = (request as any).config.tools;
      const openaiTools = this.convertToOpenAITools(geminiTools);
      
      if (openaiTools.length > 0) {
        requestConfig.tools = openaiTools;
        requestConfig.tool_choice = 'auto';
      }
    }
    
    try {
      const completion = await openai.chat.completions.create(requestConfig);
      
      const response: GenerateContentResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: completion.choices[0].message.content || '' }],
              role: 'model',
            },
            index: 0,
            finishReason: completion.choices[0].finish_reason,
            safetyRatings: [],
          },
        ],
        text: completion.choices[0].message.content || '',
        data: undefined,
        functionCalls: completion.choices[0].message.tool_calls?.map((tc: any) => {
          let args = {};
          if (tc.function?.arguments) {
            try {
              args = JSON.parse(tc.function.arguments);
            } catch (error) {
              args = {};
            }
          }
          return {
            name: tc.function?.name || '',
            args,
            id: tc.id
          };
        }) || undefined,
        executableCode: undefined,
        codeExecutionResult: undefined,
      };
      
      return response;
    } catch (error) {
      // 为 local provider 添加特殊的错误处理
      if (this.config.provider === 'local') {
        console.error(`[Local Provider Error] ${this.config.baseUrl}:`, error);
        throw new Error(`Local provider error: ${error instanceof Error ? error.message : String(error)}`);
      }
      throw error;
    }
  }

  async generateContentStream(request: GenerateContentParameters): Promise<AsyncGenerator<GenerateContentResponse>> {
    const openai = await this.getOpenAI();
    const messages = this.toMessages(request.contents);
    const requestAny = request as unknown as Record<string, unknown>;
    const config = requestAny?.config as Record<string, unknown> | undefined;
    
    const requestConfig: any = {
      model: this.config.model,
      messages,
      stream: true,
    };

    // 添加可选参数
    if (config?.temperature !== undefined) {
      requestConfig.temperature = config.temperature;
    }
    if (config?.maxOutputTokens !== undefined) {
      requestConfig.max_tokens = config.maxOutputTokens;
    }
    if (config?.top_p !== undefined) {
      requestConfig.top_p = config.top_p;
    }
    
    // 处理工具调用 - 将Gemini格式转换为OpenAI格式
    if ((request as any).config?.tools && !this.shouldSkipTools()) {
      const geminiTools = (request as any).config.tools;
      const openaiTools = this.convertToOpenAITools(geminiTools);
      
      if (openaiTools.length > 0) {
        requestConfig.tools = openaiTools;
        requestConfig.tool_choice = 'auto';
      }
    }
    
    const stream = await openai.chat.completions.create(requestConfig);
    
    // 用于累积工具调用信息
    const toolCallsBuffer: any[] = [];
    let accumulatedText = '';
    let hasToolCalls = false;
    
    async function* gen() {
      for await (const chunk of stream) {
        // 处理工具调用
        if (chunk.choices[0]?.delta?.tool_calls) {
          hasToolCalls = true;
          for (const toolCall of chunk.choices[0].delta.tool_calls) {
            const existingIndex = toolCallsBuffer.findIndex(tc => tc.index === toolCall.index);
            
            if (existingIndex >= 0) {
              // 更新现有的工具调用
              const existing = toolCallsBuffer[existingIndex];
              if (toolCall.function?.name) existing.function.name = toolCall.function.name;
              if (toolCall.function?.arguments) {
                existing.function.arguments = (existing.function.arguments || '') + toolCall.function.arguments;
              }
              if (toolCall.id) existing.id = toolCall.id;
            } else {
              // 创建新的工具调用
              toolCallsBuffer.push({
                index: toolCall.index,
                function: {
                  name: toolCall.function?.name || '',
                  arguments: toolCall.function?.arguments || ''
                },
                id: toolCall.id
              });
            }
          }
        }
        
        // 累积文本内容
        if (chunk.choices[0]?.delta?.content) {
          accumulatedText += chunk.choices[0].delta.content;
        }
        
        // 检查是否完成
        const isDone = chunk.choices[0]?.finish_reason === 'stop' || 
                      chunk.choices[0]?.finish_reason === 'tool_calls';
        
        // 如果有工具调用且完成，或者没有工具调用但有文本内容，则返回结果
        if (isDone || (!hasToolCalls && chunk.choices[0]?.delta?.content)) {
          const functionCalls = toolCallsBuffer.length > 0 ? toolCallsBuffer.map((tc: any) => {
            let args = {};
            if (tc.function?.arguments) {
              try {
                args = JSON.parse(tc.function.arguments);
              } catch (_error) {
                // 如果JSON不完整，返回空对象
                args = {};
              }
            }
            return {
              name: tc.function?.name || '',
              args,
              id: tc.id
            };
          }) : undefined;

          // 构建 parts 数组
          const parts = [];
          if (accumulatedText) {
            parts.push({ text: accumulatedText });
          }
          if (functionCalls && functionCalls.length > 0) {
            // 将工具调用转换为 functionCall 格式
            parts.push({ 
              functionCall: {
                name: functionCalls[0].name,
                args: functionCalls[0].args
              }
            });
          }
          
          // 只在完成时返回结果，或者文本长度超过20时返回
          if (isDone || accumulatedText.length >= 10) {
            yield {
              candidates: [
                {
                  content: {
                    parts: parts.length > 0 ? parts : [{ text: '' }],
                    role: 'model',
                  },
                  index: 0,
                  finishReason: chunk.choices[0]?.finish_reason,
                  safetyRatings: [],
                },
              ],
              text: accumulatedText || '',
              functionCalls: functionCalls ? functionCalls : undefined,
              data: undefined,
              executableCode: undefined,
              codeExecutionResult: undefined,
            };
            
            // 重置状态
            if (isDone) {
              accumulatedText = '';
              toolCallsBuffer.length = 0;
              hasToolCalls = false;
            } else {
              // 如果不是完成状态，重置累积的文本
              accumulatedText = '';
            }
          }
        }
      }
    }
    return gen();
  }

  async countTokens(request: CountTokensParameters): Promise<CountTokensResponse> {
    let text = '';
    if (Array.isArray(request.contents)) {
      const first = request.contents[0];
      if (first && Array.isArray((first as any).parts)) {
        text = ((first as any).parts[0]?.text) || '';
      }
    }
    return { totalTokens: Math.ceil((text as string).length / 4) };
  }

  async embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse> {
    const openai = await this.getOpenAI();
    const input = Array.isArray(request.contents)
      ? request.contents.map((c: any) => Array.isArray(c.parts) ? c.parts.map((p: any) => p.text).join('') : '').join('\n')
      : '';
    const embedding = await openai.embeddings.create({
      model: this.config.model,
      input,
    });
    return {
      embedding: embedding.data[0].embedding,
    } as EmbedContentResponse;
  }
} 
