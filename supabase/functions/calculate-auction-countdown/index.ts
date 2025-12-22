import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CountdownResult {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  total_seconds: number;
  is_expired: boolean;
  formatted: string;
  formatted_short: string;
}

function calculateCountdown(endDate: string | null): CountdownResult {
  if (!endDate) {
    return {
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      total_seconds: 0,
      is_expired: true,
      formatted: 'No end date',
      formatted_short: 'N/A'
    };
  }
  
  const now = new Date();
  const end = new Date(endDate);
  const diffMs = end.getTime() - now.getTime();
  const totalSeconds = Math.floor(diffMs / 1000);
  
  if (totalSeconds <= 0) {
    return {
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      total_seconds: 0,
      is_expired: true,
      formatted: 'Auction ended',
      formatted_short: 'Ended'
    };
  }
  
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  // Formatted strings
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 && days === 0) parts.push(`${minutes}m`);
  if (seconds > 0 && days === 0 && hours === 0) parts.push(`${seconds}s`);
  
  const formattedShort = parts.join(' ') || '<1m';
  
  const partsLong = [];
  if (days > 0) partsLong.push(`${days} day${days !== 1 ? 's' : ''}`);
  if (hours > 0) partsLong.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
  if (minutes > 0 && days === 0) partsLong.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
  if (seconds > 0 && days === 0 && hours === 0) partsLong.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);
  const formatted = partsLong.join(', ') || 'Less than a minute';
  
  return {
    days,
    hours,
    minutes,
    seconds,
    total_seconds: totalSeconds,
    is_expired: false,
    formatted,
    formatted_short: formattedShort
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { vehicle_id, end_date } = await req.json();

    if (!vehicle_id && !end_date) {
      return new Response(
        JSON.stringify({ error: 'vehicle_id or end_date is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let endDate: string | null = end_date || null;

    // If vehicle_id provided, get end date from vehicle
    if (vehicle_id && !end_date) {
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('auction_end_date, origin_metadata')
        .eq('id', vehicle_id)
        .single();

      if (vehicle) {
        endDate = vehicle.auction_end_date || 
                 vehicle.origin_metadata?.auction_times?.auction_end_date ||
                 vehicle.origin_metadata?.pcarmarket_auction_end_date ||
                 null;
      }
    }

    const countdown = calculateCountdown(endDate);
    const now = new Date();

    return new Response(
      JSON.stringify({
        success: true,
        end_date: endDate,
        current_time: now.toISOString(),
        countdown,
        time_remaining_seconds: countdown.total_seconds,
        time_remaining_formatted: countdown.formatted,
        is_expired: countdown.is_expired
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error calculating countdown:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

