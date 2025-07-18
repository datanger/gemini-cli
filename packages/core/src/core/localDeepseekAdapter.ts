/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CountTokensResponse,
  GenerateContentResponse,
  GenerateContentParameters,
  EmbedContentResponse,
  FinishReason,
  Part,
  Content,
} from '@google/genai';
import { ContentGenerator } from './contentGenerator.js';
import * as fs from 'fs';
import * as path from 'path';

interface DeepseekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface DeepseekRequest {
  model: string;
  messages: DeepseekMessage[];
  max_tokens?: number;
  stream?: boolean;
  temperature?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  top_p?: number;
  tools?: DeepseekTool[];
}

interface DeepseekTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface DeepseekResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      content?: string;
      tool_calls?: Array<{
        function: {
          name: string;
          arguments: string;
        };
      }>;
      function_call?: {
        name: string;
        arguments: string;
      };
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface DeepseekStreamDelta {
  role?: string;
  content?: string;
  finish_reason?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

interface DeepseekStreamChoice {
  index: number;
  delta: DeepseekStreamDelta;
  finish_reason: string | null;
}

interface DeepseekStreamResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: DeepseekStreamChoice[];
}

export class LocalDeepseekAdapter implements ContentGenerator {
  private apiKey: string;
  private baseUrl: string;

  constructor(baseUrl: string, apiKey: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    console.log('[localDeepseekAdapter] 启动，baseUrl:', baseUrl);
    console.log('[localDeepseekAdapter] apiKey:', apiKey);
  }

  private async makeRequest(endpoint: string, data: unknown): Promise<unknown> {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // 只有在提供了 API Key 时才添加认证头
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

    // 检查是否是 HTTPS 请求，如果是则设置环境变量忽略 SSL 证书验证
    const isHttps = this.baseUrl.startsWith('https://');
    if (isHttps && !process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }

    const url = `${this.baseUrl}${endpoint}`;
    console.log('[localDeepseekAdapter] 发起请求:', url);
    console.log('[localDeepseekAdapter] 请求参数:', JSON.stringify(data, null, 2));
    console.log('[localDeepseekAdapter] 请求头:', JSON.stringify(headers, null, 2));
    console.log('[localDeepseekAdapter] 请求体大小:', JSON.stringify(data).length, 'bytes');
    
          // 设置超时
      const timeout = parseInt(process.env.DEEPSEEK_TIMEOUT || '30000'); // 默认30秒
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(data),
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);

      console.log('[localDeepseekAdapter] 响应状态:', response.status, response.statusText);
      console.log('[localDeepseekAdapter] 响应头:', Object.fromEntries(response.headers.entries()));

      // 获取响应文本
      const responseText = await response.text();
      console.log('[localDeepseekAdapter] 原始响应:', responseText.length > 1000 ? responseText.substring(0, 1000) + '...(truncated)' : responseText);

      if (!response.ok) {
        console.error('[localDeepseekAdapter] 请求失败:', response.status, response.statusText);
        throw new Error(`Local DeepSeek API error: ${response.status} ${response.statusText} - ${responseText || 'No response body'}`);
      }

      // 检查响应是否为空
      if (!responseText || responseText.trim().length === 0) {
        console.error('[localDeepseekAdapter] 服务器返回空响应');
        throw new Error('Local DeepSeek API returned empty response');
      }

