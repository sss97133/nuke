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
  
  // If no claimed identities, return empty arrays but still return profile
  // This allows users to see their profile even if they haven't claimed identities yet

  // Get listings (BaT listings where user is seller)
  const { data: listings } = identityIds.length > 0 ? await supabase
    .from('bat_listings')
    .select(`
      *,
      vehicle:vehicles(*),
      seller_identity:external_identities!bat_listings_seller_external_identity_id_fkey(*)
    `)
    .in('seller_external_identity_id', identityIds)
    .order('auction_end_date', { ascending: false })
    .limit(100) : { data: [] };

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

  const { data: batBids } = identityIds.length > 0 ? await supabase
    .from('bat_listings')
    .select(`
      *,
      vehicle:vehicles(*),
      buyer_identity:external_identities!bat_listings_buyer_external_identity_id_fkey(*)
    `)
    .in('buyer_external_identity_id', identityIds)
    .order('auction_end_date', { ascending: false })
    .limit(100) : { data: [] };

  // Get comments (BaT comments + auction comments) - EXCLUDE bids
  const { data: batComments } = identityIds.length > 0 ? await supabase
    .from('bat_comments')
    .select(`
      *,
      listing:bat_listings(*, vehicle:vehicles(*))
    `)
    .in('external_identity_id', identityIds)
    .or('contains_bid.is.null,contains_bid.eq.false')
    .order('comment_timestamp', { ascending: false })
    .limit(100) : { data: [] };

  const { data: auctionComments } = identityIds.length > 0 ? await supabase
    .from('auction_comments')
    .select(`
      *,
      auction:auction_events(*, vehicle:vehicles(*))
    `)
    .in('external_identity_id', identityIds)
    .is('bid_amount', null)
    .order('posted_at', { ascending: false })
    .limit(100) : { data: [] };

  // Get auction wins
  const { data: auctionWins } = identityIds.length > 0 ? await supabase
    .from('bat_listings')
    .select(`
      *,
      vehicle:vehicles(*)
    `)
    .in('buyer_external_identity_id', identityIds)
    .eq('listing_status', 'sold')
    .order('auction_end_date', { ascending: false })
    .limit(50) : { data: [] };

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
  const { data: commentsOfNote } = identityIds.length > 0 ? await supabase
    .from('bat_comments')
    .select(`
      *,
      listing:bat_listings(*, vehicle:vehicles(*))
    `)
    .in('external_identity_id', identityIds)
    .gt('likes_count', 5)
    .order('likes_count', { ascending: false })
    .limit(20) : { data: [] };

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
 * Get public profile data by external identity (for unclaimed BaT users)
 * Shows their activity even if they haven't claimed their identity yet
 */
