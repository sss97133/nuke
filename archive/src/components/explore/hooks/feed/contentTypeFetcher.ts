import type { Database } from '@/types/database';
import { supabase } from '@/integrations/supabase/client';
import { ContentItem } from './types';

const AUCTION_STATUS = {
  ACTIVE: 'active',
  ENDED: 'ended',
  CANCELLED: 'cancelled'
} as const;

const STREAM_STATUS = {
  LIVE: 'live',
  ENDED: 'ended',
  SCHEDULED: 'scheduled'
} as const;

type AuctionStatus = typeof AUCTION_STATUS[keyof typeof AUCTION_STATUS];
type StreamStatus = typeof STREAM_STATUS[keyof typeof STREAM_STATUS];

export async function fetchContentByType(
  contentType: string, 
  pageParam: number, 
  limit: number,
  userId?: string,
  searchTerm: string = ''
) {
  const from = pageParam * limit;
  const to = from + limit - 1;
  
  // For search functionality
  const searchFilter = searchTerm ? 
    contentType === 'explore_content' ? `title.ilike.%${searchTerm}%,subtitle.ilike.%${searchTerm}%` : 
    contentType === 'vehicles' ? `make.ilike.%${searchTerm}%,model.ilike.%${searchTerm}%` :
    contentType === 'auctions' ? `title.ilike.%${searchTerm}%` :
    contentType === 'live_streams' ? `title.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%` :
    contentType === 'garages' ? `name.ilike.%${searchTerm}%` : 
    '' : '';
  
  // Different queries for different content types
  switch (contentType) {
    case 'explore_content':
      let query = supabase
        .from('explore_content')
        .select(`
          id,
          title,
          subtitle,
          content,
          image_url,
          tags,
          location,
          created_at,
          user_id,
          profiles(full_name, avatar_url)
        `)
        .order('created_at', { ascending: false });
        
      // Apply search if provided
      if (searchTerm) {
        query = query.or(searchFilter);
      }
      
      return await query.range(from, to);
        
    case 'vehicles':
      let vehiclesQuery = supabase
        .from('vehicles')
        .select(`
          id,
          make,
          model,
          year,
          vin_image_url,
          location,
          created_at,
          user_id,
          profiles(full_name, avatar_url)
        `)
        .order('created_at', { ascending: false });
        
      // Apply search if provided
      if (searchTerm) {
        vehiclesQuery = vehiclesQuery.or(searchFilter);
      }
      
      const { data: vehiclesData, error: vehiclesError } = await vehiclesQuery.range(from, to);
      if (vehiclesError) {
        console.error('Error fetching vehicles:', vehiclesError);
        return { data: [], error: vehiclesError };
      }
      return { data: vehiclesData, error: null };
        
    case 'auctions':
      let auctionsQuery = supabase
        .from('auctions')
        .select(`
          id,
          vehicle_id,
          starting_price,
          current_price,
          end_time,
          created_at,
          seller_id,
          profiles!seller_id(full_name, avatar_url),
          vehicles!vehicle_id(make, model, year, vin_image_url)
        `)
        .eq('status', AUCTION_STATUS.ACTIVE)
        .order('end_time', { ascending: true });
        
      // Apply search if provided
      if (searchTerm) {
        auctionsQuery = auctionsQuery.or(searchFilter);
      }
      
      const { data: auctionsData, error: auctionsError } = await auctionsQuery.range(from, to);
      if (auctionsError) {
        console.error('Error fetching auctions:', auctionsError);
        return { data: [], error: auctionsError };
      }
      return { data: auctionsData, error: null };
        
    case 'live_streams':
      let streamsQuery = supabase
        .from('live_streams')
        .select(`
          id,
          title,
          description,
          stream_url,
          thumbnail_url,
          viewer_count,
          created_at,
          user_id,
          profiles(full_name, avatar_url)
        `)
        .eq('status', STREAM_STATUS.LIVE)
        .order('viewer_count', { ascending: false });
        
      // Apply search if provided
      if (searchTerm) {
        streamsQuery = streamsQuery.or(searchFilter);
      }
      
      const { data: streamsData, error: streamsError } = await streamsQuery.range(from, to);
      if (streamsError) {
        console.error('Error fetching streams:', streamsError);
        return { data: [], error: streamsError };
      }
      return { data: streamsData, error: null };
        
    case 'garages':
      let garagesQuery = supabase
        .from('garages')
        .select(`
          id,
          name,
          address,
          contact_info,
          rating,
          created_at
        `)
        .order('rating', { ascending: false });
        
      // Apply search if provided
      if (searchTerm) {
        garagesQuery = garagesQuery.or(searchFilter);
      }
      
      const { data: garagesData, error: garagesError } = await garagesQuery.range(from, to);
      if (garagesError) {
        console.error('Error fetching garages:', garagesError);
        return { data: [], error: garagesError };
      }
      return { data: garagesData, error: null };
        
    // Add more content types as needed
        
    default:
      return { data: [], error: null };
  }
}
