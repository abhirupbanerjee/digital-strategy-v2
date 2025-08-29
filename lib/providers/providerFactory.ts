// lib/providers/providerFactory.ts
import { AIProvider } from './aiProvider.interface';

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
        // Dynamic import to avoid circular dependencies
        const { OpenAIProvider } = await import('./openaiProvider');
        provider = new OpenAIProvider();
        break;
      case 'lmstudio':
        // Dynamic import to avoid circular dependencies
        const { LMStudioProvider } = await import('./lmStudioProvider');
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