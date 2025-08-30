// lib/providers/openaiProvider.ts - SIMPLIFIED VERSION
import { openaiClient } from '@/lib/clients';
import { 
  AIProvider, 
  AIProviderOptions, 
  ChatResponse, 
  FileProcessingResult,
  Message
} from './aiProvider.interface';

// ✅ SIMPLIFIED: Use openaiClient for all operations instead of direct OpenAI SDK

export class OpenAIProvider implements AIProvider {
  name = 'openai';
  private assistantId: string;

  constructor() {
    this.assistantId = process.env.OPENAI_ASSISTANT_ID!;
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Test with a simple operation that will fail if not configured
      await openaiClient.getFile('test-file-id').catch(() => {});
      return true;
    } catch {
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
      
      // Get the latest message content
      const messageContent = messages[messages.length - 1].content;
      
      // Add message with file attachments
      await openaiClient.addMessage(threadId, messageContent, options.fileIds);
      
      // Create and run assistant
      const run = await openaiClient.createRun(threadId, this.assistantId);
      
      // Wait for completion
      const completedRun = await openaiClient.waitForRunCompletion(
        threadId,
        run.id,
        options.webSearchEnabled ? 900 : 300, // More time for web search
        options.webSearchEnabled ? 2000 : 1000 // Slower polling for web search
      );
      
      // Handle different run statuses
      if (completedRun.status === 'completed') {
        // Get the response messages
        const messagesResponse = await openaiClient.getMessages(threadId, 1);
        
        if (messagesResponse.data && messagesResponse.data.length > 0) {
          const assistantMessage = messagesResponse.data[0];
          const content = this.extractMessageContent(assistantMessage.content);
          
          return {
            reply: content,
            threadId,
            messageId: run.id,
            provider: this.name
          };
        }
      } else if (completedRun.status === 'requires_action') {
        // Handle tool outputs if needed
        if (completedRun.required_action) {
          return {
            reply: 'Additional action required. Please try again.',
            threadId,
            messageId: run.id,
            provider: this.name
          };
        }
      }
      
      throw new Error(`Run failed with status: ${completedRun.status}`);
      
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
      // Upload file using openaiClient
      const uploadedFile = await openaiClient.uploadFile(file, filename, 'assistants');
      
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
    // This would need to be added to openaiClient if needed
    // For now, return empty array as it's not used in current implementation
    console.warn('Embeddings generation not implemented in openaiClient');
    return [];
  }

  async createThread(): Promise<string> {
    const thread = await openaiClient.createThread();
    return thread.id;
  }

  async deleteThread(threadId: string): Promise<void> {
    await openaiClient.deleteThread(threadId);
  }

  async getThreadMessages(threadId: string): Promise<Message[]> {
    const messagesResponse = await openaiClient.getMessages(threadId);
    
    return messagesResponse.data.map(msg => ({
      id: msg.id,
      role: msg.role as 'user' | 'assistant',
      content: this.extractMessageContent(msg.content),
      created_at: new Date(msg.created_at * 1000).toISOString()
    }));
  }

  // Private helper methods
  
  private extractMessageContent(content: any): string {
    if (typeof content === 'string') {
      return content;
    }
    
    if (Array.isArray(content)) {
      return content
        .filter((item: any) => item.type === 'text')
        .map((item: any) => item.text?.value || '')
        .join('\n');
    }
    
    return '';
  }

  private determineTools(fileIds: string[]): string[] {
    // For now, always use code_interpreter for files
    // This could be enhanced to detect file types and choose appropriate tools
    return ['code_interpreter'];
  }
}