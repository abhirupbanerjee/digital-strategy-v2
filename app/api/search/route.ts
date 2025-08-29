// app/api/search/route.ts
import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';

export const runtime = 'nodejs';

// Tavily API - AI-optimized search engine
// Get your API key from: https://tavily.com
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;
const OPENAI_ORGANIZATION = process.env.OPENAI_ORGANIZATION;

export async function POST(request: NextRequest) {
  try {
    const { query, threadId, useSearch } = await request.json();

    if (!query) {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      );
    }

    if (!ASSISTANT_ID || !OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'Missing OpenAI configuration' },
        { status: 500 }
      );
    }

    let searchResults = '';
    let searchSources: any[] = [];

    // Perform web search using Tavily if enabled
    if (useSearch && TAVILY_API_KEY) {
      try {
        console.log('Performing Tavily search for:', query);
        
        // Tavily API request
        const searchResponse = await axios.post(
          'https://api.tavily.com/search',
          {
            api_key: TAVILY_API_KEY,
            query: query,
            search_depth: 'basic', // 'basic' or 'advanced'
            include_answer: true, // Get AI-generated answer
            include_images: false,
            include_raw_content: false,
            max_results: 5, // Limit to top 3 results
            include_domains: [], // Optional: limit to specific domains
            exclude_domains: [], // Optional: exclude specific domains
          },
          {
            headers: {
              'Content-Type': 'application/json',
            }
          }
        );

        // Format Tavily search results
        if (searchResponse.data) {
          const data = searchResponse.data;
          
          // Include Tavily's AI-generated answer if available
          if (data.answer) {
            searchResults = `\n\nWeb Search Summary: ${data.answer}\n`;
          }
          
          // Add search results
          if (data.results && data.results.length > 0) {
            searchResults += '\n\nDetailed Web Search Results:\n';
            data.results.forEach((result: any, index: number) => {
              searchResults += `\n${index + 1}. **${result.title}**\n`;
              searchResults += `   Source: ${result.url}\n`;
              searchResults += `   ${result.content}\n`;
              if (result.score) {
                searchResults += `   Relevance Score: ${(result.score * 100).toFixed(1)}%\n`;
              }
              
              // Store sources for reference
              searchSources.push({
                title: result.title,
                url: result.url,
                score: result.score
              });
            });
          }

          // Add search query context
          searchResults += `\n\nSearch performed on: ${new Date().toLocaleString()}`;
          searchResults += `\nQuery: "${data.query}"`;
        }
      } catch (searchError: any) {
        console.error('Tavily search error:', searchError.response?.data || searchError.message);
        
        // Provide fallback message
        searchResults = '\n\n[Note: Web search encountered an error. Responding based on available knowledge.]';
      }
    }

    // Prepare the augmented message
    const augmentedQuery = useSearch && searchResults 
      ? `${query}\n\n---\nCurrent Web Information:${searchResults}\n---\n\nPlease provide a comprehensive answer based on both your knowledge and the web search results above. Always cite sources when using search results.`
      : query;

    // Set up OpenAI headers
    const headers: Record<string, string> = {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'assistants=v2',
    };

    if (OPENAI_ORGANIZATION) {
      headers['OpenAI-Organization'] = OPENAI_ORGANIZATION;
    }

    let currentThreadId = threadId;

    // Create thread if it doesn't exist
    if (!currentThreadId) {
      console.log('Creating new thread for search...');
      try {
        const threadRes = await axios.post(
          'https://api.openai.com/v1/threads',
          {},
          { headers }
        );
        currentThreadId = threadRes.data.id;
        console.log('Thread created:', currentThreadId);
      } catch (error: any) {
        console.error('Thread creation failed:', error.response?.data || error.message);
        return NextResponse.json(
          { error: 'Failed to create thread' },
          { status: 500 }
        );
      }
    }

    // Add message to thread
    console.log('Adding search-enhanced message to thread...');
    try {
      await axios.post(
        `https://api.openai.com/v1/threads/${currentThreadId}/messages`,
        { 
          role: 'user', 
          content: augmentedQuery 
        },
        { headers }
      );
      console.log('Message added to thread');
    } catch (error: any) {
      console.error('Failed to add message:', error.response?.data || error.message);
      return NextResponse.json(
        { error: 'Failed to add message to thread' },
        { status: 500 }
      );
    }

    // Create run with the assistant
    console.log('Creating run with assistant...');
    let runId;
    // Store creation timestamp for message filtering
    const runCreatedAt = Date.now();
    
    try {
      const runRes = await axios.post(
        `https://api.openai.com/v1/threads/${currentThreadId}/runs`,
        { 
          assistant_id: ASSISTANT_ID,
          // Include tools if needed
          tools: [
            { type: "code_interpreter" },
            { type: "file_search" }
          ]
        },
        { headers }
      );
      runId = runRes.data.id;
      console.log(`Run created at ${runCreatedAt}: ${runId}`);
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
        console.log(`Run status: ${status} (attempt ${retries + 1})`);
        
        if (status === 'failed') {
          console.error('Run failed:', statusRes.data);
          break;
        }
        
        if (status === 'completed') {
          break;
        }
      } catch (error: any) {
        console.error('Status check failed:', error.response?.data || error.message);
        break;
      }
      
      retries++;
    }

    let reply = 'No response received.';
    
    if (status === 'completed') {
      console.log('Run completed, fetching messages...');
      try {
        const messagesRes = await axios.get(
          `https://api.openai.com/v1/threads/${currentThreadId}/messages`,
          { headers }
        );
        
        // Get messages created after this run (with 2-second buffer)
        const recentMessages = messagesRes.data.data.filter((m: any) => 
          m.role === 'assistant' && 
          (m.created_at * 1000) >= (runCreatedAt - 2000)
        );
        

        
        // Get the most recent assistant message, fallback to any assistant message
        const assistantMsg = recentMessages[0] || messagesRes.data.data.find((m: any) => m.role === 'assistant');
        
        // Process the assistant's response
        if (assistantMsg?.content) {
          // Extract ALL text content parts and concatenate
          const allTextParts = assistantMsg.content
            .filter((item: any) => item.type === 'text')
            .map((item: any) => item.text?.value || '')
            .filter((text: string) => text.length > 0);
          
          const combinedText = allTextParts.join('\n\n');
          
          if (combinedText) {
            reply = combinedText;
          } else {
            // Fallback to original logic
            const textContent = assistantMsg.content.find((c: any) => c.type === 'text');
            if (textContent) {
              reply = textContent.text.value;
            }
          }
          
          // Clean up any citation markers
          reply = reply.replace(/【\d+:\d+†[^】]+】/g, '');
          reply = reply.replace(/\[sandbox:.*?\]/g, '');
        }
        
        // Add sources if available
        if (searchSources.length > 0) {
          reply += '\n\n---\n**Sources:**\n';
          searchSources.forEach((source, index) => {
            reply += `${index + 1}. [${source.title}](${source.url})\n`;
          });
        }
        
        console.log('Reply extracted successfully');
      } catch (error: any) {
        console.error('Failed to fetch messages:', error.response?.data || error.message);
        reply = 'Failed to fetch response.';
      }
    } else if (status === 'failed') {
      reply = 'The assistant run failed. Please try again.';
    } else if (retries >= maxRetries) {
      reply = 'The assistant is taking too long to respond. Please try again.';
    }

    return NextResponse.json({
      reply,
      threadId: currentThreadId,
      hadSearchResults: !!searchResults,
      sources: searchSources,
      status: 'success'
    });

  } catch (error: any) {
    console.error('Search integration error:', error.response?.data || error.message);
    
    let errorMessage = 'Failed to process search request';
    if (error.response?.status === 401) {
      errorMessage = 'Invalid API key';
    } else if (error.response?.status === 429) {
      errorMessage = 'Rate limit exceeded. Please try again later.';
    }
    
    return NextResponse.json(
      { error: errorMessage },
      { status: error.response?.status || 500 }
    );
  }
}