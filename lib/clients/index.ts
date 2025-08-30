// lib/clients/index.ts

// Export base HTTP client
export { default as HttpClient, httpClient } from './httpClient';

// Export OpenAI client
export { default as OpenAIClient, openaiClient } from './openaiClient';

// Export Tavily search client
export { default as TavilyClient, tavilyClient } from './tavilyClient';

// Export Storage client
export { default as StorageClient, storageClient } from './storageClient';

// Export types
export type { 
  Message,
  RunStatus,
  ThreadMessage 
} from './openaiClient';

export type {
  SearchOptions,
  SearchResult,
  TavilyResponse
} from './tavilyClient';

export type {
  UploadOptions,
  UploadResult,
  ListOptions,
  BlobMetadata
} from './storageClient';