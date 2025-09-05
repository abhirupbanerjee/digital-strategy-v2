// app/api/files/[fileId]/route.ts - FOLLOWING CODEBASE PATTERN
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { openaiClient, storageClient } from '@/lib/clients';
import { ApiError, createErrorResponse } from '@/lib/utils/apiErrors';

// Following the pattern from other API routes
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function GET(
  request: NextRequest,
  { params }: { params: { fileId: string } }
) {
  try {
    const { fileId } = params;
    
    if (!fileId) {
      throw new ApiError('File ID is required', 400, 'MISSING_FILE_ID');
    }

    // First check if file exists in Vercel Blob via Supabase
    const { data: blobFile, error: dbError } = await supabase
      .from('blob_files')
      .select('vercel_blob_url, filename, content_type')
      .eq('openai_file_id', fileId)
      .single();
    
    if (blobFile && blobFile.vercel_blob_url) {
      // Redirect to the actual Vercel Blob URL
      // This ensures the file is served directly from Vercel's CDN
      return NextResponse.redirect(blobFile.vercel_blob_url);
    }
    
    // Fallback: Try to get from OpenAI if not in Vercel Blob
    try {
      const fileContent = await openaiClient.getFileContent(fileId);
      const fileMetadata = await openaiClient.getFile(fileId);
      
      // Convert content to Buffer if it's not already
      const buffer = Buffer.isBuffer(fileContent) 
        ? fileContent 
        : Buffer.from(fileContent);
      
      const contentType = getContentType(fileMetadata.filename || 'file');
      
      return new NextResponse(buffer, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${fileMetadata.filename || 'download'}"`,
          'Cache-Control': 'private, max-age=3600',
        },
      });
    } catch (openaiError: any) {
      console.error('OpenAI file retrieval failed:', openaiError);
      throw new ApiError(
        'File not found or no longer available',
        404,
        'FILE_NOT_FOUND'
      );
    }
    
  } catch (error: any) {
    console.error('File retrieval error:', error);
    
    const errorResponse = createErrorResponse(error);
    const status = error instanceof ApiError ? error.status : 500;
    
    return NextResponse.json(errorResponse, { status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { fileId: string } }
) {
  try {
    const { fileId } = params;
    
    if (!fileId) {
      throw new ApiError('File ID is required', 400, 'MISSING_FILE_ID');
    }

    // Get blob URL first for storage deletion
    const { data: blobFile } = await supabase
      .from('blob_files')
      .select('vercel_blob_url')
      .eq('openai_file_id', fileId)
      .single();

    // Delete from database
    const { error: dbError } = await supabase
      .from('blob_files')
      .delete()
      .eq('openai_file_id', fileId);
    
    if (dbError) {
      console.error('Database deletion failed:', dbError);
    }

    // Delete from Vercel Blob if URL exists and storageClient is available
    if (blobFile?.vercel_blob_url && storageClient) {
      try {
        await storageClient.delete(blobFile.vercel_blob_url);
      } catch (storageError) {
        console.error('Vercel Blob deletion failed:', storageError);
        // Continue - storage might already be deleted
      }
    }

    // Try to delete from OpenAI (may fail if already deleted)
    try {
      await openaiClient.deleteFile(fileId);
    } catch (openaiError) {
      console.error('OpenAI deletion failed (may not exist):', openaiError);
      // Continue - file might already be deleted
    }
    
    return NextResponse.json({ 
      success: true, 
      message: 'File deleted successfully' 
    });
    
  } catch (error: any) {
    console.error('File deletion error:', error);
    
    const errorResponse = createErrorResponse(error);
    const status = error instanceof ApiError ? error.status : 500;
    
    return NextResponse.json(errorResponse, { status });
  }
}

// Helper function to determine content type
function getContentType(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase();
  
  const contentTypes: Record<string, string> = {
    'pdf': 'application/pdf',
    'txt': 'text/plain',
    'csv': 'text/csv',
    'json': 'application/json',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'mp3': 'audio/mpeg',
    'mp4': 'video/mp4',
    'zip': 'application/zip',
  };
  
  return contentTypes[extension || ''] || 'application/octet-stream';
}