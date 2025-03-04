
import { supabase } from '@/integrations/supabase/client';
import { ContentItem, FeedOptions } from './types';
import { fetchContentByType } from './contentTypeFetcher';
import { fetchLiveTwitchStreams } from './twitchStreamsFetcher';

export async function fetchFeedContent(
  pageParam: number,
  { filter = 'all', limit = 10, includeStreams = false, searchTerm = '' }: FeedOptions
): Promise<ContentItem[]> {
  console.log('Fetching explore feed:', { filter, pageParam, limit, includeStreams, searchTerm });
  
  try {
    // Each content type has its own table, so we need to fetch from multiple sources
    // and combine the results based on the filter
    let allContent: ContentItem[] = [];
    
    // Get current user for personalization
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    
    // Determine which tables to query based on filter
    let contentSources = filter === 'all' ? 
      ['explore_content', 'vehicles', 'auctions', 'live_streams'] : 
      filter === 'vehicle' ? ['vehicles'] :
      filter === 'auction' ? ['auctions'] :
      filter === 'event' ? ['live_streams'] :
      filter === 'garage' ? ['garages'] :
      filter === 'article' ? ['explore_content'] : 
      ['explore_content']; // Default to posts
      
    // If including streams specifically, ensure live_streams is in the sources
    if (includeStreams && !contentSources.includes('live_streams')) {
      contentSources.push('live_streams');
    }
      
    // Query each content source
    for (const source of contentSources) {
      const { data: sourceData, error: sourceError } = await fetchContentByType(
        source,
        pageParam,
        limit,
        userId,
        searchTerm
      );
      
      if (sourceError) {
        console.error(`Error fetching ${source}:`, sourceError);
        continue; // Skip this source but continue with others
      }
      
      if (sourceData && sourceData.length > 0) {
        allContent = [...allContent, ...sourceData];
      }
    }
    
    // If including streams is enabled, fetch live Twitch streams
    if (includeStreams) {
      try {
        const twitchStreams = await fetchLiveTwitchStreams(searchTerm);
        if (twitchStreams && twitchStreams.length > 0) {
          allContent = [...allContent, ...twitchStreams];
        }
      } catch (err) {
        console.error('Error fetching Twitch streams:', err);
        // Continue with other content even if Twitch fails
      }
    }
    
    // Sort combined content by relevance_score and created_at
    allContent.sort((a, b) => {
      // First by relevance score (descending)
      if (b.relevance_score !== a.relevance_score) {
        return b.relevance_score - a.relevance_score;
      }
      // Then by date (newest first)
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    
    console.log('Combined feed data:', allContent.length);
    return allContent;
  } catch (err) {
    console.error('Error in content fetching:', err);
    throw err;
  }
}
