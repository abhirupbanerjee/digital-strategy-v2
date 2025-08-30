// app/api/chat/route.ts - MODIFIED VERSION
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { openaiClient, tavilyClient, storageClient } from '@/lib/clients';
import { ApiError, createErrorResponse } from '@/lib/utils/apiErrors';
import { ContentCleaningService } from '@/services/contentCleaningService';
import { ThreadFileService } from '@/services/threadFileService';

const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

// ✅ REMOVED: Direct axios imports and manual fetch calls
// ✅ REMOVED: Manual retry logic (now handled by httpClient)

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

    // ✅ MODIFIED: Create thread using openaiClient
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
    const existingThreadFiles = [];
    
    if (currentThreadId && threadId) {
      try {
        const { data: trackedFiles } = await supabase
          .from('thread_files')
          .select('openai_file_id')
          .eq('thread_id', currentThreadId)
          .eq('is_active', true);
        
        if (trackedFiles) {
          existingThreadFiles.push(...trackedFiles.map(f => f.openai_file_id));
        }
      } catch (error) {
        console.error('Error fetching thread files:', error);
      }
    }

    const allFileIds = [...new Set([...existingThreadFiles, ...newFileIds])];
    
    // ✅ MODIFIED: Handle web search using tavilyClient
    let searchSources: Array<{title: string, url: string, snippet: string, relevanceScore: number}> = [];
    let webSearchPerformed = false;
    let enhancedMessage = message;

    if (webSearchEnabled && tavilyClient) {
      try {
        const searchQuery = originalMessage || message;
        if (DEBUG) console.log('🔍 Performing web search for:', searchQuery);
        
        const searchResults = await tavilyClient.search({
          query: searchQuery,
          maxResults: 5,
          searchDepth: 'advanced',
          includeAnswer: true,
        });
        
        if (searchResults.results && searchResults.results.length > 0) {
          webSearchPerformed = true;
          searchSources = searchResults.results.map((result, index) => ({
            title: result.title,
            url: result.url,
            snippet: result.content.substring(0, 200),
            relevanceScore: result.score || (index + 1)
          }));
          
          enhancedMessage = formatSearchEnhancedMessage(message, searchResults, useJsonFormat);
          if (DEBUG) console.log(`✅ Web search completed: ${searchResults.results.length} results found`);
        }
      } catch (error) {
        console.error('Web search failed:', error);
        // Continue without search results
      }
    }

    // Prepare message for thread
    const messageContent = webSearchPerformed || useJsonFormat ? enhancedMessage : (originalMessage || message);

    // ✅ MODIFIED: Add message using openaiClient
    try {
      await openaiClient.addMessage(currentThreadId, messageContent, allFileIds);
      if (DEBUG) console.log('Message added to thread successfully');
    } catch (error) {
      console.error('Failed to add message:', error);
      throw new ApiError('Failed to add message to thread', 500, 'MESSAGE_ERROR');
    }

    // Configure and create run
    const runConfig: any = {
      tools: [{ type: "code_interpreter" }],
    };

    if (useJsonFormat) {
      runConfig.response_format = { type: "json_object" };
    }

    if (webSearchEnabled && (!allFileIds || allFileIds.length === 0)) {
      runConfig.tools.push({ type: "file_search" });
    }

    // ✅ MODIFIED: Create run using openaiClient
    let run;
    try {
      run = await openaiClient.createRun(currentThreadId, ASSISTANT_ID);
      if (DEBUG) console.log('Run created:', run.id);
    } catch (error) {
      console.error('Failed to create run:', error);
      throw new ApiError('Failed to create run', 500, 'RUN_ERROR');
    }

    // ✅ MODIFIED: Poll for completion using openaiClient's built-in method
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
      throw new ApiError('Assistant run timeout or failed', 408, 'RUN_TIMEOUT');
    }

    // Process response
    let reply = 'No response received.';
    let extractedResponse: any = { type: 'text', content: reply };

    if (completedRun.status === 'completed') {
      // ✅ MODIFIED: Get messages using openaiClient
      const messages = await openaiClient.getMessages(currentThreadId, 1);
      
      if (messages.data && messages.data.length > 0) {
        const assistantMessage = messages.data[0];
        extractedResponse = await extractTextFromMessage(assistantMessage);
        reply = extractedResponse.content || 'No response received.';
        
        // Handle any file outputs
        if (extractedResponse.files && storageClient) {
          for (const file of extractedResponse.files) {
            await uploadFileToStorage(file.fileId, file.description, currentThreadId);
          }
        }
      }
    } else if (completedRun.status === 'failed') {
      reply = webSearchEnabled 
        ? 'The assistant failed to process your request with web search. Please try again without web search.'
        : 'The assistant run failed. Please try again.';
      extractedResponse = { type: 'text', content: reply };
    } else if (completedRun.status === 'requires_action') {
      // Handle tool outputs if needed
      if (completedRun.required_action) {
        // Process required actions
        reply = 'Additional action required. Please try again.';
      }
    }

    // Update thread file tracking
    if (completedRun.status === 'completed' && currentThreadId && newFileIds.length > 0) {
      await updateThreadFileTracking(currentThreadId, newFileIds, allFileIds);
    }

    // Clean response content
    const cleanedReply = ContentCleaningService.cleanForDisplay(reply);

    return NextResponse.json({
      reply: cleanedReply,
      threadId: currentThreadId,
      searchSources: webSearchPerformed ? searchSources : undefined,
      messageId: run.id,
      status: completedRun.status,
      fileOutput: extractedResponse.files
    });

  } catch (error: any) {
    console.error('Chat API error:', error);
    
    // ✅ MODIFIED: Use consistent error response
    const errorResponse = createErrorResponse(error);
    const status = error instanceof ApiError ? error.status : 500;
    
    return NextResponse.json(errorResponse, { status });
  }
}

