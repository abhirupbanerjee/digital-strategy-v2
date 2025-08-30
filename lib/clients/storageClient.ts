// lib/clients/storageClient.ts
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
  contentType?: string;
}

class StorageClient {
  private config: StorageConfig;
  private client: HttpClient;
  private uploadChunkSize: number = 5 * 1024 * 1024; // 5MB chunks

  constructor(config: StorageConfig) {
    this.config = {
      maxFileSize: 100 * 1024 * 1024, // 100MB default
      allowedMimeTypes: [
        'application/pdf',
        'text/plain',
        'text/csv',
        'application/json',
        'image/jpeg',
        'image/png',
        'image/gif',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
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
      if (!this.config.allowedMimeTypes.includes(contentType)) {
        throw new ApiError(
          `File type "${contentType}" is not allowed`,
          415,
          'UNSUPPORTED_FILE_TYPE'
        );
      }
    }
  }

  async upload(
    file: Buffer | Blob,
    pathname: string,
    options: UploadOptions = {}
  ): Promise<UploadResult> {
    this.validateFile(file, options.contentType);
    
    try {
      // For large files, implement chunked upload with progress
      const size = file instanceof Buffer ? file.length : (file as Blob).size;
      const isLargeFile = size > this.uploadChunkSize;
      
      if (isLargeFile && options.onProgress) {
        return await this.uploadWithProgress(file, pathname, options);
      }
      
      // Use Vercel blob put for direct upload
      const blob = await put(pathname, file, {
        access: 'public',
        token: this.config.token,
        contentType: options.contentType,
        cacheControlMaxAge: options.cacheControlMaxAge,
        addRandomSuffix: true,
      });
      
      return {
        url: blob.url,
        pathname: blob.pathname,
        contentType: options.contentType || 'application/octet-stream',
        size,
      };
    } catch (error: any) {
      this.handleStorageError(error);
    }
  }

  private async uploadWithProgress(
    file: Buffer | Blob,
    pathname: string,
    options: UploadOptions
  ): Promise<UploadResult> {
    // For demonstration - actual multipart upload would require server-side support
    const size = file instanceof Buffer ? file.length : (file as Blob).size;
    let uploadedBytes = 0;
    
    // Simulate progress for now - in production, use actual multipart upload
    const progressInterval = setInterval(() => {
      uploadedBytes = Math.min(uploadedBytes + this.uploadChunkSize, size);
      const progress = (uploadedBytes / size) * 100;
      options.onProgress?.(progress);
      
      if (uploadedBytes >= size) {
        clearInterval(progressInterval);
      }
    }, 500);
    
    try {
      const blob = await put(pathname, file, {
        access: 'public',
        token: this.config.token,
        contentType: options.contentType,
        cacheControlMaxAge: options.cacheControlMaxAge,
        addRandomSuffix: true,
      });
      
      clearInterval(progressInterval);
      options.onProgress?.(100);
      
      return {
        url: blob.url,
        pathname: blob.pathname,
        contentType: options.contentType || 'application/octet-stream',
        size,
      };
    } catch (error) {
      clearInterval(progressInterval);
      throw error;
    }
  }

  async download(url: string, options?: { onProgress?: (progress: number) => void }): Promise<Blob> {
    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new ApiError('Failed to download file', response.status);
      }
      
      const contentLength = response.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      
      if (!response.body) {
        throw new ApiError('No response body', 500);
      }
      
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        chunks.push(value);
        received += value.length;
        
        if (options?.onProgress && total > 0) {
          options.onProgress((received / total) * 100);
        }
      }
      
      const blob = new Blob(chunks as BlobPart[]);
      options?.onProgress?.(100);
      
      return blob;
    } catch (error: any) {
      this.handleStorageError(error);
    }
  }

  async delete(url: string): Promise<void> {
    try {
      await del(url, { token: this.config.token });
    } catch (error: any) {
      this.handleStorageError(error);
    }
  }

  async deleteMultiple(urls: string[]): Promise<void> {
    try {
      await del(urls, { token: this.config.token });
    } catch (error: any) {
      this.handleStorageError(error);
    }
  }

  async list(options: ListOptions = {}): Promise<{ blobs: BlobMetadata[]; cursor?: string }> {
    try {
      const result = await list({
        token: this.config.token,
        prefix: options.prefix,
        limit: options.limit || 100,
        cursor: options.cursor,
      });
      
      const blobs: BlobMetadata[] = result.blobs.map(blob => ({
        url: blob.url,
        pathname: blob.pathname,
        size: blob.size,
        uploadedAt: new Date(blob.uploadedAt),
        contentType: (blob as any).contentType,
      }));
      
      return {
        blobs,
        cursor: result.cursor,
      };
    } catch (error: any) {
      this.handleStorageError(error);
    }
  }

  async getMetadata(url: string): Promise<BlobMetadata | null> {
    try {
      const metadata = await head(url, { token: this.config.token });
      
      if (!metadata) return null;
      
      return {
        url: metadata.url,
        pathname: metadata.pathname,
        size: metadata.size,
        uploadedAt: new Date(metadata.uploadedAt),
        contentType: metadata.contentType,
      };
    } catch (error: any) {
      if (error.status === 404) return null;
      this.handleStorageError(error);
    }
  }

  private handleStorageError(error: any): never {
    if (error.code === 'BLOB_QUOTA_EXCEEDED') {
      throw new ApiError('Storage quota exceeded', 507, 'QUOTA_EXCEEDED');
    }
    if (error.code === 'BLOB_NOT_FOUND') {
      throw new ApiError('File not found', 404, 'FILE_NOT_FOUND');
    }
    if (error.status === 401) {
      throw new ApiError('Invalid storage token', 401, 'INVALID_TOKEN');
    }
    throw error;
  }
}

// Export singleton with configuration from environment
export const storageClient = process.env.VERCEL_BLOB_READ_WRITE_TOKEN
  ? new StorageClient({
      token: process.env.VERCEL_BLOB_READ_WRITE_TOKEN,
    })
  : null;

// Export class for custom instances
export default StorageClient;