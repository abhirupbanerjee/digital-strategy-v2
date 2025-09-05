// app/api/threads/route.ts - COMPLETE FIX with annotation handling
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ContentCleaningService } from '@/services/contentCleaningService';
import { OpenAIFileHandler } from '@/services/openaiFileHandler';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

/**
 * Process OpenAI message annotations and store file mappings
 */
async function processFileAnnotations(
  message: any,
  threadId: string,
  supabase: any
): Promise<void> {
  if (!message.content || !Array.isArray(message.content)) return;
  
  for (const contentItem of message.content) {
    if (contentItem.type === 'text' && contentItem.text?.annotations) {
      for (const annotation of contentItem.text.annotations) {
        if (annotation.type === 'file_path' && annotation.file_path?.file_id) {
          const sandboxUrl = annotation.text;
          const fileId = annotation.file_path.file_id;
          
          console.log(`Found annotation: ${sandboxUrl} -> ${fileId}`);
          
          // Check if this file mapping exists
          const { data: existing } = await supabase
            .from('blob_files')
            .select('*')
            .eq('openai_file_id', fileId)
            .single();
          
          if (!existing) {
            // Extract filename from sandbox URL
            const filename = sandboxUrl.split('/').pop() || 'file';
            
            // Create new mapping
            const { error } = await supabase
              .from('blob_files')
              .insert({
                openai_file_id: fileId,
                file_id: fileId,
                sandbox_url: sandboxUrl,
                thread_id: threadId,
                message_id: message.id,
                filename: filename,
                description: filename,
                type: 'file',
                content_type: 'application/octet-stream',
                file_size: 0,
                created_at: new Date().toISOString()
              });
            
            if (error) {
              console.error(`Failed to create file mapping for ${fileId}:`, error);
            } else {
              console.log(`Created file mapping for ${fileId}`);
            }
          } else {
            // Update existing record with sandbox URL if missing
            if (!existing.sandbox_url) {
              await supabase
                .from('blob_files')
                .update({ 
                  sandbox_url: sandboxUrl,
                  message_id: message.id 
                })
                .eq('id', existing.id);
              
              console.log(`Updated existing file with sandbox URL: ${sandboxUrl}`);
            }
          }
        }
      }
    }
  }
  
  // Also check attachments
  if (message.attachments && Array.isArray(message.attachments)) {
    for (const attachment of message.attachments) {
      if (attachment.file_id) {
        console.log(`Found attachment file: ${attachment.file_id}`);
        
        // Check if mapping exists
        const { data: existing } = await supabase
          .from('blob_files')
          .select('*')
          .eq('openai_file_id', attachment.file_id)
          .single();
        
        if (!existing) {
          // Create basic mapping for attachment
          await supabase
            .from('blob_files')
            .insert({
              openai_file_id: attachment.file_id,
              file_id: attachment.file_id,
              thread_id: threadId,
              message_id: message.id,
              filename: 'attachment',
              type: 'file',
              content_type: 'application/octet-stream',
              file_size: 0,
              created_at: new Date().toISOString()
            });
        }
      }
    }
  }
}

/**
 * Map sandbox URLs to downloadable URLs
 */
