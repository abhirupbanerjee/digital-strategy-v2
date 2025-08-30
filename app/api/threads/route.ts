// app/api/threads/route.ts - OPTIMIZED VERSION  
// Reduced from ~120 lines to ~60 lines using new services
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// ✅ NEW SERVICES - Replace content processing and storage logic
import { ContentCleaningService } from '@/services/contentCleaningService';
import { StorageService } from '@/services/storageService';
import { AIProviderService } from '@/services/aiProviderService';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const DEBUG = process.env.NODE_ENV === 'development';

// GET - Retrieve thread messages
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get('threadId');

    if (!threadId) {
      return NextResponse.json({ error: 'Thread ID is required' }, { status: 400 });
    }

    // ✅ OPTIMIZED: Use AIProviderService for thread retrieval
    const threadMessages = await AIProviderService.getThreadMessages(threadId);

    if (!threadMessages || threadMessages.length === 0) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    // ✅ OPTIMIZED: Clean messages using ContentCleaningService
    const cleanedMessages = threadMessages.map(msg => ({
      ...msg,
      content: typeof msg.content === 'string' 
        ? ContentCleaningService.safeCleanWithPlaceholders(msg.content)
        : msg.content
    }));

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

  } catch (error: any) {
    console.error('Thread retrieval error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve thread' },
      { status: 500 }
    );
  }
}

// POST - Save thread to database
export async function POST(request: NextRequest) {
  try {
    const { id, projectId, title, messages, lastMessage, createdAt } = await request.json();

    if (!id || !projectId) {
      return NextResponse.json(
        { error: 'Thread ID and Project ID are required' },
        { status: 400 }
      );
    }

    // ✅ OPTIMIZED: Clean messages before saving
    const cleanedMessages = messages.map((msg: any) => ({
      ...msg,
      content: typeof msg.content === 'string' 
        ? ContentCleaningService.safeCleanWithPlaceholders(msg.content)
        : msg.content
    }));

    // ✅ OPTIMIZED: Use Supabase upsert for thread saving
    const { data, error } = await supabase
      .from('threads')
      .upsert({
        id,
        project_id: projectId,
        title: title || 'Untitled Thread',
        messages: cleanedMessages,
        last_message: lastMessage || '',
        created_at: createdAt || new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'id'
      })
      .select()
      .single();

    if (error) {
      console.error('Thread save error:', error);
      return NextResponse.json({ error: 'Failed to save thread' }, { status: 500 });
    }

    // ✅ OPTIMIZED: Update project's thread list efficiently
    const { error: projectError } = await supabase.rpc('add_thread_to_project', {
      project_id: projectId,
      thread_id: id
    });

    if (projectError) {
      console.error('Project update error:', projectError);
      // Don't fail the request, just log the error
    }

    if (DEBUG) {
      console.log(`💾 Saved thread ${id} to project ${projectId}`);
    }

    return NextResponse.json({
      success: true,
      thread: data,
      message: 'Thread saved successfully'
    });

  } catch (error: any) {
    console.error('Thread save error:', error);
    return NextResponse.json(
      { error: 'Failed to save thread' },
      { status: 500 }
    );
  }
}

// DELETE - Remove thread and associated data
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get('threadId');

    if (!threadId) {
      return NextResponse.json({ error: 'Thread ID is required' }, { status: 400 });
    }

    // ✅ OPTIMIZED: Delete from OpenAI using AIProviderService
    await AIProviderService.deleteThread(threadId);

    // ✅ OPTIMIZED: Delete from database
    const { error: dbError } = await supabase
      .from('threads')
      .delete()
      .eq('id', threadId);

    if (dbError) {
      console.error('Database deletion error:', dbError);
      return NextResponse.json({ error: 'Failed to delete from database' }, { status: 500 });
    }

    // ✅ OPTIMIZED: Cleanup associated files using StorageService  
    try {
      await StorageService.deleteFile(threadId);
      if (DEBUG) {
        console.log(`🗑️ Cleaned up files for thread ${threadId}`);
      }
    } catch (cleanupError) {
      console.error('File cleanup error:', cleanupError);
      // Don't fail the request for cleanup errors
    }

    if (DEBUG) {
      console.log(`🗑️ Deleted thread ${threadId}`);
    }

    return NextResponse.json({
      success: true,
      message: 'Thread deleted successfully'
    });

  } catch (error: any) {
    console.error('Thread deletion error:', error);
    return NextResponse.json(
      { error: 'Failed to delete thread' },
      { status: 500 }
    );
  }
}