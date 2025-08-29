// lib/providers/openaiProvider.ts
import OpenAI from 'openai';
import { 
  AIProvider, 
  AIProviderOptions, 
  ChatResponse, 
  FileProcessingResult,
  FileAttachment,
  Message
} from './aiProvider.interface';

export class OpenAIProvider implements AIProvider {
  name = 'openai';
  private client: OpenAI;
  private assistantId: string;
  private maxRetries = 5;
  private pollInterval = 1000;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      organization: process.env.OPENAI_ORGANIZATION,
    });
    this.assistantId = process.env.OPENAI_ASSISTANT_ID!;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch (error) {
      console.error('OpenAI provider not available:', error);
      return false;
    }
  }

  async generateResponse(
    messages: Message[],
    options: AIProviderOptions
  ): Promise<ChatResponse> {
    try {
      // Get or create thread
      const threadId = options.threadId || await this.createThread();
      
      // Prepare message content
      const messageContent = messages[messages.length - 1].content;
      
      // Create message with file attachments if provided
      const messageData: any = {
        role: 'user',
        content: messageContent
      };
      
      if (options.fileIds && options.fileIds.length > 0) {
        // Determine tools based on file types
        const tools = options.tools || this.determineTools(options.fileIds);
        
        messageData.attachments = options.fileIds.map(fileId => ({
          file_id: fileId,
          tools: tools.map(tool => ({ type: tool }))
        }));
      }
      
      // Add message to thread
      await this.client.beta.threads.messages.create(threadId, messageData);
      
      // Create run with optional instructions
      const runData: any = {
        assistant_id: this.assistantId,
        max_prompt_tokens: 40000,
        max_completion_tokens: 8000,
      };
      
      // Add web search instruction if enabled
      if (options.webSearchEnabled) {
        runData.additional_instructions = 'Use web search to find current information if needed.';
      }
      
      // Add response format instruction
      if (options.responseFormat === 'json') {
        runData.additional_instructions = (runData.additional_instructions || '') + 
          '\nFormat your response as valid JSON.';
      }
      
      const run = await this.client.beta.threads.runs.create(threadId, runData);
      
      // Poll for completion
      const result = await this.pollForCompletion(threadId, run.id);
      
      // Extract response
      return await this.extractResponse(threadId, result);
    } catch (error) {
      console.error('OpenAI generation error:', error);
      throw error;
    }
  }

  async processFile(
    file: Buffer,
    fileType: string,
    filename: string
  ): Promise<FileProcessingResult> {
    try {
      // Upload file to OpenAI
      const uploadedFile = await this.client.files.create({
        file: new File([file], filename, { type: fileType }),
        purpose: 'assistants'
      });
      
      return {
        fileId: uploadedFile.id,
        metadata: {
          filename: uploadedFile.filename,
          bytes: uploadedFile.bytes,
          created_at: uploadedFile.created_at
        }
      };
    } catch (error: any) {
      console.error('File processing error:', error);
      return {
        fileId: '',
        error: error.message || 'Failed to process file'
      };
    }
  }

  async generateEmbeddings(text: string): Promise<number[]> {
    try {
      const response = await this.client.embeddings.create({
        model: "text-embedding-3-small",
        input: text,
      });
      return response.data[0].embedding;
    } catch (error) {
      console.error('Embedding generation error:', error);
      return [];
    }
  }

  async createThread(): Promise<string> {
    const thread = await this.client.beta.threads.create();
    return thread.id;
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.client.beta.threads.del(threadId);
  }

  async getThreadMessages(threadId: string): Promise<Message[]> {
    const messagesResponse = await this.client.beta.threads.messages.list(threadId, {
      order: 'asc'
    });
    
    return messagesResponse.data.map(msg => ({
      id: msg.id,
      role: msg.role as 'user' | 'assistant',
      content: this.extractMessageContent(msg.content),
      created_at: new Date(msg.created_at * 1000).toISOString()
    }));
  }

  // Private helper methods
  
  private async pollForCompletion(threadId: string, runId: string): Promise<any> {
    let retries = 0;
    
    while (retries < this.maxRetries) {
      await new Promise(resolve => setTimeout(resolve, this.pollInterval));
      
      const run = await this.client.beta.threads.runs.retrieve(threadId, runId);
      
      if (run.status === 'completed') {
        return run;
      } else if (run.status === 'failed' || run.status === 'cancelled' || run.status === 'expired') {
        throw new Error(`Run ${run.status}: ${run.last_error?.message || 'Unknown error'}`);
      } else if (run.status === 'requires_action') {
        // Handle tool calls if needed
        console.log('Run requires action - tools not implemented');
      }
      
      retries++;
    }
    
    throw new Error('Response timeout - assistant took too long');
  }

  private async extractResponse(threadId: string, run: any): Promise<ChatResponse> {
    // Get messages after run completion
    const messages = await this.client.beta.threads.messages.list(threadId, {
      order: 'desc',
      limit: 1
    });
    
    const lastMessage = messages.data[0];
    if (!lastMessage || lastMessage.role !== 'assistant') {
      throw new Error('No assistant response found');
    }
    
    // Extract content
    const content = this.extractMessageContent(lastMessage.content);
    
    // Extract file attachments
    const files = await this.extractFileAttachments(lastMessage);
    
    // Parse JSON if needed
    let parsedResponse;
    if (this.looksLikeJson(content)) {
      try {
        parsedResponse = JSON.parse(content);
      } catch {
        // Not valid JSON
      }
    }
    
    return {
      reply: content,
      threadId,
      messageId: lastMessage.id,
      files,
      usage: run.usage ? {
        promptTokens: run.usage.prompt_tokens,
        completionTokens: run.usage.completion_tokens,
        totalTokens: run.usage.total_tokens
      } : undefined,
      parsedResponse
    };
  }

  private extractMessageContent(content: any): string {
    if (Array.isArray(content)) {
      return content
        .filter(block => block.type === 'text')
        .map(block => block.text?.value || '')
        .join('\n');
    }
    
    if (typeof content === 'string') {
      return content;
    }
    
    if (content?.text?.value) {
      return content.text.value;
    }
    
    return '';
  }

  private async extractFileAttachments(message: any): Promise<FileAttachment[]> {
    const files: FileAttachment[] = [];
    
    if (!message.content || !Array.isArray(message.content)) {
      return files;
    }
    
    for (const block of message.content) {
      if (block.type === 'image_file') {
        files.push({
          file_id: block.image_file.file_id,
          filename: 'image',
          content_type: 'image/png'
        });
      }
    }
    
    // Check for file citations in annotations
    for (const block of message.content) {
      if (block.text?.annotations) {
        for (const annotation of block.text.annotations) {
          if (annotation.type === 'file_citation') {
            files.push({
              file_id: annotation.file_citation.file_id,
              filename: annotation.text || 'file'
            });
          }
        }
      }
    }
    
    return files;
  }

  private determineTools(fileIds: string[]): string[] {
    // This is simplified - in reality you'd check file types
    // For now, default to code_interpreter for data files
    return ['code_interpreter'];
  }

  private looksLikeJson(content: string): boolean {
    const trimmed = content.trim();
    return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
           (trimmed.startsWith('[') && trimmed.endsWith(']'));
  }
}