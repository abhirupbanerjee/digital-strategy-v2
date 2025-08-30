// lib/clients/tavilyClient.ts
import HttpClient from './httpClient';
import { ApiError } from '@/lib/utils/apiErrors';

interface TavilyConfig {
  apiKey: string;
  baseUrl?: string;
  maxResultsPerSearch?: number;
  searchDepth?: 'basic' | 'advanced';
  includeImages?: boolean;
  includeAnswer?: boolean;
}

export interface SearchOptions {
  query: string;
  maxResults?: number;
  searchDepth?: 'basic' | 'advanced';
  includeImages?: boolean;
  includeAnswer?: boolean;
  includeDomains?: string[];
  excludeDomains?: string[];
}

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
  publishedDate?: string;
}

export interface TavilyResponse {
  query: string;
  answer?: string;
  results: SearchResult[];
  images?: string[];
}

class TavilyClient {
  private client: HttpClient;
  private config: TavilyConfig;
  private baseUrl: string;
  private cache: Map<string, { data: TavilyResponse; timestamp: number }> = new Map();
  private cacheTimeout: number = 300000; // 5 minutes
  private rateLimitDelay: number = 100; // 100ms between requests
  private lastRequestTime: number = 0;

  constructor(config: TavilyConfig) {
    this.config = {
      maxResultsPerSearch: 5,
      searchDepth: 'basic',
      includeImages: false,
      includeAnswer: true,
      ...config,
    };
    this.baseUrl = config.baseUrl || 'https://api.tavily.com';
    
    this.client = new HttpClient({
      timeout: 20000, // 20 seconds for search
      retries: 2,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  private getCacheKey(options: SearchOptions): string {
    return JSON.stringify({
      query: options.query.toLowerCase().trim(),
      maxResults: options.maxResults,
      searchDepth: options.searchDepth,
      includeDomains: options.includeDomains?.sort(),
      excludeDomains: options.excludeDomains?.sort(),
    });
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.rateLimitDelay) {
      await new Promise(resolve => 
        setTimeout(resolve, this.rateLimitDelay - timeSinceLastRequest)
      );
    }
    
    this.lastRequestTime = Date.now();
  }

  private validateQuery(query: string): void {
    if (!query || query.trim().length === 0) {
      throw new ApiError('Search query cannot be empty', 400, 'INVALID_QUERY');
    }
    
    if (query.length > 500) {
      throw new ApiError('Search query too long (max 500 characters)', 400, 'QUERY_TOO_LONG');
    }
  }

  async search(options: SearchOptions): Promise<TavilyResponse> {
    this.validateQuery(options.query);
    
    // Check cache first
    const cacheKey = this.getCacheKey(options);
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    
    // Enforce rate limiting
    await this.enforceRateLimit();
    
    const searchRequest = {
      api_key: this.config.apiKey,
      query: options.query,
      max_results: options.maxResults || this.config.maxResultsPerSearch,
      search_depth: options.searchDepth || this.config.searchDepth,
      include_images: options.includeImages ?? this.config.includeImages,
      include_answer: options.includeAnswer ?? this.config.includeAnswer,
      ...(options.includeDomains && { include_domains: options.includeDomains }),
      ...(options.excludeDomains && { exclude_domains: options.excludeDomains }),
    };
    
    try {
      const response = await this.client.post<TavilyResponse>(
        `${this.baseUrl}/search`,
        searchRequest
      );
      
      // Cache the successful response
      this.cache.set(cacheKey, {
        data: response,
        timestamp: Date.now(),
      });
      
      // Clean old cache entries
      this.cleanCache();
      
      return response;
    } catch (error: any) {
      this.handleTavilyError(error);
    }
  }

  async searchWithContext(
    query: string, 
    context: string,
    options?: Partial<SearchOptions>
  ): Promise<TavilyResponse> {
    const enhancedQuery = `${context} ${query}`.trim();
    return this.search({
      ...options,
      query: enhancedQuery,
    });
  }

  async searchNews(query: string, options?: Partial<SearchOptions>): Promise<TavilyResponse> {
    return this.search({
      ...options,
      query: `news ${query}`,
      searchDepth: 'advanced',
    });
  }

  private cleanCache(): void {
    const now = Date.now();
    const entriesToDelete: string[] = [];
    
    this.cache.forEach((value, key) => {
      if (now - value.timestamp > this.cacheTimeout) {
        entriesToDelete.push(key);
      }
    });
    
    entriesToDelete.forEach(key => this.cache.delete(key));
  }

  clearCache(): void {
    this.cache.clear();
  }

  private handleTavilyError(error: any): never {
    if (error.status === 401) {
      throw new ApiError('Invalid Tavily API key', 401, 'INVALID_API_KEY');
    }
    if (error.status === 429) {
      throw new ApiError('Tavily rate limit exceeded', 429, 'RATE_LIMIT');
    }
    if (error.status === 400) {
      throw new ApiError('Invalid search parameters', 400, 'INVALID_PARAMS');
    }
    throw error;
  }
}

// Export singleton with configuration from environment
export const tavilyClient = process.env.TAVILY_API_KEY 
  ? new TavilyClient({
      apiKey: process.env.TAVILY_API_KEY,
    })
  : null;

// Export class for custom instances
export default TavilyClient;