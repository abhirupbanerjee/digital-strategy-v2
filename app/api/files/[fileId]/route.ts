// app/api/files/[fileId]/route.ts - MODIFIED VERSION
import { NextRequest, NextResponse } from 'next/server';
import { openaiClient } from '@/lib/clients';
import { ApiError, createErrorResponse } from '@/lib/utils/apiErrors';

// ✅ REMOVED: Direct fetch calls to OpenAI (30 lines)
// ✅ REMOVED: Custom error handling (15 lines)
// ✅ ADDED: Import from lib/clients

export async function GET(
  request: NextRequest,
  { params }: { params: { fileId: string } }
) {
  try {
    const { fileId } = params;
    
    if (!fileId) {
      throw new ApiError('File ID is required', 400, 'MISSING_FILE_ID');
    }

    // ✅ MODIFIED: Use openaiClient instead of direct fetch
    const fileContent = await openaiClient.getFileContent(fileId);
    
    // Determine content type based on file metadata if needed
    const fileMetadata = await openaiClient.getFile(fileId);
    const contentType = getContentType(fileMetadata.filename);
    
    return new NextResponse(fileContent, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${fileMetadata.filename}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
    
  } catch (error: any) {
    console.error('File retrieval error:', error);
    
    // ✅ MODIFIED: Use consistent error response
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

    // ✅ MODIFIED: Use openaiClient for deletion
    await openaiClient.deleteFile(fileId);
    
    return NextResponse.json({ 
      success: true, 
      message: 'File deleted successfully' 
    });
    
  } catch (error: any) {
    console.error('File deletion error:', error);
    
    // ✅ MODIFIED: Use consistent error response
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
  };
  
  return contentTypes[extension || ''] || 'application/octet-stream';
}