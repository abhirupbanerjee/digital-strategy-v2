// services/storageService.ts
import { storageClient } from '@/lib/clients';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

interface StorageFile {
  vercel_blob_url: string;
  vercel_file_key: string;
  filename: string;
  content_type: string;
  file_size: number;
  thread_id?: string;
  project_id?: string;
  last_accessed: string;
  created_at: string;
}

interface StorageStats {
  totalSize: number;
  fileCount: number;
  lastCleanup: Date | null;
  storageUsed: number;
  storageLimit: number;
  percentUsed: number;
}

export class StorageService {
  private static readonly MAX_STORAGE = 500 * 1024 * 1024; // 500MB Vercel Blob limit
  private static readonly CLEANUP_THRESHOLD = 400 * 1024 * 1024; // 400MB threshold
  private static readonly DEFAULT_RETENTION_DAYS = 7;

  /**
   * Upload file to Vercel Blob
   * Consolidated from multiple routes
   */
  static async uploadToBlob(
    file: Buffer | Blob | File,
    filename: string,
    options?: { 
      contentType?: string; 
      threadId?: string;
      projectId?: string;
    }
  ): Promise<{ url: string; key: string; size: number }> {
    try {
      // Check storage before upload
      const stats = await this.getStorageStats();
      if (stats.storageUsed >= this.CLEANUP_THRESHOLD) {
        console.log('Storage threshold reached, triggering cleanup...');
        await this.cleanupOldFiles();
      }

      // Upload to Vercel Blob
      if (!storageClient) {
        throw new Error('Storage client not configured');
      }

      const blob = await storageClient.upload(file, filename, {
        contentType: options?.contentType
      });
          const isFileCtorAvailable =
      typeof File !== 'undefined' && typeof (File as unknown) === 'function';


    const fileSize =
      file instanceof Buffer
        ? file.length // Node Buffer: length in bytes
        : file instanceof Blob
          ? file.size // Blob (and File since File extends Blob): size in bytes
          : isFileCtorAvailable && file instanceof File
            ? file.size // Explicit File check (browser)
            : 0; // Fallback for unexpected types

      // Track in Supabase
      await this.trackBlobFile({
        vercel_blob_url: blob.url,
        vercel_file_key: blob.pathname,
        filename,
        content_type: options?.contentType || 'application/octet-stream',
        file_size: fileSize,
        thread_id: options?.threadId,
        project_id: options?.projectId,
        last_accessed: new Date().toISOString(),
        created_at: new Date().toISOString()
      });

      return {
        url: blob.url,
        key: blob.pathname,
        size: fileSize,
      };
    } catch (error) {
      console.error('Storage upload error:', error);
      throw new Error('Failed to upload file to storage');
    }
  }

