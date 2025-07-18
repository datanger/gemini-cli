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
    return contents.map((c: any) => ({
      role: c.role === 'model' ? 'assistant' : c.role,
      content: Array.isArray(c.parts) ? c.parts.map((p: any) => p.text).join('') : ''
    }));
  }

  async generateContent(request: GenerateContentParameters): Promise<GenerateContentResponse> {
    const openai = await this.getOpenAI();
    const messages = this.toMessages(request.contents);
    const completion = await openai.chat.completions.create({
      model: this.apiModel,
      messages,
    });
    return {
      candidates: [
        {
          content: {
            parts: [{ text: completion.choices[0].message.content }],
            role: 'model',
          },
          index: 0,
          finishReason: completion.choices[0].finish_reason,
          safetyRatings: [],
        },
      ],
      text: completion.choices[0].message.content,
      data: undefined,
      functionCalls: undefined,
      executableCode: undefined,
      codeExecutionResult: undefined,
    };
  }

  async generateContentStream(request: GenerateContentParameters): Promise<AsyncGenerator<GenerateContentResponse>> {
    const openai = await this.getOpenAI();
    const messages = this.toMessages(request.contents);
    const stream = await openai.chat.completions.create({
      model: this.apiModel,
      messages,
      stream: true,
    });
    async function* gen() {
      for await (const chunk of stream) {
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
          functionCalls: undefined,
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