      // 尝试解析JSON
      try {
        const json = JSON.parse(responseText);
        console.log('[localDeepseekAdapter] 解析成功，响应类型:', typeof json);
        
        // 检查响应是否包含错误信息
        if (json.error) {
          const errorMessage = json.error.message || json.error.code || 'Unknown error';
          console.error('[localDeepseekAdapter] 服务器返回错误:', json.error);
          throw new Error(`DeepSeek server error: ${errorMessage}`);
        }
        
        // 检查是否有 choices 数组
        if (!json.choices || !Array.isArray(json.choices) || json.choices.length === 0) {
          console.error('[localDeepseekAdapter] 响应缺少 choices 数组:', json);
          throw new Error('DeepSeek server returned invalid response: missing choices array');
        }
        
        return json;
      } catch (parseError) {
        console.error('[localDeepseekAdapter] JSON解析失败:', parseError);
        console.error('[localDeepseekAdapter] 无法解析的响应内容:', responseText);
        throw new Error(`Failed to parse JSON response: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
      }

          } catch (err) {
        clearTimeout(timeoutId);
        
        if (err instanceof Error) {
          if (err.name === 'AbortError') {
            console.error('[localDeepseekAdapter] 请求超时:', timeout + 'ms');
            throw new Error(`Request timeout after ${timeout}ms. Please check your DeepSeek server response time or increase DEEPSEEK_TIMEOUT.`);
          }
          
          if (err.name === 'TypeError' && err.message.includes('fetch')) {
            console.error('[localDeepseekAdapter] 网络连接失败，请检查:', {
              url,
              baseUrl: this.baseUrl,
              message: err.message
            });
            throw new Error(`Cannot connect to DeepSeek server at ${this.baseUrl}. Please check if the server is running and the URL is correct.`);
          }
        }
        
        console.error('[localDeepseekAdapter] 请求异常:', err);
        throw err;
      }
  }

  private convertToDeepseekMessages(request: unknown): DeepseekMessage[] {
    const messages: DeepseekMessage[] = [];
    
    if (request && typeof request === 'object' && 'contents' in request && Array.isArray((request as Record<string, unknown>).contents)) {
      for (const content of (request as Record<string, unknown>).contents as Array<Record<string, unknown>>) {
        if (content.role === 'user' && content.parts) {
          const text = (content.parts as Array<Record<string, unknown>>)
            .filter((part: unknown) => part && typeof part === 'object' && 'text' in part)
            .map((part: Record<string, unknown>) => part.text as string)
            .join('');
          if (text) {
            // 限制用户消息长度，避免超时
            const maxLength = 3000; // 限制单条消息最大长度
            const truncatedText = text.length > maxLength ? 
              text.substring(0, maxLength) + `\n\n...[消息已截断，原长度${text.length}字符，已截断为${maxLength}字符以提高响应速度]` : 
              text;
            messages.push({ role: 'user', content: truncatedText });
          }
        } else if (content.role === 'model' && content.parts) {
          const text = (content.parts as Array<Record<string, unknown>>)
            .filter((part: unknown) => part && typeof part === 'object' && 'text' in part)
            .map((part: Record<string, unknown>) => part.text as string)
            .join('');
          if (text) {
            // 限制助手消息长度，避免超时
            const maxLength = 2000; // 助手消息限制稍小一些
            const truncatedText = text.length > maxLength ? 
              text.substring(0, maxLength) + `\n\n...[响应已截断，原长度${text.length}字符]` : 
              text;
            messages.push({ role: 'assistant', content: truncatedText });
          }
        }
      }
    }

    if (messages.length === 0) {
      messages.push({ role: 'system', content: 'You are a helpful assistant.' });
    }

    return messages;
  }

  private convertToDeepseekTools(googleTools: unknown[]): DeepseekTool[] {
    if (!googleTools || !Array.isArray(googleTools)) {
      return [];
    }

    const result = googleTools.map(tool => {
      if (tool && typeof tool === 'object' && 'functionDeclarations' in tool && Array.isArray((tool as Record<string, unknown>).functionDeclarations)) {
        return ((tool as Record<string, unknown>).functionDeclarations as Array<Record<string, unknown>>).map((func: Record<string, unknown>) => ({
          type: "function" as const,
          function: {
            name: func.name as string,
            description: func.description as string,
            parameters: this.normalizeParameters(func.parameters)
          }
        }));
      }
      return [];
    }).flat();
    
    return result;
  }

  private normalizeParameters(parameters: unknown): Record<string, unknown> {
    if (!parameters) {
      return {};
    }

    const normalizeType = (type: string): string => {
      const typeMap: Record<string, string> = {
        'STRING': 'string',
        'NUMBER': 'number',
        'BOOLEAN': 'boolean',
        'OBJECT': 'object',
        'ARRAY': 'array',
        'INTEGER': 'integer'
      };
      return typeMap[type] || type;
    };

    const normalizeSchema = (schema: unknown): Record<string, unknown> => {
      if (typeof schema !== 'object' || schema === null) {
        return {};
      }

      const normalized = { ...schema as Record<string, unknown> };

      if ('type' in normalized && typeof normalized.type === 'string') {
        normalized.type = normalizeType(normalized.type as string);
      }

      if ('items' in normalized) {
        normalized.items = normalizeSchema(normalized.items);
      }

      if ('properties' in normalized && normalized.properties && typeof normalized.properties === 'object') {
        const normalizedProperties: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(normalized.properties as Record<string, unknown>)) {
          normalizedProperties[key] = normalizeSchema(value);
        }
        normalized.properties = normalizedProperties;
      }

      return normalized;
    };

    return normalizeSchema(parameters);
  }

  private buildResponse(choice: DeepseekResponse['choices'][0], request: GenerateContentParameters): GenerateContentResponse {
    // 检查是否有错误响应
    if (!choice) {
      throw new Error('Invalid response from DeepSeek server: no choices available');
    }

    const response = new GenerateContentResponse();
    
    // 精简日志：只记录工具调用和错误
    if (choice.message?.tool_calls || choice.message?.function_call) {
      const logData = {
        timestamp: new Date().toISOString(),
        tool_calls: choice.message.tool_calls,
        function_call: choice.message.function_call
      };
      try {
        const logPath = path.resolve(process.cwd(), 'deepseek_tool_calls.log');
        fs.appendFileSync(logPath, JSON.stringify(logData) + '\n', 'utf8');
      } catch (e) {
        console.error('[localDeepseekAdapter] 日志写入失败:', e);
      }
    }

    // 使用与标准DeepseekAdapter相同的逻辑
    if (choice.message?.content) {
      response.candidates = [{
        content: {
          parts: [{ text: choice.message.content }],
          role: 'model'
        },
        index: 0,
        finishReason: this.convertFinishReason(choice.finish_reason),
        safetyRatings: []
      }];
    } else if (choice.message?.tool_calls || choice.message?.function_call) {
      // Handle tool/function calls
      const parts: Part[] = [];
      
      if (choice.message?.tool_calls && Array.isArray(choice.message.tool_calls)) {
        console.log('[localDeepseekAdapter] tool_calls:', JSON.stringify(choice.message.tool_calls));
        for (const toolCall of choice.message.tool_calls) {
          try {
            const args = toolCall.function?.arguments ? JSON.parse(toolCall.function.arguments) : {};
            parts.push({
              functionCall: {
                name: toolCall.function?.name || 'unknown_function',
                args
              }
            });
          } catch {
            parts.push({
              functionCall: {
                name: toolCall.function?.name || 'unknown_function',
                args: { raw_arguments: toolCall.function?.arguments }
              }
            });
          }
        }
      } else if (choice.message?.function_call) {
        try {
          const args = choice.message.function_call.arguments ? JSON.parse(choice.message.function_call.arguments) : {};
          parts.push({
            functionCall: {
              name: choice.message.function_call.name || 'unknown_function',
              args
            }
          });
        } catch {
          parts.push({
            functionCall: {
              name: choice.message.function_call.name || 'unknown_function',
              args: { raw_arguments: choice.message.function_call.arguments }
            }
          });
        }
      }
      
      response.candidates = [{
        content: {
          parts,
          role: 'model'
        },
        index: 0,
        finishReason: this.convertFinishReason(choice.finish_reason),
        safetyRatings: []
      }];
    } else {
      // Empty response
      response.candidates = [{
        content: {
          parts: [],
          role: 'model'
        },
        index: 0,
        finishReason: this.convertFinishReason(choice.finish_reason),
        safetyRatings: []
      }];
    }

    // 设置automaticFunctionCallingHistory (修复：添加实际逻辑)
    response.automaticFunctionCallingHistory = this.buildAutomaticFunctionCallingHistory(request, { choices: [choice] });
    response.createTime = new Date().toISOString();
    response.responseId = `deepseek-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    response.modelVersion = 'deepseek-coder';
    
    return response;
  }

  private convertToDeepseekRequest(request: GenerateContentParameters): DeepseekRequest {
    const messages = this.convertToDeepseekMessages(request);
    const requestAny = request as unknown as Record<string, unknown>;
    const config = requestAny?.config as Record<string, unknown> | undefined;
    const googleTools = config?.tools || requestAny?.tools;
    const deepseekTools = this.convertToDeepseekTools(googleTools as unknown[]);
    
    // 检查是否是JSON生成请求
    const isJsonRequest = config?.responseMimeType === 'application/json' || config?.responseSchema;
    
    const requestObj: DeepseekRequest = {
      model: 'deepseek-coder', // 强制使用deepseek-coder模型
      messages,
      stream: true, // 启用流式请求
      temperature: config?.temperature as number || 0,
      max_tokens: config?.maxOutputTokens as number || 4096,
      presence_penalty: 0,
      frequency_penalty: 0
    };
    
    // 如果是JSON请求，添加格式要求到系统消息
    if (isJsonRequest && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === 'user') {
        lastMessage.content += '\n\n请严格按照JSON格式回复，不要包含任何其他文本，不要使用markdown代码块。';
      }
    }
    
    // 只有当有工具时才添加 tools 字段
    if (deepseekTools.length > 0) {
      requestObj.tools = deepseekTools;
    }
    
    return requestObj;
  }

