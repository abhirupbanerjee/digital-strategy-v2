// app/api/chat/route.ts
import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import { ThreadFileService } from '../../../services/threadFileService';

// Bot v2 Services
import { FileProcessingService } from '@/services/fileProcessingService';
import { ContentCleaningService } from '@/services/contentCleaningService';
import { StorageService } from '@/services/storageService';

const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_ORGANIZATION = process.env.OPENAI_ORGANIZATION;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const DEBUG = process.env.NODE_ENV === 'development' && process.env.DEBUG_CHAT === 'true';

// Optimized helper using StorageService
async function uploadFileToVercelBlob(
  fileId: string, 
  description: string,
  threadId: string
): Promise<{
  blobUrl: string;
  fileKey: string;
  fileSize: number;
  contentType: string;
  actualFilename: string;
} | null> {
  try {
    if (DEBUG) {
      console.log(`Uploading file ${fileId} to Vercel Blob...`);
    }
    
    // Get file metadata from OpenAI
    const metadataResponse = await fetch(`https://api.openai.com/v1/files/${fileId}`, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Organization': OPENAI_ORGANIZATION || '',
      },
    });
    
    let actualFilename = description + '.docx';
    let contentType = 'application/octet-stream';
    
    if (metadataResponse.ok) {
      const metadata = await metadataResponse.json();
      if (metadata.filename) {
        actualFilename = metadata.filename.split('/').pop() || metadata.filename;
        const extension = actualFilename.toLowerCase().split('.').pop() || '';
        contentType = FileProcessingService.getFileExtension(extension);
        if (DEBUG) {
          console.log(`OpenAI metadata - Original: ${metadata.filename}, Extracted: ${actualFilename}`);
        }
      }
    }
    
    // Download file content from OpenAI
    const fileResponse = await fetch(`https://api.openai.com/v1/files/${fileId}/content`, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Organization': OPENAI_ORGANIZATION || '',
      },
    });
    
    if (!fileResponse.ok) {
      if (DEBUG) {
        console.error(`Failed to download file ${fileId} from OpenAI`);
      }
      return null;
    }
    
    const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
    
    // Use StorageService for upload
    const { url, key, size } = await StorageService.uploadToBlob(
      fileBuffer,
      actualFilename,
      { 
        contentType: contentType,
        threadId: threadId
      }
    );
    
    if (DEBUG) {
      console.log(`File ${fileId} uploaded to Vercel Blob: ${url}`);
    }

    return {
      blobUrl: url,
      fileKey: key,
      fileSize: size,
      contentType: contentType,
      actualFilename: actualFilename
    };
    
  } catch (error) {
    if (DEBUG) {
      console.error(`Error uploading file ${fileId} to Vercel Blob:`, error);
    }
    return null;
  }
}