export async function getPublicProfileByExternalIdentity(externalIdentityId: string): Promise<UserProfileData | null> {
  // Get the external identity
  const { data: externalIdentity, error: identityError } = await supabase
    .from('external_identities')
    .select('id, platform, handle, profile_url, display_name, claimed_by_user_id, first_seen_at, created_at')
    .eq('id', externalIdentityId)
    .single();

  if (identityError || !externalIdentity) return null;

  // If it's claimed, redirect to regular profile
  if (externalIdentity.claimed_by_user_id) {
    return getUserProfileData(externalIdentity.claimed_by_user_id);
  }

  // Create a synthetic profile for display
  const syntheticProfile = {
    id: `external-${externalIdentity.id}`,
    username: externalIdentity.handle,
    full_name: externalIdentity.display_name || externalIdentity.handle,
    avatar_url: null,
    bio: null,
    location: null,
    created_at: externalIdentity.first_seen_at || new Date().toISOString(),
  };

  const identityIds = [externalIdentity.id];

  // Get listings where this identity is seller
  const { data: listings } = await supabase
    .from('bat_listings')
    .select(`
      *,
      vehicle:vehicles(*),
      seller_identity:external_identities!bat_listings_seller_external_identity_id_fkey(*)
    `)
    .eq('seller_external_identity_id', externalIdentity.id)
    .order('auction_end_date', { ascending: false })
    .limit(100);

  // Get listings where this identity is buyer
  const { data: batBids } = await supabase
    .from('bat_listings')
    .select(`
      *,
      vehicle:vehicles(*),
      buyer_identity:external_identities!bat_listings_buyer_external_identity_id_fkey(*)
    `)
    .eq('buyer_external_identity_id', externalIdentity.id)
    .order('auction_end_date', { ascending: false })
    .limit(100);

  // Get comments - EXCLUDE bids
  const { data: batComments } = await supabase
    .from('bat_comments')
    .select(`
      *,
      listing:bat_listings(*, vehicle:vehicles(*))
    `)
    .eq('external_identity_id', externalIdentity.id)
    .or('contains_bid.is.null,contains_bid.eq.false')
    .order('comment_timestamp', { ascending: false })
    .limit(100);

  const { data: auctionComments } = await supabase
    .from('auction_comments')
    .select(`
      *,
      auction:auction_events(*, vehicle:vehicles(*))
    `)
    .eq('external_identity_id', externalIdentity.id)
    .is('bid_amount', null)
    .order('posted_at', { ascending: false })
    .limit(100);

  // Get auction wins
  const { data: auctionWins } = await supabase
    .from('bat_listings')
    .select(`
      *,
      vehicle:vehicles(*)
    `)
    .eq('buyer_external_identity_id', externalIdentity.id)
    .eq('listing_status', 'sold')
    .order('auction_end_date', { ascending: false })
    .limit(50);

  // Calculate stats
  const stats: ProfileStats = {
    total_listings: listings?.length || 0,
    total_bids: batBids?.length || 0,
    total_comments: (batComments?.length || 0) + (auctionComments?.length || 0),
    total_auction_wins: auctionWins?.length || 0,
    total_success_stories: 0,
    member_since: externalIdentity.first_seen_at || externalIdentity.created_at,
  };

  return {
    profile: syntheticProfile,
    stats,
    listings: listings || [],
    bids: batBids || [],
    comments: [...(batComments || []), ...(auctionComments || [])],
    auction_wins: auctionWins || [],
    success_stories: [],
    comments_of_note: [],
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

  // auction_events doesn't have organization_id - need to join through vehicles
  // First get vehicle IDs for this organization
  const { data: orgVehicles } = await supabase
    .from('organization_vehicles')
    .select('vehicle_id')
    .eq('organization_id', orgId)
    .eq('status', 'active');
  
  const vehicleIds = orgVehicles?.map(ov => ov.vehicle_id).filter(Boolean) || [];

  const chunk = <T,>(arr: T[], size: number): T[][] => {
    if (size <= 0) return [arr];
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  // PostgREST encodes `.in()` as a URL query like `vehicle_id=in.(...)`.
  // Large org inventories can exceed URL limits and return 400. Chunk to keep requests small.
  const auctionListings: any[] = [];
  if (vehicleIds.length > 0) {
    const chunks = chunk(vehicleIds, 50);
    const results = await Promise.allSettled(
      chunks.map((ids) =>
        supabase
          .from('auction_events')
          .select(`
            *,
            vehicle:vehicles(*)
          `)
          .in('vehicle_id', ids)
          .order('auction_end_at', { ascending: false })
          .limit(100)
      )
    );

    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      if (r.value.error) continue;
      for (const row of r.value.data || []) auctionListings.push(row);
    }

    auctionListings.sort((a: any, b: any) => {
      const at = a?.auction_end_at ? new Date(a.auction_end_at).getTime() : 0;
      const bt = b?.auction_end_at ? new Date(b.auction_end_at).getTime() : 0;
      return bt - at;
    });
    auctionListings.splice(100);
  }

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

  // Get website mapping (use maybeSingle to handle missing rows gracefully)
  const { data: websiteMapping } = await supabase
    .from('organization_website_mappings')
    .select('*')
    .eq('organization_id', orgId)
    .maybeSingle();

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
    listings: [...(batListings || []), ...auctionListings],
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