async function mapSandboxUrlsToFiles(
  content: string, 
  threadId: string,
  annotations: any[],
  supabase: any
): Promise<string> {
  if (!content || typeof content !== 'string') return content;
  
  // Quick check for sandbox URLs
  if (!content.includes('sandbox:/')) return content;
  
  console.log(`Mapping sandbox URLs for thread ${threadId}`);
  
  // Build mapping from annotations first
  const annotationMap = new Map<string, string>();
  if (annotations && Array.isArray(annotations)) {
    for (const annotation of annotations) {
      if (annotation.type === 'file_path' && annotation.file_path?.file_id) {
        const sandboxUrl = annotation.text;
        const fileId = annotation.file_path.file_id;
        
        // Try to find this file in database by openai_file_id
        const { data: fileRecord } = await supabase
          .from('blob_files')
          .select('*')
          .or(`openai_file_id.eq.${fileId},file_id.eq.${fileId}`)
          .single();
        
        if (fileRecord) {
          const downloadUrl = fileRecord.blob_url || 
                             fileRecord.vercel_blob_url || 
                             `/api/files/${fileRecord.openai_file_id || fileRecord.file_id}`;
          annotationMap.set(sandboxUrl, downloadUrl);
          console.log(`Mapped from annotation: ${sandboxUrl} -> ${downloadUrl}`);
        } else {
          // No existing file, create placeholder URL
          annotationMap.set(sandboxUrl, `/api/files/${fileId}`);
          console.log(`Created placeholder mapping: ${sandboxUrl} -> /api/files/${fileId}`);
        }
      }
    }
  }
  
  // Get all files for this thread
  const { data: threadFiles, error } = await supabase
    .from('blob_files')
    .select('*')
    .eq('thread_id', threadId);

  if (error) {
    console.error('Error fetching thread files:', error);
  }

  // Build comprehensive file map
  const fileMap = new Map<string, string>(annotationMap);
  
  if (threadFiles && threadFiles.length > 0) {
    console.log(`Found ${threadFiles.length} files for thread ${threadId}`);
    
    for (const file of threadFiles) {
      const downloadUrl = file.blob_url || 
                         file.vercel_blob_url || 
                         `/api/files/${file.openai_file_id || file.file_id}`;
      
      // Map by sandbox URL
      if (file.sandbox_url) {
        fileMap.set(file.sandbox_url, downloadUrl);
      }
      
      // Map by filename
      if (file.filename) {
        fileMap.set(file.filename, downloadUrl);
        // Also map without extension
        const nameWithoutExt = file.filename.replace(/\.[^/.]+$/, '');
        fileMap.set(nameWithoutExt, downloadUrl);
      }
    }
  }
  
  // Replace sandbox URLs in content
  let mappedContent = content;
  let replacementCount = 0;
  
  // Use regex to find and replace all sandbox URLs
  const sandboxPattern = /sandbox:\/\/mnt\/data\/([^\s\)\]]+)/g;
  
  mappedContent = mappedContent.replace(sandboxPattern, (match, filename) => {
    // Try exact match first
    if (fileMap.has(match)) {
      replacementCount++;
      const url = fileMap.get(match)!;
      console.log(`Replaced: ${match} -> ${url}`);
      return url;
    }
    
    // Try filename
    if (fileMap.has(filename)) {
      replacementCount++;
      const url = fileMap.get(filename)!;
      console.log(`Replaced by filename: ${match} -> ${url}`);
      return url;
    }
    
    console.warn(`Could not map sandbox URL: ${match}`);
    return match;
  });
  
  console.log(`Replaced ${replacementCount} sandbox URLs`);
  return mappedContent;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get('threadId');
    const limit = parseInt(searchParams.get('limit') || '50');

    if (!threadId) {
      return NextResponse.json({ error: 'Thread ID is required' }, { status: 400 });
    }

    // Initialize file handler
    const fileHandler = new OpenAIFileHandler();

    // Fetch thread messages from OpenAI
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    const messagesResponse = await openai.beta.threads.messages.list(threadId, { limit });
    const messages = messagesResponse.data;
    
    // First pass: Process all file annotations
    for (const message of messages) {
      await processFileAnnotations(message, threadId, supabase);
    }
    
    // Second pass: Process and clean messages
    const processedMessages = await Promise.all(
      messages.map(async (msg: any) => {
        let content = msg.content;
        
        // Handle content array
        if (Array.isArray(content)) {
          content = await Promise.all(
            content.map(async (item: any) => {
              if (item.type === 'text' && item.text?.value) {
                // Get annotations for this text
                const annotations = item.text.annotations || [];
                
                // Map sandbox URLs including annotations
                let mappedText = await mapSandboxUrlsToFiles(
                  item.text.value, 
                  threadId,
                  annotations,
                  supabase
                );
                
                // Process with OpenAI file handler as backup
                mappedText = await fileHandler.processOpenAIMessage(
                  mappedText,
                  threadId,
                  msg.id
                );
                
                return {
                  ...item,
                  text: {
                    ...item.text,
                    value: mappedText
                  }
                };
              }
              return item;
            })
          );
        }
        
        return {
          ...msg,
          content: content
        };
      })
    );

    // Clean messages - this extracts text properly
    const cleanedMessages = processedMessages.map((msg: any) => {
      let cleanedContent = msg.content;
      
      if (Array.isArray(cleanedContent)) {
        // Extract text values from content array
        const textContent = cleanedContent
          .map((item: any) => {
            if (item.type === 'text' && item.text?.value) {
              return item.text.value;
            }
            return '';
          })
          .filter(Boolean)
          .join('\n');
        
        // Clean the extracted text
        cleanedContent = ContentCleaningService.cleanForActiveChat(textContent, {
          preserveWebSearch: false,
          preserveFileLinks: true
        });
      } else if (typeof cleanedContent === 'string') {
        cleanedContent = ContentCleaningService.cleanForActiveChat(cleanedContent, {
          preserveWebSearch: false,
          preserveFileLinks: true
        });
      }
      
      // Return simplified message structure
      return {
        id: msg.id,
        role: msg.role,
        content: cleanedContent, // Now this is always a string
        created_at: msg.created_at,
        file_ids: msg.file_ids || [],
        attachments: msg.attachments || []
      };
    });

    // Extract file attachments for summary
    const fileAttachments = cleanedMessages.reduce((acc: any[], msg: any) => {
      if (msg.attachments && msg.attachments.length > 0) {
        msg.attachments.forEach((attachment: any) => {
          if (attachment.file_id) {
            acc.push({
              file_id: attachment.file_id,
              message_id: msg.id,
              role: msg.role
            });
          }
        });
      }
      return acc;
    }, []);

    console.log(`📖 Retrieved ${cleanedMessages.length} messages from thread ${threadId}`);
    console.log(`📎 Found ${fileAttachments.length} file attachments`);

    return NextResponse.json({
      success: true,
      thread: {
        id: threadId,
        messages: cleanedMessages.reverse(), // Reverse to get chronological order
        totalMessages: cleanedMessages.length,
        fileCount: fileAttachments.length
      }
    });

  } catch (error) {
    console.error('Error fetching thread:', error);
    return NextResponse.json(
      { error: 'Failed to fetch thread messages' },
      { status: 500 }
    );
  }
}