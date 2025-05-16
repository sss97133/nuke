
import { ContentItem } from "./types";

export function transformContentToFeedItem(item: any, type: string): ContentItem {
  switch (type) {
    case 'explore_content':
      return {
        id: item.id,
        type: 'article',
        title: item.title,
        subtitle: item.subtitle || '',
        image_url: item.image_url,
        tags: item.tags || [],
        reason: 'Based on your interests',
        location: item.location || 'Unknown',
        relevance_score: item.relevance_score || 50,
        created_at: item.created_at,
        creator_id: item.user_id,
        creator_name: item.profiles?.full_name,
        creator_avatar: item.profiles?.avatar_url,
        view_count: 0,
        like_count: 0,
        share_count: 0,
        save_count: 0
      };
      
    case 'vehicles':
      return {
        id: item.id,
        type: 'vehicle',
        title: `${item.year} ${item.make} ${item.model}`,
        subtitle: item.vin || '',
        image_url: item.vin_image_url,
        tags: ['Vehicle', item.make, item.model],
        reason: 'Vehicle in your network',
        location: item.location ? JSON.stringify(item.location) : 'Unknown',
        relevance_score: 50,
        created_at: item.created_at,
        creator_id: item.user_id,
        creator_name: item.profiles?.full_name,
        creator_avatar: item.profiles?.avatar_url,
        view_count: 0,
        like_count: 0,
        share_count: 0,
        save_count: 0
      };
      
    case 'auctions':
      return {
        id: item.id,
        type: 'auction',
        title: `${item.vehicles?.year} ${item.vehicles?.make} ${item.vehicles?.model}`,
        subtitle: `Starting at $${item.starting_price}`,
        image_url: item.vehicles?.vin_image_url,
        tags: ['Auction', item.vehicles?.make, item.vehicles?.model],
        reason: 'Active auction ending soon',
        location: 'Online Auction',
        relevance_score: 70, // Auctions get higher relevance
        created_at: item.created_at,
        creator_id: item.seller_id,
        creator_name: item.profiles?.full_name,
        creator_avatar: item.profiles?.avatar_url,
        view_count: 0,
        like_count: 0,
        share_count: 0,
        save_count: 0
      };
      
    case 'live_streams':
      return {
        id: item.id,
        type: 'event',
        title: item.title,
        subtitle: `Live now with ${item.viewer_count} viewers`,
        image_url: item.thumbnail_url || 'https://via.placeholder.com/600x400?text=Live+Stream',
        tags: ['Live', 'Stream', 'Event'],
        reason: 'Live now',
        location: 'Live Stream',
        relevance_score: 90, // Live streams get highest relevance
        created_at: item.created_at,
        creator_id: item.user_id,
        creator_name: item.profiles?.full_name,
        creator_avatar: item.profiles?.avatar_url,
        view_count: item.viewer_count || 0,
        like_count: 0,
        share_count: 0,
        save_count: 0
      };
      
    default:
      return {
        id: item.id,
        type: 'article',
        title: item.title || 'Unknown content',
        subtitle: item.subtitle || '',
        image_url: item.image_url || 'https://via.placeholder.com/600x400?text=Content',
        tags: item.tags || [],
        reason: 'Recommended content',
        location: item.location || 'Unknown',
        relevance_score: item.relevance_score || 50,
        created_at: item.created_at
      };
  }
}
