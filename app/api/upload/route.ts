// app/api/upload/route.ts - OPTIMIZED VERSION
// Reduced from ~80 lines to ~30 lines using new services
import { NextRequest, NextResponse } from 'next/server';

// ✅ NEW SERVICES - Replace all file handling logic
import { FileProcessingService } from '@/services/fileProcessingService';
import { StorageService } from '@/services/storageService';
import { AIProviderService } from '@/services/aiProviderService';

const DEBUG = process.env.NODE_ENV === 'development';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('files') as File[];
    const threadId = formData.get('threadId') as string;
    const projectId = formData.get('projectId') as string;

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    if (DEBUG) {
      console.log(`📁 Upload request: ${files.length} files for thread ${threadId}`);
    }

    // ✅ OPTIMIZED: Use FileProcessingService for validation and processing
    const uploadResults = [];
    const errors = [];

    for (const file of files) {
      try {
        // Validate file using centralized service
        const validation = await FileProcessingService.validateFileUpload(file);
        if (!validation.valid) {
          errors.push(`${file.name}: ${validation.error}`);
          continue;
        }

        // ✅ OPTIMIZED: Use StorageService for upload
        const fileBuffer = Buffer.from(await file.arrayBuffer());
        const uploadResult = await StorageService.uploadToBlob(fileBuffer, file.name, {
          contentType: file.type,
          threadId,
          projectId
        });

        // ✅ OPTIMIZED: Use AIProviderService for file processing
        const fileProcessingResult = await AIProviderService.processFile(
          fileBuffer,
          file.type,
          file.name
        );

        if (fileProcessingResult.error) {
          errors.push(`${file.name}: ${fileProcessingResult.error}`);
          continue;
        }

        // ✅ OPTIMIZED: Use FileProcessingService for mapping creation
        await FileProcessingService.createFileMapping(
          fileProcessingResult.fileId,
          uploadResult.url,
          uploadResult.key,
          {
            filename: file.name,
            contentType: file.type,
            fileSize: file.size,
            threadId,
            projectId
          }
        );

        uploadResults.push({
          success: true,
          fileId: fileProcessingResult.fileId,
          filename: file.name,
          size: file.size,
          blobUrl: uploadResult.url,
          message: `${file.name} uploaded successfully`
        });

        if (DEBUG) {
          console.log(`✅ Successfully uploaded: ${file.name} (${file.size} bytes)`);
        }

      } catch (error) {
        console.error(`❌ Upload failed for ${file.name}:`, error);
        errors.push(`${file.name}: Upload failed - ${error || 'Unknown error'}`);
      }
    }

    // Response summary
    const successful = uploadResults.length;
    const failed = errors.length;
    const total = files.length;

    const response = {
      success: successful > 0,
      results: uploadResults,
      summary: {
        total,
        successful,
        failed,
        message: `${successful}/${total} files uploaded successfully`
      },
      errors: errors.length > 0 ? errors : undefined
    };

    if (DEBUG) {
      console.log(`📊 Upload summary: ${successful}/${total} successful uploads`);
    }

    return NextResponse.json(response);

  } catch (error: any) {
    console.error('Upload API error:', error);
    return NextResponse.json(
      { 
        error: 'Upload failed', 
        message: error.message || 'Internal server error' 
      },
      { status: 500 }
    );
  }
}