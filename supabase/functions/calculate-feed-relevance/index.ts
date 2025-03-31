import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FeedItem {
  id: string;
  type: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface UserPreferences {
  interests: string[];
  location: {
    latitude: number;
    longitude: number;
  };
}

interface RequestEvent {
  request: Request;
  method: string;
  json(): Promise<{ 
    feedItems: FeedItem[],
    userPreferences: UserPreferences 
  }>;
}

serve(async (req: RequestEvent) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { feedItems, userPreferences } = await req.json() as { 
      feedItems: FeedItem[],
      userPreferences: UserPreferences 
    };

    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    // Calculate relevance scores for feed items
    const scoredItems = await calculateRelevanceScores(feedItems, userPreferences);

    return new Response(
      JSON.stringify({ items: scoredItems }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});

async function calculateRelevanceScores(
  items: FeedItem[],
  preferences: UserPreferences
): Promise<Array<FeedItem & { relevance_score: number }>> {
  return items.map(item => {
    // Implement relevance calculation logic here
    // This is a placeholder implementation
    const interestMatch = preferences.interests.some(interest => 
      item.content.toLowerCase().includes(interest.toLowerCase())
    );
    
    const timeRelevance = calculateTimeRelevance(item.created_at);
    
    const relevanceScore = (interestMatch ? 0.6 : 0.2) + timeRelevance;

    return {
      ...item,
      relevance_score: relevanceScore
    };
  });
}

function calculateTimeRelevance(createdAt: string): number {
  const now = new Date();
  const created = new Date(createdAt);
  const hoursDiff = (now.getTime() - created.getTime()) / (1000 * 60 * 60);
  
  // Items newer than 24 hours get higher scores
  if (hoursDiff < 24) {
    return 0.4;
  } else if (hoursDiff < 48) {
    return 0.3;
  } else if (hoursDiff < 72) {
    return 0.2;
  }
  return 0.1;
}
