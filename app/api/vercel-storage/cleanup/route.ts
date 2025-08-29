// app/api/vercel-storage/cleanup/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { del } from '@vercel/blob';
import { createClient } from '@supabase/supabase-js';
import { StorageService } from '@/services/storageService';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function POST() {
  try {
    const result = await StorageService.cleanupOldFiles();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 });
  }
}