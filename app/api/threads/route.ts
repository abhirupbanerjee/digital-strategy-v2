// app/api/threads/route.ts - Complete updated file
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
 * Map sandbox URLs to downloadable URLs with better attachment handling
 */
async function mapSandboxUrlsToFiles(
  content: string, 
  threadId: string,
  annotations: any[],
  message: any,
  supabase: any
): Promise<string> {
  if (!content || typeof content !== 'string') return content;
  
  // Quick check for sandbox URLs
  if (!content.includes('sandbox:/')) return content;
  
  console.log(`=== MAPPING SANDBOX URLs ===`);
  console.log(`Thread: ${threadId}, Message: ${message.id}`);
  console.log(`Content has sandbox URLs:`, content.includes('sandbox:/'));
  console.log(`Message has ${message.attachments?.length || 0} attachments`);
  
  // If we have attachments and sandbox URLs, map them directly
  if (message.attachments && message.attachments.length > 0 && content.includes('sandbox:/')) {
    const sandboxPattern = /sandbox:\/\/mnt\/data\/([^\s\)\]]+)/g;
    let mappedContent = content;
    
    // For each sandbox URL found
    let match;
    let urlIndex = 0;
    while ((match = sandboxPattern.exec(content)) !== null) {
      const sandboxUrl = match[0];
      const filename = match[1];
      
      // Use the attachment at the corresponding index or the first one
      const attachment = message.attachments[urlIndex] || message.attachments[0];
      if (attachment && attachment.file_id) {
        const downloadUrl = `/api/files/${attachment.file_id}`;
        mappedContent = mappedContent.replace(sandboxUrl, downloadUrl);
        console.log(`Mapped: ${sandboxUrl} -> ${downloadUrl}`);
        
        // Store this mapping in the database
        try {
          await supabase
            .from('blob_files')
            .upsert({
              openai_file_id: attachment.file_id,
              file_id: attachment.file_id,
              sandbox_url: sandboxUrl,
              thread_id: threadId,
              message_id: message.id,
              filename: filename,
              type: 'file',
              content_type: 'application/octet-stream',
              file_size: 0,
              created_at: new Date().toISOString()
            }, {
              onConflict: 'openai_file_id',
              ignoreDuplicates: false
            });
        } catch (error) {
          console.error('Failed to store mapping:', error);
        }
      }
      urlIndex++;
    }
    
    console.log(`=== MAPPING COMPLETE ===`);
    return mappedContent;
  }
  
  // Return original content if no mapping was done
  return content;
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
                
                // Map sandbox URLs including annotations AND message attachments
                let mappedText = await mapSandboxUrlsToFiles(
                  item.text.value, 
                  threadId,
                  annotations,
                  msg, // Pass the full message object
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

    // Clean messages - FIXED to preserve URLs
    const cleanedMessages = processedMessages.map((msg: any) => {
      let cleanedContent = msg.content;
      
      if (Array.isArray(cleanedContent)) {
        // Process each content item individually to preserve URLs
        cleanedContent = cleanedContent
          .map((item: any) => {
            if (item.type === 'text' && item.text?.value) {
              // Clean the text but preserve file links
              const cleaned = ContentCleaningService.cleanForActiveChat(item.text.value, {
                preserveWebSearch: false,
                preserveFileLinks: true
              });
              return cleaned;
            }
            return '';
          })
          .filter(Boolean)
          .join('\n');
      } else if (typeof cleanedContent === 'string') {
        cleanedContent = ContentCleaningService.cleanForActiveChat(cleanedContent, {
          preserveWebSearch: false,
          preserveFileLinks: true
        });
      }
      
      // Return simplified message structure with cleaned content
      return {
        id: msg.id,
        role: msg.role,
        content: cleanedContent, // Now contains the mapped URLs
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId, title } = body;

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    // Create new OpenAI thread
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    const thread = await openai.beta.threads.create();

    // Store thread in database
    const { data, error } = await supabase
      .from('threads')
      .insert({
        id: thread.id,
        project_id: projectId || null,
        title: title,
        message_count: 0,
        last_activity: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('Error storing thread:', error);
      // Still return the thread even if DB storage fails
      return NextResponse.json({
        success: true,
        thread: {
          id: thread.id,
          title: title,
          project_id: projectId
        }
      });
    }

    return NextResponse.json({
      success: true,
      thread: data
    });

  } catch (error) {
    console.error('Error creating thread:', error);
    return NextResponse.json(
      { error: 'Failed to create thread' },
      { status: 500 }
    );
  }
}