// Enhanced extractTextFromOpenAI response with optimized file handling
async function extractTextFromOpenAIResponse(
  assistantMsg: any, 
  threadId: string
): Promise<{ type: string; content: string; files?: any[] }> {
  const files: any[] = [];
  const processedFileIds = new Set<string>();
  let textParts: string[] = [];

  try {
    if (!assistantMsg?.content) {
      return { type: 'text', content: 'No response received.' };
    }

    // Process attachments
    if (assistantMsg.attachments && Array.isArray(assistantMsg.attachments)) {
      for (const attachment of assistantMsg.attachments) {
        if (attachment.file_id && !processedFileIds.has(attachment.file_id)) {
          processedFileIds.add(attachment.file_id);
          
          const blobResult = await uploadFileToVercelBlob(
            attachment.file_id, 
            'Generated File',
            threadId
          );
          
          if (blobResult) {
            await FileProcessingService.createFileMapping(
              attachment.file_id,
              blobResult.blobUrl,
              blobResult.fileKey,
              {
                filename: blobResult.actualFilename,
                contentType: blobResult.contentType,
                fileSize: blobResult.fileSize,
                threadId: threadId
              }
            );
            
            files.push({
              type: 'file',
              file_id: attachment.file_id,
              description: 'Generated File',
              blob_url: blobResult.blobUrl
            });
          } else {
            files.push({
              type: 'file',
              file_id: attachment.file_id,
              description: 'Generated File'
            });
          }
        }
      }
    }

    if (Array.isArray(assistantMsg.content)) {
      for (const contentItem of assistantMsg.content) {
        if (contentItem.type === 'text') {
          let textContent = '';
          if (contentItem.text && typeof contentItem.text === 'object' && contentItem.text.value) {
            textContent = contentItem.text.value;
          } else if (typeof contentItem.text === 'string') {
            textContent = contentItem.text;
          }
          
          // Process file annotations
          if (contentItem.text && contentItem.text.annotations) {
            for (const annotation of contentItem.text.annotations) {
              if (annotation.type === 'file_path' && annotation.file_path?.file_id) {
                const fileId = annotation.file_path.file_id;
                
                if (processedFileIds.has(fileId)) {
                  const existingFile = files.find(f => f.file_id === fileId);
                  const sandboxUrl = annotation.text;
                  const actualDownloadUrl = existingFile?.blob_url || `/api/files/${fileId}`;
                  textContent = textContent.replace(sandboxUrl, actualDownloadUrl);
                  continue;
                }
                
                processedFileIds.add(fileId);
                
                const linkPattern = /\[([^\]]+)\]\([^)]+\)/;
                const linkMatch = textContent.substring(
                  Math.max(0, annotation.start_index - 100), 
                  Math.min(textContent.length, annotation.end_index + 20)
                ).match(linkPattern);
                const description = linkMatch ? linkMatch[1] : 'Generated File';
                
                const blobResult = await uploadFileToVercelBlob(
                  fileId, 
                  description,
                  threadId
                );
                
                if (blobResult) {
                  await FileProcessingService.createFileMapping(
                    fileId,
                    blobResult.blobUrl,
                    blobResult.fileKey,
                    {
                      filename: blobResult.actualFilename,
                      contentType: blobResult.contentType,
                      fileSize: blobResult.fileSize,
                      threadId: threadId
                    }
                  );
                  
                  files.push({
                    type: 'file',
                    file_id: fileId,
                    description: description,
                    blob_url: blobResult.blobUrl
                  });
                  
                  const sandboxUrl = annotation.text;
                  textContent = textContent.replace(sandboxUrl, blobResult.blobUrl);
                } else {
                  files.push({
                    type: 'file',
                    file_id: fileId,
                    description: description
                  });
                  
                  const sandboxUrl = annotation.text;
                  textContent = textContent.replace(sandboxUrl, `/api/files/${fileId}`);
                }
              }
            }
          }
          
          textParts.push(textContent);
        } else if (contentItem.type === 'image_file') {
          const imageFileId = contentItem.image_file?.file_id;
          if (imageFileId && !processedFileIds.has(imageFileId)) {
            processedFileIds.add(imageFileId);
            
            const blobResult = await uploadFileToVercelBlob(imageFileId, 'Generated Image', threadId);
            
            if (blobResult) {
              await FileProcessingService.createFileMapping(
                imageFileId,
                blobResult.blobUrl,
                blobResult.fileKey,
                {
                  filename: blobResult.actualFilename,
                  contentType: blobResult.contentType,
                  fileSize: blobResult.fileSize,
                  threadId: threadId
                }
              );
              
              files.push({
                type: 'image',
                file_id: imageFileId,
                description: 'Generated Image',
                blob_url: blobResult.blobUrl
              });
            } else {
              files.push({
                type: 'image',
                file_id: imageFileId,
                description: 'Generated Image'
              });
            }
          }
        } else if (contentItem.type === 'image_url') {
          files.push({
            type: 'image_url',
            url: contentItem.image_url?.url,
            description: 'Generated Image'
          });
        }
      }
      
      return {
        type: files.length > 0 ? 'mixed' : 'text',
        content: textParts.length > 0 ? textParts.join('\n\n') : 'Response generated',
        files: files.length > 0 ? files : undefined
      };
    }
    
    if (typeof assistantMsg.content === 'string') {
      return { type: 'text', content: assistantMsg.content };
    }
    
    return { type: 'text', content: 'Response received but could not be processed properly.' };
    
  } catch (error) {
    console.error('Error extracting text from assistant response:', error);
    return { type: 'text', content: 'Error processing assistant response.' };
  }
}

