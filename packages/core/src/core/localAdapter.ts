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

interface LocalMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LocalRequest {
  model: string;
  messages: LocalMessage[];
  max_tokens?: number;
  stream?: boolean;
  temperature?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  top_p?: number;
  tools?: LocalTool[];
}

interface LocalTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface LocalResponse {
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

interface LocalStreamDelta {
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

interface LocalStreamChoice {
  index: number;
  delta: LocalStreamDelta;
  finish_reason: string | null;
}

interface LocalStreamResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: LocalStreamChoice[];
}

export class LocalAdapter implements ContentGenerator {
  private apiKey: string;
  private baseUrl: string;

  constructor(baseUrl: string, apiKey: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    console.log('[localAdapter] 启动，baseUrl:', baseUrl);
    console.log('[localAdapter] apiKey:', apiKey);
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

    // 保证 baseUrl 末尾没有重复 /，endpoint 以 /chat/completions 开头
    const url = this.baseUrl.replace(/\/+$/, '') + endpoint;
    console.log('[localAdapter] 发起请求:', url);
    // console.log('[localAdapter] 请求参数:', JSON.stringify(data, null, 2));
    // console.log('[localAdapter] 请求头:', JSON.stringify(headers, null, 2));
    // console.log('[localAdapter] 请求体大小:', JSON.stringify(data).length, 'bytes');
    
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

      // 获取响应文本
      const responseText = await response.text();
      console.log('[localAdapter] 原始响应:', responseText.length > 1000 ? responseText.substring(0, 1000) + '...(truncated)' : responseText);

      if (!response.ok) {
        console.error('[localAdapter] 请求失败:', response.status, response.statusText);
        throw new Error(`Local DeepSeek API error: ${response.status} ${response.statusText} - ${responseText || 'No response body'}`);
      }

      // 检查响应是否为空
      if (!responseText || responseText.trim().length === 0) {
        console.error('[localAdapter] 服务器返回空响应');
        throw new Error('Local DeepSeek API returned empty response');
      }

      // 尝试解析JSON
      try {
        const json = JSON.parse(responseText);
        console.log('[localAdapter] 解析成功，响应类型:', typeof json);
        
        // 检查响应是否包含错误信息
        if (json.error) {
          const errorMessage = json.error.message || json.error.code || 'Unknown error';
          console.error('[localAdapter] 服务器返回错误:', json.error);
          throw new Error(`DeepSeek server error: ${errorMessage}`);
        }
        
        // 检查是否有 choices 数组
        if (!json.choices || !Array.isArray(json.choices) || json.choices.length === 0) {
          console.error('[localAdapter] 响应缺少 choices 数组:', json);
          throw new Error('DeepSeek server returned invalid response: missing choices array');
        }
        
        return json;
      } catch (parseError) {
        console.error('[localAdapter] JSON解析失败:', parseError);
        console.error('[localAdapter] 无法解析的响应内容:', responseText);
        throw new Error(`Failed to parse JSON response: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
      }

          } catch (err) {
        clearTimeout(timeoutId);
        
        if (err instanceof Error) {
          if (err.name === 'AbortError') {
            console.error('[localAdapter] 请求超时:', timeout + 'ms');
            throw new Error(`Request timeout after ${timeout}ms. Please check your DeepSeek server response time or increase DEEPSEEK_TIMEOUT.`);
          }
          
          if (err.name === 'TypeError' && err.message.includes('fetch')) {
            console.error('[localAdapter] 网络连接失败，请检查:', {
              url,
              baseUrl: this.baseUrl,
              message: err.message
            });
            throw new Error(`Cannot connect to DeepSeek server at ${this.baseUrl}. Please check if the server is running and the URL is correct.`);
          }
        }
        
        console.error('[localAdapter] 请求异常:', err);
        throw err;
      }
  }

  private convertToDeepseekMessages(request: unknown): LocalMessage[] {
    const messages: LocalMessage[] = [];
    
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

  private convertToTools(googleTools: unknown[]): LocalTool[] {
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

  private buildResponse(choice: LocalResponse['choices'][0], request: GenerateContentParameters): GenerateContentResponse {
    // 检查是否有错误响应
    if (!choice) {
      throw new Error('Invalid response from Local server: no choices available');
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
        console.error('[localAdapter] 日志写入失败:', e);
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
        console.log('[localAdapter] tool_calls:', JSON.stringify(choice.message.tool_calls));
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

  private convertToLocalRequest(request: GenerateContentParameters): LocalRequest {
    const messages = this.convertToDeepseekMessages(request);
    const requestAny = request as unknown as Record<string, unknown>;
    const config = requestAny?.config as Record<string, unknown> | undefined;
    const googleTools = config?.tools || requestAny?.tools;
    const localTools = this.convertToTools(googleTools as unknown[]);
    // 检查是否是JSON生成请求
    const isJsonRequest = config?.responseMimeType === 'application/json' || config?.responseSchema;
    // 构造与 llm_http_test.py 一致的请求体
    const requestObj: any = {
      model: (requestAny?.model as string) || 'deepseek-chat',
      messages,
      stream: config?.stream ?? false,
      temperature: config?.temperature ?? 1,
      top_p: config?.top_p ?? 1,
      max_tokens: config?.maxOutputTokens ?? 2048,
      presence_penalty: config?.presence_penalty ?? 0,
      frequency_penalty: config?.frequency_penalty ?? 0,
      stop: config?.stop ?? null,
      logprobs: config?.logprobs ?? false,
      top_logprobs: config?.top_logprobs ?? null,
      response_format: config?.response_format ?? { type: 'text' },
      stream_options: config?.stream_options ?? null,
      tool_choice: config?.tool_choice ?? 'auto',
    };
    if (localTools.length > 0) {
      requestObj.tools = localTools;
    }
    // 如果是JSON请求，添加格式要求到系统消息
    if (isJsonRequest && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === 'user') {
        lastMessage.content += '\n\n请严格按照JSON格式回复，不要包含任何其他文本，不要使用markdown代码块。';
      }
    }
    return requestObj;
  }

  async generateContent(request: unknown): Promise<GenerateContentResponse> {
    // console.log('[localAdapter] generateContent 入参:', JSON.stringify(request));
    const requestObj = this.convertToLocalRequest(request as GenerateContentParameters);
    // console.log('[localAdapter] 最终发送请求:', JSON.stringify(requestObj, null, 2));
    const response = await this.makeRequest('/chat/completions', requestObj) as LocalResponse;
    const result = this.buildResponse(response.choices[0], request as GenerateContentParameters);
    // console.log('[localAdapter] generateContent 返回:', JSON.stringify(result));
    return result;
  }

  async generateContentStream(request: GenerateContentParameters): Promise<AsyncGenerator<GenerateContentResponse>> {
    // 始终降级为非流式，直接 yield 一次
    const result = await this.generateContent(request);
    async function* gen() { yield result; }
    return gen();
  }

  private async *streamDeepseekResponse(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    request: GenerateContentParameters
  ): AsyncGenerator<GenerateContentResponse> {
    let buffer = '';
    const seenToolCalls = new Set<string>();
    const textDecoder = new TextDecoder();
    const self = this;
    console.log('[localAdapter][stream] 开始读取流...');
    while (true) {
      let readResult;
      try {
        readResult = await reader.read();
      } catch (err) {
        console.error('[localAdapter][stream] 读取流时出错:', err);
        throw err;
      }
      const { done, value } = readResult;

      if (done) {
        console.log('[localAdapter][stream] 流读取完毕');
        break;
      }

      const chunkStr = textDecoder.decode(value);
      console.log('[localAdapter][stream] 收到chunk:', chunkStr);
      buffer += chunkStr;
      let lines = buffer.split('\n');
      buffer = lines.pop()!; // 最后一行可能是不完整的，留到下次
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('data:')) {
          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr || jsonStr === '[DONE]') continue;
          let chunk;
          try {
            chunk = JSON.parse(jsonStr);
          } catch (err) {
            console.error('[localAdapter][stream] JSON解析失败:', err, '内容:', jsonStr);
            continue;
          }
          const choice = chunk.choices?.[0];
          if (choice && choice.finish_reason) {
            console.log('[localAdapter][stream] 解析到 finish_reason:', choice.finish_reason);
            if (choice.message?.tool_calls) {
              choice.message.tool_calls = choice.message.tool_calls.filter((tc: any) => {
                const key = tc.function?.name + JSON.stringify(tc.function?.arguments);
                if (seenToolCalls.has(key)) return false;
                seenToolCalls.add(key);
                return true;
              });
            }
            const result = self.buildResponse(choice, request as GenerateContentParameters);
            console.log('[localAdapter][stream] yield 一个响应:', JSON.stringify(result));
            yield result;
          }
        }
      }

    }
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
    const responseObj = response as LocalResponse;
    const choice = responseObj?.choices?.[0];
    if (!choice) {
      return [];
    }

    const toolCalls = choice.message?.tool_calls;
    if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
      const afcHistory: Content[] = [];
      const seen = new Set<string>();
      
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
        const key = toolCall.function?.name + JSON.stringify(toolCall.function?.arguments);
        if (seen.has(key)) continue;
        seen.add(key);
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