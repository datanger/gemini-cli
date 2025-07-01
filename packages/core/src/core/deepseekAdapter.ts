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
}

interface DeepseekResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface DeepseekStreamResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }>;
}

export class DeepseekAdapter implements ContentGenerator {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string = 'https://api.deepseek.com') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  private async makeRequest(endpoint: string, data: any): Promise<any> {
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

  private convertToDeepseekMessages(request: any): DeepseekMessage[] {
    const messages: DeepseekMessage[] = [];
    
    // 简单处理：从请求中提取文本内容
    if (request.contents && Array.isArray(request.contents)) {
      for (const content of request.contents) {
        if (content.role === 'user' && content.parts) {
          const text = content.parts
            .filter((part: any) => part.text)
            .map((part: any) => part.text)
            .join('');
          if (text) {
            messages.push({ role: 'user', content: text });
          }
        } else if (content.role === 'model' && content.parts) {
          const text = content.parts
            .filter((part: any) => part.text)
            .map((part: any) => part.text)
            .join('');
          if (text) {
            messages.push({ role: 'assistant', content: text });
          }
        }
      }
    }

    // 如果没有消息，添加一个默认的系统消息
    if (messages.length === 0) {
      messages.push({ role: 'system', content: 'You are a helpful assistant.' });
    }

    return messages;
  }

  async generateContent(request: any): Promise<GenerateContentResponse> {
    const messages = this.convertToDeepseekMessages(request);
    
    const deepseekRequest: DeepseekRequest = {
      model: request.model || 'deepseek-chat',
      messages,
      stream: false,
      temperature: request.config?.temperature,
      max_tokens: request.config?.maxOutputTokens,
    };

    try {
      const response = await this.makeRequest('/v1/chat/completions', deepseekRequest);
      
      return {
        candidates: [{
          content: {
            parts: [{ text: response.choices[0].message.content }]
          },
          finishReason: response.choices[0].finish_reason === 'stop' ? 'STOP' : 'OTHER'
        }],
        usageMetadata: {
          promptTokenCount: response.usage.prompt_tokens,
          candidatesTokenCount: response.usage.completion_tokens,
          totalTokenCount: response.usage.total_tokens
        },
        text: response.choices[0].message.content
      } as GenerateContentResponse;
    } catch (error) {
      console.error('Deepseek API error:', error);
      throw error;
    }
  }

  async generateContentStream(request: any): Promise<AsyncGenerator<GenerateContentResponse>> {
    const messages = this.convertToDeepseekMessages(request);
    
    const deepseekRequest: DeepseekRequest = {
      model: request.model || 'deepseek-chat',
      messages,
      stream: true,
      temperature: request.config?.temperature,
      max_tokens: request.config?.maxOutputTokens,
    };

    const self = this;
    return (async function* () {
      try {
        const response = await fetch(`${self.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${self.apiKey}`,
          },
          body: JSON.stringify(deepseekRequest),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Deepseek API error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('Failed to get response reader');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') return;

              try {
                const parsed: DeepseekStreamResponse = JSON.parse(data);
                if (parsed.choices[0].delta.content) {
                  yield {
                    candidates: [{
                      content: {
                        parts: [{ text: parsed.choices[0].delta.content }]
                      }
                    }]
                  } as GenerateContentResponse;
                }
              } catch (e) {
                // 忽略解析错误
              }
            }
          }
        }
      } catch (error) {
        console.error('Deepseek stream error:', error);
        throw error;
      }
    })();
  }

  async countTokens(request: any): Promise<CountTokensResponse> {
    // Deepseek API 没有直接的 token 计数端点，返回估算值
    const text = request.contents?.[0]?.parts?.[0]?.text || '';
    return {
      totalTokens: Math.ceil(text.length / 4) // 粗略估算
    } as CountTokensResponse;
  }

  async embedContent(request: any): Promise<EmbedContentResponse> {
    throw new Error('Embedding not supported by Deepseek adapter');
  }
} 