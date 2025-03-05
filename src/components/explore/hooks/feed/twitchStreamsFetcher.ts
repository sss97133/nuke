
// This file should be updated to use the correct TwitchService method for getting streams

import { ContentType } from '../../../streaming/services/types';
import twitchService from '../../../streaming/services/TwitchService';

/**
 * Fetches currently live Twitch streams
 * @returns Promise with array of content items
 */
export const fetchTwitchStreams = async () => {
  try {
    const streams = await twitchService.getStreams();
    
    // Transform the streams into the content format
    return streams.map(stream => ({
      id: stream.id,
      title: stream.title,
      description: `Playing ${stream.game_name} with ${stream.viewer_count} viewers`,
      image: stream.thumbnail_url.replace('{width}', '440').replace('{height}', '248'),
      url: `https://twitch.tv/${stream.user_login}`,
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
