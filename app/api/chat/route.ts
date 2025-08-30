// app/api/chat/route.ts - CORRECTED VERSION 
// Hybrid approach: Use services for optimization while maintaining OpenAI Assistant API compatibility
import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import { ThreadFileService } from '../../../services/threadFileService';

// ✅ NEW SERVICES - Use for specific optimizations only
import { FileProcessingService } from '@/services/fileProcessingService';
import { ContentCleaningService } from '@/services/contentCleaningService';
import { StorageService } from '@/services/storageService';

const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_ORGANIZATION = process.env.OPENAI_ORGANIZATION;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

// Environment variables for polling configuration
const POLLING_INTERVAL_MS = parseInt(process.env.OPENAI_POLLING_INTERVAL_MS || '1000');
const POLLING_MAX_RETRIES = parseInt(process.env.OPENAI_POLLING_MAX_RETRIES || '600'); // ✅ INCREASED for web search
const POLLING_LOG_FREQUENCY = parseInt(process.env.OPENAI_POLLING_LOG_FREQUENCY || '15');
const POLLING_TIMEOUT_MESSAGE = process.env.OPENAI_TIMEOUT_MESSAGE || 'The assistant is taking too long to respond. Please try again.';

// ✅ WEB SEARCH TIMEOUT HANDLING
const WEB_SEARCH_MAX_RETRIES = parseInt(process.env.OPENAI_WEB_SEARCH_MAX_RETRIES || '900'); // 15 minutes for web search
const WEB_SEARCH_POLL_INTERVAL = parseInt(process.env.OPENAI_WEB_SEARCH_POLL_INTERVAL || '2000'); // 2 seconds for web search

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const DEBUG = process.env.NODE_ENV === 'development' && process.env.DEBUG_CHAT === 'true';

