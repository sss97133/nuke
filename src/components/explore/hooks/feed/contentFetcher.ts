import { supabase } from '@/integrations/supabase/client';
import { ContentItem, FeedOptions } from './types';
import { fetchContentByType } from './contentTypeFetcher';
import { fetchLiveTwitchStreams } from './twitchStreamsFetcher';

// Also export ContentItem directly if needed elsewhere
// export type { ContentItem };

export async function fetchFeedContent(
  pageParam: number,
  { filter = 'all', limit = 10, includeStreams = false, searchTerm = '' }: FeedOptions
): Promise<any[]> {
  console.log('Fetching explore feed:', { filter, pageParam, limit, includeStreams, searchTerm });
  
  try {
    // Handle fallback for empty content
    const mockContent: any[] = [];
    
    // Each content type has its own table, so we need to fetch from multiple sources
    // and combine the results based on the filter
    let allContent: any[] = [];
    
    // Get current user for personalization
    const { data: userData, error: authError } = await supabase.auth.getUser();
    
    if (authError) {
      console.error("Authentication error:", authError);
      return generateFallbackContent();
    }
    
    const userId = userData?.user?.id;
    
    // Determine which tables to query based on filter
    const contentSources = filter === 'all' ? 
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
        // Revert: Simply spread the data without assertion
        allContent = [...allContent, ...sourceData];
      }
    }
    
    // If including streams is enabled, fetch live Twitch streams
    if (includeStreams) {
      try {
        const twitchStreams = await fetchLiveTwitchStreams(searchTerm);
        
        if (twitchStreams && twitchStreams.length > 0) {
          // Convert Twitch streams to ContentItem format
          const formattedStreams: any[] = twitchStreams.map(stream => ({
            id: stream.id,
            type: 'stream',
            title: stream.title,
            subtitle: stream.description || '',
            image_url: stream.image || '',
            tags: stream.tags || [],
            reason: 'Live now',
            location: 'Online',
            relevance_score: 100,
            created_at: stream.published || new Date().toISOString(),
            creator_name: stream.author?.name || '',
            view_count: stream.views || 0,
            url: stream.url || '',
            stream_url: stream.url || ''
          }));
          
          allContent = [...allContent, ...formattedStreams];
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
    
    // Return mock data if no content is available
    if (allContent.length === 0) {
      // Generate fallback content
      for (let i = 1; i <= 6; i++) {
        mockContent.push({
          id: `mock-${i}`,
          type: i % 2 === 0 ? 'article' : 'vehicle',
          title: `Sample Content ${i}`,
          subtitle: 'This is placeholder content for demonstration',
          image_url: `https://source.unsplash.com/random/800x600?car=${i}`,
          tags: ['Sample', 'Demo'],
          reason: 'Suggested content',
          location: 'Online',
          relevance_score: 50,
          created_at: new Date().toISOString(),
          creator_name: 'Demo User',
          creator_avatar: '',
          view_count: Math.floor(Math.random() * 1000),
          like_count: Math.floor(Math.random() * 100),
          share_count: Math.floor(Math.random() * 50),
          save_count: Math.floor(Math.random() * 30)
        });
      }
      
      console.log('Returning mock content instead', mockContent.length);
      return mockContent;
    }
    
    return allContent;
  } catch (err) {
    console.error('Error in content fetching:', err);
    // Always return some content even on error
    return generateFallbackContent();
  }
}

// Helper function to generate fallback content
function generateFallbackContent(): any[] {
  const fallbackContent: any[] = [];
  
  for (let i = 1; i <= 6; i++) {
    fallbackContent.push({
      id: `fallback-${i}`,
      type: i % 2 === 0 ? 'article' : 'vehicle',
      title: `Fallback Content ${i}`,
      subtitle: 'This appears when content cannot be loaded',
      image_url: `https://source.unsplash.com/random/800x600?automotive=${i}`,
      tags: ['Fallback', 'Demo'],
      reason: 'Demo content',
      location: 'Not available',
      relevance_score: 10,
      created_at: new Date().toISOString(),
      creator_name: 'System',
      creator_avatar: '',
      view_count: Math.floor(Math.random() * 100),
      like_count: Math.floor(Math.random() * 20),
      share_count: Math.floor(Math.random() * 10),
      save_count: Math.floor(Math.random() * 5)
    });
  }
  
  return fallbackContent;
}
