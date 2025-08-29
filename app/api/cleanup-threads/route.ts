// app/api/cleanup-threads/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ContentCleaningService } from '@/services/contentCleaningService';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Safe cleanup function using placeholders to guarantee file link preservation
// removed to services

export async function POST(request: NextRequest) {
  try {
    console.log('Starting cleanup of all threads...');

    // Fetch all threads from database
    const { data: threads, error: fetchError } = await supabase
      .from('threads')
      .select('*');

    if (fetchError) {
      console.error('Error fetching threads:', fetchError);
      return NextResponse.json({ error: 'Failed to fetch threads' }, { status: 500 });
    }

    let cleanedCount = 0;
    let processedCount = 0;
    let filesPreservedCount = 0;

    // Process each thread
    for (const thread of threads || []) {
      try {
        processedCount++;
        let needsUpdate = false;
        let threadFileLinks = 0;
        
        // Clean messages if they exist
        let cleanedMessages = thread.messages || [];
        if (Array.isArray(cleanedMessages)) {
          const originalMessagesJson = JSON.stringify(cleanedMessages);
          
          // Count original file links in this thread
          const originalFileLinks = (originalMessagesJson.match(/\/api\/files\/[a-zA-Z0-9-_]+/g) || []);
          threadFileLinks = originalFileLinks.length;
          
          if (threadFileLinks > 0) {
            console.log(`Thread ${thread.id} has ${threadFileLinks} file links to preserve`);
          }
          
          cleanedMessages = cleanedMessages.map((msg: any) => {
            if (typeof msg.content === 'string') {
              const originalContent = msg.content;
              const cleanedContent = ContentCleaningService.safeCleanWithPlaceholders(msg.content);
              
              if (originalContent !== cleanedContent) {
                needsUpdate = true;
                return { ...msg, content: cleanedContent };
              }
            }
            return msg;
          });
          
          // Verify file links are preserved after cleaning
          if (threadFileLinks > 0) {
            const cleanedJson = JSON.stringify(cleanedMessages);
            const cleanedFileLinks = (cleanedJson.match(/\/api\/files\/[a-zA-Z0-9-_]+/g) || []);
            
            if (cleanedFileLinks.length !== threadFileLinks) {
              console.error(`ERROR: Thread ${thread.id} lost file links! Original: ${threadFileLinks}, After: ${cleanedFileLinks.length}`);
              console.error('Skipping this thread to preserve file links');
              continue; // Skip this thread
            } else {
              console.log(`SUCCESS: Thread ${thread.id} preserved all ${threadFileLinks} file links`);
              filesPreservedCount += threadFileLinks;
            }
          }
          
          // Update thread if changes were made
          if (needsUpdate) {
            const { error: updateError } = await supabase
              .from('threads')
              .update({
                messages: cleanedMessages,
                updated_at: new Date().toISOString()
              })
              .eq('id', thread.id);

            if (updateError) {
              console.error(`Error updating thread ${thread.id}:`, updateError);
            } else {
              cleanedCount++;
              console.log(`Cleaned thread ${thread.id}`);
            }
          }
        }
      } catch (threadError) {
        console.error(`Error processing thread ${thread.id}:`, threadError);
      }
    }

    console.log('=== CLEANUP SUMMARY ===');
    console.log(`Processed: ${processedCount} threads`);
    console.log(`Cleaned: ${cleanedCount} threads`);
    console.log(`File links preserved: ${filesPreservedCount}`);

    return NextResponse.json({
      success: true,
      processed: processedCount,
      cleaned: cleanedCount,
      filesPreserved: filesPreservedCount,
      message: `Successfully cleaned ${cleanedCount} threads out of ${processedCount} total threads. ${filesPreservedCount} file links preserved.`
    });

  } catch (error: any) {
    console.error('Cleanup error:', error);
    return NextResponse.json(
      { error: 'Internal server error during cleanup' },
      { status: 500 }
    );
  }
}