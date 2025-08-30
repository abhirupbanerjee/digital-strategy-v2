// app/api/search/route.ts - MODIFIED VERSION
import { NextRequest, NextResponse } from 'next/server';
import { openaiClient, tavilyClient } from '@/lib/clients';
import { ApiError, createErrorResponse } from '@/lib/utils/apiErrors';

export const runtime = 'nodejs';

// ✅ REMOVED: Direct axios import and Tavily API key
// ✅ ADDED: Import from lib/clients

export async function POST(request: NextRequest) {
  try {
    const { query, threadId, useSearch } = await request.json();

    if (!query) {
      throw new ApiError('Query is required', 400, 'MISSING_QUERY');
    }

    if (!process.env.OPENAI_ASSISTANT_ID || !process.env.OPENAI_API_KEY) {
      throw new ApiError('Missing OpenAI configuration', 500, 'CONFIG_ERROR');
    }

    let searchResults = '';
    let searchSources: any[] = [];

    // ✅ MODIFIED: Use tavilyClient instead of direct API call
    if (useSearch && tavilyClient) {
      try {
        console.log('Performing Tavily search for:', query);
        
        const searchResponse = await tavilyClient.search({
          query: query,
          maxResults: 5,
          searchDepth: 'basic',
          includeAnswer: true,
          includeImages: false,
        });

        // Format Tavily search results
        if (searchResponse) {
          // Include AI-generated answer if available
          if (searchResponse.answer) {
            searchResults = `\n\nWeb Search Summary: ${searchResponse.answer}\n`;
          }
          
          // Add search results
          if (searchResponse.results && searchResponse.results.length > 0) {
            searchResults += '\n\nDetailed Web Search Results:\n';
            searchResponse.results.forEach((result: any, index: number) => {
              searchResults += `\n${index + 1}. ${result.title}\n`;
              searchResults += `   URL: ${result.url}\n`;
              searchResults += `   Content: ${result.content.substring(0, 200)}...\n`;
              
              // Store sources for response
              searchSources.push({
                title: result.title,
                url: result.url,
                snippet: result.content.substring(0, 200)
              });
            });
          }
          
          console.log(`Found ${searchResponse.results.length} search results`);
        }
      } catch (searchError: any) {
        console.error('Tavily search failed:', searchError);
        // Continue without search results
      }
    }

    // ✅ MODIFIED: Process with OpenAI using openaiClient
    let response;
    let currentThreadId = threadId;

    try {
      // Create thread if needed
      if (!currentThreadId) {
        const thread = await openaiClient.createThread();
        currentThreadId = thread.id;
        console.log('Created new thread:', currentThreadId);
      }

      // Prepare message with search context
      let messageContent = query;
      if (searchResults) {
        messageContent = `${query}\n\nWeb Search Context:\n${searchResults}\n\nPlease provide a comprehensive response based on the search results above.`;
      }

      // Add message to thread
      await openaiClient.addMessage(currentThreadId, messageContent);

      // Create and wait for run
      const run = await openaiClient.createRun(currentThreadId);
      const completedRun = await openaiClient.waitForRunCompletion(
        currentThreadId,
        run.id,
        60,  // max attempts
        1000 // poll interval
      );

      // Get the response
      if (completedRun.status === 'completed') {
        const messages = await openaiClient.getMessages(currentThreadId, 1);
        
        if (messages.data && messages.data.length > 0) {
          const assistantMessage = messages.data[0];
          const content = assistantMessage.content
            .filter((item: any) => item.type === 'text')
            .map((item: any) => item.text?.value || '')
            .join('\n');
          
          response = {
            reply: content,
            threadId: currentThreadId,
            searchSources: searchSources.length > 0 ? searchSources : undefined
          };
        } else {
          throw new ApiError('No response from assistant', 500, 'NO_RESPONSE');
        }
      } else {
        throw new ApiError(`Run failed with status: ${completedRun.status}`, 500, 'RUN_FAILED');
      }

    } catch (openaiError: any) {
      console.error('OpenAI processing failed:', openaiError);
      throw new ApiError('Failed to process with OpenAI', 500, 'OPENAI_ERROR');
    }

    return NextResponse.json(response);

  } catch (error: any) {
    console.error('Search API error:', error);
    
    // ✅ MODIFIED: Use consistent error response
    const errorResponse = createErrorResponse(error);
    const status = error instanceof ApiError ? error.status : 500;
    
    return NextResponse.json(errorResponse, { status });
  }
}