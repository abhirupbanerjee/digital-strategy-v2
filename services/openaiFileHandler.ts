// services/openaiFileHandler.ts - Complete OpenAI file handling service
import { createClient } from '@supabase/supabase-js';

interface OpenAIFileReference {
  sandboxUrl: string;
  filename: string;
  fileId?: string;
  blobUrl?: string;
}

export class OpenAIFileHandler {
  private supabase: any;

  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );
  }

  /**
   * Extract and store OpenAI generated files from message content
   */
  async processOpenAIMessage(
    messageContent: string,
    threadId: string,
    messageId: string
  ): Promise<string> {
    if (!messageContent || !messageContent.includes('sandbox:/')) {
      return messageContent;
    }

    console.log(`Processing OpenAI message for sandbox URLs in thread ${threadId}`);

    // Multiple patterns to catch different sandbox URL formats
    const patterns = [
      /\[([^\]]+)\]\((sandbox:\/\/mnt\/data\/([^)]+))\)/g, // Markdown links
      /(sandbox:\/\/mnt\/data\/([^\s\)]+))/g, // Plain URLs
    ];
    
    const fileReferences: OpenAIFileReference[] = [];
    const processedUrls = new Set<string>();
    
    // Extract all sandbox URLs
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(messageContent)) !== null) {
        const sandboxUrl = match[1].startsWith('sandbox:') ? match[1] : match[2];
        const filename = match[1].startsWith('sandbox:') ? match[2] : match[3] || match[2];
        
        if (!processedUrls.has(sandboxUrl)) {
          processedUrls.add(sandboxUrl);
          fileReferences.push({
            sandboxUrl: sandboxUrl,
            filename: filename
          });
        }
      }
    }

    if (fileReferences.length === 0) {
      return messageContent;
    }

    console.log(`Found ${fileReferences.length} sandbox URLs to process`);

    // Process each file reference
    for (const ref of fileReferences) {
      try {
        // Check if file already exists in database by sandbox URL
        const { data: existingFile } = await this.supabase
          .from('blob_files')
          .select('*')
          .eq('sandbox_url', ref.sandboxUrl)
          .single();

        if (existingFile) {
          // File already exists, use existing URLs
          ref.blobUrl = existingFile.blob_url || 
                       existingFile.vercel_blob_url || 
                       `/api/files/${existingFile.file_id || existingFile.openai_file_id}`;
          ref.fileId = existingFile.file_id || existingFile.openai_file_id;
          console.log(`Found existing file mapping for ${ref.filename}`);
        } else {
          // Check by filename and thread
          const { data: fileByName } = await this.supabase
            .from('blob_files')
            .select('*')
            .eq('thread_id', threadId)
            .eq('filename', ref.filename)
            .single();

          if (fileByName) {
            // Update with sandbox URL
            await this.supabase
              .from('blob_files')
              .update({ sandbox_url: ref.sandboxUrl })
              .eq('id', fileByName.id);
            
            ref.blobUrl = fileByName.blob_url || 
                         fileByName.vercel_blob_url || 
                         `/api/files/${fileByName.file_id || fileByName.openai_file_id}`;
            ref.fileId = fileByName.file_id || fileByName.openai_file_id;
            console.log(`Updated existing file with sandbox URL for ${ref.filename}`);
          } else {
            // Create new file entry for OpenAI generated file
            const fileId = `openai-${threadId.substring(0, 8)}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            
            // Determine file type
            const fileType = this.getFileType(ref.filename);
            
            // Store file metadata in database
            const { data: newFile, error } = await this.supabase
              .from('blob_files')
              .insert({
                file_id: fileId,
                openai_file_id: fileId, // For backward compatibility
                thread_id: threadId,
                message_id: messageId,
                filename: ref.filename,
                description: ref.filename,
                type: fileType,
                sandbox_url: ref.sandboxUrl,
                // These will be populated when file is actually downloaded
                vercel_blob_url: null,
                vercel_file_key: null,
                blob_url: null,
                file_size: 0,
                content_type: this.getContentType(ref.filename),
                created_at: new Date().toISOString()
              })
              .select()
              .single();

            if (!error && newFile) {
              ref.fileId = newFile.file_id;
              // Use /api/files/ endpoint until blob is created
              ref.blobUrl = `/api/files/${newFile.file_id}`;
              console.log(`Created new file entry for ${ref.filename} with ID ${fileId}`);
            } else {
              console.error(`Failed to create file entry for ${ref.filename}:`, error);
            }
          }
        }
      } catch (error) {
        console.error(`Failed to process file ${ref.filename}:`, error);
      }
    }

    // Replace sandbox URLs with actual URLs in content
    let processedContent = messageContent;
    for (const ref of fileReferences) {
      if (ref.blobUrl) {
        // Replace all occurrences of this sandbox URL
        const escapedUrl = ref.sandboxUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedUrl, 'g');
        processedContent = processedContent.replace(regex, ref.blobUrl);
        console.log(`Replaced ${ref.sandboxUrl} with ${ref.blobUrl}`);
      }
    }

    return processedContent;
  }

  /**
   * Download file from OpenAI and store as blob
   */
async downloadAndStoreOpenAIFile(
  fileId: string,
  openaiFileId: string,
  threadId: string
): Promise<string | null> {
  try {
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    console.log(`Downloading OpenAI file ${openaiFileId}`);

    // Download file from OpenAI
    const file = await openai.files.retrieve(openaiFileId);
    const fileContent = await openai.files.content(openaiFileId);
    
    // Convert response to buffer - FIXED
    const buffer = Buffer.from(await fileContent.arrayBuffer());

    // Create blob
    const blob = new Blob([buffer]);
    
    // Upload to Vercel Blob Storage
    const { put } = await import('@vercel/blob');
    const { url } = await put(
      `threads/${threadId}/${fileId}/${file.filename}`,
      blob,
      { access: 'public' }
    );

    console.log(`Uploaded file to Vercel Blob: ${url}`);

    // Update database with blob URL
    const { error } = await this.supabase
      .from('blob_files')
      .update({ 
        vercel_blob_url: url,
        blob_url: url,
        file_size: buffer.length
      })
      .eq('file_id', fileId);

    if (error) {
      console.error('Failed to update blob URL in database:', error);
    }

    return url;
  } catch (error) {
    console.error('Failed to download OpenAI file:', error);
    return null;
  }
}

  /**
   * Get file type from filename
   */
  private getFileType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    
    const typeMap: Record<string, string> = {
      'xlsx': 'spreadsheet',
      'xls': 'spreadsheet',
      'csv': 'spreadsheet',
      'pdf': 'document',
      'doc': 'document',
      'docx': 'document',
      'png': 'image',
      'jpg': 'image',
      'jpeg': 'image',
      'gif': 'image',
      'svg': 'image',
      'txt': 'text',
      'md': 'text',
      'json': 'code',
      'js': 'code',
      'ts': 'code',
      'py': 'code',
      'java': 'code',
      'cpp': 'code',
      'c': 'code',
      'html': 'code',
      'css': 'code',
      'xml': 'code',
      'yaml': 'code',
      'yml': 'code',
      'zip': 'archive',
      'rar': 'archive',
      '7z': 'archive',
      'tar': 'archive',
      'gz': 'archive'
    };

    return typeMap[ext || ''] || 'file';
  }

  /**
   * Get content type from filename
   */
  private getContentType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    
    const contentTypeMap: Record<string, string> = {
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'xls': 'application/vnd.ms-excel',
      'csv': 'text/csv',
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'svg': 'image/svg+xml',
      'txt': 'text/plain',
      'md': 'text/markdown',
      'json': 'application/json',
      'js': 'application/javascript',
      'ts': 'application/typescript',
      'py': 'text/x-python',
      'html': 'text/html',
      'css': 'text/css',
      'xml': 'application/xml',
      'yaml': 'application/x-yaml',
      'yml': 'application/x-yaml',
      'zip': 'application/zip',
      'rar': 'application/x-rar-compressed',
      '7z': 'application/x-7z-compressed',
      'tar': 'application/x-tar',
      'gz': 'application/gzip'
    };

    return contentTypeMap[ext || ''] || 'application/octet-stream';
  }

  /**
   * Map sandbox URLs to downloadable URLs for a thread
   */
  async getSandboxUrlMappings(threadId: string): Promise<Map<string, string>> {
    const mappings = new Map<string, string>();
    
    try {
      const { data: files } = await this.supabase
        .from('blob_files')
        .select('sandbox_url, blob_url, vercel_blob_url, file_id, openai_file_id')
        .eq('thread_id', threadId)
        .not('sandbox_url', 'is', null);

      if (files) {
        files.forEach((file: any) => {
          const url = file.blob_url || 
                     file.vercel_blob_url || 
                     `/api/files/${file.file_id || file.openai_file_id}`;
          mappings.set(file.sandbox_url, url);
        });
      }

      console.log(`Retrieved ${mappings.size} sandbox URL mappings for thread ${threadId}`);
    } catch (error) {
      console.error('Failed to get sandbox URL mappings:', error);
    }

    return mappings;
  }

  /**
   * Clean up old sandbox URLs (older than 48 hours)
   */
  async cleanupOldSandboxUrls(): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('blob_files')
        .update({ sandbox_url: null })
        .lt('created_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
        .not('sandbox_url', 'is', null);

      if (error) {
        console.error('Failed to cleanup old sandbox URLs:', error);
      } else {
        console.log('Cleaned up old sandbox URLs');
      }
    } catch (error) {
      console.error('Error in sandbox URL cleanup:', error);
    }
  }
}