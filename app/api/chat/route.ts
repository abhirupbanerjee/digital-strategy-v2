// app/api/chat/route.ts - FIXED VERSION WITH CORRECT CLIENT METHODS
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { openaiClient, tavilyClient, storageClient } from '@/lib/clients';
import { ApiError, createErrorResponse } from '@/lib/utils/apiErrors';
import { ContentCleaningService } from '@/services/contentCleaningService';
import { ThreadFileService } from '@/services/threadFileService';


const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

// Polling configuration
const MAX_RETRIES = parseInt(process.env.OPENAI_MAX_RETRIES || '300');
const POLL_INTERVAL = parseInt(process.env.OPENAI_POLL_INTERVAL || '1000');
const WEB_SEARCH_MAX_RETRIES = parseInt(process.env.OPENAI_WEB_SEARCH_MAX_RETRIES || '900');
const WEB_SEARCH_POLL_INTERVAL = parseInt(process.env.OPENAI_WEB_SEARCH_POLL_INTERVAL || '2000');

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const DEBUG = process.env.NODE_ENV === 'development' && process.env.DEBUG_CHAT === 'true';

// Main POST handler - with file download and web search fix
export async function POST(request: NextRequest) {
  try {
    const { message, threadId, fileIds, webSearchEnabled, useJsonFormat, originalMessage } = await request.json();

    // Basic validation
    if (!ASSISTANT_ID) {
      throw new ApiError('Missing OpenAI configuration', 500, 'CONFIG_ERROR');
    }

    if (!message || message.trim() === '') {
      throw new ApiError('Message is required', 400, 'VALIDATION_ERROR');
    }

    let currentThreadId = threadId;

    // Create thread if needed
    if (!currentThreadId) {
      if (DEBUG) console.log('Creating new thread...');
      try {
        const thread = await openaiClient.createThread();
        currentThreadId = thread.id;
        if (DEBUG) console.log('Thread created:', currentThreadId);
      } catch (error) {
        console.error('Failed to create thread:', error);
        throw new ApiError('Failed to create thread', 500, 'THREAD_CREATION_ERROR');
      }
    }

    // Handle file uploads
    const newFileIds = fileIds || [];
    const existingThreadFiles:string[]= [];

    if (currentThreadId && threadId) {
      try {
        const { data: threadFiles } = await supabase
          .from('thread_file_context')
          .select('*')
          .eq('thread_id', currentThreadId)
          .eq('is_active', true);

        if (threadFiles) {
          threadFiles.forEach((file: any) => {
            const fileContext = file.file_context_tracking;
            if (fileContext?.openai_file_id) {
              existingThreadFiles.push(fileContext.openai_file_id);
            }
          });
        }
      } catch (error) {
        console.error('Error fetching thread files:', error);
      }
    }

    const allFileIds = [...new Set([...existingThreadFiles, ...newFileIds])];
    if (DEBUG) console.log('Total file IDs for thread:', allFileIds);

    // Handle web search
    let webSearchPerformed = false;
    let searchSources: any[] = [];
    let messageContent = message;

    if (webSearchEnabled && tavilyClient) {
      try {
        if (DEBUG) console.log('Performing web search...');
        const searchResults = await tavilyClient.search(originalMessage || message);
        
        if (searchResults && searchResults.results) {
          webSearchPerformed = true;
          searchSources = searchResults.results.map((r: any) => ({
            title: r.title,
            url: r.url,
            snippet: r.content?.substring(0, 200) + '...'
          }));
          
          messageContent = formatSearchEnhancedMessage(message, searchResults, useJsonFormat || false);
          if (DEBUG) console.log('Web search enhanced message created');
        }
      } catch (error) {
        console.error('Web search failed:', error);
      }
    }

    const enhancedMessage = webSearchPerformed ? messageContent : (originalMessage || message);

    // Add message to thread
    try {
      await openaiClient.addMessage(currentThreadId, enhancedMessage, allFileIds.length > 0 ? allFileIds : undefined);
      if (DEBUG) console.log('Message added to thread successfully');
    } catch (error) {
      console.error('Failed to add message:', error);
      throw new ApiError('Failed to add message to thread', 500, 'MESSAGE_ERROR');
    }

    // Create run
    let run;
    try {
      run = await openaiClient.createRun(currentThreadId, ASSISTANT_ID);
      if (DEBUG) console.log('Run created:', run.id);
    } catch (error) {
      console.error('Failed to create run:', error);
      throw new ApiError('Failed to create run', 500, 'RUN_ERROR');
    }

    // Poll for completion
    const maxRetries = webSearchEnabled ? WEB_SEARCH_MAX_RETRIES : MAX_RETRIES;
    const pollInterval = webSearchEnabled ? WEB_SEARCH_POLL_INTERVAL : POLL_INTERVAL;
    
    let completedRun;
    try {
      completedRun = await openaiClient.waitForRunCompletion(
        currentThreadId,
        run.id,
        maxRetries,
        pollInterval
      );
    } catch (error) {
      console.error('Run polling failed:', error);
      throw new ApiError('Assistant run timeout', 408, 'RUN_TIMEOUT');
    }

    // Process response
    let reply = 'No response received.';
    let extractedResponse: any = { type: 'text', content: reply };

    if (completedRun.status === 'completed') {
      // Get messages from thread
      const messages = await openaiClient.getMessages(currentThreadId, 1);
      
      if (messages.data && messages.data.length > 0) {
        const assistantMessage = messages.data[0];
        extractedResponse = await extractTextFromMessage(assistantMessage);
        reply = extractedResponse.content || 'No response received.';
        
        // CRITICAL FIX: Process file outputs (images/graphs)
        if (extractedResponse.files && extractedResponse.files.length > 0) {
          reply = await processFileOutputs(
            extractedResponse.files,
            currentThreadId,
            reply
          );
          
          // Also handle storage upload for non-image files
          if (storageClient) {
            for (const file of extractedResponse.files) {
              if (!file.description.toLowerCase().includes('image') && 
                  !file.description.toLowerCase().includes('graph')) {
                await uploadFileToStorage(file.fileId, file.description, currentThreadId);
              }
            }
          }
        }
      }
    } else if (completedRun.status === 'failed') {
      reply = webSearchEnabled 
        ? 'The assistant failed to process your request with web search. Please try again without web search.'
        : 'The assistant run failed. Please try again.';
      extractedResponse = { type: 'text', content: reply };
    } else if (completedRun.status === 'requires_action') {
      reply = 'Additional action required. Please try again.';
      extractedResponse = { type: 'text', content: reply };
    }

    // Update thread file tracking
    if (completedRun.status === 'completed' && currentThreadId && newFileIds.length > 0) {
      await updateThreadFileTracking(currentThreadId, newFileIds, allFileIds);
    }

    // Clean response content with proper preservation
    const cleanedReply = ContentCleaningService.cleanForActiveChat(reply, {
      preserveWebSearch: webSearchEnabled,
      preserveFileLinks: true
    });

    // Return response
    return NextResponse.json({
      reply: cleanedReply,
      threadId: currentThreadId,
      searchSources: webSearchPerformed ? searchSources : undefined,
      messageId: run.id,
      status: completedRun.status,
      fileOutput: extractedResponse.files, // Keep for backward compatibility
      isComplete: completedRun.status === 'completed'
    });

  } catch (error: any) {
    console.error('Chat API error:', error);
    
    const errorResponse = createErrorResponse(error);
    const status = error instanceof ApiError ? error.status : 500;
    
    return NextResponse.json(errorResponse, { status });
  }
}

