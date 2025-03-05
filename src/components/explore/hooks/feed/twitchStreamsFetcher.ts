
// This file should be updated to use the correct TwitchService method for getting streams

import { ContentType } from '../../../streaming/services/types';
import twitchService from '../../../streaming/services/TwitchService';

/**
 * Fetches currently live Twitch streams
 * @returns Promise with array of content items
 */
export const fetchTwitchStreams = async (searchTerm?: string) => {
  try {
    const streams = await twitchService.getStreams();
    
    // Filter by search term if provided
    const filteredStreams = searchTerm 
      ? streams.filter(stream => 
          stream.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          stream.user_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          stream.game_name.toLowerCase().includes(searchTerm.toLowerCase())
        )
      : streams;
    
    // Transform the streams into the content format
    return filteredStreams.map(stream => ({
      id: stream.id,
      title: stream.title,
      description: `Playing ${stream.game_name} with ${stream.viewer_count} viewers`,
      image: stream.thumbnail_url.replace('{width}', '440').replace('{height}', '248'),
      url: `/streaming/watch/${stream.user_login}`,  // Link to in-app watch page instead of Twitch
      author: {
        name: stream.user_name,
        avatar: null
      },
      published: new Date(stream.started_at).toISOString(),
      type: 'stream' as ContentType,
      tags: stream.tags || [],
      likes: 0,
      comments: 0,
      views: stream.viewer_count
    }));
  } catch (error) {
    console.error('Error fetching Twitch streams:', error);
    return [];
  }
};

// Alias for backward compatibility
export const fetchLiveTwitchStreams = fetchTwitchStreams;
