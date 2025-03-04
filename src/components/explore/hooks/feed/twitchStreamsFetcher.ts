
import { TwitchStreamData } from "@/components/streaming/services/types";
import twitchService from "@/components/streaming/services/TwitchService";
import { ContentItem } from "./types";

export async function fetchLiveTwitchStreams(searchTerm = ''): Promise<ContentItem[]> {
  try {
    // If not authenticated with Twitch, we can't fetch streams
    if (!twitchService.isAuthenticated()) {
      console.log('Not authenticated with Twitch, skipping stream fetch');
      return [];
    }
    
    // Get live streams from Twitch API
    const streams = await twitchService.getLiveStreams(searchTerm);
    
    if (!streams || streams.length === 0) {
      return [];
    }
    
    // Transform Twitch streams to ContentItem format
    return streams.map(stream => transformTwitchStreamToContentItem(stream));
  } catch (error) {
    console.error('Error fetching Twitch streams:', error);
    return [];
  }
}

function transformTwitchStreamToContentItem(stream: TwitchStreamData): ContentItem {
  return {
    id: stream.id,
    type: 'stream',
    title: stream.title || 'Live Stream',
    subtitle: `${stream.user_name} - ${stream.viewer_count} viewers`,
    image_url: stream.thumbnail_url?.replace('{width}', '440').replace('{height}', '248') || 
             'https://via.placeholder.com/440x248?text=Live+Stream',
    tags: ['Live', 'Stream', stream.game_name || 'Gaming'].filter(Boolean),
    reason: 'Live now',
    location: 'Twitch',
    relevance_score: 95, // High relevance for live content
    created_at: stream.started_at || new Date().toISOString(),
    creator_id: stream.user_id,
    creator_name: stream.user_name,
    creator_avatar: '', // Twitch API doesn't provide this directly
    view_count: stream.viewer_count,
    like_count: 0,
    share_count: 0,
    save_count: 0,
    stream_url: `https://twitch.tv/${stream.user_login}`
  };
}