export async function POST(request: NextRequest) {
  try {
    const { message, threadId, fileIds, webSearchEnabled, useJsonFormat, originalMessage } = await request.json();

    // Basic validation
    if (!ASSISTANT_ID || !OPENAI_API_KEY) {
      console.error('Missing OpenAI configuration');
      return NextResponse.json({ error: 'Missing OpenAI configuration' }, { status: 500 });
    }

    if (!message || message.trim() === '') {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'assistants=v2',
    };

    if (OPENAI_ORGANIZATION) {
      headers['OpenAI-Organization'] = OPENAI_ORGANIZATION;
    }

    let currentThreadId = threadId;

    // Create thread if needed - Keep original approach
    if (!currentThreadId) {
      if (DEBUG) console.log('Creating new thread...');
      try {
        const threadRes = await axios.post('https://api.openai.com/v1/threads', {}, { headers });
        currentThreadId = threadRes.data.id;
        if (DEBUG) console.log('Thread created:', currentThreadId);
      } catch (error: any) {
        console.error('Thread creation failed:', error.response?.data || error.message);
        return NextResponse.json({ error: 'Failed to create thread' }, { status: 500 });
      }
    }

    // ✅ OPTIMIZED: Get existing thread files using centralized service
    let existingThreadFiles: string[] = [];
    if (currentThreadId) {
      try {
        const activeFiles = await ThreadFileService.getActiveThreadFiles(currentThreadId);
        existingThreadFiles = activeFiles.map(file => file.openai_file_id);
        if (DEBUG && existingThreadFiles.length > 0) {
          console.log(`Found ${existingThreadFiles.length} existing thread files`);
        }
      } catch (error) {
        console.error('Error retrieving thread files:', error);
      }
    }

    // ✅ OPTIMIZED: Prepare file IDs for processing
    const newFileIds = fileIds || [];
    const allFileIds = [...new Set([...newFileIds, ...existingThreadFiles])];
    
    if (DEBUG) {
      console.log(`File attachment summary:
        - New uploads: ${newFileIds.length} files
        - Existing thread files: ${existingThreadFiles.length} files
        - Total files to attach: ${allFileIds.length} files`);
    }

    // ✅ RESTORED V1 WEB SEARCH - Use original working format and instructions
    let enhancedMessage = message;
    let searchSources: any[] = [];
    let webSearchPerformed = false;

    if (webSearchEnabled && TAVILY_API_KEY) {
      try {
        if (DEBUG) {
          console.log('🌐 Performing Tavily search for:', originalMessage || message);
        }
        
        const searchResponse = await axios.post('https://api.tavily.com/search', {
          api_key: TAVILY_API_KEY,
          query: originalMessage || message,
          search_depth: 'basic',
          include_answer: true,
          max_results: 5,
        }, {
          headers: { 'Content-Type': 'application/json' }
        });
        
        if (searchResponse.data) {
          const data = searchResponse.data;
          webSearchPerformed = true;
          
          // ✅ RESTORED V1 FORMAT - Critical for proper AI instruction following
          enhancedMessage = `${message}\n\n[INTERNAL SEARCH CONTEXT - DO NOT INCLUDE IN RESPONSE]:\n`;
          
          if (data.answer) {
            enhancedMessage += `\nWeb Summary: ${data.answer}\n`;
          }
          
          if (data.results && data.results.length > 0) {
            enhancedMessage += '\nCurrent Web Information:\n';
            data.results.forEach((result: any, idx: number) => {
              enhancedMessage += `${idx + 1}. ${result.title}\n`;
              enhancedMessage += `   ${result.content.substring(0, 200)}...\n`;
              enhancedMessage += `   Source: ${result.url}\n\n`;
              
              searchSources.push({
                title: result.title,
                url: result.url,
                score: result.score
              });
            });
          }
          
          enhancedMessage += '\n[END SEARCH CONTEXT]\n\n';
          
          // ✅ RESTORED V1 INSTRUCTIONS - Exact format that worked
          if (useJsonFormat) {
            enhancedMessage += 'IMPORTANT: Please provide a natural response incorporating relevant information. Format as JSON:\n\n{\n  "content": "Your response",\n  "sources": ["source1", "source2"],\n  "type": "response_with_search"\n}\n\nDO NOT include any text outside this JSON structure.';
          } else {
            enhancedMessage += 'IMPORTANT: Please provide a natural response incorporating relevant information from the search results above.';
          }
          
          if (DEBUG) {
            console.log('🌐 Web search enhanced message created with V1 format');
          }
        }
      } catch (searchError: any) {
        console.error('❌ Tavily search failed:', searchError.response?.data || searchError.message);
        enhancedMessage = `${message}\n\n[Note: Web search was requested but encountered an error. Responding based on available knowledge.]`;
        
        if (useJsonFormat) {
          enhancedMessage += '\n\nPlease format your response as a valid JSON object.';
        }
      }
    } else if (useJsonFormat) {
      enhancedMessage = `${message}\n\nPlease format your response as a valid JSON object.`;
    }

    // Prepare message for thread - Keep original OpenAI format
    const messageContent = webSearchPerformed || useJsonFormat ? enhancedMessage : (originalMessage || message);
    const messageForThread: any = {
      role: 'user',
      content: messageContent
    };

    // Attach files with appropriate tools - Keep original logic
    if (allFileIds.length > 0) {
      messageForThread.attachments = allFileIds.map((fileId: string) => ({
        file_id: fileId,
        tools: [{ type: 'code_interpreter' }]
      }));
      
      if (DEBUG) console.log('Total files attached to message:', allFileIds);
    }

    // Add message to thread - Keep original approach
    try {
      await axios.post(`https://api.openai.com/v1/threads/${currentThreadId}/messages`, messageForThread, { headers });
      if (DEBUG) console.log('Message added to thread successfully');
    } catch (error: any) {
      console.error('Failed to add message:', error.response?.data || error.message);
      return NextResponse.json({ error: 'Failed to add message to thread' }, { status: 500 });
    }

    // Configure run - Keep original approach
    const runConfig: any = {
      assistant_id: ASSISTANT_ID,
    };

    if (useJsonFormat) {
      runConfig.response_format = { type: "json_object" };
    }

    // Configure tools
    const tools = [];
    tools.push({ type: "code_interpreter" });

    if (webSearchEnabled && (!allFileIds || allFileIds.length === 0)) {
      tools.push({ type: "file_search" });
      if (DEBUG) console.log('file_search tool enabled for web search');
    }

    runConfig.tools = tools;

    // Enhanced instructions
    if (allFileIds && allFileIds.length > 0) {
      let instructions = "You have access to uploaded files. Please analyze the file content carefully and provide specific, detailed responses.";
      
      if (webSearchEnabled && searchSources.length > 0) {
        instructions += " You also have access to current web search results.";
      }
      
      if (existingThreadFiles.length > 0) {
        instructions += ` Note: ${existingThreadFiles.length} files from previous messages are available.`;
      }
      
      runConfig.additional_instructions = instructions;
    } else if (webSearchEnabled && searchSources.length > 0) {
      runConfig.additional_instructions = "You have access to current web search results. Use this information to provide accurate responses.";
    }

    // Create run - Keep original approach
    if (DEBUG) console.log('Creating run with config:', { ...runConfig, tools });
    
    let runId;
    const runCreatedAt = Date.now();
    
    try {
      const runRes = await axios.post(`https://api.openai.com/v1/threads/${currentThreadId}/runs`, runConfig, { headers });
      runId = runRes.data.id;
      if (DEBUG) console.log(`Run created at ${runCreatedAt}: ${runId}`);
    } catch (error: any) {
      console.error('Run creation failed:', error.response?.data || error.message);
      return NextResponse.json({ error: 'Failed to create run' }, { status: 500 });
    }

    // Poll for completion - ✅ ADAPTIVE POLLING based on web search
    let status = 'in_progress';
    let retries = 0;
    
    // ✅ Use different timeouts based on request complexity
    const maxRetries = webSearchEnabled ? WEB_SEARCH_MAX_RETRIES : POLLING_MAX_RETRIES;
    const pollInterval = webSearchEnabled ? WEB_SEARCH_POLL_INTERVAL : POLLING_INTERVAL_MS;
    const logFrequency = webSearchEnabled ? Math.floor(POLLING_LOG_FREQUENCY * 1.5) : POLLING_LOG_FREQUENCY;

    if (DEBUG) {
      const timeoutMinutes = ((maxRetries * pollInterval) / 60000).toFixed(1);
      console.log(`🔄 Starting ${webSearchEnabled ? 'WEB SEARCH' : 'STANDARD'} polling: ${pollInterval}ms interval, ${maxRetries} max retries (${timeoutMinutes} min timeout)`);
    }

    while ((status === 'in_progress' || status === 'queued') && retries < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
      try {
        const statusRes = await axios.get(`https://api.openai.com/v1/threads/${currentThreadId}/runs/${runId}`, { headers });
        
        status = statusRes.data.status;
        
        // ✅ ADAPTIVE logging frequency
        if (DEBUG && retries % logFrequency === 0) {
          const elapsedTime = ((retries * pollInterval) / 1000).toFixed(1);
          const searchIndicator = webSearchEnabled ? '🌐' : '💬';
          console.log(`🔄 ${searchIndicator} Run status: ${status} (attempt ${retries + 1}/${maxRetries}, ${elapsedTime}s elapsed)`);
        }
        
        if (status === 'failed' || status === 'completed') {
          break;
        }
      } catch (error: any) {
        if (DEBUG) {
          console.error('❌ Status check failed:', error.response?.data || error.message);
        }
        break;
      }
      
      retries++;
    }

    // Process response - ✅ IMPROVED error messages with web search context
    let reply = 'No response received.';
    let extractedResponse: any = { type: 'text', content: reply };

    if (status === 'completed') {
      const totalTime = ((retries * pollInterval) / 1000).toFixed(1);
      if (DEBUG) {
        const searchIndicator = webSearchEnabled ? '🌐' : '💬';
        console.log(`✅ ${searchIndicator} Run completed successfully after ${totalTime}s (${retries + 1} attempts)`);
      }
      
      extractedResponse = await extractTextFromOpenAIResponse(currentThreadId, headers, runCreatedAt);
      reply = extractedResponse.content || 'No response received.';
    } else if (status === 'failed') {
      const totalTime = ((retries * pollInterval) / 1000).toFixed(1);
      console.error(`❌ Run failed after ${totalTime}s`);
      reply = webSearchEnabled 
        ? 'The assistant failed to process your request with web search. Please try again without web search.'
        : 'The assistant run failed. Please try again.';
      extractedResponse = { type: 'text', content: reply };
    } else if (retries >= maxRetries) {
      const totalTime = ((retries * pollInterval) / 1000).toFixed(1);
      console.error(`⏰ Run timeout after ${totalTime}s (${retries} attempts)${webSearchEnabled ? ' [WEB SEARCH]' : ''}`);
      reply = webSearchEnabled 
        ? `The assistant is taking longer than expected to process your request with web search (${Math.floor(parseFloat(totalTime)/60)} minutes). The response may still be processing. Please refresh the page in a moment or try again without web search.`
        : POLLING_TIMEOUT_MESSAGE;
      extractedResponse = { type: 'text', content: reply };
    }

    // ✅ OPTIMIZED: Update thread file tracking using centralized service
    if (status === 'completed' && currentThreadId && newFileIds.length > 0) {
      await updateThreadFileTracking(currentThreadId, newFileIds, allFileIds);
    }

    // ✅ OPTIMIZED: Clean response content using ContentCleaningService (SINGLE CALL)
    const cleanedReply = webSearchEnabled 
      ? ContentCleaningService.safeCleanWithPlaceholders(reply)
      : reply; // Skip cleaning for non-web search responses

    if (DEBUG && webSearchEnabled && cleanedReply !== reply) {
      console.log(`🧹 Content cleaning: ${reply.length} → ${cleanedReply.length} chars (removed ${reply.length - cleanedReply.length})`);
    }

    // Build response
    const responseObj = {
      reply: cleanedReply,
      files: extractedResponse?.files,
      threadId: currentThreadId,
      status: 'success',
      webSearchPerformed,
      useJsonFormat: !webSearchPerformed && useJsonFormat,
      searchSources: webSearchPerformed ? searchSources : undefined
    };

    if (DEBUG) {
      console.log('✅ Chat response completed successfully');
    }

    return NextResponse.json(responseObj);

  } catch (error: any) {
    console.error('Chat API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ✅ HELPER FUNCTIONS - Keep original working implementations

async function performWebSearch(query: string) {
  try {
    const response = await axios.post('https://api.tavily.com/search', {
      api_key: TAVILY_API_KEY,
      query: query,
      search_depth: "basic",
      include_answer: true,
      max_results: 5
    });

    const searchResults = response.data.results || [];
    if (searchResults.length === 0) return null;

    const enhancedMessage = `${query}\n\n[Current Web Information]:\n${searchResults.map((result: any) => 
      `- ${result.title}: ${(result.content || '').substring(0, 200)}...`
    ).join('\n')}`;

    return {
      enhancedMessage,
      sources: searchResults.map((result: any) => ({ 
        title: result.title || 'Untitled', 
        url: result.url || '' 
      }))
    };
  } catch (error) {
    console.error('Web search failed:', error);
    return null;
  }
}

async function extractTextFromOpenAIResponse(threadId: string, headers: any, runCreatedAt: number) {
  const files: any[] = [];
  const processedFileIds = new Set<string>();
  let textParts: string[] = [];

  try {
    if (DEBUG) {
      console.log(`🔍 Extracting response from thread ${threadId} after timestamp ${runCreatedAt}`);
    }

    // Get messages from the thread
    const messagesRes = await axios.get(`https://api.openai.com/v1/threads/${threadId}/messages?order=desc&limit=20`, { headers });
    const messages = messagesRes.data.data || [];

    if (DEBUG) {
      console.log(`📨 Retrieved ${messages.length} messages from thread`);
    }

    // Filter to messages after run creation (convert to milliseconds)
    const recentMessages = messages.filter((msg: any) => (msg.created_at * 1000) > runCreatedAt);
    const assistantMessages = recentMessages.filter((msg: any) => msg.role === 'assistant');

    if (DEBUG) {
      console.log(`🤖 Found ${assistantMessages.length} assistant messages after run creation`);
    }

    if (assistantMessages.length === 0) {
      console.warn('⚠️ No assistant messages found after run creation');
      return {
        type: 'text',
        content: 'No assistant response found in thread messages.',
        files: undefined
      };
    }

    // Process assistant messages (most recent first)
    for (const assistantMsg of assistantMessages) {
      if (!assistantMsg?.content) continue;

      if (DEBUG) {
        console.log(`📝 Processing assistant message with ${assistantMsg.content.length} content items`);
      }

      for (const contentItem of assistantMsg.content) {
        if (contentItem.type === 'text') {
          let textContent = contentItem.text?.value || '';
          
          if (DEBUG && textContent) {
            console.log(`📄 Found text content: ${textContent.substring(0, 100)}...`);
          }
          
          // Process file annotations
          if (contentItem.text?.annotations) {
            if (DEBUG) {
              console.log(`📎 Processing ${contentItem.text.annotations.length} annotations`);
            }

            for (const annotation of contentItem.text.annotations) {
              if (annotation.type === 'file_path' && annotation.file_path?.file_id) {
                const fileId = annotation.file_path.file_id;
                if (!processedFileIds.has(fileId)) {
                  processedFileIds.add(fileId);
                  
                  const linkMatch = annotation.text?.match(/\[([^\]]+)\]/);
                  const description = linkMatch ? linkMatch[1] : 'Generated File';
                  
                  // ✅ OPTIMIZED: Use StorageService for file upload
                  const blobResult = await uploadFileToStorage(fileId, description, threadId);
                  
                  if (blobResult) {
                    await FileProcessingService.createFileMapping(fileId, blobResult.blobUrl, blobResult.fileKey, {
                      filename: blobResult.actualFilename,
                      contentType: blobResult.contentType,
                      fileSize: blobResult.fileSize,
                      threadId
                    });
                    
                    files.push({
                      type: 'file',
                      file_id: fileId,
                      description,
                      blob_url: blobResult.blobUrl
                    });
                    
                    textContent = textContent.replace(annotation.text, blobResult.blobUrl);
                  } else {
                    textContent = textContent.replace(annotation.text, `/api/files/${fileId}`);
                  }
                }
              }
            }
          }
          
          if (textContent.trim()) {
            textParts.push(textContent);
          }
        }
      }
    }

    const finalContent = textParts.join('\n').trim();
    
    if (DEBUG) {
      console.log(`✅ Final extracted content length: ${finalContent.length}`);
      if (finalContent.length < 50) {
        console.log(`🔍 Short content detected: "${finalContent}"`);
      }
    }

    return {
      type: 'text',
      content: finalContent || 'No response content found.',
      files: files.length > 0 ? files : undefined
    };

  } catch (error) {
    console.error('❌ Error extracting text from assistant response:', error);
    return { 
      type: 'text', 
      content: 'Error processing assistant response.',
      files: undefined 
    };
  }
}

// ✅ OPTIMIZED: Use StorageService for file uploads
async function uploadFileToStorage(fileId: string, description: string, threadId: string) {
  try {
    // Download file from OpenAI
    const fileResponse = await fetch(`https://api.openai.com/v1/files/${fileId}/content`, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Organization': OPENAI_ORGANIZATION || '',
      },
    });

    if (!fileResponse.ok) return null;

    const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
    const filename = `${description}-${Date.now()}.docx`;

    // ✅ Use StorageService instead of manual Vercel Blob operations
    const result = await StorageService.uploadToBlob(fileBuffer, filename, {
      contentType: 'application/octet-stream',
      threadId
    });

    return {
      blobUrl: result.url,
      fileKey: result.key,
      fileSize: result.size,
      contentType: 'application/octet-stream',
      actualFilename: filename
    };

  } catch (error) {
    console.error(`Error uploading file ${fileId}:`, error);
    return null;
  }
}

