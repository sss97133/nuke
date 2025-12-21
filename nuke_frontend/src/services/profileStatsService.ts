/**
 * Profile Stats Service
 * Aggregates BaT-style stats for users and organizations
 */

import { supabase } from '../lib/supabase';

export interface ProfileStats {
  total_listings: number;
  total_bids: number;
  total_comments: number;
  total_auction_wins: number;
  total_success_stories: number;
  member_since: string | null;
}

export interface UserProfileData {
  profile: any;
  stats: ProfileStats;
  listings: any[];
  bids: any[];
  comments: any[];
  auction_wins: any[];
  success_stories: any[];
  comments_of_note: any[];
}

export interface OrganizationProfileData {
  organization: any;
  stats: ProfileStats;
  listings: any[];
  bids: any[];
  comments: any[];
  auction_wins: any[];
  success_stories: any[];
  services: any[];
  website_mapping: any | null;
}

/**
 * Get comprehensive user profile data (BaT-style)
 */
export async function getUserProfileData(userId: string): Promise<UserProfileData> {
  // Get profile with stats
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (profileError) throw profileError;

  // Get external identities for this user
  const { data: externalIdentities } = await supabase
    .from('external_identities')
    .select('id, platform, handle')
    .eq('claimed_by_user_id', userId);

  const identityIds = externalIdentities?.map(ei => ei.id) || [];

  // Get listings (BaT listings where user is seller)
  const { data: listings } = await supabase
    .from('bat_listings')
    .select(`
      *,
      vehicle:vehicles(*),
      seller_identity:external_identities!bat_listings_seller_external_identity_id_fkey(*)
    `)
    .in('seller_external_identity_id', identityIds)
    .order('auction_end_date', { ascending: false })
    .limit(100);

  // Get bids (auction bids + BaT listings where user is buyer)
  const { data: userBids } = await supabase
    .from('auction_bids')
    .select(`
      *,
      auction:auction_events(*, vehicle:vehicles(*))
    `)
    .eq('bidder_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);

  const { data: batBids } = await supabase
    .from('bat_listings')
    .select(`
      *,
      vehicle:vehicles(*),
      buyer_identity:external_identities!bat_listings_buyer_external_identity_id_fkey(*)
    `)
    .in('buyer_external_identity_id', identityIds)
    .order('auction_end_date', { ascending: false })
    .limit(100);

  // Get comments (BaT comments + auction comments)
  const { data: batComments } = await supabase
    .from('bat_comments')
    .select(`
      *,
      listing:bat_listings(*, vehicle:vehicles(*))
    `)
    .in('external_identity_id', identityIds)
    .order('comment_timestamp', { ascending: false })
    .limit(100);

  const { data: auctionComments } = await supabase
    .from('auction_comments')
    .select(`
      *,
      auction:auction_events(*, vehicle:vehicles(*))
    `)
    .in('external_identity_id', identityIds)
    .order('posted_at', { ascending: false })
    .limit(100);

  // Get auction wins
  const { data: auctionWins } = await supabase
    .from('bat_listings')
    .select(`
      *,
      vehicle:vehicles(*)
    `)
    .in('buyer_external_identity_id', identityIds)
    .eq('listing_status', 'sold')
    .order('auction_end_date', { ascending: false })
    .limit(50);

  // Get success stories
  const { data: successStories } = await supabase
    .from('success_stories')
    .select(`
      *,
      vehicle:vehicles(*)
    `)
    .eq('user_id', userId)
    .order('story_date', { ascending: false })
    .limit(20);

  // Get comments of note (highly liked/engaged comments)
  const { data: commentsOfNote } = await supabase
    .from('bat_comments')
    .select(`
      *,
      listing:bat_listings(*, vehicle:vehicles(*))
    `)
    .in('external_identity_id', identityIds)
    .gt('likes_count', 5)
    .order('likes_count', { ascending: false })
    .limit(20);

  // Calculate stats
  const stats: ProfileStats = {
    total_listings: profile.total_listings || (listings?.length || 0),
    total_bids: profile.total_bids || ((userBids?.length || 0) + (batBids?.length || 0)),
    total_comments: profile.total_comments || ((batComments?.length || 0) + (auctionComments?.length || 0)),
    total_auction_wins: profile.total_auction_wins || (auctionWins?.length || 0),
    total_success_stories: profile.total_success_stories || (successStories?.length || 0),
    member_since: profile.member_since || profile.created_at,
  };

  return {
    profile,
    stats,
    listings: listings || [],
    bids: [...(userBids || []), ...(batBids || [])],
    comments: [...(batComments || []), ...(auctionComments || [])],
    auction_wins: auctionWins || [],
    success_stories: successStories || [],
    comments_of_note: commentsOfNote || [],
  };
}

/**
 * Get comprehensive organization profile data (BaT-style)
 */
export async function getOrganizationProfileData(orgId: string): Promise<OrganizationProfileData> {
  // Get organization with stats
  const { data: organization, error: orgError } = await supabase
    .from('businesses')
    .select('*')
    .eq('id', orgId)
    .single();

  if (orgError) throw orgError;

  // Get listings (BaT listings + auction events)
  const { data: batListings } = await supabase
    .from('bat_listings')
    .select(`
      *,
      vehicle:vehicles(*)
    `)
    .eq('organization_id', orgId)
    .order('auction_end_date', { ascending: false })
    .limit(100);

  const { data: auctionListings } = await supabase
    .from('auction_events')
    .select(`
      *,
      vehicle:vehicles(*)
    `)
    .eq('organization_id', orgId)
    .order('auction_end_time', { ascending: false })
    .limit(100);

  // Get bids (from organization members)
  const { data: orgContributors } = await supabase
    .from('organization_contributors')
    .select('user_id')
    .eq('organization_id', orgId)
    .eq('status', 'active');

  const contributorIds = orgContributors?.map(oc => oc.user_id) || [];

  const { data: bids } = contributorIds.length > 0 ? await supabase
    .from('auction_bids')
    .select(`
      *,
      auction:auction_events(*, vehicle:vehicles(*)),
      bidder:profiles(*)
    `)
    .in('bidder_id', contributorIds)
    .order('created_at', { ascending: false })
    .limit(100) : { data: [] };

  // Get comments (from organization members)
  let comments: any[] = [];
  if (contributorIds.length > 0) {
    // Get external identity IDs for contributors
    const { data: externalIdentities } = await supabase
      .from('external_identities')
      .select('id')
      .in('claimed_by_user_id', contributorIds);
    
    const identityIds = externalIdentities?.map(ei => ei.id) || [];
    
    if (identityIds.length > 0) {
      const { data: batComments } = await supabase
        .from('bat_comments')
        .select(`
          *,
          listing:bat_listings(*, vehicle:vehicles(*))
        `)
        .in('external_identity_id', identityIds)
        .order('comment_timestamp', { ascending: false })
        .limit(100);
      
      comments = batComments || [];
    }
  }

  // Get auction wins
  const { data: auctionWins } = await supabase
    .from('bat_listings')
    .select(`
      *,
      vehicle:vehicles(*)
    `)
    .eq('organization_id', orgId)
    .eq('listing_status', 'sold')
    .order('auction_end_date', { ascending: false })
    .limit(50);

  // Get success stories
  const { data: successStories } = await supabase
    .from('success_stories')
    .select(`
      *,
      vehicle:vehicles(*)
    `)
    .eq('organization_id', orgId)
    .order('story_date', { ascending: false })
    .limit(20);

  // Get services
  const { data: services } = await supabase
    .from('organization_services')
    .select('*')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('service_name', { ascending: true });

  // Get website mapping
  const { data: websiteMapping } = await supabase
    .from('organization_website_mappings')
    .select('*')
    .eq('organization_id', orgId)
    .single();

  // Calculate stats
  const stats: ProfileStats = {
    total_listings: organization.total_listings || ((batListings?.length || 0) + (auctionListings?.length || 0)),
    total_bids: organization.total_bids || (bids?.length || 0),
    total_comments: organization.total_comments || (comments?.length || 0),
    total_auction_wins: organization.total_auction_wins || (auctionWins?.length || 0),
    total_success_stories: organization.total_success_stories || (successStories?.length || 0),
    member_since: organization.member_since || organization.created_at,
  };

  return {
    organization,
    stats,
    listings: [...(batListings || []), ...(auctionListings || [])],
    bids: bids || [],
    comments: comments || [],
    auction_wins: auctionWins || [],
    success_stories: successStories || [],
    services: services || [],
    website_mapping: websiteMapping || null,
  };
}

/**
 * Update user profile stats (call after activity changes)
 */
export async function updateUserProfileStats(userId: string): Promise<void> {
  const { error } = await supabase.rpc('update_user_profile_stats', {
    p_user_id: userId,
  });
  if (error) throw error;
}

/**
 * Update organization profile stats (call after activity changes)
 */
export async function updateOrganizationProfileStats(orgId: string): Promise<void> {
  const { error } = await supabase.rpc('update_organization_profile_stats', {
    p_org_id: orgId,
  });
  if (error) throw error;
}

