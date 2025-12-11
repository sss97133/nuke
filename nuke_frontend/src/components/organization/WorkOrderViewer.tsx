// Work Order Viewer - "The Research Terminal"
// Tabbed, swipeable, bookmarkable deep-dive into shop work

import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { supabase } from '../../lib/supabase';

interface WorkOrderViewerProps {
  event: any; // business_timeline_event
  organizationName: string;
  laborRate?: number;
  onClose: () => void;
  onNavigateEvent?: (event: any) => void;
}

type Tab = 'overview' | 'parts' | 'labor' | 'photos' | 'shop';

export default function WorkOrderViewer({ event, organizationName, laborRate = 0, onClose, onNavigateEvent }: WorkOrderViewerProps) {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [bookmarkCount, setBookmarkCount] = useState(0);
  const [parts, setParts] = useState<any[]>([]);
  const [laborItems, setLaborItems] = useState<any[]>([]);
  const [collaborators, setCollaborators] = useState<any[]>([]);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [prevEvent, setPrevEvent] = useState<any>(null);
  const [nextEvent, setNextEvent] = useState<any>(null);
  const [allAuctionEvents, setAllAuctionEvents] = useState<any[]>([]);
  
  const vehicleName = event.metadata?.vehicle_name || 'Unknown Vehicle';
  const vehicleId = event.metadata?.vehicle_id;
  
  // Detect if this is an auction event
  const isAuctionEvent = event.event_type?.startsWith('auction') || 
                         event.metadata?.platform === 'bat' ||
                         event.metadata?.source === 'bat_import';
  
  // Load all auction events chronologically for navigation
  useEffect(() => {
    if (isAuctionEvent && vehicleId) {
      loadAuctionEventSequence();
    }
  }, [event.id, isAuctionEvent, vehicleId]);
  
  // Aggregate images from event (handles both single events and grouped events)
  let images: string[] = [];
  if (event.image_urls && Array.isArray(event.image_urls)) {
    images = event.image_urls.filter(url => url); // Remove nulls
  } else if (event.image_urls && typeof event.image_urls === 'string') {
    images = [event.image_urls]; // Single string URL
  }
  
  // If this is a grouped event with aggregated_images from parent
  if (event.aggregated_images && Array.isArray(event.aggregated_images)) {
    images = [...images, ...event.aggregated_images].filter(url => url);
  }
  
  const totalImages = images.length;
  
  // Debug logging
  console.log('WorkOrderViewer event:', event);
  console.log('Images array:', images);
  console.log('Total images:', totalImages);
  
  // Parse AI metadata
  let workPerformed: string[] = [];
  let partsIdentified: string[] = [];
  let aiDescription = '';
  let qualityRating = 0;
  
  try {
    if (event.metadata?.work_performed) {
      workPerformed = JSON.parse(event.metadata.work_performed);
    }
  } catch (e) { }
  
  try {
    if (event.metadata?.parts_identified) {
      partsIdentified = JSON.parse(event.metadata.parts_identified);
    }
  } catch (e) { }
  
  if (event.metadata?.description) {
    aiDescription = event.metadata.description;
  }
  
  if (event.metadata?.qualityRating) {
    qualityRating = event.metadata.qualityRating;
  }

  useEffect(() => {
    if (!isAuctionEvent) {
      loadUserData();
      loadParts();
      loadLabor();
      loadCollaborators();
      checkBookmarkStatus();
    } else {
      loadUserData();
      checkBookmarkStatus();
    }
  }, [event.id, isAuctionEvent]);

  const loadAuctionEventSequence = async () => {
    if (!vehicleId) return;
    
    // Load ALL auction events for this vehicle, ordered chronologically
    // Use event_date first, then created_at for events on the same day
    const { data: allEvents, error } = await supabase
      .from('business_timeline_events')
      .select('*')
      .eq('business_id', event.business_id)
      .like('event_type', 'auction%')
      .eq('metadata->>vehicle_id', vehicleId)
      .order('event_date', { ascending: true })
      .order('created_at', { ascending: true });
    
    if (error) {
      console.error('Error loading auction events:', error);
      return;
    }
    
    if (!allEvents || allEvents.length === 0) return;
    
    setAllAuctionEvents(allEvents);
    
    // Find current event's position in the sequence
    const currentIndex = allEvents.findIndex(e => e.id === event.id);
    
    if (currentIndex > 0) {
      setPrevEvent(allEvents[currentIndex - 1]);
    } else {
      setPrevEvent(null);
    }
    
    if (currentIndex < allEvents.length - 1) {
      setNextEvent(allEvents[currentIndex + 1]);
    } else {
      setNextEvent(null);
    }
  };
  
  // Navigate to a different auction event
  const navigateToEvent = (targetEvent: any) => {
    if (targetEvent && onNavigateEvent) {
      // Parent component will update the selected event
      onNavigateEvent(targetEvent);
    }
  };

  const loadUserData = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) setCurrentUserId(user.id);
  };

  const loadParts = async () => {
    // Load manual work order parts
    const { data: workOrderParts, error } = await supabase
      .from('work_order_parts')
      .select('*')
      .eq('timeline_event_id', event.id)
      .order('created_at', { ascending: true});

    // Load AI-identified shoppable products from image tags
    const imageUrls = images.length > 0 ? images : [];
    console.log('🔍 loadParts() - Querying for', imageUrls.length, 'image URLs');
    
    const { data: imageProducts, error: tagsError } = await supabase
      .from('image_tags')
      .select('*')
      .in('image_url', imageUrls)
      .eq('is_shoppable', true)
      .order('confidence', { ascending: false });
    
    console.log('✅ Found', imageProducts?.length || 0, 'shoppable products from image_tags');
    if (tagsError) console.error('❌ Error loading products:', tagsError);
    
    // Combine both sources
    const combined = [
      ...(workOrderParts || []),
      ...(imageProducts || []).map(tag => ({
        ...tag,
        is_ai_detected: true,
        buy_link: tag.affiliate_links?.amazon || `https://amazon.com/s?k=${encodeURIComponent(tag.tag_name)}`
      }))
    ];
    
    console.log('🎯 Total parts to display:', combined.length);
    setParts(combined);
  };

  const loadLabor = async () => {
    const { data, error } = await supabase
      .from('work_order_labor')
      .select('*')
      .eq('timeline_event_id', event.id)
      .order('created_at', { ascending: true });
    
    if (data) setLaborItems(data);
  };

  const loadCollaborators = async () => {
    const { data, error } = await supabase
      .from('work_order_collaborators')
      .select(`
        *,
        businesses:organization_id (
          id,
          business_name,
          business_type,
          logo_url
        )
      `)
      .eq('timeline_event_id', event.id)
      .order('created_at', { ascending: true });
    
    if (data) setCollaborators(data);
  };

  const checkBookmarkStatus = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    const { data } = await supabase
      .from('user_bookmarks')
      .select('id')
      .eq('user_id', user.id)
      .eq('bookmark_type', 'work_order')
      .eq('reference_id', event.id)
      .single();
    
    setIsBookmarked(!!data);
    
    // Get total bookmark count
    const { count } = await supabase
      .from('user_bookmarks')
      .select('*', { count: 'exact', head: true })
      .eq('bookmark_type', 'work_order')
      .eq('reference_id', event.id);
    
    if (count !== null) setBookmarkCount(count);
  };

  const toggleBookmark = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      alert('Please log in to bookmark');
      return;
    }

    if (isBookmarked) {
      // Remove bookmark
      await supabase
        .from('user_bookmarks')
        .delete()
        .eq('user_id', user.id)
        .eq('bookmark_type', 'work_order')
        .eq('reference_id', event.id);
      
      setIsBookmarked(false);
      setBookmarkCount(prev => Math.max(0, prev - 1));
    } else {
      // Add bookmark
      await supabase
        .from('user_bookmarks')
        .insert({
          user_id: user.id,
          bookmark_type: 'work_order',
          reference_id: event.id,
          title: `${vehicleName} - ${event.title}`,
          thumbnail_url: images[0] || null,
          metadata: {
            vehicle_id: vehicleId,
            organization_name: organizationName,
            event_date: event.event_date
          }
        });
      
      setIsBookmarked(true);
      setBookmarkCount(prev => prev + 1);
    }
  };

  const partsTotal = parts.reduce((sum, p) => sum + (parseFloat(p.total_price) || 0), 0);
  const laborTotal = laborItems.reduce((sum, l) => sum + (parseFloat(l.total_cost) || 0), 0);
  const totalHours = laborItems.reduce((sum, l) => sum + (parseFloat(l.hours) || 0), 0);

  // Auction-specific data extraction
  const auctionPlatform = event.metadata?.platform === 'bat' ? 'Bring a Trailer' : 
                         event.metadata?.platform ? event.metadata.platform.toUpperCase() : 
                         event.metadata?.source === 'bat_import' ? 'Bring a Trailer' : 'Auction';
  const lotNumber = event.metadata?.lot_number || event.metadata?.listing_id;
  const auctionUrl = event.metadata?.bat_url || event.metadata?.listing_url || event.metadata?.bat_listing_url;
  const bidAmount = event.metadata?.bid_amount || event.cost_amount;
  const bidder = event.metadata?.bidder || event.metadata?.bat_username || event.metadata?.buyer;
  const reserveMet = event.event_type === 'auction_reserve_met';
  const isSold = event.event_type === 'auction_sold';
  const finalPrice = isSold ? (event.metadata?.final_price || bidAmount || event.cost_amount) : null;
  const bidSequence = event.metadata?.bid_sequence || event.metadata?.bid_count;

  // Render auction view
  const renderAuctionView = () => {
    const eventDate = new Date(event.event_date);
    // Format date with time if available (bids have timestamps)
    const eventDateTime = event.created_at ? new Date(event.created_at) : eventDate;
    const hasTime = event.created_at && event.event_type === 'auction_bid_placed';
    
    const formattedDate = eventDate.toLocaleDateString('en-US', { 
      month: '2-digit', day: '2-digit', year: 'numeric'
    });
    
    const formattedDateTime = hasTime ? eventDateTime.toLocaleString('en-US', {
      month: '2-digit', 
      day: '2-digit', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }) : formattedDate;
    
    // Get previous/next event dates for display
    const prevDateStr = prevEvent ? (() => {
      const d = new Date(prevEvent.event_date);
      const hasPrevTime = prevEvent.created_at && prevEvent.event_type === 'auction_bid_placed';
      if (hasPrevTime) {
        const dt = new Date(prevEvent.created_at);
        return dt.toLocaleString('en-US', {
          month: '2-digit', day: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit'
        });
      }
      return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    })() : null;
    
    const nextDateStr = nextEvent ? (() => {
      const d = new Date(nextEvent.event_date);
      const hasNextTime = nextEvent.created_at && nextEvent.event_type === 'auction_bid_placed';
      if (hasNextTime) {
        const dt = new Date(nextEvent.created_at);
        return dt.toLocaleString('en-US', {
          month: '2-digit', day: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit'
        });
      }
      return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    })() : null;

    return ReactDOM.createPortal(
      <div
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.75)',
          zIndex: 99999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '8px',
          overflow: 'auto'
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: 'rgb(255, 255, 255)',
            width: '100%',
            maxWidth: '800px',
            maxHeight: '90vh',
            border: '2px solid rgb(0, 0, 0)',
            fontFamily: 'Arial, sans-serif',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}
        >
          {/* Header with date navigation */}
          <div style={{
            padding: '16px',
            borderBottom: '2px solid #000',
            background: '#f5f5f5',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (prevEvent) {
                  navigateToEvent(prevEvent);
                }
              }}
              disabled={!prevEvent}
              style={{
                background: prevEvent ? '#000' : '#ccc',
                color: '#fff',
                border: 'none',
                padding: '8px 16px',
                cursor: prevEvent ? 'pointer' : 'not-allowed',
                fontSize: '9pt',
                fontWeight: 600
              }}
            >
              ← PREV
              {prevEvent && prevDateStr && (
                <span style={{ display: 'block', fontSize: '7pt', marginTop: '2px', opacity: 0.8 }}>
                  {prevDateStr}
                </span>
              )}
            </button>
            
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '11pt', fontWeight: 700 }}>
                {formattedDateTime}
              </div>
              {allAuctionEvents.length > 0 && (
                <div style={{ fontSize: '7pt', color: '#666', marginTop: '2px' }}>
                  Event {allAuctionEvents.findIndex(e => e.id === event.id) + 1} of {allAuctionEvents.length}
                </div>
              )}
            </div>
            
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (nextEvent) {
                  navigateToEvent(nextEvent);
                }
              }}
              disabled={!nextEvent}
              style={{
                background: nextEvent ? '#000' : '#ccc',
                color: '#fff',
                border: 'none',
                padding: '8px 16px',
                cursor: nextEvent ? 'pointer' : 'not-allowed',
                fontSize: '9pt',
                fontWeight: 600
              }}
            >
              NEXT →
              {nextEvent && nextDateStr && (
                <span style={{ display: 'block', fontSize: '7pt', marginTop: '2px', opacity: 0.8 }}>
                  {nextDateStr}
                </span>
              )}
            </button>
          </div>

          {/* Auction Details */}
          <div style={{ padding: '20px', overflow: 'auto', flex: 1 }}>
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '10pt', color: '#666', marginBottom: '4px' }}>
                {auctionPlatform}
                {lotNumber && ` • Lot #${lotNumber}`}
              </div>
              {vehicleId && (
                <a
                  href={`/vehicle/${vehicleId}`}
                  style={{ 
                    fontSize: '14pt', 
                    fontWeight: 700, 
                    color: '#000',
                    textDecoration: 'none',
                    display: 'block',
                    marginBottom: '8px'
                  }}
                  className="hover:underline"
                >
                  {vehicleName}
                </a>
              )}
              <div style={{ fontSize: '12pt', fontWeight: 600, color: '#333', marginBottom: '12px' }}>
                {event.title}
              </div>
              {event.description && (
                <div style={{ fontSize: '9pt', color: '#666', lineHeight: 1.5, marginBottom: '16px' }}>
                  {event.description}
                </div>
              )}
            </div>

            {/* Bid Information */}
            {(bidAmount || bidder) && (
              <div style={{
                padding: '16px',
                background: '#f8f9fa',
                border: '1px solid #ddd',
                borderRadius: '4px',
                marginBottom: '16px'
              }}>
                <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '8px', textTransform: 'uppercase', color: '#666' }}>
                  {isSold ? 'Final Sale' : event.event_type === 'auction_listed' ? 'Auction Listed' : 'Bid Information'}
                </div>
                {bidAmount && (
                  <div style={{ fontSize: '18pt', fontWeight: 700, color: '#000', marginBottom: '4px' }}>
                    ${bidAmount.toLocaleString()}
                  </div>
                )}
                {bidder && (
                  <div style={{ fontSize: '9pt', color: '#666', marginTop: '4px' }}>
                    {event.event_type === 'auction_bid_placed' && bidSequence ? (
                      <>Bid #{bidSequence} by <strong>{bidder}</strong></>
                    ) : bidder ? (
                      <strong>{bidder}</strong>
                    ) : null}
                  </div>
                )}
                {reserveMet && (
                  <div style={{
                    marginTop: '8px',
                    padding: '4px 8px',
                    background: '#d4edda',
                    color: '#155724',
                    fontSize: '8pt',
                    fontWeight: 600,
                    display: 'inline-block',
                    borderRadius: '3px'
                  }}>
                    RESERVE MET
                  </div>
                )}
                {isSold && (
                  <div style={{
                    marginTop: '8px',
                    padding: '4px 8px',
                    background: '#d1ecf1',
                    color: '#0c5460',
                    fontSize: '8pt',
                    fontWeight: 600,
                    display: 'inline-block',
                    borderRadius: '3px'
                  }}>
                    SOLD
                  </div>
                )}
              </div>
            )}

            {/* Auction Link */}
            {auctionUrl && (
              <div style={{ marginBottom: '20px' }}>
                <a
                  href={auctionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-block',
                    padding: '10px 20px',
                    background: '#000',
                    color: '#fff',
                    textDecoration: 'none',
                    fontSize: '9pt',
                    fontWeight: 600,
                    borderRadius: '4px'
                  }}
                  className="hover:opacity-90"
                >
                  VIEW AUCTION LISTING →
                </a>
              </div>
            )}

            {/* Event Metadata */}
            {event.metadata && Object.keys(event.metadata).length > 0 && (
              <div style={{
                padding: '12px',
                background: '#f8f9fa',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '8pt',
                color: '#666'
              }}>
                <div style={{ fontWeight: 700, marginBottom: '6px' }}>Event Details</div>
                {event.event_type && (
                  <div>Type: <strong>{event.event_type.replace('_', ' ').toUpperCase()}</strong></div>
                )}
                {event.metadata.seller && (
                  <div>Seller: <strong>{event.metadata.seller}</strong></div>
                )}
                {event.metadata.buyer && bidder !== event.metadata.buyer && (
                  <div>Buyer: <strong>{event.metadata.buyer}</strong></div>
                )}
                {event.metadata.bid_count && (
                  <div>Total Bids: <strong>{event.metadata.bid_count}</strong></div>
                )}
                {event.metadata.view_count && (
                  <div>Views: <strong>{event.metadata.view_count.toLocaleString()}</strong></div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{
            padding: '12px 16px',
            borderTop: '2px solid #000',
            background: '#f5f5f5',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '8pt',
            color: '#666'
          }}>
            <span>[ESC TO CLOSE]</span>
            <button
              onClick={onClose}
              style={{
                background: '#000',
                color: '#fff',
                border: 'none',
                padding: '6px 12px',
                cursor: 'pointer',
                fontSize: '9pt',
                fontWeight: 600
              }}
            >
              CLOSE
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  };

  // If this is an auction event, render the auction view instead
  if (isAuctionEvent) {
    return renderAuctionView();
  }

  return ReactDOM.createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8px',
        overflow: 'auto'
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--white)',
          width: '100%',
          maxWidth: '1000px',
          maxHeight: '95vh',
          borderRadius: '8px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {/* HEADER - Sticky */}
        <div style={{
          padding: '16px',
          borderBottom: '2px solid var(--border)',
          background: 'linear-gradient(to bottom, #f8f9fa, #ffffff)',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
                {new Date(event.event_date).toLocaleDateString('en-US', { 
                  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                })}
              </div>
              <div style={{ fontSize: '8pt', color: 'var(--accent)', marginBottom: '8px' }}>
                {organizationName} {laborRate > 0 && `• $${laborRate}/hr`}
              </div>
              {vehicleId ? (
                <a
                  href={`/vehicle/${vehicleId}`}
                  style={{ fontSize: '13pt', fontWeight: 700, color: 'var(--text)', textDecoration: 'none' }}
                  className="hover:underline"
                >
                  {vehicleName}
                </a>
              ) : (
                <div style={{ fontSize: '13pt', fontWeight: 700, color: 'var(--text)' }}>
                  {vehicleName}
                </div>
              )}
              <div style={{ fontSize: '11pt', color: 'var(--text-secondary)', marginTop: '2px' }}>
                {event.title}
              </div>
            </div>
            
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {/* Bookmark button */}
              <button
                onClick={toggleBookmark}
                style={{
              background: isBookmarked ? 'var(--accent)' : 'transparent',
              border: '2px solid var(--accent)',
              cursor: 'pointer',
              fontSize: '8pt',
              fontWeight: 600,
              padding: '6px 12px',
              borderRadius: '4px',
              color: isBookmarked ? 'white' : 'var(--accent)',
              transition: 'all 0.12s ease'
            }}
            title={isBookmarked ? 'Remove bookmark' : 'Bookmark for later'}
            className="hover:scale-110"
          >
            {isBookmarked ? 'SAVED' : 'SAVE'}
          </button>
              
              {/* Close button */}
              <button
                onClick={onClose}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '24pt',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: '0',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                ×
              </button>
            </div>
          </div>
          
          {/* Key metrics badges */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {partsTotal > 0 && (
              <div style={{
                fontSize: '8pt',
                padding: '4px 10px',
                borderRadius: '4px',
                background: '#d4edda',
                color: '#155724',
                fontWeight: 600,
                border: '1px solid #c3e6cb'
              }}>
                ${partsTotal.toLocaleString()} parts
              </div>
            )}
            {totalHours > 0 && (
              <div style={{
                fontSize: '8pt',
                padding: '4px 10px',
                borderRadius: '4px',
                background: '#d1ecf1',
                color: '#0c5460',
                fontWeight: 600,
                border: '1px solid #bee5eb'
              }}>
                {totalHours}h labor
              </div>
            )}
            {totalImages > 0 && (
              <div style={{
                fontSize: '8pt',
                padding: '4px 10px',
                borderRadius: '4px',
                background: '#fff3cd',
                color: '#856404',
                fontWeight: 600,
                border: '1px solid #ffeaa7'
              }}>
                {totalImages} {totalImages === 1 ? 'photo' : 'photos'}
              </div>
            )}
            {qualityRating > 0 && (
              <div style={{
                fontSize: '8pt',
                padding: '4px 10px',
                borderRadius: '4px',
                background: qualityRating >= 80 ? '#d4edda' : qualityRating >= 60 ? '#fff3cd' : '#f8d7da',
                color: qualityRating >= 80 ? '#155724' : qualityRating >= 60 ? '#856404' : '#721c24',
                fontWeight: 600,
                border: `1px solid ${qualityRating >= 80 ? '#c3e6cb' : qualityRating >= 60 ? '#ffeaa7' : '#f5c6cb'}`
              }}>
                {qualityRating}/100 quality
              </div>
            )}
            {bookmarkCount > 0 && (
              <div style={{
                fontSize: '8pt',
                padding: '4px 10px',
                borderRadius: '4px',
                background: '#e2e8f0',
                color: '#475569',
                fontWeight: 600
              }}>
                {bookmarkCount} {bookmarkCount === 1 ? 'bookmark' : 'bookmarks'}
              </div>
            )}
          </div>
        </div>

        {/* TABS NAVIGATION */}
        <div style={{
          display: 'flex',
          borderBottom: '2px solid var(--border)',
          background: 'var(--surface)',
          overflowX: 'auto',
          flexShrink: 0
        }}>
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'parts', label: `Parts${partsTotal > 0 ? ` ($${partsTotal.toLocaleString()})` : ''}` },
            { id: 'labor', label: `Labor${totalHours > 0 ? ` (${totalHours}h)` : ''}` },
            { id: 'photos', label: `Photos (${totalImages})` },
            { id: 'shop', label: 'Shop Info' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as Tab)}
              style={{
                flex: '1 0 auto',
                padding: '12px 16px',
                border: 'none',
                borderBottom: activeTab === tab.id ? '3px solid var(--accent)' : '3px solid transparent',
                background: activeTab === tab.id ? 'var(--white)' : 'transparent',
                fontSize: '9pt',
                fontWeight: activeTab === tab.id ? 700 : 400,
                cursor: 'pointer',
                color: activeTab === tab.id ? 'var(--accent)' : 'var(--text)',
                transition: 'all 0.12s ease',
                whiteSpace: 'nowrap'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* TAB CONTENT - Scrollable */}
        <div style={{
          flex: 1,
          overflow: 'auto',
          padding: '20px',
          WebkitOverflowScrolling: 'touch'
        }}>
          {/* OVERVIEW TAB */}
          {activeTab === 'overview' && (
            <div>
              {aiDescription && (
                <div style={{
                  padding: '16px',
                  background: '#f8f9fa',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  marginBottom: '20px'
                }}>
                  <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '8px', color: 'var(--text)' }}>
                    Work Summary
                  </div>
                  <div style={{ fontSize: '9pt', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    {aiDescription}
                  </div>
                </div>
              )}
              
              {workPerformed.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '10px', color: 'var(--text)' }}>
                    Work Performed
                  </div>
                  <ul style={{ margin: 0, paddingLeft: '24px', fontSize: '9pt', color: 'var(--text-secondary)' }}>
                    {workPerformed.map((work, idx) => (
                      <li key={idx} style={{ marginBottom: '6px', lineHeight: 1.5 }}>{work}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              {qualityRating > 0 && event.metadata?.concerns && (
                <div style={{
                  padding: '16px',
                  background: qualityRating >= 80 ? '#d4edda' : '#fff3cd',
                  borderRadius: '6px',
                  border: `1px solid ${qualityRating >= 80 ? '#c3e6cb' : '#ffeaa7'}`,
                  marginBottom: '20px'
                }}>
                  <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '8px', color: 'var(--text)' }}>
                    Quality Rating: {qualityRating}/100
                  </div>
                  <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    {event.metadata.concerns}
                  </div>
                </div>
              )}

              {/* Collaborators */}
              {collaborators.length > 0 && (
                <div style={{
                  padding: '16px',
                  background: '#f8f9fa',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  marginBottom: '20px'
                }}>
                  <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '12px', color: 'var(--text)' }}>
                    Work Order Attribution
                  </div>
                  {collaborators.map(collab => (
                    <div
                      key={collab.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 0',
                        borderBottom: '1px solid var(--border-light)'
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <a
                          href={`/org/${collab.organization_id}`}
                          style={{ fontSize: '9pt', fontWeight: 600, color: 'var(--accent)', textDecoration: 'none' }}
                          className="hover:underline"
                        >
                          {collab.businesses?.business_name}
                        </a>
                        <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: '2px' }}>
                          {collab.role === 'originator' ? 'Work Order Originator' : 
                           collab.role === 'location' ? 'Location / Host' :
                           collab.role === 'performer' ? 'Work Performed By' :
                           collab.role}
                        </div>
                      </div>
                      {collab.revenue_attribution > 0 && (
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '9pt', fontWeight: 700, color: 'var(--accent)' }}>
                            ${parseFloat(collab.revenue_attribution).toLocaleString()}
                          </div>
                          {collab.revenue_percentage && (
                            <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                              {parseFloat(collab.revenue_percentage).toFixed(0)}%
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              
              {workPerformed.length === 0 && !aiDescription && (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '9pt' }}>
                  <div>No detailed work summary available yet.</div>
                  <div style={{ marginTop: '8px', fontSize: '8pt' }}>
                    Shop owners can add notes and details to this work order.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* PARTS TAB */}
          {activeTab === 'parts' && (
            <div>
              {parts.length > 0 ? (
                <div>
                  <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '16px', color: 'var(--text)' }}>
                    Parts & Materials Used
                    <span style={{ float: 'right', color: 'var(--accent)' }}>
                      Total: ${partsTotal.toLocaleString()}
                    </span>
                  </div>
                  
                  {parts.map(part => (
                    <div
                      key={part.id}
                      style={{
                        padding: '16px',
                        marginBottom: '12px',
                        border: '2px solid var(--border)',
                        borderRadius: '6px',
                        background: part.is_ai_detected ? '#f0fdf4' : 'var(--white)'
                      }}
                    >
                      <div style={{ display: 'flex', gap: '12px' }}>
                        {part.image_url && (
                          <img
                            src={part.image_url}
                            alt={part.part_name || part.tag_name}
                            style={{
                              width: '80px',
                              height: '80px',
                              objectFit: 'cover',
                              borderRadius: '4px',
                              border: '1px solid var(--border)'
                            }}
                          />
                        )}
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '4px' }}>
                            {part.part_name || part.tag_name}
                            {part.is_ai_detected && (
                              <span style={{ 
                                fontSize: '7pt', 
                                background: '#10b981', 
                                color: 'white', 
                                padding: '2px 6px', 
                                borderRadius: '3px',
                                marginLeft: '8px'
                              }}>
                                AI DETECTED
                              </span>
                            )}
                            {part.quantity > 1 && (
                              <span style={{ fontSize: '8pt', color: 'var(--text-muted)', marginLeft: '8px' }}>
                                × {part.quantity}
                              </span>
                            )}
                            {part.confidence && (
                              <span style={{ fontSize: '7pt', color: 'var(--text-muted)', marginLeft: '8px' }}>
                                {part.confidence}% confidence
                              </span>
                            )}
                          </div>
                          {part.brand && (
                            <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                              Brand: {part.brand}
                            </div>
                          )}
                          {part.part_number && (
                            <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                              Part #: {part.part_number}
                            </div>
                          )}
                          {part.oem_part_number && (
                            <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                              OEM #: {part.oem_part_number}
                            </div>
                          )}
                          <div style={{ fontSize: '11pt', fontWeight: 700, color: 'var(--accent)' }}>
                            ${parseFloat(part.total_price || part.lowest_price_cents / 100 || 0).toLocaleString()}
                          </div>
                          {(part.buy_url || part.buy_link) && (
                            <a
                              href={part.buy_url || part.buy_link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="button button-small button-primary"
                              style={{
                                marginTop: '8px',
                                fontSize: '8pt',
                                display: 'inline-block',
                                textDecoration: 'none'
                              }}
                            >
                              BUY ON AMAZON
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : partsIdentified.length > 0 ? (
                <div>
                  <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '16px', color: 'var(--text)' }}>
                    Parts & Materials (AI Identified)
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {partsIdentified.map((part, idx) => (
                      <div
                        key={idx}
                        style={{
                          fontSize: '8pt',
                          padding: '8px 12px',
                          background: '#f3f4f6',
                          border: '1px solid #d1d5db',
                          borderRadius: '4px',
                          color: '#374151'
                        }}
                      >
                        {part}
                      </div>
                    ))}
                  </div>
                  <div style={{
                    marginTop: '20px',
                    padding: '16px',
                    background: '#fff3cd',
                    borderRadius: '6px',
                    border: '1px solid #ffeaa7',
                    fontSize: '8pt',
                    color: '#856404'
                  }}>
                    These parts were identified by AI from work photos. Shop owners can add exact part numbers and buy links.
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '9pt' }}>
                  <div>No parts information available yet.</div>
                </div>
              )}
            </div>
          )}

          {/* LABOR TAB */}
          {activeTab === 'labor' && (
            <div>
              {laborItems.length > 0 ? (
                <div>
                  <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '16px', color: 'var(--text)' }}>
                    Labor Breakdown
                    <span style={{ float: 'right', color: 'var(--accent)' }}>
                      {totalHours}h × ${laborRate}/hr = ${laborTotal.toLocaleString()}
                    </span>
                  </div>
                  
                  {laborItems.map(labor => (
                    <div
                      key={labor.id}
                      style={{
                        padding: '12px 16px',
                        marginBottom: '8px',
                        border: '1px solid var(--border)',
                        borderRadius: '4px',
                        background: 'var(--white)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start'
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '2px' }}>
                          {labor.task_name}
                        </div>
                        {labor.task_category && (
                          <div style={{
                            fontSize: '7pt',
                            color: 'var(--text-muted)',
                            textTransform: 'uppercase',
                            marginBottom: '4px'
                          }}>
                            {labor.task_category}
                          </div>
                        )}
                        {labor.notes && (
                          <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', marginTop: '4px' }}>
                            {labor.notes}
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign: 'right', marginLeft: '16px' }}>
                        <div style={{ fontSize: '10pt', fontWeight: 700 }}>
                          {parseFloat(labor.hours).toFixed(1)}h
                        </div>
                        <div style={{ fontSize: '9pt', color: 'var(--accent)' }}>
                          ${parseFloat(labor.total_cost || 0).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : event.labor_hours > 0 ? (
                <div>
                  <div style={{
                    padding: '16px',
                    background: '#f8f9fa',
                    borderRadius: '6px',
                    border: '1px solid var(--border)',
                    marginBottom: '16px'
                  }}>
                    <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '8px' }}>
                      Total Labor: {event.labor_hours}h
                    </div>
                    {laborRate > 0 && (
                      <div style={{ fontSize: '9pt', color: 'var(--text-secondary)' }}>
                        Estimated cost: ${(event.labor_hours * laborRate).toLocaleString()} at ${laborRate}/hr
                      </div>
                    )}
                  </div>
                  <div style={{
                    padding: '16px',
                    background: '#fff3cd',
                    borderRadius: '6px',
                    border: '1px solid #ffeaa7',
                    fontSize: '8pt',
                    color: '#856404'
                  }}>
                    Detailed labor breakdown not available. Shop owners can add itemized tasks for transparency.
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '9pt' }}>
                  <div>No labor information available yet.</div>
                </div>
              )}
            </div>
          )}

          {/* PHOTOS TAB */}
          {activeTab === 'photos' && (
            <div>
              {images.length > 0 ? (
                <div>
                  {/* Main image viewer */}
                  <div style={{
                    position: 'relative',
                    marginBottom: '16px',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    border: '2px solid var(--border)'
                  }}>
                    <img
                      src={images[currentImageIndex]}
                      alt={`Work photo ${currentImageIndex + 1}`}
                      style={{
                        width: '100%',
                        height: 'auto',
                        maxHeight: '60vh',
                        objectFit: 'contain',
                        background: '#000',
                        cursor: 'zoom-in'
                      }}
                      onClick={() => setZoomedImage(images[currentImageIndex])}
                    />
                    
                    {/* Navigation arrows */}
                    {images.length > 1 && (
                      <>
                        <button
                          onClick={() => setCurrentImageIndex(prev => (prev - 1 + images.length) % images.length)}
                          style={{
                            position: 'absolute',
                            left: '10px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            background: 'rgba(0,0,0,0.7)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '50%',
                            width: '40px',
                            height: '40px',
                            fontSize: '20pt',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          ‹
                        </button>
                        <button
                          onClick={() => setCurrentImageIndex(prev => (prev + 1) % images.length)}
                          style={{
                            position: 'absolute',
                            right: '10px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            background: 'rgba(0,0,0,0.7)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '50%',
                            width: '40px',
                            height: '40px',
                            fontSize: '20pt',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          ›
                        </button>
                      </>
                    )}
                    
                    {/* Image counter */}
                    <div style={{
                      position: 'absolute',
                      bottom: '10px',
                      right: '10px',
                      background: 'rgba(0,0,0,0.7)',
                      color: 'white',
                      padding: '4px 12px',
                      borderRadius: '20px',
                      fontSize: '8pt',
                      fontWeight: 600
                    }}>
                      {currentImageIndex + 1} / {images.length}
                    </div>
                  </div>
                  
                  {/* Thumbnail strip */}
                  {images.length > 1 && (
                    <div style={{
                      display: 'flex',
                      gap: '8px',
                      overflowX: 'auto',
                      paddingBottom: '8px'
                    }}>
                      {images.map((img, idx) => (
                        <img
                          key={idx}
                          src={img}
                          alt={`Thumbnail ${idx + 1}`}
                          onClick={() => setCurrentImageIndex(idx)}
                          style={{
                            width: '80px',
                            height: '80px',
                            objectFit: 'cover',
                            borderRadius: '4px',
                            border: idx === currentImageIndex ? '3px solid var(--accent)' : '2px solid var(--border)',
                            cursor: 'pointer',
                            flexShrink: 0
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '9pt' }}>
                  <div>No photos available for this work order.</div>
                </div>
              )}
            </div>
          )}

          {/* SHOP INFO TAB */}
          {activeTab === 'shop' && (
            <div style={{
              padding: '20px',
              background: '#f8f9fa',
              borderRadius: '8px',
              border: '1px solid var(--border)'
            }}>
              <div style={{ fontSize: '12pt', fontWeight: 700, marginBottom: '16px' }}>
                {organizationName}
              </div>
              
              {laborRate > 0 && (
                <div style={{ fontSize: '9pt', marginBottom: '8px' }}>
                  Labor Rate: <strong>${laborRate}/hr</strong>
                </div>
              )}
              
              <div style={{ marginTop: '20px' }}>
                <a
                  href={`/org/${event.organization_id || event.business_id}`}
                  className="button button-primary"
                  style={{ fontSize: '9pt', textDecoration: 'none', display: 'inline-block' }}
                >
                  View Full Profile
                </a>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Zoomed image lightbox */}
      {zoomedImage && ReactDOM.createPortal(
        <div
          onClick={() => setZoomedImage(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.95)',
            zIndex: 100000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
        >
          <img
            src={zoomedImage}
            alt="Zoomed"
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain'
            }}
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setZoomedImage(null)}
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              background: 'rgba(255,255,255,0.2)',
              color: 'white',
              border: 'none',
              borderRadius: '50%',
              width: '50px',
              height: '50px',
              fontSize: '30pt',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            ×
          </button>
        </div>,
        document.body
      )}
    </div>,
    document.body
  );
}
