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

interface DeepseekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface DeepseekRequest {
  model: string;
  messages: DeepseekMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
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
  model?: string;
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

export class DeepseekAdapter implements ContentGenerator {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string = 'https://api.deepseek.com') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  private async makeRequest(endpoint: string, data: unknown): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Deepseek API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response.json();
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
            messages.push({ role: 'user', content: text });
          }
        } else if (content.role === 'model' && content.parts) {
          const text = (content.parts as Array<Record<string, unknown>>)
            .filter((part: unknown) => part && typeof part === 'object' && 'text' in part)
            .map((part: Record<string, unknown>) => part.text as string)
            .join('');
          if (text) {
            messages.push({ role: 'assistant', content: text });
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

    return googleTools.map(tool => {
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

    const functionCall = choice.message?.function_call;
    if (functionCall) {
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
      
      try {
        const args = functionCall.arguments ? JSON.parse(functionCall.arguments) : {};
        afcHistory.push({
          role: 'model',
          parts: [{
            functionCall: {
              name: functionCall.name || 'unknown_function',
              args
            }
          }]
        });
      } catch {
        afcHistory.push({
          role: 'model',
          parts: [{
            functionCall: {
              name: functionCall.name || 'unknown_function',
              args: { raw_arguments: functionCall.arguments }
            }
          }]
        });
      }
      
      return afcHistory;
    }

    return [];
  }

  private buildResponse(choice: DeepseekResponse['choices'][0], request: GenerateContentParameters): GenerateContentResponse {
    const response = new GenerateContentResponse();
    
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
    
    response.automaticFunctionCallingHistory = this.buildAutomaticFunctionCallingHistory(request, { choices: [choice] });
    
    return response;
  }

  private convertToDeepseekRequest(request: GenerateContentParameters): DeepseekRequest {
    const messages = this.convertToDeepseekMessages(request);
    const requestAny = request as unknown as Record<string, unknown>;
    const config = requestAny?.config as Record<string, unknown> | undefined;
    const googleTools = config?.tools || requestAny?.tools;
    const deepseekTools = this.convertToDeepseekTools(googleTools as unknown[]);
    
    return {
      model: (requestAny?.model as string) || 'deepseek-chat',
      messages,
      stream: true,
      temperature: config?.temperature as number,
      max_tokens: config?.maxOutputTokens as number,
      tools: deepseekTools,
    };
  }

  async generateContent(request: unknown): Promise<GenerateContentResponse> {
    const messages = this.convertToDeepseekMessages(request);
    
    const requestAny = request as unknown as Record<string, unknown>;
    const config = requestAny?.config as Record<string, unknown> | undefined;
    const googleTools = config?.tools || requestAny?.tools;
    const deepseekTools = this.convertToDeepseekTools(googleTools as unknown[]);
    
    const deepseekRequest: DeepseekRequest = {
      model: (requestAny?.model as string) || 'deepseek-chat',
      messages,
      stream: false,
      temperature: config?.temperature as number,
      max_tokens: config?.maxOutputTokens as number,
      tools: deepseekTools,
    };

    const response = await this.makeRequest('/v1/chat/completions', deepseekRequest) as DeepseekResponse;
    
    const generateContentResponse = new GenerateContentResponse();
    
    generateContentResponse.candidates = [{
      content: {
        parts: [{ text: response.choices[0].message.content || '' }]
      },
      finishReason: this.convertFinishReason(response.choices[0].finish_reason)
    }];
    
    generateContentResponse.usageMetadata = {
      promptTokenCount: response.usage?.prompt_tokens || 0,
      candidatesTokenCount: response.usage?.completion_tokens || 0,
      totalTokenCount: response.usage?.total_tokens || 0
    };
    
    generateContentResponse.automaticFunctionCallingHistory = this.buildAutomaticFunctionCallingHistory(request, response);
    
    generateContentResponse.createTime = new Date().toISOString();
    generateContentResponse.responseId = `deepseek-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    generateContentResponse.modelVersion = response.model || 'deepseek-chat';
    
    return generateContentResponse;
  }

  async generateContentStream(request: GenerateContentParameters): Promise<AsyncGenerator<GenerateContentResponse>> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(this.convertToDeepseekRequest(request)),
    });

    if (!response.ok) {
      throw new Error(`Deepseek API error: ${response.status} ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Failed to get response reader');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    const accumulatedToolCalls: Array<{
      index: number;
      id?: string;
      function?: {
        name?: string;
        arguments?: string;
      };
    }> = [];

    return (async function* (this: DeepseekAdapter) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                // 只在 [DONE] 时 yield 工具调用响应
                if (accumulatedToolCalls.length > 0) {
                  try {
                    const response = this.buildResponse({
                      index: 0,
                      message: {
                        tool_calls: accumulatedToolCalls.map(tc => ({
                          function: {
                            name: tc.function?.name || 'unknown_function',
                            arguments: tc.function?.arguments || '{}'
                          }
                        })),
                        function_call: undefined,
                        content: undefined
                      },
                      finish_reason: 'stop'
                    }, request);
                    yield response;
                  } catch (e) {
                    console.error('Failed to parse accumulated tool calls:', e);
                  }
                }
                return;
              }

              try {
                const parsed = JSON.parse(data) as DeepseekStreamResponse;
                const delta = parsed.choices?.[0]?.delta;
                
                if (delta?.tool_calls) {
                  // 只累积 tool_calls，不 yield
                  for (const toolCall of delta.tool_calls) {
                    const existingIndex = accumulatedToolCalls.findIndex(tc => tc.index === toolCall.index);
                    if (existingIndex >= 0) {
                      if (toolCall.id) accumulatedToolCalls[existingIndex].id = toolCall.id;
                      if (toolCall.function?.name) accumulatedToolCalls[existingIndex].function = accumulatedToolCalls[existingIndex].function || {};
                      if (toolCall.function?.name) accumulatedToolCalls[existingIndex].function!.name = toolCall.function.name;
                      if (toolCall.function?.arguments) {
                        accumulatedToolCalls[existingIndex].function = accumulatedToolCalls[existingIndex].function || {};
                        accumulatedToolCalls[existingIndex].function!.arguments = 
                          (accumulatedToolCalls[existingIndex].function!.arguments || '') + toolCall.function.arguments;
                      }
                    } else {
                      accumulatedToolCalls.push({
                        index: toolCall.index,
                        id: toolCall.id,
                        function: {
                          name: toolCall.function?.name,
                          arguments: toolCall.function?.arguments || ''
                        }
                      });
                    }
                  }
                } else if (delta?.content) {
                  // 普通文本内容，直接 yield
                  const response = new GenerateContentResponse();
                  response.candidates = [{
                    content: {
                      parts: [{ text: delta.content }],
                      role: 'model'
                    },
                    index: 0,
                    finishReason: this.convertFinishReason(delta.finish_reason),
                    safetyRatings: []
                  }];
                  yield response;
                }
              } catch (e) {
                console.error('Failed to parse SSE data:', e);
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    }).bind(this)();
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
    throw new Error('Embedding not supported by Deepseek adapter');
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
} 