async function updateThreadFileTracking(threadId: string, newFileIds: string[], allFileIds: string[]) {
  try {
    // Add new files to thread tracking
    for (const fileId of newFileIds) {
      try {
        const fileMetadataResponse = await fetch(`https://api.openai.com/v1/files/${fileId}`, {
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'OpenAI-Organization': OPENAI_ORGANIZATION || '',
          },
        });
        
        let filename = `uploaded-${Date.now()}`;
        let fileSize = 0;
        let fileType = 'unknown';
        
        if (fileMetadataResponse.ok) {
          const metadata = await fileMetadataResponse.json();
          filename = metadata.filename || filename;
          fileSize = metadata.bytes || 0;
          const extension = filename.toLowerCase().split('.').pop();
          fileType = extension || 'unknown';
        }
        
        await ThreadFileService.addFileToThread(threadId, fileId, filename, fileType, fileSize);
        
      } catch (fileError) {
        console.error(`Error processing file ${fileId}:`, fileError);
        await ThreadFileService.addFileToThread(threadId, fileId, `file-${Date.now()}`, 'unknown', 0);
      }
    }
    
    // Update usage statistics
    if (allFileIds.length > 0) {
      await ThreadFileService.updateFileUsage(threadId, allFileIds);
    }
    
    if (DEBUG) {
      console.log(`Updated file tracking for thread ${threadId}`);
    }
  } catch (error) {
    console.error('Error updating thread file tracking:', error);
  }
}