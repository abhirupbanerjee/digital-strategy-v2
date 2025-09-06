// app/api/threads/route.ts - COMPLETE REVISED VERSION WITH ALL FIXES
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
 * Enhanced sandbox URL mapping with fileOutput support
 * This MUST run BEFORE any content cleaning
 */
async function mapAllSandboxUrls(
  message: any,
  threadId: string,
  supabase: any
): Promise<any> {
  console.log(`=== MAPPING SANDBOX URLs ===`);
  console.log(`Processing message: ${message.id}`);
  
  // Build a map of ALL available file mappings
  const fileMapping = new Map<string, string>();
  
  // First, get ALL file mappings from annotations
  if (message.content && Array.isArray(message.content)) {
    for (const item of message.content) {
      if (item.type === 'text' && item.text?.annotations) {
        for (const annotation of item.text.annotations) {
          if (annotation.type === 'file_path' && annotation.file_path?.file_id) {
            const sandboxUrl = annotation.text;
            const fileId = annotation.file_path.file_id;
            const downloadUrl = `/api/files/${fileId}`;
            fileMapping.set(sandboxUrl, downloadUrl);
            console.log(`Annotation mapping: ${sandboxUrl} -> ${downloadUrl}`);
          }
        }
      }
    }
  }
  
  // Also map attachments
  if (message.attachments && Array.isArray(message.attachments)) {
    for (const attachment of message.attachments) {
      if (attachment.file_id) {
        // Try to find the sandbox URL for this attachment
        const downloadUrl = `/api/files/${attachment.file_id}`;
        fileMapping.set(attachment.file_id, downloadUrl);
      }
    }
  }
  
  // Now process and replace sandbox URLs in content
  let content = message.content;
  
  // Extract text content
  if (Array.isArray(content)) {
    content = content
      .map((item: any) => {
        if (item.type === 'text' && item.text?.value) {
          let text = item.text.value;
          
          // Replace ALL sandbox URLs using our mapping
          fileMapping.forEach((downloadUrl, sandboxUrl) => {
            if (text.includes(sandboxUrl)) {
              text = text.replace(new RegExp(sandboxUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), downloadUrl);
              console.log(`Replaced: ${sandboxUrl} -> ${downloadUrl}`);
            }
          });
          
          return text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  } else if (typeof content === 'string') {
    // Replace sandbox URLs in string content
    fileMapping.forEach((downloadUrl, sandboxUrl) => {
      if (content.includes(sandboxUrl)) {
        content = content.replace(new RegExp(sandboxUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), downloadUrl);
        console.log(`Replaced: ${sandboxUrl} -> ${downloadUrl}`);
      }
    });
  }
  
  // Update message content
  message.content = content;
  console.log(`=== MAPPING COMPLETE ===`);
  return message;
}

/**
 * Process fileOutput array (for images/graphs)
 * Injects image references into content
 */
async function processFileOutput(message: any, threadId: string, supabase: any): Promise<any> {
  // Check if this is from our API response with fileOutput
  if (message.fileOutput && Array.isArray(message.fileOutput)) {
    console.log(`Processing ${message.fileOutput.length} file outputs`);
    
    let additionalContent = '';
    
    for (const file of message.fileOutput) {
      if (file.fileId) {
        const fileUrl = `/api/files/${file.fileId}`;
        const description = file.description || 'Generated file';
        
        // Store file reference in database for later retrieval
        try {
          await supabase
            .from('blob_files')
            .upsert({
              openai_file_id: file.fileId,
              file_id: file.fileId,
              thread_id: threadId,
              message_id: message.id,
              filename: `${description.replace(/\s+/g, '_')}.png`, // Default to PNG for graphs
              description: description,
              type: 'image',
              content_type: 'image/png',
              file_size: 0,
              created_at: new Date().toISOString()
            }, {
              onConflict: 'openai_file_id',
              ignoreDuplicates: false
            });
        } catch (error) {
          console.error('Failed to store file output mapping:', error);
        }
        
        // Determine if it's an image based on description or file ID
        const isImage = description.toLowerCase().includes('graph') || 
                       description.toLowerCase().includes('chart') || 
                       description.toLowerCase().includes('image') ||
                       description.toLowerCase().includes('diagram') ||
                       description.toLowerCase().includes('plot') ||
                       description.toLowerCase().includes('visualization');
        
        if (isImage) {
          // Add image markdown
          additionalContent += `\n\n![${description}](${fileUrl})`;
        } else {
          // Add download link
          additionalContent += `\n\n[Download ${description}](${fileUrl})`;
        }
        
        console.log(`Added ${isImage ? 'image' : 'file'} reference: ${fileUrl}`);
      }
    }
    
    // Append to existing content
    if (additionalContent) {
      if (typeof message.content === 'string') {
        message.content += additionalContent;
      } else {
        message.content = (message.content || '') + additionalContent;
      }
    }
  }
  
  return message;
}

/**
 * GET endpoint - Retrieve thread messages
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get('threadId');
    const limit = parseInt(searchParams.get('limit') || '100');

    if (!threadId) {
      return NextResponse.json({ error: 'Thread ID required' }, { status: 400 });
    }

    // Initialize OpenAI handler
    const openaiHandler = new OpenAIFileHandler();
    
    // Initialize OpenAI client
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    // Retrieve thread messages from OpenAI
    const messagesResponse = await openai.beta.threads.messages.list(threadId, { limit });
    const messages = messagesResponse.data;
    
    if (!messages || messages.length === 0) {
      return NextResponse.json({
        messages: [],
        totalMessages: 0,
        fileCount: 0
      });
    }

    // CRITICAL: Process messages in the correct order
    const processedMessages = await Promise.all(
      messages.map(async (msg: any) => {
        // Step 1: Process file annotations first
        await processFileAnnotations(msg, threadId, supabase);
        
        // Step 2: Map sandbox URLs BEFORE any cleaning
        const mappedMessage = await mapAllSandboxUrls(msg, threadId, supabase);
        
        // Step 3: Process fileOutput array (for images)
        const messageWithFiles = await processFileOutput(mappedMessage, threadId, supabase);
        
        // Step 4: Process with OpenAI file handler as additional processing
        let finalContent = messageWithFiles.content;
        
        // Handle array content
        if (Array.isArray(finalContent)) {
          finalContent = finalContent
            .map((item: any) => {
              if (item.type === 'text' && item.text?.value) {
                return item.text.value;
              }
              return '';
            })
            .filter(Boolean)
            .join('\n');
        }
        
        // Additional processing with OpenAI file handler
        if (typeof finalContent === 'string') {
          finalContent = await openaiHandler.processOpenAIMessage(
            finalContent,
            threadId,
            messageWithFiles.id
          );
        }
        
        // Return message with processed content
        return {
          ...messageWithFiles,
          content: finalContent
        };
      })
    );

    // Step 5: NOW clean messages (after all mapping is complete)
    const cleanedMessages = processedMessages.map((msg: any) => {
      let cleanedContent = msg.content;
      
      // Clean content while preserving the mapped file links
      if (typeof cleanedContent === 'string') {
        cleanedContent = ContentCleaningService.cleanForActiveChat(cleanedContent, {
          preserveWebSearch: false,
          preserveFileLinks: true // This will now detect and preserve our mapped URLs
        });
      }
      
      // Return simplified message structure
      return {
        id: msg.id,
        role: msg.role,
        content: cleanedContent,
        created_at: msg.created_at,
        file_ids: msg.file_ids || [],
        attachments: msg.attachments || []
      };
    });

    // Count unique file attachments
    const fileCount = new Set(
      cleanedMessages.flatMap((msg: any) => 
        (msg.attachments || []).map((a: any) => a.file_id).filter(Boolean)
      )
    ).size;

    console.log(`📖 Retrieved ${cleanedMessages.length} messages from thread ${threadId}`);
    console.log(`📎 Found ${fileCount} file attachments`);

    return NextResponse.json({
      messages: cleanedMessages,
      totalMessages: cleanedMessages.length,
      fileCount: fileCount
    });

  } catch (error) {
    console.error('Error fetching thread messages:', error);
    return NextResponse.json(
      { error: 'Failed to fetch thread messages' },
      { status: 500 }
    );
  }
}

/**
 * POST endpoint - Save thread to database
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { threadId, title, messages, projectId } = body;

    if (!threadId || !messages) {
      return NextResponse.json(
        { error: 'Thread ID and messages are required' },
        { status: 400 }
      );
    }

    // Clean messages before saving
    const cleanedMessages = messages.map((msg: any) => ({
      ...msg,
      content: ContentCleaningService.cleanForDisplay(msg.content)
    }));

    // Upsert thread record
    const { data: thread, error: threadError } = await supabase
      .from('threads')
      .upsert({
        id: threadId,
        title: title || 'New Thread',
        messages: cleanedMessages,
        project_id: projectId || null,
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (threadError) {
      console.error('Error saving thread:', threadError);
      return NextResponse.json(
        { error: 'Failed to save thread' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      thread: thread
    });

  } catch (error) {
    console.error('Error in POST /api/threads:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE endpoint - Delete thread from database
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get('threadId');

    if (!threadId) {
      return NextResponse.json(
        { error: 'Thread ID is required' },
        { status: 400 }
      );
    }

    // Delete thread from database (cascade will handle related records)
    const { error } = await supabase
      .from('threads')
      .delete()
      .eq('id', threadId);

    if (error) {
      console.error('Error deleting thread:', error);
      return NextResponse.json(
        { error: 'Failed to delete thread' },
        { status: 500 }
      );
    }

    // Optionally try to delete from OpenAI (may fail if doesn't exist)
    try {
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      await openai.beta.threads.del(threadId);
    } catch (openaiError) {
      console.log('OpenAI thread deletion failed (may not exist):', openaiError);
    }

    return NextResponse.json({
      success: true,
      message: 'Thread deleted successfully'
    });

  } catch (error) {
    console.error('Error in DELETE /api/threads:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}