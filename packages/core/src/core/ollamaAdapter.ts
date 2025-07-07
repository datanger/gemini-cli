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

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OllamaRequest {
  model: string;
  messages: OllamaMessage[];
  stream?: boolean;
  options?: {
    temperature?: number;
    num_predict?: number;
    top_k?: number;
    top_p?: number;
    repeat_penalty?: number;
    seed?: number;
  };
  tools?: OllamaTool[];
  format?: string;
}

interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OllamaResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content?: string;
    tool_calls?: Array<{
      id: string;
      type: string;
      function: {
        name: string;
        arguments: string;
      };
    }>;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OllamaStreamDelta {
  role?: string;
  content?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

interface OllamaStreamChoice {
  index: number;
  delta: OllamaStreamDelta;
  finish_reason: string | null;
}

interface OllamaStreamResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content?: string;
    tool_calls?: Array<{
      id: string;
      type: string;
      function: {
        name: string;
        arguments: string;
      };
    }>;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export class OllamaAdapter implements ContentGenerator {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:11434') {
    this.baseUrl = baseUrl;
  }

  private async makeRequest(endpoint: string, data: unknown): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response.json();
  }

  private convertToOllamaMessages(request: unknown): OllamaMessage[] {
    const messages: OllamaMessage[] = [];
    
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

  private convertToOllamaTools(googleTools: unknown[]): OllamaTool[] {
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
    if (!parameters || typeof parameters !== 'object') {
      return {};
    }

    const params = parameters as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};

    // 处理 properties
    if (params.properties && typeof params.properties === 'object') {
      normalized.properties = params.properties;
    }

    // 处理 required
    if (params.required && Array.isArray(params.required)) {
      normalized.required = params.required;
    }

    // 处理 type
    if (params.type) {
      normalized.type = params.type;
    }

    return normalized;
  }

  private convertFinishReason(finishReason: string | null): FinishReason {
    if (!finishReason) return FinishReason.STOP;
    
    switch (finishReason.toLowerCase()) {
      case 'stop':
        return FinishReason.STOP;
      case 'length':
        return FinishReason.MAX_TOKENS;
      case 'tool_calls':
        return FinishReason.SAFETY;
      default:
        return FinishReason.STOP;
    }
  }

  private buildAutomaticFunctionCallingHistory(request: unknown, response: unknown): Content[] {
    const responseObj = response as OllamaResponse;
    const toolCalls = responseObj?.message?.tool_calls;
    
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

  private buildResponse(response: OllamaResponse, request: GenerateContentParameters): GenerateContentResponse {
    const generateContentResponse = new GenerateContentResponse();
    
    if (response.message?.content) {
      generateContentResponse.candidates = [{
        content: {
          parts: [{ text: response.message.content }],
          role: 'model'
        },
        index: 0,
        finishReason: this.convertFinishReason(response.done ? 'stop' : null),
        safetyRatings: []
      }];
    } else if (response.message?.tool_calls) {
      // Handle tool calls
      const parts: Part[] = [];
      
      for (const toolCall of response.message.tool_calls) {
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
      
      generateContentResponse.candidates = [{
        content: {
          parts,
          role: 'model'
        },
        index: 0,
        finishReason: this.convertFinishReason(response.done ? 'stop' : null),
        safetyRatings: []
      }];
    } else {
      // Empty response
      generateContentResponse.candidates = [{
        content: {
          parts: [],
          role: 'model'
        },
        index: 0,
        finishReason: this.convertFinishReason(response.done ? 'stop' : null),
        safetyRatings: []
      }];
    }
    
    generateContentResponse.automaticFunctionCallingHistory = this.buildAutomaticFunctionCallingHistory(request, response);
    
    return generateContentResponse;
  }

  private convertToOllamaRequest(request: GenerateContentParameters): OllamaRequest {
    const messages = this.convertToOllamaMessages(request);
    const requestAny = request as unknown as Record<string, unknown>;
    const config = requestAny?.config as Record<string, unknown> | undefined;
    const googleTools = config?.tools || requestAny?.tools;
    const ollamaTools = this.convertToOllamaTools(googleTools as unknown[]);
    
    return {
      model: (requestAny?.model as string) || 'llama2',
      messages,
      stream: false,
      options: {
        temperature: config?.temperature as number,
        num_predict: config?.maxOutputTokens as number,
      },
      tools: ollamaTools,
    };
  }

  async generateContent(request: unknown): Promise<GenerateContentResponse> {
    const messages = this.convertToOllamaMessages(request);
    
    const requestAny = request as unknown as Record<string, unknown>;
    const config = requestAny?.config as Record<string, unknown> | undefined;
    const googleTools = config?.tools || requestAny?.tools;
    const ollamaTools = this.convertToOllamaTools(googleTools as unknown[]);
    
    const ollamaRequest: OllamaRequest = {
      model: (requestAny?.model as string) || 'llama2',
      messages,
      stream: false,
      options: {
        temperature: config?.temperature as number,
        num_predict: config?.maxOutputTokens as number,
      },
      tools: ollamaTools,
    };

    const response = await this.makeRequest('/api/chat', ollamaRequest) as OllamaResponse;
    
    const generateContentResponse = this.buildResponse(response, request as GenerateContentParameters);
    
    generateContentResponse.usageMetadata = {
      promptTokenCount: response.prompt_eval_count || 0,
      candidatesTokenCount: response.eval_count || 0,
      totalTokenCount: (response.prompt_eval_count || 0) + (response.eval_count || 0)
    };
    
    generateContentResponse.createTime = response.created_at || new Date().toISOString();
    generateContentResponse.responseId = `ollama-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    generateContentResponse.modelVersion = response.model || 'llama2';
    
    return generateContentResponse;
  }

  async generateContentStream(request: GenerateContentParameters): Promise<AsyncGenerator<GenerateContentResponse>> {
    const messages = this.convertToOllamaMessages(request);
    const requestAny = request as unknown as Record<string, unknown>;
    const config = requestAny?.config as Record<string, unknown> | undefined;
    const googleTools = config?.tools || requestAny?.tools;
    const ollamaTools = this.convertToOllamaTools(googleTools as unknown[]);
    
    const ollamaRequest: OllamaRequest = {
      model: (requestAny?.model as string) || 'llama2',
      messages,
      stream: true,
      options: {
        temperature: config?.temperature as number,
        num_predict: config?.maxOutputTokens as number,
      },
      tools: ollamaTools,
    };

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(ollamaRequest),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Failed to get response reader');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    const accumulatedToolCalls: Array<{
      id?: string;
      type?: string;
      function?: {
        name?: string;
        arguments?: string;
      };
    }> = [];

    return (async function* (this: OllamaAdapter) {
      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.trim() === '') continue;

            try {
              const parsed = JSON.parse(line) as OllamaStreamResponse;
              
              if (parsed.message?.tool_calls) {
                // 累积 tool_calls，不 yield
                for (const toolCall of parsed.message.tool_calls) {
                  const existingIndex = accumulatedToolCalls.findIndex(tc => tc.id === toolCall.id);
                  if (existingIndex >= 0) {
                    if (toolCall.function?.name) accumulatedToolCalls[existingIndex].function = accumulatedToolCalls[existingIndex].function || {};
                    if (toolCall.function?.name) accumulatedToolCalls[existingIndex].function!.name = toolCall.function.name;
                    if (toolCall.function?.arguments) {
                      accumulatedToolCalls[existingIndex].function = accumulatedToolCalls[existingIndex].function || {};
                      accumulatedToolCalls[existingIndex].function!.arguments = 
                        (accumulatedToolCalls[existingIndex].function!.arguments || '') + toolCall.function.arguments;
                    }
                  } else {
                    accumulatedToolCalls.push({
                      id: toolCall.id,
                      type: toolCall.type,
                      function: {
                        name: toolCall.function?.name,
                        arguments: toolCall.function?.arguments || ''
                      }
                    });
                  }
                }
              } else if (parsed.message?.content) {
                // 如果有累积的 tool_calls，先 yield 它们
                if (accumulatedToolCalls.length > 0) {
                  const parts: Part[] = [];
                  for (const toolCall of accumulatedToolCalls) {
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
                  
                  const generateContentResponse = new GenerateContentResponse();
                  generateContentResponse.candidates = [{
                    content: {
                      parts,
                      role: 'model'
                    },
                    index: 0,
                    finishReason: FinishReason.SAFETY,
                    safetyRatings: []
                  }];
                  
                  generateContentResponse.automaticFunctionCallingHistory = this.buildAutomaticFunctionCallingHistory(request, { message: { tool_calls: accumulatedToolCalls } });
                  generateContentResponse.createTime = parsed.created_at || new Date().toISOString();
                  generateContentResponse.responseId = `ollama-stream-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                  generateContentResponse.modelVersion = parsed.model || 'llama2';
                  
                  yield generateContentResponse;
                  accumulatedToolCalls.splice(0); // 清空累积的 tool_calls
                }

                // Yield 文本内容
                const generateContentResponse = new GenerateContentResponse();
                generateContentResponse.candidates = [{
                  content: {
                    parts: [{ text: parsed.message.content }],
                    role: 'model'
                  },
                  index: 0,
                  finishReason: parsed.done ? this.convertFinishReason('stop') : undefined,
                  safetyRatings: []
                }];
                
                generateContentResponse.automaticFunctionCallingHistory = [];
                generateContentResponse.createTime = parsed.created_at || new Date().toISOString();
                generateContentResponse.responseId = `ollama-stream-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                generateContentResponse.modelVersion = parsed.model || 'llama2';
                
                yield generateContentResponse;
              }
            } catch (error) {
              console.error('Error parsing Ollama stream response:', error);
            }
          }
        }

        // 处理最后的 tool_calls（如果有的话）
        if (accumulatedToolCalls.length > 0) {
          const parts: Part[] = [];
          for (const toolCall of accumulatedToolCalls) {
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
          
          const generateContentResponse = new GenerateContentResponse();
          generateContentResponse.candidates = [{
            content: {
              parts,
              role: 'model'
            },
            index: 0,
            finishReason: FinishReason.SAFETY,
            safetyRatings: []
          }];
          
          generateContentResponse.automaticFunctionCallingHistory = this.buildAutomaticFunctionCallingHistory(request, { message: { tool_calls: accumulatedToolCalls } });
          generateContentResponse.createTime = new Date().toISOString();
          generateContentResponse.responseId = `ollama-stream-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          generateContentResponse.modelVersion = 'llama2';
          
          yield generateContentResponse;
        }
      } finally {
        reader.releaseLock();
      }
    }).call(this);
  }

  async countTokens(request: unknown): Promise<CountTokensResponse> {
    // Ollama 不直接支持 token 计数，返回估算值
    const requestAny = request as Record<string, unknown>;
    const text = (requestAny?.text as string) || '';
    const estimatedTokens = Math.ceil(text.length / 4); // 粗略估算
    
    return {
      totalTokens: estimatedTokens,
    };
  }

  async embedContent(_request: unknown): Promise<EmbedContentResponse> {
    throw new Error('Embedding not supported by Ollama adapter');
  }
} 
