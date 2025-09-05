// app/api/threads/route.ts - FINAL FIXED VERSION
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ContentCleaningService } from '@/services/contentCleaningService';
import { openaiClient } from '@/lib/clients';
import { ApiError, createErrorResponse } from '@/lib/utils/apiErrors';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const DEBUG = process.env.NODE_ENV === 'development';

// Helper function to extract text content from message content array
function extractTextFromContent(content: any): string {
  if (typeof content === 'string') {
    return content;
  }
  
  if (Array.isArray(content)) {
    return content
      .map(item => {
        if (typeof item === 'string') {
          return item;
        }
        if (item.type === 'text' && item.text?.value) {
          return item.text.value;
        }
        if (item.type === 'image_file' && item.image_file?.file_id) {
          return `[Image: ${item.image_file.file_id}]`;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  
  if (content && typeof content === 'object') {
    if (content.text?.value) return content.text.value;
    if (content.text) return String(content.text);
    if (content.value) return String(content.value);
  }
  
  return '';
}

// GET - Retrieve thread messages
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get('threadId');

    if (!threadId) {
      return NextResponse.json({ error: 'Thread ID is required' }, { status: 400 });
    }

    try {
      // Use the existing openaiClient method for getting messages
      const threadMessages = await openaiClient.getMessages(threadId);

      if (!threadMessages || !threadMessages.data || threadMessages.data.length === 0) {
        return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
      }

      // Transform messages to the format expected by the frontend
      const cleanedMessages = threadMessages.data.map((msg) => {
        // Extract text content from the message
        const textContent = extractTextFromContent(msg.content);
        
        // Clean the text content if cleaning service is available
        const cleanedContent = ContentCleaningService?.safeCleanWithPlaceholders 
          ? ContentCleaningService.safeCleanWithPlaceholders(textContent)
          : textContent;

        // Return message in the format expected by frontend
        return {
          id: msg.id,
          role: msg.role,
          content: cleanedContent, // This is now a plain string
          created_at: msg.created_at,
          // Preserve file IDs if they exist in the original message
          fileIds: msg.content
            ?.filter((item: any) => item.type === 'image_file')
            ?.map((item: any) => item.image_file?.file_id)
            ?.filter(Boolean)
        };
      });

      if (DEBUG) {
        console.log(`📖 Retrieved thread ${threadId} with ${cleanedMessages.length} messages`);
      }

      return NextResponse.json({
        success: true,
        thread: {
          id: threadId,
          messages: cleanedMessages
        }
      });

    } catch (openaiError: any) {
      // Handle OpenAI-specific errors
      if (openaiError?.status === 404 || openaiError?.message?.includes('not found')) {
        return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
      }
      
      console.error('OpenAI API error:', openaiError);
      throw new ApiError(
        `Failed to retrieve thread: ${openaiError?.message || 'Unknown error'}`,
        openaiError?.status || 500,
        'OPENAI_ERROR'
      );
    }

  } catch (error: any) {
    console.error('Error retrieving thread:', error);
    const errorResponse = createErrorResponse(error);
    const status = error instanceof ApiError ? error.status : 500;
    return NextResponse.json(errorResponse, { status });
  }
}

// POST - Save thread to database
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, projectId, title, messages } = body;

    if (!id || !projectId) {
      return NextResponse.json(
        { error: 'Thread ID and Project ID are required' },
        { status: 400 }
      );
    }

    // Calculate message count and active file count from messages
    const messageCount = messages ? messages.length : 0;
    const activeFileCount = messages ? 
      messages.reduce((count: number, msg: any) => {
        return count + (msg.fileIds?.length || 0);
      }, 0) : 0;

    // FIX: Only use columns that exist in the database
    const threadData = {
      id: id,
      project_id: projectId,
      title: title || 'New Chat',
      last_activity: new Date().toISOString(),
      message_count: messageCount,
      active_file_count: activeFileCount
    };

    if (DEBUG) {
      console.log('Saving thread with data:', threadData);
    }

    // Upsert thread with ONLY existing columns
    const { data, error } = await supabase
      .from('threads')
      .upsert(threadData, { 
        onConflict: 'id',
        ignoreDuplicates: false 
      })
      .select()
      .single();

    if (error) {
      console.error('Error saving thread:', error);
      throw new ApiError(`Failed to save thread: ${error.message}`, 500, 'DATABASE_ERROR');
    }

    if (DEBUG) {
      console.log(`✅ Thread ${id} saved successfully`);
    }

    return NextResponse.json({
      success: true,
      thread: data
    });

  } catch (error: any) {
    console.error('Error in thread save:', error);
    const errorResponse = createErrorResponse(error);
    const status = error instanceof ApiError ? error.status : 500;
    return NextResponse.json(errorResponse, { status });
  }
}

// DELETE - Delete a thread
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

    // First try to delete from OpenAI (optional - won't fail if thread doesn't exist)
    try {
      await openaiClient.deleteThread(threadId);
      if (DEBUG) {
        console.log(`🗑️ Thread ${threadId} deleted from OpenAI`);
      }
    } catch (openaiError: any) {
      // Log but don't fail if OpenAI deletion fails (thread might not exist there)
      if (DEBUG) {
        console.log(`Note: Could not delete thread from OpenAI: ${openaiError?.message}`);
      }
    }

    // Delete from database
    const { error } = await supabase
      .from('threads')
      .delete()
      .eq('id', threadId);

    if (error) {
      throw new ApiError(`Failed to delete thread: ${error.message}`, 500, 'DATABASE_ERROR');
    }

    if (DEBUG) {
      console.log(`🗑️ Thread ${threadId} deleted from database`);
    }

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('Error deleting thread:', error);
    const errorResponse = createErrorResponse(error);
    const status = error instanceof ApiError ? error.status : 500;
    return NextResponse.json(errorResponse, { status });
  }
}