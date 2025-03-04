
import { supabase } from '@/integrations/supabase/client';
import { ContentItem } from './types';

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
      
      return await vehiclesQuery.range(from, to);
        
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
        .eq('status', 'active')
        .order('end_time', { ascending: true });
        
      // Apply search if provided
      if (searchTerm) {
        auctionsQuery = auctionsQuery.or(searchFilter);
      }
      
      return await auctionsQuery.range(from, to);
        
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
        .eq('status', 'live')
        .order('viewer_count', { ascending: false });
        
      // Apply search if provided
      if (searchTerm) {
        streamsQuery = streamsQuery.or(searchFilter);
      }
      
      return await streamsQuery.range(from, to);
        
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
      
      return await garagesQuery.range(from, to);
        
    // Add more content types as needed
        
    default:
      return { data: [], error: null };
  }
}