  async generateContent(request: unknown): Promise<GenerateContentResponse> {
    console.log('[localDeepseekAdapter] generateContent 入参:', JSON.stringify(request));
    const messages = this.convertToDeepseekMessages(request);
    
    const requestAny = request as unknown as Record<string, unknown>;
    const config = requestAny?.config as Record<string, unknown> | undefined;
    const googleTools = config?.tools || requestAny?.tools;
    console.log('[localDeepseekAdapter] 原始工具配置:', JSON.stringify(googleTools));
    
    const deepseekTools = this.convertToDeepseekTools(googleTools as unknown[]);
    console.log('[localDeepseekAdapter] 转换后的工具配置:', JSON.stringify(deepseekTools));
    
    // 检查是否是JSON生成请求
    const isJsonRequest = config?.responseMimeType === 'application/json' || config?.responseSchema;
    
    const deepseekRequest: DeepseekRequest = {
      model: (requestAny?.model as string) || 'deepseek-coder',
      messages,
      stream: false, // 禁用流式请求
      temperature: config?.temperature as number || 0,
      max_tokens: config?.maxOutputTokens as number || 4096, // 恢复原始设置
      presence_penalty: 0,
      frequency_penalty: 0
    };
    
    // 如果是JSON请求，添加格式要求到系统消息
    if (isJsonRequest && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === 'user') {
        lastMessage.content += '\n\n请严格按照JSON格式回复，不要包含任何其他文本，不要使用markdown代码块。';
      }
    }
    
