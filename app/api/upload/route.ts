// app/api/upload/route.ts - MODIFIED VERSION
import { NextRequest, NextResponse } from 'next/server';
import { openaiClient, storageClient } from '@/lib/clients';
import { ApiError, createErrorResponse } from '@/lib/utils/apiErrors';
import { createClient } from '@supabase/supabase-js';

// ✅ REMOVED: Direct Vercel Blob fetch calls (40 lines)
// ✅ REMOVED: Duplicate timeout logic (10 lines)
// ✅ ADDED: Import from lib/clients

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const threadId = formData.get('threadId') as string;
    const projectId = formData.get('projectId') as string;
    
    if (!file) {
      throw new ApiError('No file provided', 400, 'NO_FILE');
    }

    // Validate file size and type
    const maxSize = 100 * 1024 * 1024; // 100MB
    if (file.size > maxSize) {
      throw new ApiError('File size exceeds 100MB limit', 413, 'FILE_TOO_LARGE');
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // ✅ MODIFIED: Upload to OpenAI using openaiClient
    let openaiFile;
    try {
      openaiFile = await openaiClient.uploadFile(
        buffer,
        file.name,
        'assistants'
      );
    } catch (error) {
      console.error('OpenAI upload failed:', error);
      throw new ApiError('Failed to upload file to OpenAI', 500, 'OPENAI_UPLOAD_ERROR');
    }

    // ✅ MODIFIED: Upload to Vercel Blob using storageClient with progress
    let blobResult;
    if (storageClient) {
      try {
        blobResult = await storageClient.upload(
          buffer,
          `uploads/${threadId || 'global'}/${file.name}`,
          {
            contentType: file.type,
            metadata: {
              threadId,
              projectId,
              openaiFileId: openaiFile.id,
              originalName: file.name
            },
            onProgress: (progress) => {
              // Could send progress updates via SSE or WebSocket if needed
              console.log(`Upload progress: ${progress}%`);
            }
          }
        );
      } catch (error) {
        // If blob upload fails, clean up OpenAI file
        await openaiClient.deleteFile(openaiFile.id);
        throw new ApiError('Failed to upload file to storage', 500, 'STORAGE_UPLOAD_ERROR');
      }
    }

    // Save file metadata to database
    if (blobResult) {
      try {
        await supabase
          .from('blob_files')
          .insert({
            openai_file_id: openaiFile.id,
            vercel_blob_url: blobResult.url,
            vercel_file_key: blobResult.pathname,
            filename: file.name,
            content_type: file.type,
            file_size: file.size,
            thread_id: threadId,
            project_id: projectId
          });
      } catch (error) {
        console.error('Database insert failed:', error);
        // Clean up both OpenAI and Blob on database failure
        await openaiClient.deleteFile(openaiFile.id);
        if (storageClient) {
          await storageClient.delete(blobResult.url);
        }
        throw new ApiError('Failed to save file metadata', 500, 'DATABASE_ERROR');
      }
    }

    // Update storage metrics
    if (storageClient) {
      try {
        const { data: metrics } = await supabase
          .from('storage_metrics')
          .select('total_size_bytes, file_count')
          .single();
        
        if (metrics) {
          await supabase
            .from('storage_metrics')
            .update({
              total_size_bytes: metrics.total_size_bytes + file.size,
              file_count: metrics.file_count + 1,
              updated_at: new Date().toISOString()
            })
            .eq('id', '00000000-0000-0000-0000-000000000000');
        }
      } catch (error) {
        console.error('Failed to update storage metrics:', error);
        // Non-critical error, continue
      }
    }

    return NextResponse.json({
      success: true,
      fileId: openaiFile.id,
      filename: file.name,
      size: file.size,
      blobUrl: blobResult?.url,
      message: 'File uploaded successfully'
    });

  } catch (error: any) {
    console.error('Upload error:', error);
    
    // ✅ MODIFIED: Use consistent error response
    const errorResponse = createErrorResponse(error);
    const status = error instanceof ApiError ? error.status : 500;
    
    return NextResponse.json(errorResponse, { status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { fileId, blobUrl } = await request.json();
    
    if (!fileId) {
      throw new ApiError('File ID is required', 400, 'MISSING_FILE_ID');
    }

    // Delete from OpenAI
    try {
      await openaiClient.deleteFile(fileId);
    } catch (error) {
      console.error('OpenAI deletion failed:', error);
      // Continue with blob deletion even if OpenAI fails
    }

    // Delete from Vercel Blob
    if (blobUrl && storageClient) {
      try {
        await storageClient.delete(blobUrl);
      } catch (error) {
        console.error('Blob deletion failed:', error);
      }
    }

    // Remove from database
    await supabase
      .from('blob_files')
      .delete()
      .eq('openai_file_id', fileId);

    return NextResponse.json({
      success: true,
      message: 'File deleted successfully'
    });

  } catch (error: any) {
    console.error('Delete error:', error);
    
    const errorResponse = createErrorResponse(error);
    const status = error instanceof ApiError ? error.status : 500;
    
    return NextResponse.json(errorResponse, { status });
  }
}