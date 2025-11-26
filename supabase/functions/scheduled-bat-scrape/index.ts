import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  let jobId: string | null = null;

  try {
    console.log('🚀 Starting scheduled BaT scrape...');

    // Create job record
    const { data: job, error: jobError } = await supabase
      .from('bat_scrape_jobs')
      .insert({
        job_type: 'full_scrape',
        status: 'running',
        started_at: new Date().toISOString()
      })
      .select()
      .single();

    if (jobError) throw jobError;
    jobId = job.id;

    // Call the import edge function (which handles scraping + import)
    // In production, this would trigger the actual scraper
    const importUrl = `${supabaseUrl}/functions/v1/import-bat-data`;
    const importResponse = await fetch(importUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ trigger: 'scheduled' })
    });

    if (!importResponse.ok) {
      const errorText = await importResponse.text();
      throw new Error(`Import failed: ${errorText}`);
    }

    const importResult = await importResponse.json();

    // Update job record
    const duration = Math.round((Date.now() - new Date(job.started_at).getTime()) / 1000);
    await supabase
      .from('bat_scrape_jobs')
      .update({
        status: 'completed',
        listings_found: importResult.listingsFound || 0,
        listings_scraped: importResult.listingsScraped || 0,
        comments_extracted: importResult.commentsExtracted || 0,
        users_created: importResult.usersCreated || 0,
        vehicles_matched: importResult.vehiclesMatched || 0,
        completed_at: new Date().toISOString(),
        duration_seconds: duration
      })
      .eq('id', jobId);

    // Create success notification
    await supabase.rpc('notify_admin_bat_scrape_complete', {
      p_listings_found: importResult.listingsFound || 0,
      p_listings_scraped: importResult.listingsScraped || 0,
      p_comments_extracted: importResult.commentsExtracted || 0,
      p_vehicles_matched: importResult.vehiclesMatched || 0
    });

    return new Response(JSON.stringify({ success: true, ...importResult }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error: any) {
    console.error('❌ Error in scheduled BaT scrape:', error);

    // Update job record with error
    if (jobId) {
      await supabase
        .from('bat_scrape_jobs')
        .update({
          status: 'failed',
          error_message: error.message,
          error_stack: error.stack,
          completed_at: new Date().toISOString()
        })
        .eq('id', jobId);
    }

    // Create error notification
    await supabase.rpc('notify_admin_bat_scrape_error', {
      p_error_message: error.message || 'Unknown error',
      p_error_details: {
        job_id: jobId,
        stack: error.stack,
        timestamp: new Date().toISOString()
      }
    });

    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});