// Helper functions
//Format search enhanced message (existing function)
function formatSearchEnhancedMessage(message: string, searchResults: any, useJsonFormat: boolean): string {
  let enhancedMessage = message;
  
  // Add search context wrapper
  enhancedMessage += '\n\n[INTERNAL SEARCH CONTEXT - DO NOT INCLUDE IN RESPONSE]:';
  
  if (searchResults.answer) {
    enhancedMessage += `\n\nWeb Search Summary: ${searchResults.answer}`;
  }
  
  enhancedMessage += '\n\nSources:\n';
  searchResults.results.forEach((result: any, index: number) => {
    // Include source with arrow symbol for citations
    enhancedMessage += `${index + 1}. ${result.title}\n`;
    enhancedMessage += `   ${result.content.substring(0, 200)}...\n`;
    enhancedMessage += `   Source: ${result.url}↗\n\n`;
  });
  
  enhancedMessage += '[END SEARCH CONTEXT]\n\n';
  enhancedMessage += 'Please provide a natural response incorporating relevant information from the search results above.';
  
  if (useJsonFormat) {
    enhancedMessage += '\n\nPlease format your response as a valid JSON object.';
  }
  
  return enhancedMessage;
}

// MODIFIED extractTextFromMessage FUNCTION
// UPDATED to handle both image_file and file types
async function extractTextFromMessage(message: any): Promise<any> {
  try {
    const textContent = message.content
      .filter((item: any) => item.type === 'text')
      .map((item: any) => item.text?.value || '')
      .join('\n');
    
    // Extract both image_file and regular file outputs
    const files = message.content
      .filter((item: any) => item.type === 'image_file' || item.type === 'file')
      .map((item: any) => {
        if (item.type === 'image_file' && item.image_file?.file_id) {
          return {
            fileId: item.image_file.file_id,
            description: 'Generated image'
          };
        } else if (item.type === 'file' && item.file?.file_id) {
          return {
            fileId: item.file.file_id,
            description: 'Generated file'
          };
        }
        return null;
      })
      .filter(Boolean);
    
    return {
      type: 'text',
      content: textContent,
      files: files.length > 0 ? files : undefined
    };
  } catch (error) {
    console.error('Error extracting text from message:', error);
    return { type: 'text', content: 'Error processing response.' };
  }
}