  /**
   * Get storage statistics
   * Extracted from: /app/api/vercel-storage/stats/route.ts
   */
  static async getStorageStats(): Promise<StorageStats> {
    try {
      // Get all tracked files from Supabase
      const { data: files, error } = await supabase
        .from('blob_files')
        .select('file_size, created_at')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching storage stats:', error);
        throw error;
      }

      const totalSize = files?.reduce((sum, file) => sum + (file.file_size || 0), 0) || 0;
      const fileCount = files?.length || 0;

      // Get last cleanup timestamp
      const { data: cleanupData } = await supabase
        .from('storage_cleanup_log')
        .select('executed_at')
        .order('executed_at', { ascending: false })
        .limit(1)
        .single();

      return {
        totalSize,
        fileCount,
        lastCleanup: cleanupData?.executed_at ? new Date(cleanupData.executed_at) : null,
        storageUsed: totalSize,
        storageLimit: this.MAX_STORAGE,
        percentUsed: (totalSize / this.MAX_STORAGE) * 100
      };
    } catch (error) {
      console.error('Error getting storage stats:', error);
      return {
        totalSize: 0,
        fileCount: 0,
        lastCleanup: null,
        storageUsed: 0,
        storageLimit: this.MAX_STORAGE,
        percentUsed: 0
      };
    }
  }

  /**
   * Cleanup old files
   * Extracted from: /app/api/vercel-storage/cleanup/route.ts
   */
  static async cleanupOldFiles(
    thresholdDays: number = this.DEFAULT_RETENTION_DAYS,
    targetSize: number = this.CLEANUP_THRESHOLD
  ): Promise<{ deletedCount: number; freedSpace: number }> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - thresholdDays);

      // Get files eligible for deletion
      const { data: oldFiles, error } = await supabase
        .from('blob_files')
        .select('*')
        .lt('last_accessed', cutoffDate.toISOString())
        .order('last_accessed', { ascending: true });

      if (error) {
        console.error('Error fetching old files:', error);
        throw error;
      }

      let deletedCount = 0;
      let freedSpace = 0;

      // Delete files until we're under the target size
      for (const file of oldFiles || []) {
        try {
          // Delete from Vercel Blob
          if (!storageClient) {
            throw new Error('Storage client not configured');
          }
          await storageClient.delete(file.vercel_file_key);

          // Delete from Supabase
          await supabase
            .from('blob_files')
            .delete()
            .eq('id', file.id);

          deletedCount++;
          freedSpace += file.file_size || 0;

          // Check if we've freed enough space
          const stats = await this.getStorageStats();
          if (stats.storageUsed < targetSize) {
            break;
          }
        } catch (deleteError) {
          console.error(`Error deleting file ${file.filename}:`, deleteError);
        }
      }

      // Log cleanup operation
      await supabase
        .from('storage_cleanup_log')
        .insert({
          files_deleted: deletedCount,
          space_freed: freedSpace,
          executed_at: new Date().toISOString()
        });

      return { deletedCount, freedSpace };
    } catch (error) {
      console.error('Storage cleanup error:', error);
      return { deletedCount: 0, freedSpace: 0 };
    }
  }

  /**
   * Track blob file in Supabase
   */
  private static async trackBlobFile(data: StorageFile): Promise<void> {
    const { error } = await supabase
      .from('blob_files')
      .insert(data);

    if (error) {
      console.error('Error tracking blob file:', error);
      // Don't throw - file is uploaded, tracking failure is non-critical
    }
  }

  /**
   * Get file from blob or fallback to OpenAI
   * Extracted from: /app/api/files/[fileId]/route.ts
   */
  static async getFile(
    fileId: string,
    openaiClient?: any
  ): Promise<{ 
    data: Buffer; 
    contentType: string; 
    filename: string 
  }> {
    try {
      // First try to get from our file mappings
      const { data: mapping } = await supabase
        .from('file_mappings')
        .select('*')
        .eq('openai_file_id', fileId)
        .single();

      if (mapping && mapping.vercel_blob_url) {
        // Update last accessed timestamp
        await supabase
          .from('file_mappings')
          .update({ last_accessed: new Date().toISOString() })
          .eq('openai_file_id', fileId);

        // Fetch from Vercel Blob
        const response = await fetch(mapping.vercel_blob_url);
        if (response.ok) {
          const buffer = Buffer.from(await response.arrayBuffer());
          return {
            data: buffer,
            contentType: mapping.content_type || 'application/octet-stream',
            filename: mapping.filename || 'download'
          };
        }
      }

      // Fallback to OpenAI if available
      if (openaiClient) {
        const fileContent = await openaiClient.files.content(fileId);
        const fileDetails = await openaiClient.files.retrieve(fileId);
        
        // Convert response to buffer
        const chunks: Uint8Array[] = [];
        for await (const chunk of fileContent) {
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);

        return {
          data: buffer,
          contentType: 'application/octet-stream',
          filename: fileDetails.filename || 'download'
        };
      }

      throw new Error('File not found in storage');
    } catch (error) {
      console.error('Error retrieving file:', error);
      throw new Error('Failed to retrieve file');
    }
  }

  /**
   * Delete file from storage
   */
  static async deleteFile(fileId: string): Promise<boolean> {
    try {
      // Get file mapping
      const { data: mapping } = await supabase
        .from('file_mappings')
        .select('*')
        .eq('openai_file_id', fileId)
        .single();

      if (mapping) {
        // Delete from Vercel Blob
        if (mapping.vercel_file_key) {
          if (!storageClient) {
            throw new Error('Storage client not configured');
          }
          await storageClient.delete(mapping.vercel_file_key);
        }

        // Delete from Supabase
        await supabase
          .from('file_mappings')
          .delete()
          .eq('openai_file_id', fileId);

        return true;
      }

      return false;
    } catch (error) {
      console.error('Error deleting file:', error);
      return false;
    }
  }

  /**
   * Update file access timestamp
   */
  static async updateFileAccess(fileId: string): Promise<void> {
    await supabase
      .from('file_mappings')
      .update({ last_accessed: new Date().toISOString() })
      .eq('openai_file_id', fileId);
  }

  /**
   * Get files by thread
   */
  static async getThreadFiles(threadId: string): Promise<StorageFile[]> {
    const { data, error } = await supabase
      .from('blob_files')
      .select('*')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching thread files:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Get files by project
   */
  static async getProjectFiles(projectId: string): Promise<StorageFile[]> {
    const { data, error } = await supabase
      .from('blob_files')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching project files:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Deduplicate files based on content hash
   */
  static async deduplicateFiles(): Promise<{ merged: number; spaceSaved: number }> {
    // This would require implementing content hashing
    // For now, return placeholder
    console.log('File deduplication not yet implemented');
    return { merged: 0, spaceSaved: 0 };
  }

  /**
   * Check if cleanup is needed
   */
  static async isCleanupNeeded(): Promise<boolean> {
    const stats = await this.getStorageStats();
    return stats.storageUsed >= this.CLEANUP_THRESHOLD;
  }

  /**
   * Force recalculate storage stats from Vercel Blob
   */
  static async recalculateStats(): Promise<StorageStats> {
    try {
      // List all blobs from Vercel
      if (!storageClient) {
        throw new Error('Storage client not configured');
      }
      const blobs = await storageClient.list();
      
      // Update Supabase records
      for (const blob of blobs.blobs) {
        const fileSize = 0; // Blob list doesn't provide size, would need to fetch individually
        
        await supabase
          .from('blob_files')
          .upsert({
            vercel_file_key: blob.pathname,
            vercel_blob_url: blob.url,
            file_size: fileSize,
            filename: blob.pathname.split('/').pop() || 'unknown',
            content_type: 'application/octet-stream',
            last_accessed: blob.uploadedAt,
            created_at: blob.uploadedAt
          }, {
            onConflict: 'vercel_file_key'
          });
      }

      return await this.getStorageStats();
    } catch (error) {
      console.error('Error recalculating stats:', error);
      throw error;
    }
  }
}