    // 只有当有工具时才添加 tools 字段
    if (deepseekTools.length > 0) {
      deepseekRequest.tools = deepseekTools;
      console.log('[localDeepseekAdapter] 添加工具到请求，工具数量:', deepseekTools.length);
    } else {
      console.log('[localDeepseekAdapter] 没有工具，不添加tools字段');
    }

    console.log('[localDeepseekAdapter] 最终发送请求:', JSON.stringify(deepseekRequest, null, 2));
    const response = await this.makeRequest('/v1/chat/completions', deepseekRequest) as DeepseekResponse;
    
    const result = this.buildResponse(response.choices[0], request as GenerateContentParameters);
    
    console.log('[localDeepseekAdapter] generateContent 返回:', JSON.stringify(result));
    return result;
  }

  async generateContentStream(request: GenerateContentParameters): Promise<AsyncGenerator<GenerateContentResponse>> {
    // 禁用流式请求，直接返回非流式结果
    const self = this;
    return (async function* () {
      console.log('Local DeepSeek: 流式请求已禁用，使用非流式请求');
      try {
        const response = await self.generateContent(request);
        yield response;
        return;
      } catch (error) {
        console.error('Local DeepSeek 流式请求错误:', error);
        throw error;
      }
    })();
  }

  async countTokens(request: unknown): Promise<CountTokensResponse> {
    const requestAny = request as unknown as Record<string, unknown>;
    const contents = requestAny?.contents as Array<Record<string, unknown>> | undefined;
    const firstContent = contents?.[0] as Record<string, unknown> | undefined;
    const parts = firstContent?.parts as Array<Record<string, unknown>> | undefined;
    const text = parts?.[0]?.text as string || '';
    return {
      totalTokens: Math.ceil(text.length / 4)
    } as CountTokensResponse;
  }

  async embedContent(_request: unknown): Promise<EmbedContentResponse> {
    throw new Error('Embedding not supported by Local DeepSeek adapter');
  }

  private convertFinishReason(finishReason: string | null | undefined): FinishReason {
    if (!finishReason) return FinishReason.STOP;
    switch (finishReason) {
      case 'stop':
        return FinishReason.STOP;
      case 'max_tokens':
        return FinishReason.MAX_TOKENS;
      case 'safety':
        return FinishReason.SAFETY;
      case 'recitation':
        return FinishReason.RECITATION;
      default:
        return FinishReason.OTHER;
    }
  }

  private buildAutomaticFunctionCallingHistory(request: unknown, response: unknown): Content[] {
    const responseObj = response as DeepseekResponse;
    const choice = responseObj?.choices?.[0];
    if (!choice) {
      return [];
    }

    const toolCalls = choice.message?.tool_calls;
    if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
      const afcHistory: Content[] = [];
      
      if (request && typeof request === 'object' && 'contents' in request && Array.isArray((request as Record<string, unknown>).contents)) {
        const contents = (request as Record<string, unknown>).contents as Array<Record<string, unknown>>;
        const userContent = contents[0];
        if (userContent && userContent.role === 'user' && userContent.parts) {
          const userText = (userContent.parts as Array<Record<string, unknown>>)
            .filter((part: unknown) => part && typeof part === 'object' && 'text' in part)
            .map((part: Record<string, unknown>) => part.text as string)
            .join('');
          if (userText) {
            afcHistory.push({
              role: 'user',
              parts: [{ text: userText }]
            });
          }
        }
      }
      
      for (const toolCall of toolCalls) {
        try {
          const args = toolCall.function?.arguments ? JSON.parse(toolCall.function.arguments) : {};
          afcHistory.push({
            role: 'model',
            parts: [{
              functionCall: {
                name: toolCall.function?.name || 'unknown_function',
                args
              }
            }]
          });
        } catch {
          afcHistory.push({
            role: 'model',
            parts: [{
              functionCall: {
                name: toolCall.function?.name || 'unknown_function',
                args: { raw_arguments: toolCall.function?.arguments }
              }
            }]
          });
        }
      }
      
      return afcHistory;
    }
    
    return [];
  }
} 