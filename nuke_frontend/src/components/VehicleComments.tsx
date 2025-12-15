import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { ContentDetector } from '../services/contentDetector';
import UserReputationBadge from './UserReputationBadge';
import ExtractionQueueStatus from './ExtractionQueueStatus';

interface Comment {
  id: string;
  user_id: string;
  comment_text: string;
  created_at: string;
  target_type: string;
  target_label: string;
  user_email?: string;
  user_name?: string;
  avatar_url?: string;
  image_thumbnail?: string;
}

interface VehicleCommentsProps {
  vehicleId: string;
}

const VehicleComments: React.FC<VehicleCommentsProps> = ({ vehicleId }) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [scrapingStatus, setScrapingStatus] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);

  useEffect(() => {
    loadAllComments();
    // Get current user ID
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCurrentUserId(session?.user?.id || null);
    });
  }, [vehicleId]);

  const loadAllComments = async () => {
    setLoading(true);
    try {
      // Load comments from all sources for this vehicle without PostgREST joins
      const [vehicleComments, imageComments, eventComments, dataPointComments] = await Promise.all([
        supabase
          .from('vehicle_comments')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('created_at', { ascending: false }),

        supabase
          .from('vehicle_image_comments')
          .select('*, image:vehicle_images(thumbnail_url)')
          .eq('vehicle_id', vehicleId)
          .order('created_at', { ascending: false }),

        supabase
          .from('timeline_event_comments')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('created_at', { ascending: false }),

        supabase
          .from('data_point_comments')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('created_at', { ascending: false })
      ]);

      const allComments: Comment[] = [];

      // Process vehicle comments
      if (vehicleComments.data) {
        allComments.push(...vehicleComments.data.map(c => ({
          ...c,
          target_type: 'vehicle',
          target_label: 'General Comment',
          user_email: undefined,
          user_name: undefined,
          avatar_url: undefined
        })));
      }

      // Process image comments
      if (imageComments.data) {
        allComments.push(...imageComments.data.map((c: any) => ({
          ...c,
          target_type: 'image',
          target_label: 'Vehicle Image',
          image_thumbnail: c.image?.thumbnail_url,
          user_email: undefined,
          user_name: undefined,
          avatar_url: undefined
        })));
      }

      // Process event comments
      if (eventComments.data) {
        allComments.push(...eventComments.data.map(c => ({
          ...c,
          target_type: 'event',
          target_label: 'Timeline Event',
          user_email: undefined,
          user_name: undefined,
          avatar_url: undefined
        })));
      }

      // Process data point comments
      if (dataPointComments.data) {
        allComments.push(...dataPointComments.data.map(c => ({
          ...c,
          target_type: 'data_point',
          target_label: `${c.data_point_type?.charAt(0).toUpperCase() + c.data_point_type?.slice(1)}: ${c.data_point_value || 'N/A'}`,
          user_email: undefined,
          user_name: undefined,
          avatar_url: undefined
        })));
      }

      // Optionally enrich with usernames/avatars from profiles
      try {
        const uniqueUserIds = Array.from(new Set(allComments.map(c => c.user_id).filter(Boolean)));
        if (uniqueUserIds.length > 0) {
          const { data: profilesData, error: profilesError } = await supabase
            .from('profiles')
            .select('id, username, avatar_url')
            .in('id', uniqueUserIds as string[]);
          if (profilesError) {
            console.warn('Profiles enrichment blocked or unavailable:', profilesError.message);
          }
          const byId: Record<string, { username?: string; avatar_url?: string }> = {};
          (profilesData || []).forEach((p: any) => { byId[p.id] = { username: p.username, avatar_url: p.avatar_url }; });
          allComments.forEach(c => {
            const p = c.user_id ? byId[c.user_id] : undefined;
            if (p) {
              c.user_name = p.username || undefined;
              c.avatar_url = p.avatar_url || c.avatar_url;
            }
          });

          // Fallback: if current auth user is present, inject their username/email for their own comments
          const { data: authData } = await supabase.auth.getUser();
          const authUser = authData?.user;
          if (authUser) {
            const authUsername = (authUser.user_metadata as any)?.username || (authUser.email ? authUser.email.split('@')[0] : undefined);
            allComments.forEach(c => {
              if (c.user_id === authUser.id && !c.user_name) {
                c.user_name = authUsername || c.user_name;
              }
            });
          }
        }
      } catch (e) {
        // Ignore enrichment failure; comments still display
      }

      // Sort all comments by date
      allComments.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      
      setComments(allComments);
      
      // Self-healing: Check existing comments for BAT URLs
      await checkExistingCommentsForBATUrls(allComments);
    } catch (error) {
      console.error('Error loading comments:', error);
    } finally {
      setLoading(false);
    }
  };

  const getCommentTypeIcon = (type: string) => {
    switch (type) {
      case 'vehicle': return '🚗';
      case 'image': return 'IMG';
      case 'event': return '📅';
      case 'data_point': return '📊';
      default: return '💬';
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffMinutes < 1) {
      return 'Just now';
    } else if (diffMinutes < 60) {
      return `${diffMinutes}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays}d ago`;
    } else {
      return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
      });
    }
  };

  // Check if comment can be deleted (within 10 minute grace period)
  const canDeleteComment = (comment: Comment): boolean => {
    if (!currentUserId || comment.user_id !== currentUserId) {
      return false;
    }
    const commentDate = new Date(comment.created_at);
    const now = new Date();
    const diffMs = now.getTime() - commentDate.getTime();
    const diffMinutes = diffMs / (1000 * 60);
    return diffMinutes < 10; // 10 minute grace period
  };

  // Delete a comment
  const deleteComment = async (comment: Comment) => {
    if (!canDeleteComment(comment)) {
      console.error('Cannot delete comment: outside grace period or not owner');
      return;
    }

    setDeletingCommentId(comment.id);
    try {
      // Determine which table to delete from based on target_type
      let tableName: string;
      switch (comment.target_type) {
        case 'vehicle':
          tableName = 'vehicle_comments';
          break;
        case 'image':
          tableName = 'vehicle_image_comments';
          break;
        case 'event':
          tableName = 'timeline_event_comments';
          break;
        case 'data_point':
          tableName = 'data_point_comments';
          break;
        default:
          console.error('Unknown comment target_type:', comment.target_type);
          return;
      }

      const { error } = await supabase
        .from(tableName)
        .delete()
        .eq('id', comment.id)
        .eq('user_id', currentUserId); // Double-check ownership

      if (error) {
        console.error('Error deleting comment:', error);
        alert('Failed to delete comment. It may be outside the 10-minute grace period.');
        return;
      }

      // Reload comments
      loadAllComments();
    } catch (error) {
      console.error('Error deleting comment:', error);
      alert('Failed to delete comment');
    } finally {
      setDeletingCommentId(null);
    }
  };

  if (loading) {
    return (
      <div className="vehicle-section">
        <h3 className="section-title">Comments</h3>
        <div className="comments-loading">
          <div className="spinner"></div>
          <p className="text-muted">Loading comments...</p>
        </div>
      </div>
    );
  }

  // Detect BAT URLs in comment text
  const detectBATUrl = (text: string): string | null => {
    const batUrlRegex = /https?:\/\/(?:www\.)?bringatrailer\.com\/listing\/[^\s\)]+/gi;
    const match = text.match(batUrlRegex);
    const url = match ? match[0] : null;
    if (url) {
      console.log('[VehicleComments] BAT URL detected:', url);
    }
    return url;
  };

  // Self-healing: Check existing comments for BAT URLs and process them
  const checkExistingCommentsForBATUrls = async (comments: Comment[]) => {
    try {
      // Check if vehicle already has images (avoid redundant scraping)
      const { count: imageCount } = await supabase
        .from('vehicle_images')
        .select('*', { count: 'exact', head: true })
        .eq('vehicle_id', vehicleId);

      if (imageCount && imageCount > 0) {
        console.log('[VehicleComments] Vehicle already has images, skipping BAT URL processing');
        return;
      }

      // Find most recent comment with BAT URL from trusted user
      for (const comment of comments) {
        const batUrl = detectBATUrl(comment.comment_text);
        if (!batUrl) continue;

        console.log('[VehicleComments] Found BAT URL in existing comment:', {
          commentId: comment.id,
          userId: comment.user_id,
          batUrl
        });

        // Check if user is trusted (has contributor access or is owner)
        const { data: userProfile } = await supabase
          .from('profiles')
          .select('id, user_type')
          .eq('id', comment.user_id)
          .single();

        // Check organization affiliations
        const { data: orgLinks } = await supabase
          .from('organization_contributors')
          .select('organization_id, role')
          .eq('user_id', comment.user_id)
          .eq('status', 'active');

        const isTrustedUser = 
          userProfile?.user_type === 'dealer' || 
          userProfile?.user_type === 'organization' ||
          (orgLinks && orgLinks.length > 0);

        if (isTrustedUser) {
          console.log('[VehicleComments] Trusted user detected, processing BAT URL');
          // Process the BAT URL (async, don't block)
          processBATUrl(batUrl, comment.user_id).catch(err => {
            console.error('[VehicleComments] Error processing existing BAT URL:', err);
          });
          // Only process the first trusted BAT URL found
          break;
        } else {
          console.log('[VehicleComments] User not trusted, skipping BAT URL processing');
        }
      }
    } catch (error) {
      console.error('[VehicleComments] Error checking existing comments:', error);
    }
  };

  // Scrape BAT listing and save images/data
  const processBATUrl = async (batUrl: string, userId: string) => {
    console.log('[VehicleComments] processBATUrl called with:', { batUrl, userId, vehicleId });
    setScrapingStatus('Scraping BAT listing...');
    try {
      // Get vehicle data for VIN matching
      const { data: vehicle, error: vehicleError } = await supabase
        .from('vehicles')
        .select('vin, year, make, model')
        .eq('id', vehicleId)
        .single();

      if (vehicleError) {
        console.error('[VehicleComments] Error fetching vehicle:', vehicleError);
        throw new Error(`Failed to fetch vehicle: ${vehicleError.message}`);
      }

      console.log('[VehicleComments] Calling simple-scraper edge function with URL:', batUrl);
      // Scrape the BAT listing
      const { data: scrapeResult, error: scrapeError } = await supabase.functions.invoke('simple-scraper', {
        body: { url: batUrl }
      });

      console.log('[VehicleComments] Scrape result:', { scrapeResult, scrapeError });

      if (scrapeError) {
        console.error('[VehicleComments] Scrape error:', scrapeError);
        throw new Error(`Scrape error: ${scrapeError.message || JSON.stringify(scrapeError)}`);
      }

      if (!scrapeResult?.success) {
        console.error('[VehicleComments] Scrape failed:', scrapeResult);
        throw new Error(scrapeResult?.error || 'Failed to scrape BAT listing');
      }

      const scrapedData = scrapeResult.data;
      setScrapingStatus('Validating VIN match...');

      const sanitizeVin = (raw: any): string | null => {
        if (!raw) return null;
        const s = String(raw).trim();
        if (!s) return null;
        // Hard guard: reject garbage strings that match the char class but are not real VINs (must include digits).
        const cleaned = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (cleaned.length !== 17) return null;
        if (/[IOQ]/.test(cleaned)) return null;
        if (!/\d/.test(cleaned)) return null;
        return cleaned;
      };

      const vehicleVin = sanitizeVin(vehicle.vin);
      const scrapedVin = sanitizeVin(scrapedData?.vin);

      // VIN matching validation (appraiser brain) - STRICT: NO MIXING DATA
      let vinMatch = false;
      let shouldReject = false;
      let rejectionReason = '';
      
      if (vehicleVin && scrapedVin) {
        vinMatch = vehicleVin.toLowerCase() === scrapedVin.toLowerCase();
        if (!vinMatch) {
          shouldReject = true;
          rejectionReason = `VIN mismatch: vehicle has ${vehicleVin}, BAT listing has ${scrapedVin}`;
        }
      } else if (scrapedData.vin) {
        // Check if multiple VINs found in scraped data (ambiguous)
        const vinMatches = (String(scrapedData.vin || '').toUpperCase().match(/([A-HJ-NPR-Z0-9]{17})/gi) || [])
          .map((x) => sanitizeVin(x))
          .filter(Boolean) as string[];
        if (vinMatches.length > 1) {
          shouldReject = true;
          rejectionReason = `Multiple VINs found in listing: ${vinMatches.join(', ')} - ambiguous, cannot import`;
        } else {
          if (!scrapedVin) {
            shouldReject = true;
            rejectionReason = `Listing VIN is invalid (${String(scrapedData.vin || '').slice(0, 64)}). Not importing to prevent contaminating VIN field.`;
          } else if (!vehicleVin) {
            // If vehicle doesn't have VIN but scraped data does, update vehicle
            await supabase
              .from('vehicles')
              .update({ vin: scrapedVin })
              .eq('id', vehicleId);
            vinMatch = true;
          } else {
            // Vehicle VIN is invalid/unsane but present; treat as mismatch-risk and reject.
            shouldReject = true;
            rejectionReason = `Vehicle VIN is invalid (${String(vehicle.vin || '').slice(0, 64)}). Fix VIN first before importing listing data.`;
          }
        }
      } else if (vehicleVin && !scrapedData.vin) {
        // Vehicle has VIN but listing doesn't - can't verify, reject
        shouldReject = true;
        rejectionReason = 'Vehicle has VIN but BAT listing does not - cannot verify match';
      }
      
      // REJECT if VINs don't match - NEVER mix data
      if (shouldReject) {
        console.error('[VehicleComments] REJECTED BAT import:', rejectionReason);
        setScrapingStatus(`REJECTED: ${rejectionReason}. Data not imported to prevent mixing.`);
        setTimeout(() => setScrapingStatus(null), 10000);
        return; // STOP - don't import anything
      }

      // Calculate confidence score based on user metadata
      const confidenceScore = await calculateCommentConfidence(userId, vehicleId, batUrl);

      // CRITICAL: Only proceed if VIN matches - NEVER use confidence score to override VIN mismatch
      if (!vinMatch) {
        console.error('[VehicleComments] REJECTED: VIN mismatch prevents data import');
        setScrapingStatus(`REJECTED: VIN mismatch. Vehicle VIN (${vehicleVin || 'none'}) does not match BAT listing VIN (${scrapedVin || 'none'}). Data not imported to prevent mixing.`);
        setTimeout(() => setScrapingStatus(null), 10000);
        return; // STOP - don't import anything
      }

      setScrapingStatus('Saving and validating images...');

      // Save and validate ALL images from BAT listing (only if VIN matches)
      // AI validation will catch images that don't belong
      if (scrapedData.images && Array.isArray(scrapedData.images) && scrapedData.images.length > 0 && vinMatch) {
        // Save ALL images - validation happens synchronously during save
        await saveBATImages(scrapedData.images, batUrl, vinMatch, confidenceScore);
      }

      // Update vehicle data ONLY if VIN matches
      if (vinMatch) {
        const updates: any = {};
        
        // Update origin_metadata with seller/buyer chain
        if (scrapedData.seller || scrapedData.buyer) {
          const { data: currentVehicle } = await supabase
            .from('vehicles')
            .select('origin_metadata')
            .eq('id', vehicleId)
            .single();
          
          const currentMetadata = currentVehicle?.origin_metadata || {};
          updates.origin_metadata = {
            ...currentMetadata,
            ...(scrapedData.seller && { bat_seller: scrapedData.seller }),
            ...(scrapedData.buyer && { bat_buyer: scrapedData.buyer }),
            bat_scraped_at: new Date().toISOString()
          };
        }
        if (scrapedData.year && !vehicle.year) updates.year = scrapedData.year;
        if (scrapedData.make && !vehicle.make) updates.make = scrapedData.make;
        if (scrapedData.model && !vehicle.model) updates.model = scrapedData.model;
        if (scrapedData.mileage) updates.mileage = scrapedData.mileage;
        // Never write a VIN unless it was validated and matched.
        if (scrapedVin && vinMatch) updates.vin = scrapedVin;

        if (Object.keys(updates).length > 0) {
          await supabase
            .from('vehicles')
            .update(updates)
            .eq('id', vehicleId);
        }
      }

      // Create timeline event and ownership transfer for BAT auction
      if (vinMatch && scrapedData) {
        try {
          // Check if there's an active auction listing first
          const { data: activeListing } = await supabase
            .from('vehicle_listings')
            .select('id, status, sale_type, auction_end_time')
            .eq('vehicle_id', vehicleId)
            .eq('status', 'active')
            .in('sale_type', ['auction', 'live_auction'])
            .gt('auction_end_time', new Date().toISOString())
            .maybeSingle();

          // Also check external_listings for BAT auctions
          const { data: externalListing } = await supabase
            .from('external_listings')
            .select('id, listing_status, end_date')
            .eq('vehicle_id', vehicleId)
            .eq('platform', 'bat')
            .eq('listing_status', 'active')
            .gt('end_date', new Date().toISOString())
            .maybeSingle();

          const isActiveAuction = activeListing || externalListing;

          // Extract auction START date (this is the base date for all auction events)
          // BAT auctions typically run for 7 days, so start_date = sale_date - 7 days
          let auctionStartDate = scrapedData.auction_start_date || scrapedData.listed_date;
          
          // If we have sale_date but no start_date, calculate it (BAT auctions are typically 7 days)
          if (!auctionStartDate && scrapedData.sale_date) {
            const saleDate = new Date(scrapedData.sale_date);
            saleDate.setDate(saleDate.getDate() - 7); // Subtract 7 days for typical BAT auction duration
            auctionStartDate = saleDate.toISOString().split('T')[0];
          }
          
          // Fallback: use sale_date - 7 days if available
          if (!auctionStartDate && scrapedData.auction_end_date) {
            const endDate = new Date(scrapedData.auction_end_date);
            endDate.setDate(endDate.getDate() - 7);
            auctionStartDate = endDate.toISOString().split('T')[0];
          }
          
          // Last resort fallbacks
          if (!auctionStartDate && vehicle.year) {
            auctionStartDate = `${vehicle.year}-01-01`;
          } else if (!auctionStartDate) {
            auctionStartDate = new Date().toISOString().split('T')[0];
          }

          // Determine event type and title based on auction status
          let eventType = 'auction_started';
          let eventTitle = 'Auction Started';
          
          if (isActiveAuction) {
            // Vehicle is currently on auction - create "started" event
            eventType = 'auction_started';
            eventTitle = 'Auction Started';
          } else if (scrapedData.sale_price) {
            // Auction completed with sale - create START event first, then sale event separately
            eventType = 'auction_started';
            eventTitle = 'Auction Started';
          } else {
            // Listed but no sale price yet
            eventType = 'auction_started';
            eventTitle = 'Auction Started';
          }

          // Create timeline event for the auction START (base event)
          const { data: timelineEvent, error: eventError } = await supabase
            .from('timeline_events')
            .insert({
              vehicle_id: vehicleId,
              user_id: userId,
              event_type: eventType,
              event_date: auctionStartDate, // Use START date, not sale date
              title: eventTitle,
              description: scrapedData.title 
                ? `${scrapedData.title} - Auction started on Bring a Trailer${scrapedData.seller ? ` - Seller: ${scrapedData.seller}` : ''}`
                : `Auction started on Bring a Trailer${scrapedData.seller ? ` - Seller: ${scrapedData.seller}` : ''}`,
              cost_amount: null, // No sale price on start event
              metadata: {
                source: 'bat_import',
                bat_url: batUrl,
                bat_listing_title: scrapedData.title,
                seller: scrapedData.seller,
                auction_start_date: auctionStartDate,
                auction_end_date: scrapedData.sale_date || scrapedData.auction_end_date,
                is_active_auction: !!isActiveAuction,
                processed_from_comment: true
              }
            })
            .select('id')
            .single();

          // If auction is completed with sale, create a separate SALE event
          if (!isActiveAuction && scrapedData.sale_price && scrapedData.sale_date) {
            await supabase
              .from('timeline_events')
              .insert({
                vehicle_id: vehicleId,
                user_id: userId,
                event_type: 'sale',
                event_date: scrapedData.sale_date, // Sale event uses actual sale date
                title: `Sold on Bring a Trailer for $${scrapedData.sale_price.toLocaleString()}`,
                description: scrapedData.title 
                  ? `${scrapedData.title} - ${scrapedData.buyer ? `Buyer: ${scrapedData.buyer}` : ''}`
                  : `Vehicle sold on Bring a Trailer${scrapedData.buyer ? ` - Buyer: ${scrapedData.buyer}` : ''}`,
                cost_amount: scrapedData.sale_price,
                metadata: {
                  source: 'bat_import',
                  bat_url: batUrl,
                  bat_listing_title: scrapedData.title,
                  buyer: scrapedData.buyer,
                  sale_date: scrapedData.sale_date,
                  auction_start_date: auctionStartDate,
                  processed_from_comment: true
                }
              });
          }

          if (eventError) {
            console.warn('[VehicleComments] Failed to create timeline event:', eventError);
          } else {
            console.log('[VehicleComments] Created timeline event for BAT auction');
            
            // Create ownership transfer record if buyer is available
            if (scrapedData.buyer && timelineEvent?.id) {
              // Try to find existing profile by username/name matching buyer
              // BaT buyers are often usernames, so try to match
              let buyerProfileId = null;
              const { data: buyerProfile } = await supabase
                .from('profiles')
                .select('id')
                .or(`username.ilike.%${scrapedData.buyer}%,full_name.ilike.%${scrapedData.buyer}%`)
                .limit(1)
                .maybeSingle();
              
              if (buyerProfile) {
                buyerProfileId = buyerProfile.id;
              }

              // Get current owner (if any) from vehicle_ownerships
              const { data: currentOwner } = await supabase
                .from('vehicle_ownerships')
                .select('owner_profile_id')
                .eq('vehicle_id', vehicleId)
                .eq('is_current', true)
                .limit(1)
                .maybeSingle();

              // Create ownership transfer record
              // Note: We'll need to add metadata column to ownership_transfers table
              const transferData: any = {
                vehicle_id: vehicleId,
                from_owner_id: currentOwner?.owner_profile_id || null,
                to_owner_id: buyerProfileId || null, // null if buyer not found in profiles
                transfer_date: auctionDate,
                source: 'bring_a_trailer',
                source_url: batUrl,
                price: scrapedData.sale_price || null,
                proof_event_id: timelineEvent.id
              };

              // Add metadata if column exists (will be added via migration)
              // Store buyer name even if no profile match
              if (scrapedData.buyer || scrapedData.seller) {
                transferData.metadata = {
                  ...(scrapedData.buyer && { buyer_name: scrapedData.buyer }),
                  ...(scrapedData.seller && { seller_name: scrapedData.seller }),
                  bat_listing_title: scrapedData.title,
                  lot_number: scrapedData.lot_number || null
                };
              }

              const { error: transferError } = await supabase
                .from('ownership_transfers')
                .insert(transferData);

              if (transferError) {
                console.warn('[VehicleComments] Failed to create ownership transfer:', transferError);
              } else {
                console.log('[VehicleComments] Created ownership transfer for BaT buyer:', scrapedData.buyer);
                // Note: We do NOT create vehicle_ownerships records here because:
                // 1. Ownership must be verified through the ownership_verification system
                // 2. Only approved, up-to-date title verifications create vehicle_ownerships records
                // 3. The ownership_transfer record documents the sale, but doesn't grant ownership
                // 4. The buyer must submit title documents and get verified to become the current owner
              }
            }
          }
        } catch (eventErr) {
          console.warn('[VehicleComments] Error creating timeline event:', eventErr);
        }
      }

      setScrapingStatus('Complete!');
      setTimeout(() => setScrapingStatus(null), 3000);
    } catch (error: any) {
      console.error('Error processing BAT URL:', error);
      setScrapingStatus(`Error: ${error.message}`);
      setTimeout(() => setScrapingStatus(null), 5000);
    }
  };

  // Calculate confidence score based on user metadata
  const calculateCommentConfidence = async (userId: string, vehicleId: string, batUrl: string): Promise<number> => {
    let confidence = 0.5; // Base confidence

    try {
      // Get user profile and organization affiliations
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, user_type, location')
        .eq('id', userId)
        .single();

      // Check if user is linked to organizations
      const { data: orgLinks } = await supabase
        .from('organization_contributors')
        .select('organization_id, role')
        .eq('user_id', userId)
        .eq('is_active', true);

      // Check if user has vehicle relationship (worked for entity that sold vehicle)
      const { data: vehicleOrgs } = await supabase
        .from('organization_vehicles')
        .select('organization_id, relationship_type')
        .eq('vehicle_id', vehicleId);

      // Boost confidence if user is linked to organization that has relationship with vehicle
      if (orgLinks && vehicleOrgs) {
        const matchingOrg = orgLinks.find(link => 
          vehicleOrgs.some(vOrg => vOrg.organization_id === link.organization_id)
        );
        if (matchingOrg) {
          confidence += 0.3; // High boost for organizational connection
        }
      }

      // Boost for professional user types
      if (profile?.user_type === 'professional' || profile?.user_type === 'dealer') {
        confidence += 0.15;
      }

      // Check user's historical accuracy (if trust scores exist)
      const { data: trustScore } = await supabase
        .from('user_trust_scores')
        .select('overall_score, accuracy_rate')
        .eq('user_id', userId)
        .single();

      if (trustScore?.overall_score) {
        confidence += trustScore.overall_score * 0.2; // Add up to 0.2 based on trust
      }

      // Boost if URL was already seen (user is providing correct data)
      const { data: existingUrls } = await supabase
        .from('vehicle_comments')
        .select('comment_text')
        .eq('vehicle_id', vehicleId)
        .ilike('comment_text', `%${batUrl}%`);

      if (existingUrls && existingUrls.length > 0) {
        confidence += 0.1; // User is confirming/correcting data
      }

    } catch (error) {
      console.error('Error calculating confidence:', error);
    }

    return Math.min(confidence, 1.0); // Cap at 1.0
  };

  // Save BAT images to vehicle_images table
  const saveBATImages = async (imageUrls: string[], batUrl: string, vinMatch: boolean, confidence: number) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return;

    // Get vehicle for validation
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('id, year, make, model')
      .eq('id', vehicleId)
      .single();

    if (!vehicle) return;

    // Process ALL images (not just first 15) - AI validation will filter out incorrect ones
    const imagesToSave = imageUrls;
    
    let savedCount = 0;
    let validatedCount = 0;
    let mismatchCount = 0;
    
    for (let i = 0; i < imagesToSave.length; i++) {
      const imageUrl = imagesToSave[i];
      
      try {
        // Check if image already exists for this vehicle
        const { data: existing } = await supabase
          .from('vehicle_images')
          .select('id')
          .eq('vehicle_id', vehicleId)
          .eq('image_url', imageUrl)
          .limit(1);

        if (existing && existing.length > 0) {
          continue; // Skip if already exists
        }

        // Basic validation: filter out obvious non-vehicle images
        // Skip images that look like ads, logos, or thumbnails
        const urlLower = imageUrl.toLowerCase();
        if (urlLower.includes('logo') || 
            urlLower.includes('icon') ||
            urlLower.includes('avatar') ||
            urlLower.includes('gravatar') ||
            urlLower.match(/-(\d+)x\d+\./)) { // Skip thumbnails like -150x150
          console.log(`Skipping non-vehicle image: ${imageUrl}`);
          continue;
        }

        // Insert image record (direct link to BAT image)
        const insertData: any = {
          vehicle_id: vehicleId,
          image_url: imageUrl,
          user_id: session.user.id,
          category: 'bat_listing',
          is_primary: i === 0,
          source: 'bat_listing',
          // Store BAT metadata in ai_scan_metadata since metadata column doesn't exist
          ai_scan_metadata: {
            source: 'bat_scraper',
            bat_url: batUrl,
            scraped_at: new Date().toISOString(),
            vin_match: vinMatch,
            confidence_score: confidence,
            original_listing: batUrl,
            vehicle_expected: `${vehicle.year} ${vehicle.make} ${vehicle.model}`
          }
        };

        // Save image to database
        const { data: insertedImage, error: insertError } = await supabase
          .from('vehicle_images')
          .insert(insertData)
          .select('id')
          .single();

        if (insertError) {
          console.error(`Error saving image ${i + 1}:`, insertError);
          continue;
        }

        if (!insertedImage?.id) {
          continue;
        }

        savedCount++;

        // Validate image IMMEDIATELY (synchronously) as it's being saved
        // Add rate limiting: 1.5s delay between validations to avoid hitting API limits
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }

        try {
          // Add timeout protection (30 seconds max per validation)
          const validationPromise = supabase.functions.invoke('validate-bat-image', {
            body: {
              image_id: insertedImage.id,
              image_url: imageUrl,
              vehicle_id: vehicleId,
              expected_vehicle: {
                year: vehicle.year,
                make: vehicle.make,
                model: vehicle.model
              }
            }
          });

          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Validation timeout after 30s')), 30000)
          );

          const { data: validationResult, error: validationError } = await Promise.race([
            validationPromise,
            timeoutPromise
          ]) as any;

          if (validationError) {
            console.warn(`Validation failed for image ${i + 1}:`, validationError);
            // Mark for retry later (store in metadata)
            await supabase
              .from('vehicle_images')
              .update({
                ai_scan_metadata: {
                  ...insertData.ai_scan_metadata,
                  validation: {
                    status: 'failed',
                    error: validationError.message,
                    retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString() // Retry in 5 min
                  }
                }
              })
              .eq('id', insertedImage.id);
          } else if (validationResult?.validation) {
            validatedCount++;
            if (!validationResult.validation.matches) {
              mismatchCount++;
              console.log(`  ⚠️  Image ${i + 1} MISMATCH: ${validationResult.validation.mismatch_reason || 'Does not match vehicle'}`);
            }
          }
        } catch (validationErr: any) {
          console.warn(`Validation error for image ${i + 1}:`, validationErr);
          // Mark for retry if it's a timeout or rate limit
          if (validationErr?.message?.includes('timeout') || validationErr?.message?.includes('429')) {
            await supabase
              .from('vehicle_images')
              .update({
                ai_scan_metadata: {
                  ...insertData.ai_scan_metadata,
                  validation: {
                    status: 'pending_retry',
                    error: validationErr.message,
                    retry_at: new Date(Date.now() + 2 * 60 * 1000).toISOString() // Retry in 2 min
                  }
                }
              })
              .eq('id', insertedImage.id);
          }
        }
      } catch (error) {
        console.error(`Error processing image ${i + 1}:`, error);
      }
    }

    console.log(`[VehicleComments] Saved ${savedCount} images, validated ${validatedCount}, ${mismatchCount} mismatches detected`);
  };

  const submitGeneralComment = async () => {
    if (!newComment.trim()) return;
    
    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        console.error('Must be logged in to comment');
        return;
      }
      
      // Save comment first
      const { data: insertedComment, error } = await supabase
        .from('vehicle_comments')
        .insert({
          vehicle_id: vehicleId,
          user_id: session?.user?.id,
          comment_text: newComment.trim()
        })
        .select('id')
        .single();

      if (error) {
        console.error('Error submitting comment:', error);
        return;
      }

      setNewComment('');
      loadAllComments();

      // NEW: Intelligent content detection
      console.log('[VehicleComments] Analyzing comment for extractable content...');
      setScrapingStatus('Analyzing content...');

      try {
        // Detect all types of valuable content
        const detected = await ContentDetector.analyzeComment(
          newComment.trim(),
          vehicleId,
          insertedComment?.id,
          'vehicle_comments'
        );

        if (detected.length > 0) {
          console.log(`[VehicleComments] Detected ${detected.length} extractable items:`, detected);
          setScrapingStatus(`Found ${detected.length} extractable item(s) - processing...`);

          // Queue content for extraction
          await ContentDetector.queueDetectedContent(
            detected,
            vehicleId,
            session.user.id,
            insertedComment?.id,
            'vehicle_comments'
          );

          // Trigger immediate processing for high-confidence listings
          const highConfidenceListings = detected.filter(
            d => d.type === 'listing_url' && d.confidence >= 0.8
          );

          if (highConfidenceListings.length > 0) {
            setScrapingStatus(`Processing ${highConfidenceListings.length} listing(s)...`);
            
            // Trigger processing edge function
            const { error: processError } = await supabase.functions.invoke('process-content-extraction');
            
            if (processError) {
              console.error('[VehicleComments] Processing error:', processError);
              setScrapingStatus('Content queued for processing');
            } else {
              setScrapingStatus('Content processed successfully!');
              // Reload to show new images/data
              setTimeout(() => {
                window.location.reload();
              }, 2000);
            }
          } else {
            setScrapingStatus('Content queued for processing');
          }

          // Clear status after 5 seconds
          setTimeout(() => setScrapingStatus(null), 5000);
      } else {
          console.log('[VehicleComments] No extractable content detected');
          setScrapingStatus(null);
      }
      } catch (detectionError) {
        console.error('[VehicleComments] Content detection error:', detectionError);
        setScrapingStatus(null);
      }

    } catch (error) {
      console.error('Error submitting comment:', error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      {/* Extraction Queue Status */}
      <ExtractionQueueStatus vehicleId={vehicleId} />

      {/* Compact header only if there are comments */}
      {comments.length > 0 && (
        <div style={{ marginBottom: '12px', fontSize: '14px', fontWeight: 600, color: '#374151' }}>
          Comments ({comments.length})
        </div>
      )}
      
      {/* Comment Box */}
      <div className="comment-form">
        <div className="form-group" style={{ position: 'relative', marginBottom: '12px' }}>
          <textarea
            className="form-input"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder={comments.length === 0 ? "Be the first to comment... (Paste listings, specs, VINs, videos - we'll extract the data automatically)" : "Add a comment... (Share listings, specs, prices, timeline events - we extract and credit you)"}
            rows={3}
            disabled={submitting}
            style={{ paddingBottom: '40px' }}
          />
          <div className="form-actions" style={{ position: 'absolute', right: '8px', bottom: '8px', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end' }}>
            {scrapingStatus && (
              <div style={{ fontSize: '11px', color: '#6b7280', padding: '2px 8px' }}>
                {scrapingStatus}
              </div>
            )}
            <button
              className="button button-primary"
              onClick={submitGeneralComment}
              disabled={!newComment.trim() || submitting}
              style={{ padding: '6px 12px', fontSize: '14px' }}
            >
              {submitting ? 'Posting...' : 'Post Comment'}
            </button>
          </div>
        </div>
      </div>

      {/* Comments List */}
      {loading ? (
        <div className="comments-loading" style={{ padding: '20px', textAlign: 'center' }}>
          <div className="spinner"></div>
        </div>
      ) : comments.length > 0 ? (
        <div className="comments-list" style={{ paddingTop: '8px' }}>
          {comments.map((comment) => (
            <div key={`${comment.target_type}-${comment.id}`} className="comment-item">
                  <div className="comment-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div className="comment-avatar" style={{ width: 16, height: 16 }}>
                        {comment.avatar_url ? (
                          <img src={comment.avatar_url} alt="Profile" className="avatar-image" style={{ width: 16, height: 16, borderRadius: '50%' }} />
                        ) : (
                          <div className="avatar-placeholder" style={{ width: 16, height: 16, borderRadius: '50%', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {(comment.user_name || comment.user_email || 'U').charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div className="comment-author" style={{ fontSize: 12, color: '#374151' }}>
                        {comment.user_name || comment.user_email?.split('@')[0] || 'User'}
                      </div>
                      <UserReputationBadge userId={comment.user_id} inline={true} />
                      <span className="comment-date" style={{ fontSize: 11, color: '#6b7280' }}>{formatDate(comment.created_at)}</span>
                    </div>
                    {canDeleteComment(comment) && (
                      <button
                        onClick={() => {
                          if (confirm('Delete this comment? This action cannot be undone after 10 minutes.')) {
                            deleteComment(comment);
                          }
                        }}
                        disabled={deletingCommentId === comment.id}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#ef4444',
                          fontSize: '11px',
                          cursor: deletingCommentId === comment.id ? 'not-allowed' : 'pointer',
                          padding: '2px 6px',
                          opacity: deletingCommentId === comment.id ? 0.5 : 1
                        }}
                        title="Delete comment (10 minute grace period)"
                      >
                        {deletingCommentId === comment.id ? 'Deleting...' : 'Delete'}
                      </button>
                    )}
                  </div>
                  <div className="comment-body">
                    <div className="comment-text" style={{ wordBreak: 'break-word' }}>
                      {comment.comment_text.split(/(https?:\/\/[^\s\)]+)/g).map((part, idx) => {
                        if (part.match(/^https?:\/\//)) {
                          const isBAT = part.includes('bringatrailer.com');
                          return (
                            <a
                              key={idx}
                              href={part}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                color: isBAT ? '#2563eb' : '#059669',
                                textDecoration: 'underline',
                                fontWeight: isBAT ? 600 : 400
                              }}
                            >
                              {isBAT ? 'BAT Listing' : part}
                            </a>
                          );
                        }
                        return <span key={idx}>{part}</span>;
                      })}
                    </div>
                    {comment.image_thumbnail && (
                      <div style={{ marginTop: '8px' }}>
                        <img 
                          src={comment.image_thumbnail} 
                          alt="Comment context" 
                          style={{ 
                            width: '80px', 
                            height: '80px', 
                            objectFit: 'cover', 
                            borderRadius: '4px',
                            border: '1px solid var(--border)'
                          }} 
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : null
      }
    </div>
  );
};

export default VehicleComments;
