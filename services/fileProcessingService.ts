// services/fileProcessingService.ts
import { put } from '@vercel/blob';
import { createClient } from '@supabase/supabase-js';

// Type definition for MessageFile (matches your existing types)
interface MessageFile {
  file_id?: string;
  filename: string;
  content_type?: string;
  size?: number;
  url?: string;
  created_at?: string;
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export class FileProcessingService {
  /**
   * Determine which OpenAI tools to use based on file type
   * Extracted from: /app/api/chat/route.ts (lines 150-170)
   */
  static determineFileTools(fileType: string): string[] {
    const excelTypes = [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/excel',
      'application/x-excel',
      'application/x-msexcel'
    ];
    
    const csvTypes = [
      'text/csv',
      'application/csv',
      'text/comma-separated-values',
      'application/vnd.ms-excel'
    ];
    
    // Excel and CSV files can only use code_interpreter
    if (excelTypes.includes(fileType) || csvTypes.includes(fileType)) {
      return ['code_interpreter'];
    }
    
    // Other file types can use both tools
    return ['file_search', 'code_interpreter'];
  }

  /**
   * Validate file before upload
   * Extracted from: /app/api/upload/route.ts (lines 30-50)
   */
  static validateFileUpload(file: File | { size: number; type: string; name: string }): { 
    valid: boolean; 
    error?: string 
  } {
    const MAX_SIZE = 20 * 1024 * 1024; // 20MB
    const ALLOWED_TYPES = [
      // Documents
      'application/pdf',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      // Spreadsheets
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/csv',
      // Presentations
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      // Images
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      // Other
      'application/json',
      'text/markdown',
      'text/html'
    ];

    if (file.size > MAX_SIZE) {
      return { 
        valid: false, 
        error: `File size exceeds 20MB limit (${(file.size / 1024 / 1024).toFixed(2)}MB)` 
      };
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return { 
        valid: false, 
        error: `File type not supported: ${file.type}` 
      };
    }

    return { valid: true };
  }

  /**
   * Process file attachments from OpenAI response
   * Extracted from: /app/api/chat/route.ts (lines 180-230)
   */
  static async processAttachments(
    fileIds: string[], 
    threadId: string,
    openaiClient?: any
  ): Promise<MessageFile[]> {
    const processedFiles: MessageFile[] = [];
    
    for (const fileId of fileIds) {
      try {
        // Check if file mapping already exists in Supabase
        const { data: existingFile } = await supabase
          .from('file_mappings')
          .select('*')
          .eq('openai_file_id', fileId)
          .single();

        if (existingFile) {
          processedFiles.push({
            file_id: fileId,
            filename: existingFile.filename,
            content_type: existingFile.content_type,
            size: existingFile.file_size,
            url: existingFile.vercel_blob_url,
            created_at: existingFile.created_at
          });
          continue;
        }

        // If not found and OpenAI client provided, fetch from OpenAI
        if (openaiClient) {
          const fileDetails = await openaiClient.files.retrieve(fileId);
          
          processedFiles.push({
            file_id: fileId,
            filename: fileDetails.filename || 'unknown',
            content_type: 'application/octet-stream',
            size: fileDetails.bytes || 0,
            created_at: new Date().toISOString()
          });
        }
      } catch (error) {
        console.error(`Error processing attachment ${fileId}:`, error);
      }
    }

    return processedFiles;
  }

 /**
 * Upload file to Vercel Blob storage
 * Consolidated from multiple locations
 */
static async uploadToBlob(
  file: Buffer | Blob | File,
  filename: string,
  contentType: string,
  metadata?: Record<string, any>
): Promise<{ url: string; key: string; size: number }> {
  try {
    const blob = await put(filename, file, {
      access: 'public',
      contentType,
      addRandomSuffix: true,
      // Note: `put` options don't accept arbitrary metadata keys,
      // so spread ONLY if you know they are valid for your usage.
      // If these are custom values you want to store, consider encoding
      // them into the filename or storing them in your DB.
      ...(metadata ?? {}),
    });

    // --- Safe size detection without unsafe casts ---
    // We support Buffer (Node), Blob (browser/edge), and File (browser).
    // Guard for environments where `File` may be undefined.
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

    return {
      url: blob.url,
      key: blob.pathname,
      size: fileSize,
    };
  } catch (error) {
    console.error('Blob upload error:', error);
    throw new Error('Failed to upload file to storage');
  }
}


  /**
   * Create file mapping in Supabase
   * Extracted from: /app/api/upload/route.ts (lines 60-80)
   */
  static async createFileMapping(
    openaiFileId: string,
    blobUrl: string,
    blobKey: string,
    metadata: {
      filename: string;
      contentType: string;
      fileSize: number;
      threadId?: string;
      projectId?: string;
    }
  ): Promise<void> {
    const { error } = await supabase
      .from('file_mappings')
      .insert({
        openai_file_id: openaiFileId,
        vercel_blob_url: blobUrl,
        vercel_file_key: blobKey,
        filename: metadata.filename,
        content_type: metadata.contentType,
        file_size: metadata.fileSize,
        thread_id: metadata.threadId,
        project_id: metadata.projectId,
        created_at: new Date().toISOString(),
        last_accessed: new Date().toISOString()
      });

    if (error) {
      console.error('Error creating file mapping:', error);
      throw new Error('Failed to create file mapping');
    }
  }

  /**
   * Get file extension from content type
   */
  static getFileExtension(contentType: string): string {
    const typeMap: Record<string, string> = {
      'application/pdf': 'pdf',
      'text/plain': 'txt',
      'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.ms-excel': 'xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'text/csv': 'csv',
      'application/csv': 'csv',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'application/json': 'json',
      'text/markdown': 'md',
      'text/html': 'html'
    };

    return typeMap[contentType] || 'bin';
  }

  /**
   * Check if file type supports file_search tool
   */
  static supportsFileSearch(contentType: string): boolean {
    const unsupportedTypes = [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/csv',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp'
    ];

    return !unsupportedTypes.includes(contentType);
  }

  /**
   * Clean up old file mappings
   */
  static async cleanupOldMappings(daysOld: number = 7): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const { data, error } = await supabase
      .from('file_mappings')
      .delete()
      .lt('last_accessed', cutoffDate.toISOString())
      .select();

    if (error) {
      console.error('Error cleaning up old mappings:', error);
      return 0;
    }

    return data?.length || 0;
  }
}