// Helper functions

function formatSearchEnhancedMessage(message: string, searchResults: any, useJsonFormat: boolean): string {
  let enhancedMessage = message;
  
  if (searchResults.answer) {
    enhancedMessage = `${message}\n\nWeb Search Context:\n${searchResults.answer}\n\n`;
  }
  
  enhancedMessage += 'Sources:\n';
  searchResults.results.forEach((result: any, index: number) => {
    enhancedMessage += `${index + 1}. ${result.title}: ${result.content.substring(0, 200)}...\n`;
  });
  
  if (useJsonFormat) {
    enhancedMessage += '\n\nPlease format your response as a valid JSON object.';
  }
  
  return enhancedMessage;
}

async function extractTextFromMessage(message: any): Promise<any> {
  try {
    const textContent = message.content
      .filter((item: any) => item.type === 'text')
      .map((item: any) => item.text?.value || '')
      .join('\n');
    
    const files = message.content
      .filter((item: any) => item.type === 'file')
      .map((item: any) => ({
        fileId: item.file?.file_id,
        description: item.file?.filename || 'Generated file'
      }));
    
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

// ✅ MODIFIED: Use storageClient for file uploads
async function uploadFileToStorage(fileId: string, description: string, threadId: string) {
  if (!storageClient) return null;
  
  try {
    // Get file content from OpenAI
    const fileContent = await openaiClient.getFileContent(fileId);
    const fileBuffer = Buffer.from(fileContent);
    const filename = `${description}-${Date.now()}.docx`;

    // Upload using storageClient
    const result = await storageClient.upload(
      fileBuffer,
      `threads/${threadId}/${filename}`,
      {
        contentType: 'application/octet-stream',
        metadata: { threadId, openaiFileId: fileId }
      }
    );

    // Save to database
    await supabase
      .from('blob_files')
      .insert({
        openai_file_id: fileId,
        vercel_blob_url: result.url,
        vercel_file_key: result.pathname,
        filename: filename,
        content_type: result.contentType,
        file_size: result.size,
        thread_id: threadId
      });

    return result;
  } catch (error) {
    console.error(`Error uploading file ${fileId}:`, error);
    return null;
  }
}

async function updateThreadFileTracking(threadId: string, newFileIds: string[], allFileIds: string[]) {
  try {
    for (const fileId of newFileIds) {
      try {
        // ✅ MODIFIED: Get file metadata using openaiClient
        const metadata = await openaiClient.getFile(fileId);
        
        await ThreadFileService.addFileToThread(
          threadId,
          fileId,
          metadata.filename || `file-${Date.now()}`,
          metadata.purpose || 'unknown',
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