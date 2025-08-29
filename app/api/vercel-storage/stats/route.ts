// app/api/vercel-storage/stats/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { StorageService } from '@/services/storageService';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// NEW CODE - REPLACE WITH:
// code optimise
export async function GET() {
  try {
    const stats = await StorageService.getStorageStats();
    return NextResponse.json(stats);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to get stats' }, { status: 500 });
  }
}

// POST endpoint to manually trigger metrics recalculation
export async function POST(request: NextRequest) {
  try {
    console.log('Recalculating storage metrics...');
    
    // Query all files and calculate totals
    const { data: allFiles, error: filesError } = await supabase
      .from('blob_files')
      .select('file_size');
    
    if (filesError) {
      console.error('Error querying files for metrics:', filesError);
      return NextResponse.json(
        { error: 'Failed to query files' },
        { status: 500 }
      );
    }
    
    const totalSize = allFiles?.reduce((sum, file) => sum + (file.file_size || 0), 0) || 0;
    const fileCount = allFiles?.length || 0;
    
    // Update storage metrics
    const { error: updateError } = await supabase
      .from('storage_metrics')
      .upsert({
        id: '00000000-0000-0000-0000-000000000000',
        total_size_bytes: totalSize,
        file_count: fileCount,
        updated_at: new Date().toISOString()
      });
    
    if (updateError) {
      console.error('Error updating storage metrics:', updateError);
      return NextResponse.json(
        { error: 'Failed to update metrics' },
        { status: 500 }
      );
    }
    
    console.log(`Metrics recalculated: ${fileCount} files, ${(totalSize / 1024 / 1024).toFixed(2)}MB`);
    
    return NextResponse.json({
      success: true,
      message: 'Metrics recalculated',
      totalSizeBytes: totalSize,
      totalSizeMB: Math.round((totalSize / 1024 / 1024) * 100) / 100,
      fileCount: fileCount
    });
    
  } catch (error) {
    console.error('Metrics recalculation error:', error);
    return NextResponse.json(
      { error: 'Failed to recalculate metrics' },
      { status: 500 }
    );
  }
}