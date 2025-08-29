// services/aiProviderService.ts
import { AIProvider, ChatResponse, AIProviderOptions } from '../lib/providers/aiProvider.interface';
import { ProviderFactory } from '../lib/providers/providerFactory';

// Message type definition (matches your existing types)
interface Message {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string | any;
  created_at?: string;
  files?: any[];
}

/**
 * Main AI Provider Service
 * Orchestrates AI interactions with automatic fallback support
 */
export class AIProviderService {
  private static provider: AIProvider | null = null;
  private static providerType: string = 'openai';
  private static initialized: boolean = false;

  /**
   * Initialize provider based on environment
   */
  static async initialize(forceProvider?: string): Promise<void> {
    try {
      this.providerType = forceProvider || process.env.AI_PROVIDER || 'openai';
      
      console.log(`Initializing AI provider: ${this.providerType}`);
      
      this.provider = await ProviderFactory.createProvider(this.providerType);
      this.initialized = true;
      
      console.log(`AI provider ${this.providerType} initialized successfully`);
    } catch (error) {
      console.error(`Failed to initialize ${this.providerType} provider:`, error);
      
      // Try fallback to OpenAI if enabled
      if (this.providerType !== 'openai' && process.env.ENABLE_FALLBACK === 'true') {
        console.log('Attempting fallback to OpenAI...');
        this.providerType = 'openai';
        this.provider = await ProviderFactory.createProvider('openai');
        this.initialized = true;
      } else {
        throw error;
      }
    }
  }

  /**
   * Send message to AI provider with automatic fallback
   */
  static async sendMessage(
    messages: Message[],
    options: {
      threadId?: string;
      webSearchEnabled?: boolean;
      fileIds?: string[];
      tools?: string[];
      temperature?: number;
      maxTokens?: number;
      responseFormat?: 'text' | 'json' | 'markdown';
    } = {}
  ): Promise<ChatResponse> {
    // Ensure provider is initialized
    if (!this.initialized || !this.provider) {
      await this.initialize();
    }

    const providerOptions: AIProviderOptions = {
      threadId: options.threadId,
      webSearchEnabled: options.webSearchEnabled,
      fileIds: options.fileIds,
      tools: options.tools,
      temperature: options.temperature || 0.7,
      maxTokens: options.maxTokens || 4000,
      responseFormat: options.responseFormat || 'text'
    };

    try {
      // Try primary provider
      const response = await this.provider!.generateResponse(messages, providerOptions);
      
      // Add provider info to response
      return {
        ...response,
        provider: this.providerType
      } as ChatResponse;
      
    } catch (error: any) {
      console.error(`${this.providerType} provider error:`, error);
      
      // Attempt fallback if enabled and not already using OpenAI
      if (this.providerType !== 'openai' && process.env.ENABLE_FALLBACK === 'true') {
        console.log('Falling back to OpenAI...');
        
        try {
          const fallbackProvider = await ProviderFactory.createProvider('openai');
          const fallbackResponse = await fallbackProvider.generateResponse(messages, providerOptions);
          
          return {
            ...fallbackResponse,
            provider: 'openai',
            fallbackUsed: true
          } as ChatResponse;
          
        } catch (fallbackError) {
          console.error('Fallback to OpenAI also failed:', fallbackError);
          throw new Error('Both primary and fallback providers failed');
        }
      }
      
      // Re-throw if no fallback or fallback disabled
      throw error;
    }
  }

  /**
   * Process file upload
   */
  static async processFile(
    file: Buffer,
    fileType: string,
    filename: string
  ): Promise<{ fileId: string; error?: string }> {
    if (!this.initialized || !this.provider) {
      await this.initialize();
    }

    try {
      const result = await this.provider!.processFile(file, fileType, filename);
      return {
        fileId: result.fileId,
        error: result.error
      };
    } catch (error: any) {
      console.error('File processing error:', error);
      
      // Try fallback for file processing
      if (this.providerType !== 'openai' && process.env.ENABLE_FALLBACK === 'true') {
        console.log('Falling back to OpenAI for file processing...');
        const fallbackProvider = await ProviderFactory.createProvider('openai');
        const result = await fallbackProvider.processFile(file, fileType, filename);
        return {
          fileId: result.fileId,
          error: result.error
        };
      }
      
      return {
        fileId: '',
        error: error.message || 'Failed to process file'
      };
    }
  }

