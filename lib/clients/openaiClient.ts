// lib/clients/openaiClient.ts
import HttpClient from './httpClient';
import { ApiError } from '@/lib/utils/apiErrors';

interface OpenAIConfig {
  apiKey: string;
  organizationId?: string;
  assistantId: string;
  baseUrl?: string;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  file_ids?: string[];
}

export interface RunStatus {
  id: string;
  status: string;
  required_action?: any;
}

export interface ThreadMessage {
  id: string;
  content: any[];
  role: string;
  created_at: number;
}

class OpenAIClient {
  private client: HttpClient;
  private config: OpenAIConfig;
  private baseUrl: string;

  constructor(config: OpenAIConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    
    this.client = new HttpClient({
      timeout: 60000, // 60 seconds for OpenAI
      retries: 3,
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'OpenAI-Beta': 'assistants=v2',
        'Content-Type': 'application/json',
        ...(config.organizationId && { 'OpenAI-Organization': config.organizationId }),
      },
    });
  }

  // Thread Management
  async createThread(metadata?: Record<string, any>) {
    return this.client.post(`${this.baseUrl}/threads`, { metadata });
  }

  async getThread(threadId: string) {
    return this.client.get(`${this.baseUrl}/threads/${threadId}`);
  }

  async deleteThread(threadId: string) {
    return this.client.delete(`${this.baseUrl}/threads/${threadId}`);
  }

  async modifyThread(threadId: string, metadata: Record<string, any>) {
    return this.client.post(`${this.baseUrl}/threads/${threadId}`, { metadata });
  }

  // Message Management
  async addMessage(threadId: string, content: string, fileIds?: string[]) {
    const message: Message = {
      role: 'user',
      content,
      ...(fileIds && fileIds.length > 0 && { file_ids: fileIds }),
    };

    return this.client.post(`${this.baseUrl}/threads/${threadId}/messages`, message);
  }

  async getMessages(threadId: string, limit: number = 100) {
    return this.client.get<{ data: ThreadMessage[] }>(
      `${this.baseUrl}/threads/${threadId}/messages?limit=${limit}`
    );
  }

  // Run Management
  async createRun(threadId: string, assistantId?: string, instructions?: string) {
    return this.client.post(`${this.baseUrl}/threads/${threadId}/runs`, {
      assistant_id: assistantId || this.config.assistantId,
      ...(instructions && { instructions }),
    });
  }

  async getRun(threadId: string, runId: string): Promise<RunStatus> {
    return this.client.get(`${this.baseUrl}/threads/${threadId}/runs/${runId}`);
  }

  async cancelRun(threadId: string, runId: string) {
    return this.client.post(`${this.baseUrl}/threads/${threadId}/runs/${runId}/cancel`);
  }

  async submitToolOutputs(threadId: string, runId: string, outputs: any[]) {
    return this.client.post(
      `${this.baseUrl}/threads/${threadId}/runs/${runId}/submit_tool_outputs`,
      { tool_outputs: outputs }
    );
  }

  // Polling for run completion
  async waitForRunCompletion(
    threadId: string, 
    runId: string, 
    maxAttempts: number = 60,
    pollingInterval: number = 1000
  ): Promise<RunStatus> {
    for (let i = 0; i < maxAttempts; i++) {
      const run = await this.getRun(threadId, runId);
      
      if (['completed', 'failed', 'cancelled', 'expired'].includes(run.status)) {
        return run;
      }
      
      if (run.status === 'requires_action') {
        return run; // Caller needs to handle required actions
      }
      
      await new Promise(resolve => setTimeout(resolve, pollingInterval));
    }
    
    throw new ApiError('Run timeout: Maximum polling attempts reached', 408);
  }

  // File Management
  async uploadFile(file: Buffer | Blob, filename: string, purpose: string = 'assistants') {
    const formData = new FormData();
    const fileBlob = file instanceof Buffer ? new Blob([file as BlobPart]) : file;
    formData.append('file', fileBlob as Blob, filename);
    formData.append('purpose', purpose);

    // Use fetch directly for FormData
    const response = await fetch(`${this.baseUrl}/files`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        ...(this.config.organizationId && { 'OpenAI-Organization': this.config.organizationId }),
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(error.error?.message || 'File upload failed', response.status);
    }

    return response.json();
  }

  async getFile(fileId: string) {
    return this.client.get(`${this.baseUrl}/files/${fileId}`);
  }

  async deleteFile(fileId: string) {
    return this.client.delete(`${this.baseUrl}/files/${fileId}`);
  }

  async getFileContent(fileId: string) {
    return this.client.get(`${this.baseUrl}/files/${fileId}/content`);
  }

  // Streaming support for messages
  async *streamRun(threadId: string, assistantId?: string, instructions?: string) {
    const response = await fetch(`${this.baseUrl}/threads/${threadId}/runs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'OpenAI-Beta': 'assistants=v2',
        'Content-Type': 'application/json',
        ...(this.config.organizationId && { 'OpenAI-Organization': this.config.organizationId }),
      },
      body: JSON.stringify({
        assistant_id: assistantId || this.config.assistantId,
        stream: true,
        ...(instructions && { instructions }),
      }),
    });

    if (!response.ok || !response.body) {
      throw new ApiError('Stream initialization failed', response.status);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') return;
          
          try {
            yield JSON.parse(data);
          } catch (e) {
            console.error('Failed to parse stream data:', e);
          }
        }
      }
    }
  }

  // Error handling for OpenAI-specific errors
  handleOpenAIError(error: any): never {
    if (error.status === 429) {
      throw new ApiError('Rate limit exceeded. Please try again later.', 429, 'RATE_LIMIT');
    }
    if (error.status === 413) {
      throw new ApiError('Context length exceeded. Please reduce the message size.', 413, 'CONTEXT_LENGTH');
    }
    if (error.status === 401) {
      throw new ApiError('Invalid API key or unauthorized access.', 401, 'UNAUTHORIZED');
    }
    throw error;
  }
}

// Export singleton with configuration from environment
export const openaiClient = new OpenAIClient({
  apiKey: process.env.OPENAI_API_KEY!,
  organizationId: process.env.OPENAI_ORGANIZATION,
  assistantId: process.env.OPENAI_ASSISTANT_ID!,
});

// Export class for custom instances
export default OpenAIClient;