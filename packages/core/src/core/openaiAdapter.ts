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

export class OpenAIAdapter {
  private apiKey: string;
  private apiBase: string;
  private apiVersion: string;
  private apiModel: string;
  private openai: any;

  constructor({
    apiKey,
    apiBase,
    apiVersion,
    apiModel,
  }: {
    apiKey: string;
    apiBase: string;
    apiVersion: string;
    apiModel: string;
  }) {
    this.apiKey = apiKey;
    this.apiBase = apiBase;
    this.apiVersion = apiVersion;
    this.apiModel = apiModel;
  }

  private async getOpenAI() {
    if (!this.openai) {
      const { OpenAI } = await import('openai');
      this.openai = new OpenAI({
        apiKey: this.apiKey,
        baseURL: this.apiBase,
        defaultHeaders: this.apiVersion ? { 'OpenAI-Version': this.apiVersion } : undefined,
      });
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
          // 否则使用文本内容
          message.content = c.parts.map((p: any) => p.text).join('');
        }
      } else {
        message.content = '';
      }
      
      return message;
    });
  }

  async generateContent(request: GenerateContentParameters): Promise<GenerateContentResponse> {
    const openai = await this.getOpenAI();
    const messages = this.toMessages(request.contents);
    
    const requestConfig: any = {
      model: this.apiModel,
      messages,
    };
    
    // 处理工具调用 - 将Gemini格式转换为OpenAI格式
    if ((request as any).config?.tools) {
      const geminiTools = (request as any).config.tools;
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
      
      if (openaiTools.length > 0) {
        requestConfig.tools = openaiTools;
        // console.log('[DEBUG] OpenAI tools:', JSON.stringify(openaiTools, null, 2));
      }
    }
    
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
            console.error('[DEBUG] Failed to parse tool arguments:', tc.function.arguments, error);
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
  }

  async generateContentStream(request: GenerateContentParameters): Promise<AsyncGenerator<GenerateContentResponse>> {
    const openai = await this.getOpenAI();
    const messages = this.toMessages(request.contents);
    
    const requestConfig: any = {
      model: this.apiModel,
      messages,
      stream: true,
    };
    
    // 处理工具调用 - 将Gemini格式转换为OpenAI格式
    if ((request as any).config?.tools) {
      const geminiTools = (request as any).config.tools;
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
      
      if (openaiTools.length > 0) {
        requestConfig.tools = openaiTools;
        // console.log('[DEBUG] OpenAI tools:', JSON.stringify(openaiTools, null, 2));
      }
    }
    
    const stream = await openai.chat.completions.create(requestConfig);
    
    // 用于累积工具调用信息
    const toolCallsBuffer: any[] = [];
    
    async function* gen() {
      for await (const chunk of stream) {
        // 处理工具调用
        // console.log('\n[DEBUG] OpenAI tool calls:', JSON.stringify(chunk.choices[0]?.delta?.tool_calls, null, 2));
        // console.log('\n[DEBUG] OpenAI contents:', JSON.stringify(chunk.choices[0]?.delta?.content, null, 2));
        if (chunk.choices[0]?.delta?.tool_calls) {
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
        
        yield {
          candidates: [
            {
              content: {
                parts: [{ text: chunk.choices[0]?.delta?.content || '' }],
                role: 'model',
              },
              index: 0,
              finishReason: chunk.choices[0]?.finish_reason,
              safetyRatings: [],
            },
          ],
          text: chunk.choices[0]?.delta?.content || '',
          data: undefined,
          functionCalls: toolCallsBuffer.length > 0 ? toolCallsBuffer.map((tc: any) => {
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
          }) : undefined,
          executableCode: undefined,
          codeExecutionResult: undefined,
        };
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
      model: this.apiModel,
      input,
    });
    return {
      embedding: embedding.data[0].embedding,
    } as EmbedContentResponse;
  }
} 
