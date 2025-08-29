// lib/providers/aiProvider.interface.ts

import { LMStudioProvider } from "./lmStudioProvider";
import { OpenAIProvider } from "./openaiProvider";

// Message type definition (matches your existing types)
export interface Message {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string | any;
  created_at?: string;
  files?: any[];
}

export interface AIProvider {
  name: string;
  
  /**
   * Check if provider is available
   */
  isAvailable(): Promise<boolean>;
  
  /**
   * Generate response from messages
   */
  generateResponse(
    messages: Message[],
    options: AIProviderOptions
  ): Promise<ChatResponse>;
  
  /**
   * Process uploaded file
   */
  processFile(
    file: Buffer,
    fileType: string,
    filename: string
  ): Promise<FileProcessingResult>;
  
  /**
   * Generate embeddings for text
   */
  generateEmbeddings(text: string): Promise<number[]>;
  
  /**
   * Create a new thread
   */
  createThread?(): Promise<string>;
  
  /**
   * Delete a thread
   */
  deleteThread?(threadId: string): Promise<void>;
  
  /**
   * Get thread messages
   */
  getThreadMessages?(threadId: string): Promise<Message[]>;
}

export interface AIProviderOptions {
  threadId?: string;
  webSearchEnabled?: boolean;
  fileIds?: string[];
  tools?: string[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json' | 'markdown';
  stream?: boolean;
}

export interface ChatResponse {
  reply: string;
  threadId?: string;
  messageId?: string;
  files?: FileAttachment[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  webSearchPerformed?: boolean;
  searchSources?: SearchSource[];
  parsedResponse?: any;
  provider?: string;
  fallbackUsed?: boolean;
}

export interface FileProcessingResult {
  fileId: string;
  extracted?: string;
  metadata?: any;
  error?: string;
}

export interface FileAttachment {
  file_id: string;
  filename: string;
  content_type?: string;
  size?: number;
  url?: string;
  created_at?: string;
}

export interface SearchSource {
  title: string;
  url: string;
  snippet?: string;
  score?: number;
}

export class ProviderFactory {
  private static providers: Map<string, AIProvider> = new Map();
  
  /**
   * Create or get cached provider instance
   */
  static async createProvider(type: string): Promise<AIProvider> {
    // Check cache first
    if (this.providers.has(type)) {
      return this.providers.get(type)!;
    }
    
    let provider: AIProvider;
    
    switch (type.toLowerCase()) {
      case 'openai':
        provider = new OpenAIProvider();
        break;
      case 'lmstudio':
        provider = new LMStudioProvider();
        break;
      default:
        throw new Error(`Unknown provider type: ${type}`);
    }
    
    // Verify availability
    const isAvailable = await provider.isAvailable();
    if (!isAvailable) {
      throw new Error(`Provider ${type} is not available`);
    }
    
    // Cache for reuse
    this.providers.set(type, provider);
    
    return provider;
  }
  
  /**
   * Clear provider cache
   */
  static clearCache(): void {
    this.providers.clear();
  }
  
  /**
   * Get all available providers
   */
  static async getAvailableProviders(): Promise<string[]> {
    const available: string[] = [];
    const types = ['openai', 'lmstudio'];
    
    for (const type of types) {
      try {
        const provider = await this.createProvider(type);
        if (await provider.isAvailable()) {
          available.push(type);
        }
      } catch {
        // Provider not available
      }
    }
    
    return available;
  }
}