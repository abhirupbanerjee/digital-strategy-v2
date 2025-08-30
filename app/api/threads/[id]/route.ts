// app/api/threads/[id]/route.ts
// used for thread delete option


import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';


//file optimised
// ADD these imports at the top:
import { openaiClient } from '@/lib/clients';
import { ApiError, createErrorResponse } from '@/lib/utils/apiErrors';


const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// MODIFY the DELETE function:
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const { id } = params;

    if (!id) {
      throw new ApiError('Thread ID is required', 400, 'MISSING_THREAD_ID');
    }

    console.log('Deleting thread:', id);

    // ✅ NEW: Delete from OpenAI first
    try {
      await openaiClient.deleteThread(id);
      console.log('Thread deleted from OpenAI');
    } catch (openaiError) {
      console.error('OpenAI deletion failed (may not exist):', openaiError);
      // Continue with database deletion even if OpenAI fails
    }

    // Delete thread from database
    const { error } = await supabase
      .from('threads')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Supabase delete error:', error);
      throw new ApiError('Failed to delete thread from database', 500, 'DATABASE_ERROR');
    }

    console.log('Thread deleted successfully');
    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('Thread delete error:', error);
    
    // ✅ NEW: Use consistent error response
    const errorResponse = createErrorResponse(error);
    const status = error instanceof ApiError ? error.status : 500;
    return NextResponse.json(errorResponse, { status });
  }
}