  /**
   * Generate embeddings
   */
  static async generateEmbeddings(text: string): Promise<number[]> {
    if (!this.initialized || !this.provider) {
      await this.initialize();
    }

    try {
      return await this.provider!.generateEmbeddings(text);
    } catch (error) {
      console.error('Embedding generation error:', error);
      
      // Fallback to OpenAI for embeddings
      if (this.providerType !== 'openai' && process.env.ENABLE_FALLBACK === 'true') {
        const fallbackProvider = await ProviderFactory.createProvider('openai');
        return await fallbackProvider.generateEmbeddings(text);
      }
      
      return [];
    }
  }

  /**
   * Check provider availability
   */
  static async checkAvailability(): Promise<{
    primary: { name: string; available: boolean };
    fallback: { name: string; available: boolean };
    activeProvider: string;
  }> {
    const primary = {
      name: this.providerType,
      available: await this.provider?.isAvailable() || false
    };
    
    let fallback = {
      name: 'openai',
      available: false
    };
    
    if (process.env.ENABLE_FALLBACK === 'true' && this.providerType !== 'openai') {
      try {
        const fallbackProvider = await ProviderFactory.createProvider('openai');
        fallback.available = await fallbackProvider.isAvailable();
      } catch {
        fallback.available = false;
      }
    }
    
    return {
      primary,
      fallback,
      activeProvider: this.provider?.name || 'none'
    };
  }

  /**
   * Get current provider info
   */
  static getProviderInfo(): {
    current: string;
    initialized: boolean;
    fallbackEnabled: boolean;
  } {
    return {
      current: this.providerType,
      initialized: this.initialized,
      fallbackEnabled: process.env.ENABLE_FALLBACK === 'true'
    };
  }

  /**
   * Switch provider dynamically
   */
  static async switchProvider(providerType: string): Promise<void> {
    console.log(`Switching from ${this.providerType} to ${providerType}`);
    
    // Clear cache
    ProviderFactory.clearCache();
    
    // Re-initialize with new provider
    await this.initialize(providerType);
  }

  /**
   * Create a new thread
   */
  static async createThread(): Promise<string> {
    if (!this.initialized || !this.provider) {
      await this.initialize();
    }

    if (this.provider!.createThread) {
      return await this.provider!.createThread();
    }
    
    // Generate a local thread ID if provider doesn't support threads
    return `thread-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Delete a thread
   */
  static async deleteThread(threadId: string): Promise<void> {
    if (!this.initialized || !this.provider) {
      await this.initialize();
    }

    if (this.provider!.deleteThread) {
      await this.provider!.deleteThread(threadId);
    }
  }

  /**
   * Get thread messages
   */
  static async getThreadMessages(threadId: string): Promise<Message[]> {
    if (!this.initialized || !this.provider) {
      await this.initialize();
    }

    if (this.provider!.getThreadMessages) {
      return await this.provider!.getThreadMessages(threadId);
    }
    
    return [];
  }

  /**
   * Health check for the service
   */
  static async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    provider: string;
    details: any;
  }> {
    try {
      const availability = await this.checkAvailability();
      
      if (availability.primary.available) {
        return {
          status: 'healthy',
          provider: availability.primary.name,
          details: availability
        };
      } else if (availability.fallback.available) {
        return {
          status: 'degraded',
          provider: availability.fallback.name,
          details: {
            ...availability,
            message: 'Primary provider unavailable, using fallback'
          }
        };
      } else {
        return {
          status: 'unhealthy',
          provider: 'none',
          details: {
            ...availability,
            message: 'No providers available'
          }
        };
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        provider: 'none',
        details: { error: String(error) }
      };
    }
  }
}