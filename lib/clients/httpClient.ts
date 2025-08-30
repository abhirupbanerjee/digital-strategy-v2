// lib/clients/httpClient.ts
import { ApiError } from '@/lib/utils/apiErrors';

interface HttpClientOptions {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  headers?: Record<string, string>;
}

interface RequestOptions extends HttpClientOptions {
  method?: string;
  body?: any;
  signal?: AbortSignal;
}

class HttpClient {
  private defaultOptions: HttpClientOptions = {
    timeout: 30000, // 30 seconds default
    retries: 3,
    retryDelay: 1000, // 1 second initial delay
    headers: {
      'Content-Type': 'application/json',
    },
  };

  constructor(options?: HttpClientOptions) {
    this.defaultOptions = { ...this.defaultOptions, ...options };
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private shouldRetry(error: any, attempt: number, maxRetries: number): boolean {
    if (attempt >= maxRetries) return false;
    
    // Retry on network errors or 5xx status codes
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') return true;
    if (error.status >= 500 && error.status < 600) return true;
    if (error.status === 429) return true; // Rate limit
    
    return false;
  }

  private createTimeoutSignal(timeout: number, existingSignal?: AbortSignal): AbortSignal {
    const controller = new AbortController();
    
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    if (existingSignal) {
      existingSignal.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        controller.abort();
      });
    }
    
    return controller.signal;
  }

  private log(method: string, url: string, options?: any): void {
    if (process.env.NODE_ENV === 'development' && process.env.DEBUG === 'true') {
      console.log(`[HttpClient] ${method} ${url}`, options);
    }
  }

  async request<T = any>(url: string, options: RequestOptions = {}): Promise<T> {
    const mergedOptions = { ...this.defaultOptions, ...options };
    const { timeout, retries, retryDelay, headers, method = 'GET', body, signal } = mergedOptions;

    this.log(method, url, { body });

    let lastError: any;
    
    for (let attempt = 0; attempt < retries!; attempt++) {
      try {
        const timeoutSignal = this.createTimeoutSignal(timeout!, signal);
        
        const response = await fetch(url, {
          method,
          headers: {
            ...this.defaultOptions.headers,
            ...headers,
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: timeoutSignal,
        });

        // Handle non-2xx responses
        if (!response.ok) {
          const errorBody = await response.text();
          let errorData;
          
          try {
            errorData = JSON.parse(errorBody);
          } catch {
            errorData = { message: errorBody };
          }
          
          throw new ApiError(
            errorData.message || `HTTP ${response.status}: ${response.statusText}`,
            response.status,
            errorData.code
          );
        }

        // Parse JSON response
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          return await response.json();
        }
        
        return await response.text() as any;
      } catch (error: any) {
        lastError = error;
        
        // Check if we should retry
        if (this.shouldRetry(error, attempt + 1, retries!)) {
          const delay = retryDelay! * Math.pow(2, attempt); // Exponential backoff
          this.log('RETRY', url, { attempt: attempt + 1, delay });
          await this.delay(delay);
          continue;
        }
        
        throw error;
      }
    }
    
    throw lastError;
  }

  async get<T = any>(url: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(url, { ...options, method: 'GET' });
  }

  async post<T = any>(url: string, body?: any, options?: RequestOptions): Promise<T> {
    return this.request<T>(url, { ...options, method: 'POST', body });
  }

  async put<T = any>(url: string, body?: any, options?: RequestOptions): Promise<T> {
    return this.request<T>(url, { ...options, method: 'PUT', body });
  }

  async delete<T = any>(url: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(url, { ...options, method: 'DELETE' });
  }

  async patch<T = any>(url: string, body?: any, options?: RequestOptions): Promise<T> {
    return this.request<T>(url, { ...options, method: 'PATCH', body });
  }
}

// Export singleton instance for general use
export const httpClient = new HttpClient();

// Export class for custom instances
export default HttpClient;