// Helper function to parse JSON response
function parseAssistantJsonResponse(responseText: string): any {
  try {
    return JSON.parse(responseText);
  } catch (error) {
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch (e) {
        console.error('Failed to parse JSON from code block:', e);
      }
    }
    
    const jsonStart = responseText.indexOf('{');
    const jsonEnd = responseText.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      try {
        return JSON.parse(responseText.substring(jsonStart, jsonEnd + 1));
      } catch (e) {
        console.error('Failed to parse extracted JSON:', e);
      }
    }
    
    return {
      content: responseText,
      type: "text",
      metadata: {
        parsing_failed: true,
        original_content: responseText
      }
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    const { message, originalMessage, threadId, webSearchEnabled, fileIds, shareToken, useJsonFormat } = await request.json();

    // Validate share token if provided
    if (shareToken) {
      const { data: share } = await supabase
        .from('thread_shares')
        .select('permissions, expires_at, thread_id')
        .eq('share_token', shareToken)
        .single();
        
      if (!share || new Date(share.expires_at) < new Date()) {
        return NextResponse.json({ error: 'Invalid or expired share' }, { status: 403 });
      }
      
      if (share.permissions !== 'collaborate') {
        return NextResponse.json({ error: 'Read-only access' }, { status: 403 });
      }
    }

    // Environment check
    if (DEBUG) {
      console.log('Environment check:', {
        hasAssistantId: !!ASSISTANT_ID,
        hasApiKey: !!OPENAI_API_KEY,
        hasOrganization: !!OPENAI_ORGANIZATION
      });
    }
    
    if (!ASSISTANT_ID || !OPENAI_API_KEY) {
      console.error('Missing OpenAI configuration');
      return NextResponse.json(
        { error: 'Missing OpenAI configuration' },
        { status: 500 }
      );
    }

    if (!message || message.trim() === '') {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
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

    // Create thread if needed
    if (!currentThreadId) {
      if (DEBUG) {
        console.log('Creating new thread...');
      }
      try {
        const threadRes = await axios.post(
          'https://api.openai.com/v1/threads',
          {},
          { headers }
        );
        currentThreadId = threadRes.data.id;
        if (DEBUG) {
          console.log('Thread created:', currentThreadId);
        }
      } catch (error: any) {
        console.error('Thread creation failed:', error.response?.data || error.message);
        return NextResponse.json(
          { error: 'Failed to create thread' },
          { status: 500 }
        );
      }
    }

    // Get existing thread files for persistence
    let existingThreadFiles: string[] = [];
    
    if (currentThreadId) {
      try {
        const activeFiles = await ThreadFileService.getActiveThreadFiles(currentThreadId);
        existingThreadFiles = activeFiles.map(file => file.openai_file_id);
        
        if (DEBUG && existingThreadFiles.length > 0) {
          console.log(`Found ${existingThreadFiles.length} existing thread files:`, existingThreadFiles);
        }
      } catch (error) {
        console.error('Error retrieving thread files:', error);
      }
    }

    // Web search enhancement
    let enhancedMessage = message;
    let searchSources: any[] = [];
    let webSearchPerformed = false;
    
    if (webSearchEnabled && TAVILY_API_KEY) {
      try {
        if (DEBUG) {
          console.log('Performing Tavily search for:', originalMessage || message);
        }
        
        const searchResponse = await axios.post(
          'https://api.tavily.com/search',
          {
            api_key: TAVILY_API_KEY,
            query: originalMessage || message,
            search_depth: 'basic',
            include_answer: true,
            max_results: 5,
          },
          {
            headers: {
              'Content-Type': 'application/json',
            }
          }
        );
        
        if (searchResponse.data) {
          const data = searchResponse.data;
          webSearchPerformed = true;
          
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
          
          if (useJsonFormat) {
            enhancedMessage += 'IMPORTANT: Please provide a natural response incorporating relevant information. Format as JSON:\n\n{\n  "content": "Your response",\n  "sources": ["source1", "source2"],\n  "type": "response_with_search"\n}\n\nDO NOT include any text outside this JSON structure.';
          } else {
            enhancedMessage += 'IMPORTANT: Please provide a natural response incorporating relevant information from the search results above.';
          }
          
          if (DEBUG) {
            console.log('Web search enhanced message created');
          }
        }
      } catch (searchError: any) {
        console.error('Tavily search failed:', searchError.response?.data || searchError.message);
        enhancedMessage = `${message}\n\n[Note: Web search was requested but encountered an error. Responding based on available knowledge.]`;
        
        if (useJsonFormat) {
          enhancedMessage += '\n\nPlease format your response as a valid JSON object.';
        }
      }
    } else if (useJsonFormat) {
      enhancedMessage = `${message}\n\nPlease format your response as a valid JSON object.`;
    }
    
    // Prepare message for thread
    interface MessageForThread {
      role: string;
      content: any;
      attachments?: Array<{
        file_id: string;
        tools: Array<{ type: string }>;
      }>;
    }

    const messageContent = webSearchPerformed || useJsonFormat ? enhancedMessage : (originalMessage || message);

    const messageForThread: MessageForThread = {
      role: 'user',
      content: messageContent
    };

    // Combine new uploads with existing thread files
    const newFileIds = fileIds || [];
    const allFileIds = [...new Set([...newFileIds, ...existingThreadFiles])];
    
    if (DEBUG) {
      console.log(`File attachment summary:
        - New uploads: ${newFileIds.length} files
        - Existing thread files: ${existingThreadFiles.length} files
        - Total files to attach: ${allFileIds.length} files`);
    }

    // Attach files with appropriate tools using FileProcessingService
    if (allFileIds.length > 0) {
      messageForThread.attachments = allFileIds.map((fileId: string) => {
        // Default to code_interpreter for maximum compatibility
        const tools = ['code_interpreter'];
        return {
          file_id: fileId,
          tools: tools.map(tool => ({ type: tool }))
        };
      });
      
      if (DEBUG) {
        console.log('Total files attached to message:', allFileIds);
      }
    }

    // Add message to thread
    if (DEBUG) {
      console.log('Adding message to thread with files and enhanced content...');
    }
    try {
      await axios.post(
        `https://api.openai.com/v1/threads/${currentThreadId}/messages`,
        messageForThread,
        { headers }
      );
      if (DEBUG) {
        console.log('Message added to thread successfully');
      }
    } catch (error: any) {
      console.error('Failed to add message:', error.response?.data || error.message);
      
      const errorData = error.response?.data?.error || {};
      let errorMessage = 'Failed to add message to thread';
      
      if (errorData.code === 'unsupported_file') {
        errorMessage = `File type error: ${errorData.message}`;
      } else if (errorData.message) {
        errorMessage = errorData.message;
      }
      
      return NextResponse.json(
        { error: errorMessage },
        { status: error.response?.status || 500 }
      );
    }

    // Configure run
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
      if (DEBUG) {
        console.log('file_search tool enabled for web search');
      }
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

    // Create run
    if (DEBUG) {
      console.log('Creating run with config:', { ...runConfig, tools });
    }
    
    let runId;
    const runCreatedAt = Date.now();
    
    try {
      const runRes = await axios.post(
        `https://api.openai.com/v1/threads/${currentThreadId}/runs`,
        runConfig,
        { headers }
      );
      runId = runRes.data.id;
      if (DEBUG) {
        console.log(`Run created at ${runCreatedAt}: ${runId}`);
      }
    } catch (error: any) {
      console.error('Run creation failed:', error.response?.data || error.message);
      return NextResponse.json(
        { error: 'Failed to create run' },
        { status: 500 }
      );
    }

    // Poll for completion
    let status = 'in_progress';
    let retries = 0;
    const maxRetries = 300;

    while ((status === 'in_progress' || status === 'queued') && retries < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      try {
        const statusRes = await axios.get(
          `https://api.openai.com/v1/threads/${currentThreadId}/runs/${runId}`,
          { headers }
        );
        
        status = statusRes.data.status;
        if (DEBUG && retries % 10 === 0) {
          console.log(`Run status: ${status} (attempt ${retries + 1})`);
        }
        
        if (status === 'requires_action') {
          const requiredAction = statusRes.data.required_action;
          if (DEBUG) {
            console.log('Tool outputs required:', requiredAction?.type);
          }
        }
        
        if (status === 'failed' || status === 'completed') {
          break;
        }
      } catch (error: any) {
        if (DEBUG) {
          console.error('Status check failed:', error.response?.data || error.message);
        }
        break;
      }
      
      retries++;
    }

    let reply = 'No response received.';
    let parsedResponse = null;
    let extractedResponse;

    if (status === 'completed') {
      if (DEBUG) {
        console.log('Run completed, fetching messages...');
      }
      try {
        const messagesRes = await axios.get(
          `https://api.openai.com/v1/threads/${currentThreadId}/messages`,
          { headers }
        );

        const recentMessages = messagesRes.data.data.filter((m: any) => 
          m.role === 'assistant' && 
          (m.created_at * 1000) >= (runCreatedAt - 2000)
        );

        const assistantMsg = recentMessages[0] || messagesRes.data.data.find((m: any) => m.role === 'assistant');
        
        if (assistantMsg?.content) {
          extractedResponse = await extractTextFromOpenAIResponse(assistantMsg, currentThreadId);
          
          if (Array.isArray(assistantMsg.content)) {
            const allTextParts = assistantMsg.content
              .filter((item: any) => item.type === 'text')
              .map((item: any) => item.text?.value || '')
              .filter((text: string) => text.length > 0);
            
            const combinedText = allTextParts.join('\n\n');
            
            if (DEBUG) {
              console.log(`Extracted ${allTextParts.length} text parts, total length: ${combinedText.length} characters`);
            }
            
            reply = combinedText.length > extractedResponse.content.length ? combinedText : extractedResponse.content;
          } else {
            reply = extractedResponse.content;
          }
          
          // Clean up using ContentCleaningService
          reply = ContentCleaningService.safeCleanWithPlaceholders(reply);
          
          if (useJsonFormat) {
            parsedResponse = parseAssistantJsonResponse(reply);
            if (DEBUG) {
              console.log('Parsed JSON response:', parsedResponse);
            }
          }
        } else {
          extractedResponse = { type: 'text', content: reply };
        }
        
        if (DEBUG) {
          console.log(`Thread ${currentThreadId} message analysis complete`);
        }
      } catch (error: any) {
        console.error('Failed to fetch messages:', error.response?.data || error.message);
        reply = 'Failed to fetch response.';
        extractedResponse = { type: 'text', content: reply };
      }
    } else if (status === 'failed') {
      reply = 'The assistant run failed. Please try again.';
      extractedResponse = { type: 'text', content: reply };
    } else if (retries >= maxRetries) {
      reply = 'The assistant is taking too long to respond. Please try again.';
      extractedResponse = { type: 'text', content: reply };
    }

    // Update thread file tracking
    if (status === 'completed' && currentThreadId) {
      try {
        if (newFileIds.length > 0) {
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
              
              await ThreadFileService.addFileToThread(
                currentThreadId,
                fileId,
                filename,
                fileType,
                fileSize
              );
              
            } catch (fileError) {
              console.error(`Error processing file ${fileId}:`, fileError);
              await ThreadFileService.addFileToThread(
                currentThreadId,
                fileId,
                `file-${Date.now()}`,
                'unknown',
                0
              );
            }
          }
          
          if (DEBUG) {
            console.log(`Added ${newFileIds.length} new files to thread context`);
          }
        }
        
        if (allFileIds.length > 0) {
          await ThreadFileService.updateFileUsage(currentThreadId, allFileIds);
          
          if (DEBUG) {
            console.log(`Updated usage statistics for ${allFileIds.length} thread files`);
          }
        }
        
      } catch (error) {
        console.error('Error updating thread file context:', error);
      }
    }

    // Build response
    const responseObj: any = {
      reply,
      files: extractedResponse?.files,
      threadId: currentThreadId,
      status: 'success',
      webSearchPerformed,
      useJsonFormat: !!useJsonFormat
    };

    if (useJsonFormat && parsedResponse) {
      responseObj.parsedResponse = parsedResponse;
    }

    if (webSearchEnabled && searchSources.length > 0) {
      if (!useJsonFormat || parsedResponse?.parsing_failed) {
        reply += '\n\n---\n**Sources:**\n';
        searchSources.forEach((source, index) => {
          reply += `${index + 1}. [${source.title}](${source.url})`;
          if (source.score) {
            reply += ` (${(source.score * 100).toFixed(0)}% relevance)`;
          }
          reply += '\n';
        });
        responseObj.reply = reply;
      }
      responseObj.searchSources = searchSources;
    }

    return NextResponse.json(responseObj);

  } catch (error: any) {
    if (DEBUG) {
      console.error('API Error:', error.response?.data || error.message);
    }
    
    let errorMessage = 'Unable to reach assistant.';
    
    if (error.response?.data?.error?.message) {
      errorMessage = error.response.data.error.message;
    } else if (error.response?.status === 401) {
      errorMessage = 'Invalid API key.';
    } else if (error.response?.status === 404) {
      errorMessage = 'Assistant not found.';
    } else if (error.message) {
      errorMessage = error.message;
    }

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}