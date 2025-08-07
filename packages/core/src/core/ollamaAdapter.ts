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
  FinishReason,
} from '@google/genai';

export class OllamaAdapter {
  private baseUrl: string;
  private apiModel: string;

  constructor(baseUrl: string = 'http://localhost:11434', apiModel?: string) {
    this.baseUrl = baseUrl;
    this.apiModel = apiModel || 'llama2';
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

  async generateContent(request: GenerateContentParameters): Promise<GenerateContentResponse> {
    const messages = this.toMessages(request.contents);
    const requestAny = request as unknown as Record<string, unknown>;
    const config = requestAny?.config as Record<string, unknown> | undefined;
    
    const requestConfig: any = {
      model: this.apiModel,
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
    // 注意：某些 Ollama 模型不支持工具调用，所以我们需要检查
    if ((request as any).config?.tools) {
      const geminiTools = (request as any).config.tools;
      const openaiTools = this.convertToOpenAITools(geminiTools);
      
      // 只有当有工具时才添加工具配置
      if (openaiTools.length > 0) {
        // 对于不支持工具的模型，我们跳过工具调用
        // 这里可以根据模型名称或其他方式来判断是否支持工具
        if (this.apiModel.includes('qwen3-coder') || this.apiModel.includes('qwen')) {
          // Qwen 模型可能不支持工具调用，跳过
        } else {
          requestConfig.tools = openaiTools;
          requestConfig.tool_choice = 'auto';
        }
      }
    }
    
    // 使用 Ollama 的 OpenAI 兼容端点
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestConfig),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const completion = await response.json();
    
    const responseObj: GenerateContentResponse = {
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
    
    return responseObj;
  }

  async generateContentStream(request: GenerateContentParameters): Promise<AsyncGenerator<GenerateContentResponse>> {
    const messages = this.toMessages(request.contents);
    const requestAny = request as unknown as Record<string, unknown>;
    const config = requestAny?.config as Record<string, unknown> | undefined;
    
    const requestConfig: any = {
      model: this.apiModel,
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
    if ((request as any).config?.tools) {
      const geminiTools = (request as any).config.tools;
      const openaiTools = this.convertToOpenAITools(geminiTools);
      
      // 只有当有工具时才添加工具配置
      if (openaiTools.length > 0) {
        // 对于不支持工具的模型，我们跳过工具调用
        // 这里可以根据模型名称或其他方式来判断是否支持工具
        if (this.apiModel.includes('qwen3-coder') || this.apiModel.includes('qwen')) {
          // Qwen 模型可能不支持工具调用，跳过
        } else {
          requestConfig.tools = openaiTools;
          requestConfig.tool_choice = 'auto';
        }
      }
    }
    
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestConfig),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Failed to get response reader');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    
    // 用于累积工具调用信息
    const toolCallsBuffer: any[] = [];
    let accumulatedText = '';
    let hasToolCalls = false;
    
    async function* gen() {
      // 确保 reader 存在
      if (!reader) {
        throw new Error('Reader is not available');
      }
      
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
                // 流结束
                if (accumulatedText || toolCallsBuffer.length > 0) {
                  yield createResponse(accumulatedText, toolCallsBuffer);
                }
                return;
              }
              
              try {
                const chunk = JSON.parse(data);
                
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
                  if (accumulatedText || toolCallsBuffer.length > 0) {
                    yield createResponse(accumulatedText, toolCallsBuffer);
                  }
                  
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
              } catch (error) {
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    }
    
    function createResponse(text: string, toolCalls: any[]): GenerateContentResponse {
      const functionCalls = toolCalls.length > 0 ? toolCalls.map((tc: any) => {
        let args = {};
        if (tc.function?.arguments) {
          try {
            args = JSON.parse(tc.function.arguments);
          } catch (_error) {
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
      if (text) {
        parts.push({ text });
      }
      if (functionCalls && functionCalls.length > 0) {
        parts.push({ 
          functionCall: {
            name: functionCalls[0].name,
            args: functionCalls[0].args
          }
        });
      }
      
      return {
        candidates: [
          {
            content: {
              parts: parts.length > 0 ? parts : [{ text: '' }],
              role: 'model',
            },
            index: 0,
            finishReason: FinishReason.STOP,
            safetyRatings: [],
          },
        ],
        text: text || '',
        functionCalls: functionCalls ? functionCalls : undefined,
        data: undefined,
        executableCode: undefined,
        codeExecutionResult: undefined,
      };
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
    const input = Array.isArray(request.contents)
      ? request.contents.map((c: any) => Array.isArray(c.parts) ? c.parts.map((p: any) => p.text).join('') : '').join('\n')
      : '';
    
    // Ollama 目前不支持嵌入，返回空数组
    return {
      embedding: new Array(1536).fill(0), // 返回固定大小的零向量
    } as EmbedContentResponse;
  }
}