//Upload file to storage (existing function)
async function uploadFileToStorage(fileId: string, description: string, threadId: string) {
  if (!storageClient) return null;
  
  try {
    const fileContent = await openaiClient.getFileContent(fileId);
    const fileBuffer = Buffer.from(fileContent);
    const filename = `${description}-${Date.now()}.docx`;

    const result = await storageClient.upload(
      fileBuffer,
      `threads/${threadId}/${filename}`,
      {
        contentType: 'application/octet-stream'
      }
    );

    await supabase
      .from('blob_files')
      .insert({
        openai_file_id: fileId,
        vercel_blob_url: result.url,
        vercel_file_key: result.pathname,
        filename: filename,
        content_type: 'application/octet-stream',
        file_size: fileBuffer.length,
        thread_id: threadId,
        created_at: new Date().toISOString()
      });

    return result;
  } catch (error) {
    console.error(`Error uploading file ${fileId}:`, error);
    return null;
  }
}


//Update thread file tracking (existing function)
async function updateThreadFileTracking(threadId: string, newFileIds: string[], allFileIds: string[]) {
  try {
    for (const fileId of newFileIds) {
      try {
        const metadata = await openaiClient.getFile(fileId);
        
        await ThreadFileService.addFileToThread(
          threadId,
          fileId,
          metadata.filename || `file-${Date.now()}`,
          metadata.purpose || 'assistants',
          metadata.bytes || 0
        );
      } catch (error) {
        console.error(`Error processing file ${fileId}:`, error);
      }
    }
    
    if (allFileIds.length > 0) {
      await ThreadFileService.updateFileUsage(threadId, allFileIds);
    }
  } catch (error) {
    console.error('Error updating thread file tracking:', error);
  }
}

// Process fileOutput array and inject references into message content
// This should be called after receiving the assistant response
// CRITICAL NEW FUNCTION for handling generated images/graphs
async function processFileOutputs(
  fileOutputs: Array<{ fileId: string; description: string }>,
  threadId: string,
  messageContent: string
): Promise<string> {
  if (!fileOutputs || fileOutputs.length === 0) {
    return messageContent;
  }
  
  console.log(`Processing ${fileOutputs.length} file outputs`);
  
  let enhancedContent = messageContent;
  const processedFiles: string[] = [];
  
  for (const fileOutput of fileOutputs) {
    try {
      const { fileId, description } = fileOutput;
      
      // Store file reference in database
      await supabase
        .from('blob_files')
        .upsert({
          openai_file_id: fileId,
          file_id: fileId,
          thread_id: threadId,
          filename: `${description.replace(/\s+/g, '_')}_${Date.now()}`,
          description: description,
          type: 'file',
          content_type: 'application/octet-stream',
          file_size: 0,
          created_at: new Date().toISOString()
        }, {
          onConflict: 'openai_file_id',
          ignoreDuplicates: false
        });
      
      // Create download/view URL
      const fileUrl = `/api/files/${fileId}`;
      
      // Determine if it's likely an image/graph based on description
      const imageKeywords = [
        'graph', 'chart', 'plot', 'diagram', 
        'image', 'visualization', 'figure',
        'drawing', 'illustration', 'picture'
      ];
      
      const isImage = imageKeywords.some(keyword => 
        description.toLowerCase().includes(keyword)
      );
      
      // Add appropriate markdown to content
      if (isImage) {
        enhancedContent += `\n\n![${description}](${fileUrl})`;
        console.log(`Added image reference: ${fileUrl}`);
      } else {
        enhancedContent += `\n\n[Download ${description}](${fileUrl})`;
        console.log(`Added file download link: ${fileUrl}`);
      }
      
      processedFiles.push(fileId);
      
    } catch (error) {
      console.error(`Error processing file output ${fileOutput.fileId}:`, error);
    }
  }
  
  if (processedFiles.length > 0) {
    console.log(`Successfully processed ${processedFiles.length} file outputs`);
  }
  
  return enhancedContent;
}