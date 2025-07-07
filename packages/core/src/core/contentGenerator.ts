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
  GoogleGenAI,
  FinishReason,
} from '@google/genai';
import { createCodeAssistContentGenerator } from '../code_assist/codeAssist.js';
import { DEFAULT_GEMINI_MODEL } from '../config/models.js';
import { getEffectiveModel } from './modelCheck.js';
import { DeepseekAdapter } from './deepseekAdapter.js';
import { OllamaAdapter } from './ollamaAdapter.js';

/**
 * Interface abstracting the core functionalities for generating content and counting tokens.
 */
export interface ContentGenerator {
  generateContent(
    request: GenerateContentParameters,
  ): Promise<GenerateContentResponse>;

  generateContentStream(
    request: GenerateContentParameters,
  ): Promise<AsyncGenerator<GenerateContentResponse>>;

  countTokens(request: CountTokensParameters): Promise<CountTokensResponse>;

  embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse>;
}

export enum AuthType {
  LOGIN_WITH_GOOGLE_PERSONAL = 'oauth-personal',
  USE_GEMINI = 'gemini-api-key',
  USE_VERTEX_AI = 'vertex-ai',
}

export type ContentGeneratorConfig = {
  model: string;
  apiKey?: string;
  vertexai?: boolean;
  authType?: AuthType | undefined;
};

export async function createContentGeneratorConfig(
  model: string | undefined,
  authType: AuthType | undefined,
  config?: { getModel?: () => string },
): Promise<ContentGeneratorConfig> {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const googleApiKey = process.env.GOOGLE_API_KEY;
  const googleCloudProject = process.env.GOOGLE_CLOUD_PROJECT;
  const googleCloudLocation = process.env.GOOGLE_CLOUD_LOCATION;

  // Use runtime model from config if available, otherwise fallback to parameter or default
  const effectiveModel = config?.getModel?.() || model || DEFAULT_GEMINI_MODEL;

  const contentGeneratorConfig: ContentGeneratorConfig = {
    model: effectiveModel,
    authType,
  };

  // if we are using google auth nothing else to validate for now
  if (authType === AuthType.LOGIN_WITH_GOOGLE_PERSONAL) {
    return contentGeneratorConfig;
  }

  if (authType === AuthType.USE_GEMINI && geminiApiKey) {
    contentGeneratorConfig.apiKey = geminiApiKey;
    contentGeneratorConfig.model = await getEffectiveModel(
      contentGeneratorConfig.apiKey,
      contentGeneratorConfig.model,
    );

    return contentGeneratorConfig;
  }

  if (
    authType === AuthType.USE_VERTEX_AI &&
    !!googleApiKey &&
    googleCloudProject &&
    googleCloudLocation
  ) {
    contentGeneratorConfig.apiKey = googleApiKey;
    contentGeneratorConfig.vertexai = true;
    contentGeneratorConfig.model = await getEffectiveModel(
      contentGeneratorConfig.apiKey,
      contentGeneratorConfig.model,
    );

    return contentGeneratorConfig;
  }

  return contentGeneratorConfig;
}

export async function createContentGenerator(
  config: ContentGeneratorConfig,
): Promise<ContentGenerator> {
  const version = process.env.CLI_VERSION || process.version;
  const httpOptions = {
    headers: {
      'User-Agent': `GeminiCLI/${version} (${process.platform}; ${process.arch})`,
    },
  };

  // 从环境变量获取provider，默认为gemini
  const provider = process.env.GEMINI_PROVIDER || 'gemini';
  
  if (provider === 'deepseek') {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error('DEEPSEEK_API_KEY environment variable is required for Deepseek provider');
    }
    return new DeepseekAdapter(apiKey);
  }

  if (provider === 'ollama') {
    const baseUrl = process.env.GEMINI_OLLAMA_BASE_URL || 'http://localhost:11434';
    return new OllamaAdapter(baseUrl);
  }

  if (provider !== 'gemini' && provider !== 'deepseek' && provider !== 'ollama') {
    // 返回一个模拟适配器
    return {
      async generateContent(request: any) {
        const responseText = `这是来自 ${provider} 的模拟响应。模型: ${request.model}`;
        
        // 使用正确的构造函数创建 GenerateContentResponse
        const generateContentResponse = new GenerateContentResponse();
        
        generateContentResponse.candidates = [{
          content: {
            parts: [{ text: responseText }]
          },
          finishReason: FinishReason.STOP
        }];
        
        generateContentResponse.usageMetadata = {
          promptTokenCount: 1,
          candidatesTokenCount: 1,
          totalTokenCount: 2
        };
        
        // 设置其他必要字段
        generateContentResponse.automaticFunctionCallingHistory = [];
        generateContentResponse.createTime = new Date().toISOString();
        generateContentResponse.responseId = `mock-${provider}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        generateContentResponse.modelVersion = request.model || 'mock-model';
        
        return generateContentResponse;
      },
      async generateContentStream(request: any) {
        const responseText = `这是来自 ${provider} 的流式模拟响应。模型: ${request.model}`;
        return (async function* () {
          const words = responseText.split(' ');
          for (const word of words) {
            // 使用正确的构造函数创建 GenerateContentResponse
            const generateContentResponse = new GenerateContentResponse();
            
            generateContentResponse.candidates = [{
              content: {
                parts: [{ text: word + ' ' }]
              }
            }];
            
            // 模拟适配器不支持函数调用，所以 automaticFunctionCallingHistory 为空
            generateContentResponse.automaticFunctionCallingHistory = [];
            generateContentResponse.createTime = new Date().toISOString();
            generateContentResponse.responseId = `mock-stream-${provider}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            generateContentResponse.modelVersion = request.model || 'mock-model';
            
            yield generateContentResponse;
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        })();
      },
      async countTokens() { return { totalTokens: 1 }; },
      async embedContent() { throw new Error('Not implemented'); }
    } as ContentGenerator;
  }

  if (config.authType === AuthType.LOGIN_WITH_GOOGLE_PERSONAL) {
    return createCodeAssistContentGenerator(httpOptions, config.authType);
  }

  if (
    config.authType === AuthType.USE_GEMINI ||
    config.authType === AuthType.USE_VERTEX_AI
  ) {
    const googleGenAI = new GoogleGenAI({
      apiKey: config.apiKey === '' ? undefined : config.apiKey,
      vertexai: config.vertexai,
      httpOptions,
    });

    return googleGenAI.models;
  }

  throw new Error(
    `Error creating contentGenerator: Unsupported authType: ${config.authType}`,
  );
}
