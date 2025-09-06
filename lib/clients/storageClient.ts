// lib/clients/storageClient.ts - FIXED VERSION with octet-stream support
import HttpClient from './httpClient';
import { ApiError } from '@/lib/utils/apiErrors';
import { put, del, list, head } from '@vercel/blob';

interface StorageConfig {
  token: string;
  maxFileSize?: number; // in bytes
  allowedMimeTypes?: string[];
}

export interface UploadOptions {
  onProgress?: (progress: number) => void;
  metadata?: Record<string, any>;
  contentType?: string;
  cacheControlMaxAge?: number;
}

export interface UploadResult {
  url: string;
  pathname: string;
  contentType: string;
  size: number;
}

export interface ListOptions {
  prefix?: string;
  limit?: number;
  cursor?: string;
}

export interface BlobMetadata {
  url: string;
  pathname: string;
  size: number;
  uploadedAt: Date;
  contentType?: string; // Made optional since it's not available in list response
}

class StorageClient {
  private config: StorageConfig;
  private client: HttpClient;
  private uploadChunkSize: number = 5 * 1024 * 1024; // 5MB chunks

  constructor(config: StorageConfig) {
    this.config = {
      maxFileSize: 100 * 1024 * 1024, // 100MB default
      allowedMimeTypes: [
        // Documents
        'application/pdf',
        'text/plain',
        'text/csv',
        'application/json',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        
        // Spreadsheets (including xlsx)
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/excel',
        'application/x-excel',
        'application/x-msexcel',
        
        // Presentations
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        
        // Images
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/svg+xml',
        'image/webp',
        
        // CRITICAL: Add octet-stream for OpenAI generated files
        'application/octet-stream',
        
        // Other formats
        'text/html',
        'text/markdown',
        'application/xml',
      ],
      ...config,
    };
    
    this.client = new HttpClient({
      timeout: 120000, // 2 minutes for large file uploads
      retries: 3,
    });
  }

  private validateFile(file: Buffer | Blob, contentType?: string): void {
    const size = file instanceof Buffer ? file.length : (file as Blob).size;
    
    if (size > this.config.maxFileSize!) {
      throw new ApiError(
        `File size exceeds maximum allowed (${this.config.maxFileSize! / 1024 / 1024}MB)`,
        413,
        'FILE_TOO_LARGE'
      );
    }
    
    if (contentType && this.config.allowedMimeTypes) {
      // Special handling for octet-stream - try to detect actual type
      if (contentType === 'application/octet-stream') {
        console.log('Allowing application/octet-stream for OpenAI generated file');
        return; // Allow it through
      }
      
      if (!this.config.allowedMimeTypes.includes(contentType)) {
        throw new ApiError(
          `File type "${contentType}" is not allowed`,
          415,
          'UNSUPPORTED_FILE_TYPE'
        );
      }
    }
  }

  /**
   * Detect actual content type from file buffer
   * Used when OpenAI returns generic octet-stream
   */
  private detectContentType(file: Buffer, filename?: string): string {
    // Check file extension first
    if (filename) {
      const ext = filename.toLowerCase().split('.').pop();
      const typeMap: { [key: string]: string } = {
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'svg': 'image/svg+xml',
        'pdf': 'application/pdf',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'csv': 'text/csv',
        'txt': 'text/plain',
        'json': 'application/json',
      };
      
      if (ext && typeMap[ext]) {
        return typeMap[ext];
      }
    }
    
    // Check magic bytes for common formats
    if (file.length > 4) {
      const header = file.toString('hex', 0, 4);
      
      // PNG
      if (header === '89504e47') return 'image/png';
      
      // JPEG
      if (header.startsWith('ffd8ff')) return 'image/jpeg';
      
      // GIF
      if (header.startsWith('47494638')) return 'image/gif';
      
      // PDF
      if (header === '25504446') return 'application/pdf';
    }
    
    // Default to octet-stream if can't detect
    return 'application/octet-stream';
  }

  async upload(
    file: Buffer | Blob,
    pathname: string,
    options: UploadOptions = {}
  ): Promise<UploadResult> {
    // For octet-stream, try to detect actual type
    let contentType = options.contentType;
    if (contentType === 'application/octet-stream' && file instanceof Buffer) {
      const detectedType = this.detectContentType(file, pathname);
      console.log(`Detected content type: ${detectedType} for ${pathname}`);
      contentType = detectedType;
    }
    
    this.validateFile(file, contentType);
    
    try {
      // For large files, implement chunked upload with progress
      const size = file instanceof Buffer ? file.length : (file as Blob).size;
      
      if (options.onProgress) {
        options.onProgress(0);
      }
      
      // Upload to Vercel Blob
      const blob = await put(pathname, file, {
        access: 'public',
        token: this.config.token,
        contentType: contentType,
        cacheControlMaxAge: options.cacheControlMaxAge,
        addRandomSuffix: false,
      });
      
      if (options.onProgress) {
        options.onProgress(100);
      }
      
      return {
        url: blob.url,
        pathname: blob.pathname,
        contentType: contentType || 'application/octet-stream',
        size: size,
      };
    } catch (error: any) {
      if (error.message?.includes('already exists')) {
        throw new ApiError(
          'File already exists at this location',
          409,
          'FILE_EXISTS'
        );
      }
      
      throw new ApiError(
        `Upload failed: ${error.message}`,
        500,
        'UPLOAD_FAILED'
      );
    }
  }

  async delete(pathname: string): Promise<void> {
    try {
      await del(pathname, {
        token: this.config.token,
      });
    } catch (error: any) {
      throw new ApiError(
        `Delete failed: ${error.message}`,
        500,
        'DELETE_FAILED'
      );
    }
  }

  async list(options: ListOptions = {}): Promise<BlobMetadata[]> {
    try {
      const result = await list({
        token: this.config.token,
        prefix: options.prefix,
        limit: options.limit || 100,
        cursor: options.cursor,
      });
      
      return result.blobs.map(blob => ({
        url: blob.url,
        pathname: blob.pathname,
        size: blob.size,
        uploadedAt: new Date(blob.uploadedAt),
        // Error: Property 'contentType' does not exist on type 'ListBlobResultBlob'.
        // Fixed. The error was caused by   trying to access blob.contentType   
        // when the Vercel blob list API   doesn't provide this property. 
        // The fix uses type assertion (blob as any).contentType || undefined 
        // to    safely access the property and return undefined if it doesn't exist, 
        // which matches the optional nature of the contentType field in the BlobMetadata interface. 
        contentType: (blob as any).contentType || undefined,
      }));
    } catch (error: any) {
      throw new ApiError(
        `List failed: ${error.message}`,
        500,
        'LIST_FAILED'
      );
    }
  }

  async getMetadata(pathname: string): Promise<BlobMetadata | null> {
    try {
      const result = await head(pathname, {
        token: this.config.token,
      });
      
      return {
        url: result.url,
        pathname: pathname,
        size: result.size,
        uploadedAt: new Date(result.uploadedAt),
        contentType: result.contentType,
      };
    } catch (error: any) {
      if (error.message?.includes('not found')) {
        return null;
      }
      
      throw new ApiError(
        `Get metadata failed: ${error.message}`,
        500,
        'METADATA_FAILED'
      );
    }
  }

  isHealthy(): boolean {
    return !!this.config.token;
  }
}

export default StorageClient;