import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { supabase } from '../lib/supabase';
import AddEventWizard from './AddEventWizard';
import { UniversalImageUpload } from './UniversalImageUpload';
import TimelineEventComments from './TimelineEventComments';
import TimelineEventEditor from './TimelineEventEditor';
import { TechnicianWorkTimeline } from './TechnicianWorkTimeline';
import { TimelineEventService } from '../services/timelineEventService';
import { ComprehensiveWorkOrderReceipt } from './ComprehensiveWorkOrderReceipt';
import { ParticipantBadge } from './auction/AuctionBadges';
import { generateDaySummary, generateEventSummary } from '../utils/timelineSummary';
import WorkSessionEventCard from './timeline/WorkSessionEventCard';

// Types
// Note: DB supports auction_* event types via timeline_events constraint migration.
// Keep this list in sync so auction timeline events render cleanly.
type EventType =
  | 'maintenance'
  | 'repair'
  | 'modification'
  | 'inspection'
  | 'purchase'
  | 'sale'
  | 'accident'
  | 'registration'
  | 'insurance'
  | 'transport'
  | 'evaluation'
  | 'general'
  | 'custom'
  | 'life'
  | 'documentation'
  | 'pending_analysis'
  | 'auction_listed'
  | 'auction_started'
  | 'auction_bid_placed'
  | 'auction_reserve_met'
  | 'auction_extended'
  | 'auction_ending_soon'
  | 'auction_ended'
  | 'auction_sold'
  | 'auction_reserve_not_met';

interface TimelineEvent {
  id: string;
  vehicle_id: string;
  title: string;
  description?: string;
  event_type: EventType;
  event_date: string;
  created_at: string;
  created_by: string;
  mileage_at_event?: number;
  cost_amount?: number;
  cost_currency?: string;
  location_name?: string;
  service_provider_name?: string;
  image_urls?: string[];
  metadata?: any;
  participants?: any[];
  locations?: any[];
  proofs?: any[];
  images?: any[];
}

interface EventImage {
  id: string;
  event_id: string;
  image_url: string;
  image_context?: string;
  category?: string;
}

const VehicleTimeline: React.FC<{ 
  vehicleId: string; 
  isOwner: boolean; 
  onDateClick?: (date: string, events: any[]) => void;
}> = ({ vehicleId, isOwner, onDateClick }) => {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [photoDates, setPhotoDates] = useState<Map<string, number>>(new Map()); // Map of date -> photo count
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingEvent, setEditingEvent] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid');
  
  // Track UI state
  const [showAdvancedFields, setShowAdvancedFields] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [selectedDayEvents, setSelectedDayEvents] = useState<TimelineEvent[]>([]);
  const [showDayPopup, setShowDayPopup] = useState(false);
  const [dayInvoicesByEventId, setDayInvoicesByEventId] = useState<Record<string, any>>({});
  const [dayInvoicesLoading, setDayInvoicesLoading] = useState(false);
  const [creatingWorkSession, setCreatingWorkSession] = useState(false);
  const [popupImageUrl, setPopupImageUrl] = useState<string | null>(null);
  const [selectedEventForDetail, setSelectedEventForDetail] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [eventFiles, setEventFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{[key: string]: number}>({});
  const [totalSize, setTotalSize] = useState(0);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userVehicleRole, setUserVehicleRole] = useState<string>('contributor');
  const [autoParticipants, setAutoParticipants] = useState<{role: string, reason: string}[]>([]);
  const [imageVerificationStatus, setImageVerificationStatus] = useState<{[key: string]: 'pending' | 'verified' | 'flagged'}>({});
  const [showWizard, setShowWizard] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [showWorkTimeline, setShowWorkTimeline] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'life'>('all');
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [editingEventData, setEditingEventData] = useState<{title: string; description: string; event_date: string}>({title: '', description: '', event_date: ''});
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [timelineEventsExpanded, setTimelineEventsExpanded] = useState<boolean>(false);
  const [vehicleOwner, setVehicleOwner] = useState<string | null>(null);
  const [vehicleValueMeta, setVehicleValueMeta] = useState<{ current_value?: number|null; asking_price?: number|null; purchase_price?: number|null; msrp?: number|null } | null>(null);
  const [readyTargetHours, setReadyTargetHours] = useState<number>(100);
  const autoOpenedTodayRef = React.useRef<boolean>(false);
  const yearsScrollerRef = React.useRef<HTMLDivElement | null>(null);

  // Helper: normalize any date-ish value to YYYY-MM-DD without timezone shifting.
  // - If it's already a date-only string, keep it.
  // - If it includes a time, drop the time portion.
  // - Fallback: parse as Date and use ISO date (UTC).
  const toDateOnly = (raw: any): string => {
    if (!raw) return new Date().toISOString().slice(0, 10);
    try {
      const s = String(raw);
      if (s.includes('T')) return s.split('T')[0];
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const d = new Date(s);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    } catch {}
    return new Date().toISOString().slice(0, 10);
  };

  const yearFromDateOnly = (ymd: string): number => {
    const y = Number(String(ymd || '').slice(0, 4));
    return Number.isFinite(y) ? y : new Date().getUTCFullYear();
  };

  const addDaysYmd = (ymd: string, days: number): string => {
    const [y, m, d] = String(ymd || '').split('-').map((x) => Number(x));
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return ymd;
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10);
  };

  const ymdToUtcStart = (ymd: string): string => `${ymd}T00:00:00.000Z`;

  useEffect(() => {
    loadTimelineEvents();
    loadCurrentUser();
    loadUserVehicleRole();
    loadVehicleOwner();
  }, [vehicleId]);

  useEffect(() => {
    const handleImageUpdate = (event: CustomEvent) => {
      if (event.detail?.vehicleId === vehicleId) {
        loadTimelineEvents();
      }
    };
    
    window.addEventListener('vehicle_images_updated', handleImageUpdate as any);
    return () => {
      window.removeEventListener('vehicle_images_updated', handleImageUpdate as any);
    };
  }, [vehicleId]);

  useEffect(() => {
    updateAutoParticipants();
  }, [eventFiles, currentUser]);

  const loadUserVehicleRole = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Check if user is vehicle owner first
        if (isOwner) {
          setUserVehicleRole('owner');
          return;
        }

        // Check for specific roles in user_vehicle_roles table (if it exists)
        const { data: roleData } = await supabase
          .from('user_vehicle_roles')
          .select('role')
          .eq('user_id', user.id)
          .eq('vehicle_id', vehicleId)
          .maybeSingle();

        if (roleData) {
          setUserVehicleRole(roleData.role);
        } else {
          setUserVehicleRole('contributor');
        }
      }
    } catch (error) {
      console.error('Error loading user vehicle role:', error);
      setUserVehicleRole('contributor');
    }
  };

  const loadCurrentUser = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user);
    } catch (error) {
      console.error('Error loading current user:', error);
    }
  };

  const loadVehicleOwner = async () => {
    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select('user_id, current_value, asking_price, purchase_price, msrp')
        .eq('id', vehicleId)
        .single();
      if (data && !error) {
        setVehicleOwner(data.user_id);
        setVehicleValueMeta({
          current_value: (data as any).current_value ?? null,
          asking_price: (data as any).asking_price ?? null,
          purchase_price: (data as any).purchase_price ?? null,
          msrp: (data as any).msrp ?? null
        });
      }
      // Optional: load readiness target hours if available
      try {
        const { data: s } = await supabase
          .from('vehicle_sale_settings')
          .select('target_ready_hours')
          .eq('vehicle_id', vehicleId)
          .maybeSingle();
        if (s && typeof (s as any).target_ready_hours === 'number') {
          setReadyTargetHours((s as any).target_ready_hours);
        }
      } catch {}
    } catch (e) {
      // ignore
    }
  };

  // Heuristic: estimate hours for a single event
  const estimateEventHours = (ev: any): number => {
    const md = (ev?.metadata || {}) as any;
    if (typeof md.labor_hours === 'number') return Math.max(0, Math.min(24, md.labor_hours));
    if (typeof md.hours === 'number') return Math.max(0, Math.min(24, md.hours));
    const imgCount = (Array.isArray(ev?.image_urls) ? ev.image_urls.length : 0) || Number(md.uploaded_images || 0);
    // Baseline + small per-photo heuristic
    let hours = 0.25 + imgCount / 20; // 20 photos ~ 1 hr
    // Extra weight for repair/modification types
    const t = String(ev?.event_type || '').toLowerCase();
    if (t.includes('repair') || t.includes('modification') || t.includes('engine')) {
      hours += 0.5;
    }
    return Math.min(12, Math.max(0, hours));
  };

  const currency = (n?: number|null) => {
    if (typeof n !== 'number') return '—';
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
    } catch { return `$${Math.round(n)}`; }
  };

  const valueAnchor = (): number | null => {
    const m = vehicleValueMeta || {};
    return (typeof m.current_value === 'number' && m.current_value) ||
           (typeof m.asking_price === 'number' && m.asking_price) ||
           (typeof (m as any).sale_price === 'number' && (m as any).sale_price) ||
           (typeof m.purchase_price === 'number' && m.purchase_price) ||
           (typeof m.msrp === 'number' && m.msrp) || null;
  };

  const calcEventImpact = (ev: any) => {
    // Don't calculate labor cost for photo/inspection events - photos document work, they aren't work
    const isPhotoEvent = ['inspection', 'documentation', 'pending_analysis'].includes(ev?.event_type);
    
    // For sale/auction events, use actual sale price, not calculated labor
    const isSaleEvent = ['sale', 'auction_started', 'auction_listed', 'auction_bid_placed', 'auction_reserve_met', 'auction_ended', 'auction_sold', 'auction_reserve_not_met'].includes(ev?.event_type);
    
    let valueUSD = 0;
    let hours = 0;
    
    if (isSaleEvent) {
      // Use actual sale price from cost_amount or metadata
      valueUSD = ev?.cost_amount || ev?.metadata?.sale_price || ev?.metadata?.bid_amount || 0;
      hours = 0; // No labor hours for sales
    } else if (isPhotoEvent) {
      hours = 0;
      valueUSD = 0;
    } else {
      // Calculate labor cost for work/service events
      hours = estimateEventHours(ev);
      const laborRate = 120; // USD/hr default
      valueUSD = hours * laborRate;
    }
    
    const anchor = valueAnchor();
    const pct = anchor ? (valueUSD / anchor) * 100 : null;
    const ts = (ev?.metadata?.when?.photo_taken || ev?.metadata?.when?.uploaded || ev?.created_at || ev?.event_date);
    return { hours, valueUSD, anchor, pct, ts };
  };

  const isUuid = (v: any): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || '').trim());

  // When a day receipt is open, load invoices for all events on that day (best-effort).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!showDayPopup || !Array.isArray(selectedDayEvents) || selectedDayEvents.length === 0) {
          setDayInvoicesByEventId({});
          setDayInvoicesLoading(false);
          return;
        }

        const uniqueEvents = (selectedDayEvents || []).filter((ev, idx, arr) =>
          arr.findIndex((e: any) => e.id === ev.id || (e.title === ev.title && e.event_date === ev.event_date)) === idx
        );
        const ids = uniqueEvents.map((e: any) => String(e.id || '').trim()).filter(isUuid);
        if (ids.length === 0) {
          setDayInvoicesByEventId({});
          setDayInvoicesLoading(false);
          return;
        }

        setDayInvoicesLoading(true);
        const { data, error } = await supabase
          .from('generated_invoices')
          .select('id,event_id,invoice_number,total_amount,status,payment_status')
          .in('event_id', ids);

        if (cancelled) return;
        if (error) throw error;

        const by: Record<string, any> = {};
        for (const row of (data || []) as any[]) {
          const eid = String(row.event_id || '').trim();
          if (!eid) continue;
          by[eid] = row;
        }
        setDayInvoicesByEventId(by);
      } catch (e) {
        if (!cancelled) setDayInvoicesByEventId({});
      } finally {
        if (!cancelled) setDayInvoicesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [showDayPopup, selectedDayEvents]);

  // Group photo_added events in a single day into one evidence set
  const groupDayEvents = (dayEvents: TimelineEvent[]): TimelineEvent[] => {
    // ✅ No longer grouping photo events since photos aren't events
    return dayEvents;
  };

  const toggleComments = (eventId: string) => {
    const newExpanded = new Set(expandedComments);
    if (newExpanded.has(eventId)) {
      newExpanded.delete(eventId);
    } else {
      newExpanded.add(eventId);
    }
    setExpandedComments(newExpanded);
  };

  const updateAutoParticipants = () => {
    const participants: {role: string, reason: string}[] = [];
    
    if (currentUser) {
      participants.push({
        role: userVehicleRole,
        reason: `Current user (${userVehicleRole})`
      });
    }

    // Add participants based on event files
    if (eventFiles.length > 0) {
      participants.push({
        role: 'photographer',
        reason: `Uploaded ${eventFiles.length} images`
      });
    }

    setAutoParticipants(participants);
  };

  const loadTimelineEvents = async () => {
    try {
      setLoading(true);

      // Load timeline events (actual work/events only, not photos)
      let timelineData: any[] = [];
      let timelineError: any = null;
      const primaryResult = await supabase
        .from('vehicle_timeline_events')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('event_date', { ascending: false })
        .limit(200);
      timelineData = primaryResult.data || [];
      timelineError = primaryResult.error;

      // Fallback to timeline_events if the view/table is missing or empty.
      if (timelineError || (timelineData || []).length === 0) {
        const fallbackResult = await supabase
          .from('timeline_events')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('event_date', { ascending: false })
          .limit(200);
        if (!fallbackResult.error) {
          timelineData = fallbackResult.data || [];
          timelineError = null;
        }
      }

      // Load auction activity dates (comments and events)
      const { data: auctionDataRaw, error: auctionErr } = await supabase
        .from('auction_comments')
        .select('posted_at, comment_type, bid_amount, is_leading_bid')
        .eq('vehicle_id', vehicleId)
        .order('posted_at', { ascending: false })
        .limit(5000);
      const auctionData = auctionErr ? [] : (auctionDataRaw || []);

      // Load auction events (ended/sold) and synthesize timeline entries so the timeline is never "empty"
      // for auction-origin vehicles. We treat auctions as evidence about the vehicle.
      let auctionTimelineEvents: any[] = [];
      try {
        const { data: aeRows, error: aeErr } = await supabase
          .from('auction_events')
          .select('id, source, source_url, outcome, auction_start_date, auction_end_date, high_bid, winning_bid, total_bids, comments_count, seller_name, winning_bidder, lot_number')
          .eq('vehicle_id', vehicleId)
          .order('auction_end_date', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .limit(25);

        if (!aeErr && Array.isArray(aeRows) && aeRows.length > 0) {
          auctionTimelineEvents = aeRows
            .filter((r: any) => Boolean(r?.auction_end_date || r?.auction_start_date))
            .map((r: any) => {
              const platform = String(r?.source || 'auction').toUpperCase();
              const outcome = String(r?.outcome || '').toLowerCase();
              const isSold = outcome === 'sold' || (typeof r?.winning_bid === 'number' && r.winning_bid > 0);
              const isRNM = outcome === 'reserve_not_met' || outcome === 'no_sale';
              const amount = isSold ? (r?.winning_bid ?? r?.high_bid ?? null) : (r?.high_bid ?? null);
              const amountText = (typeof amount === 'number' && amount > 0) ? `$${Math.round(amount).toLocaleString()}` : null;

              const endYmd = r?.auction_end_date ? toDateOnly(r.auction_end_date) : toDateOnly(r.auction_start_date);
              const eventType =
                isSold ? 'auction_sold' :
                isRNM ? 'auction_reserve_not_met' :
                'auction_ended';

              const title =
                isSold
                  ? `${platform} sold${amountText ? ` for ${amountText}` : ''}`
                  : isRNM
                    ? `${platform} ended (RNM)${amountText ? ` • bid to ${amountText}` : ''}`
                    : `${platform} ended${amountText ? ` • bid to ${amountText}` : ''}`;

              const descParts: string[] = [];
              if (r?.lot_number) descParts.push(`Lot #${r.lot_number}`);
              if (typeof r?.total_bids === 'number') descParts.push(`${r.total_bids} bids`);
              if (typeof r?.comments_count === 'number') descParts.push(`${r.comments_count} comments`);
              const description = descParts.length ? descParts.join(' • ') : undefined;

              return {
                id: `auction-${r.id}`,
                vehicle_id: vehicleId,
                event_type: eventType,
                event_date: endYmd,
                title,
                description,
                created_at: new Date().toISOString(),
                created_by: 'system',
                image_urls: [],
                metadata: {
                  auction_event_id: r.id,
                  platform: r.source,
                  source_url: r.source_url,
                  outcome,
                  high_bid: r.high_bid,
                  winning_bid: r.winning_bid,
                  winning_bidder: r.winning_bidder,
                  seller: r.seller_name,
                  lot_number: r.lot_number,
                  total_bids: r.total_bids,
                  comments_count: r.comments_count,
                },
                __table: 'auction_events'
              };
            });
        }
      } catch (err) {
        console.error('Error loading auction events:', err);
      }

      // Load photo dates for calendar heatmap (photos ARE activity even if not events)
      const { data: imageData } = await supabase
        .from('vehicle_images')
        .select('taken_at, created_at')
        .eq('vehicle_id', vehicleId);

      // Build activity date map for calendar (photos + auction activity)
      const activityDateMap = new Map<string, number>();

      // Add photo dates
      if (imageData) {
        for (const img of imageData) {
          const dt = (img as any)?.taken_at || (img as any)?.created_at;
          if (dt) {
            const dateKey = toDateOnly(dt);
            activityDateMap.set(dateKey, (activityDateMap.get(dateKey) || 0) + 1);
          }
        }
      }

      // Add auction activity dates
      if (auctionData) {
        for (const comment of auctionData) {
          if (comment.posted_at) {
            const dateKey = toDateOnly(comment.posted_at);
            activityDateMap.set(dateKey, (activityDateMap.get(dateKey) || 0) + 1);
          }
        }
      }

      setPhotoDates(activityDateMap);
      console.log(`Loaded ${activityDateMap.size} days with activity (photos + auction)`);

      // If today's auction is live, auto-open a "daily auction receipt" once per session.
      try {
        const todayYmd = new Date().toISOString().slice(0, 10);
        const todayActivity = activityDateMap.get(todayYmd) || 0;
        if (!autoOpenedTodayRef.current && todayActivity > 0 && Array.isArray(auctionData) && auctionData.length > 0) {
          // Determine if auction is live using external_listings end_date when available (more reliable than joins).
          let isLiveAuction = true;
          try {
            const { data: listing } = await supabase
              .from('external_listings')
              .select('end_date, listing_status, updated_at')
              .eq('vehicle_id', vehicleId)
              .order('updated_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            const status = String((listing as any)?.listing_status || '').toLowerCase();
            const end = (listing as any)?.end_date ? new Date((listing as any).end_date).getTime() : NaN;
            if (status === 'ended' || status === 'sold') isLiveAuction = false;
            if (Number.isFinite(end)) isLiveAuction = end > Date.now();
          } catch {
            // If we can't determine, prefer showing the open receipt (vehicle-first UX).
            isLiveAuction = true;
          }

          if (isLiveAuction) {
            const alreadyOpenedKey = `nzero_open_receipt_${vehicleId}_${todayYmd}`;
            const alreadyOpened = (() => {
              try { return window.localStorage.getItem(alreadyOpenedKey) === '1'; } catch { return false; }
            })();

            if (!alreadyOpened) {
              // Filter auction activity for today
              const dayAuction = auctionData.filter((c: any) => {
                const at = c?.posted_at ? new Date(c.posted_at).toISOString().slice(0, 10) : null;
                return at === todayYmd;
              });

              if (dayAuction.length > 0) {
                autoOpenedTodayRef.current = true;
                try { window.localStorage.setItem(alreadyOpenedKey, '1'); } catch {}

                const activityEvent = {
                  id: `activity-${todayYmd}`,
                  vehicle_id: vehicleId,
                  event_type: 'documentation' as any,
                  event_date: todayYmd,
                  title: `${dayAuction.length} auction comment${dayAuction.length === 1 ? '' : 's'}`,
                  description: 'Bring a Trailer auction activity (live)',
                  image_urls: [],
                  metadata: {
                    auction_activity: true,
                    auction_count: dayAuction.length,
                    auction_data: dayAuction,
                    receipt_open: true,
                  }
                };
                setSelectedDayEvents([activityEvent as any]);
                setShowDayPopup(true);
              }
            }
          }
        }
      } catch {
        // ignore auto-open failures
      }

      // Load future auction listings to show as scheduled events in the timeline
      let futureAuctionEvents: any[] = [];
      try {
        // Query all listings for this vehicle - we'll filter for future dates on frontend
        // Don't filter by status since listings can be incorrectly marked as 'ended'
        const { data: futureListings } = await supabase
          .from('external_listings')
          .select('id, platform, listing_url, start_date, end_date, listing_status, metadata')
          .eq('vehicle_id', vehicleId)
          .order('start_date', { ascending: true, nullsFirst: false })
          .limit(10);

        const nowMs = Date.now();
        
        // Convert future auctions to timeline event format
        futureAuctionEvents = (futureListings || [])
          .filter((listing: any) => {
            // Use start_date/end_date from columns, or fallback to metadata.sale_date
            const startDate = listing.start_date ? new Date(listing.start_date).getTime() : 
                              listing.metadata?.sale_date ? new Date(listing.metadata.sale_date).getTime() : null;
            const endDate = listing.end_date ? new Date(listing.end_date).getTime() : 
                            listing.metadata?.sale_date ? new Date(listing.metadata.sale_date).getTime() : null;
            return (startDate && startDate > nowMs) || (endDate && endDate > nowMs);
          })
          .map((listing: any) => {
            // Build event name from location or platform
            const location = listing.metadata?.location;
            const eventName = listing.metadata?.event_name || 
                              listing.metadata?.auction_name || 
                              (location ? `${listing.platform ? listing.platform.charAt(0).toUpperCase() + listing.platform.slice(1) : ''} ${location}`.trim() : null) ||
                              `${listing.platform ? listing.platform.charAt(0).toUpperCase() + listing.platform.slice(1) : 'Upcoming'} Auction`;
            const lotNumber = listing.metadata?.lot_number;
            const estimateLow = listing.metadata?.estimate_low;
            const estimateHigh = listing.metadata?.estimate_high;
            
            // Get auction date from columns or fallback to metadata
            const auctionDate = listing.start_date || listing.end_date || listing.metadata?.sale_date;
            
            return {
              id: `future-auction-${listing.id}`,
              vehicle_id: vehicleId,
              event_type: 'scheduled_auction',
              event_date: auctionDate,
              title: `Scheduled: ${eventName}`,
              description: lotNumber 
                ? `Lot #${lotNumber}${estimateLow || estimateHigh ? ` | Est: $${(estimateLow || 0).toLocaleString()} - $${(estimateHigh || 0).toLocaleString()}` : ''}`
                : 'Upcoming auction',
              metadata: {
                platform: listing.platform,
                listing_url: listing.listing_url,
                is_future: true,
                lot_number: lotNumber,
                estimate_low: estimateLow,
                estimate_high: estimateHigh,
                ...listing.metadata
              },
              __table: 'future_auction'
            };
          });
        
        if (futureAuctionEvents.length > 0) {
          console.log(`Found ${futureAuctionEvents.length} upcoming auction event(s)`);
        }
      } catch (err) {
        console.error('Error loading future auctions:', err);
      }

      if (timelineError) {
        console.error('Error loading timeline events:', timelineError);
        setError(timelineError?.message || 'Failed to load timeline events');
        const mergedFallback: any[] = [
          ...(futureAuctionEvents || []),
          ...(auctionTimelineEvents || []),
        ];
        setEvents(mergedFallback.length > 0 ? (mergedFallback as any) : []);
      } else {
        let merged: any[] = (timelineData || []).map((e: any) => ({ ...e, __table: 'timeline_events' }));
        
        // Add ended auction events to the timeline (vehicle-first evidence)
        if (auctionTimelineEvents.length > 0) {
          merged = [...auctionTimelineEvents, ...merged];
          for (const ev of auctionTimelineEvents) {
            if (ev?.event_date) {
              const dateKey = toDateOnly(ev.event_date);
              activityDateMap.set(dateKey, (activityDateMap.get(dateKey) || 0) + 1);
            }
          }
        }

        // Add future auction events to the timeline
        if (futureAuctionEvents.length > 0) {
          merged = [...futureAuctionEvents, ...merged];
          
          // Also add future auction dates to the activity map so they show in calendar
          for (const ev of futureAuctionEvents) {
            if (ev.event_date) {
              const dateKey = toDateOnly(ev.event_date);
              activityDateMap.set(dateKey, (activityDateMap.get(dateKey) || 0) + 1);
            }
          }
        }

        // ✅ PHOTOS ARE NOT EVENTS
        // But photo dates ARE loaded separately for the calendar heatmap

        // Stable sort: newest first
        merged = merged.sort((a: any, b: any) => {
          const da = new Date(a?.event_date || 0).getTime();
          const db = new Date(b?.event_date || 0).getTime();
          if (Number.isFinite(db) && Number.isFinite(da) && db !== da) return db - da;
          return String(b?.id || '').localeCompare(String(a?.id || ''));
        });

        console.log(`Loaded ${merged.length} timeline events`);
        setEvents(merged as any);

        // Get all years from both events AND photos
        const yearCounts: Record<number, number> = {};
        
        // Count timeline events by year
        merged.forEach((ev: any) => {
          const year = yearFromDateOnly(toDateOnly(ev.event_date));
          yearCounts[year] = (yearCounts[year] || 0) + 1;
        });
        
        // Add activity counts by year (photos + auction)
        activityDateMap.forEach((count, dateStr) => {
          const year = yearFromDateOnly(toDateOnly(dateStr));
          yearCounts[year] = (yearCounts[year] || 0) + count;
        });
        
        if (Object.keys(yearCounts).length > 0) {
          // Check if there are future scheduled events - prioritize showing those years
          const futureYears = futureAuctionEvents
            .filter(ev => ev.event_date)
            .map(ev => yearFromDateOnly(toDateOnly(ev.event_date)));
          
          // If there's a future auction, prioritize that year
          if (futureYears.length > 0) {
            const nearestFutureYear = Math.min(...futureYears);
            setSelectedYear(nearestFutureYear);
            console.log(`Setting timeline to year ${nearestFutureYear} (has scheduled auction)`);
          } else {
            // Sort by activity count (most active year first), then by year (most recent first)
            const sortedYears = Object.entries(yearCounts)
              .sort(([yearA, countA], [yearB, countB]) => {
                if (countB !== countA) return countB - countA;
                return Number(yearB) - Number(yearA);
              })
              .map(([year]) => Number(year));
            
            // Always set to the year with the most activity (events + photos + auction)
            setSelectedYear(sortedYears[0]);
            console.log(`Setting timeline to year ${sortedYears[0]} with ${yearCounts[sortedYears[0]]} items (events + photos + auction)`);
          }
        }
      }
    } catch (error) {
      console.error('Timeline loading failed:', error);
      setError('Failed to load timeline');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const getEventTypeColor = (eventType: string) => {
    const eventTypeColors: { [key: string]: string } = {
      transport: 'badge-info',
      inspection: 'badge-warning',
      evaluation: 'badge-secondary',
      repair: 'badge-danger',
      maintenance: 'badge-primary',
      modification: 'badge-success',
      purchase: 'badge-info',
      sale: 'badge-warning',
      accident: 'badge-danger',
      registration: 'badge-secondary',
      insurance: 'badge-warning',
      general: 'badge-secondary',
      custom: 'badge-dark',
      life: 'badge-info',
      scheduled_auction: 'badge-primary'
    };
    return eventTypeColors[eventType] || 'badge-secondary';
  };

  const handleDeleteEvent = async (eventId: string) => {
    try {
      // Only allow deletion of real DB events (skip synthesized image events prefixed with img_)
      if (eventId.startsWith('img_')) {
        alert('This item is derived from a photo record. Delete the photo from Images to remove it from the timeline.');
        return;
      }

      const { error } = await supabase
        .from('vehicle_timeline_events')
        .delete()
        .eq('id', eventId);

      if (error) {
        console.error('Error deleting event:', error);
        alert('Failed to delete event. Please try again.');
        return;
      }

      // Remove from local state
      setEvents(prev => prev.filter(event => event.id !== eventId));
      setShowDeleteConfirm(null);
    } catch (error) {
      console.error('Error deleting event:', error);
      alert('Failed to delete event. Please try again.');
    }
  };

  if (loading) {
    return (
      <div className="card">
        <div className="card-body">
          <div className="text-center">
            <div className="spinner-border" role="status">
              <span className="sr-only">Loading...</span>
            </div>
            <p className="mt-2">Loading timeline events...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <div className="card-body">
          <div className="alert alert-danger">
            <h5>Error Loading Timeline</h5>
            <p>{error}</p>
            <button className="btn btn-primary" onClick={loadTimelineEvents}>
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Build list of distinct years for index navigation (plain compute to avoid hook ordering issues)
  const yearIndex: number[] = Array.from(new Set([
    ...events.map((ev) => yearFromDateOnly(toDateOnly((ev as any).event_date))),
    ...Array.from(photoDates.keys()).map((ymd) => yearFromDateOnly(toDateOnly(ymd))),
  ])).sort((a,b) => b-a);

  const selectYear = (y: number) => {
    setSelectedYear(y);
  };

  const currentTopYear = yearIndex[0];
  const scrollYearsBy = (direction: 'left' | 'right') => {
    const el = yearsScrollerRef.current;
    if (!el) return;
    const amount = Math.max(140, Math.round(el.clientWidth * 0.85));
    el.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' });
  };

  return (
    <div className="card">
      <div className="card-body" style={{ position: 'relative' }}>

        {/* Events auto-generated from images, receipts, work orders */}

        {/* Events Display (Grid only) */}
        {events.length === 0 ? (
          <div className="text-center p-6">
            <div className="text-sm text-gray-600 mb-4">No timeline events yet</div>
            <div className="text-xs text-gray-500 mb-4">
              Timeline auto-populates from uploaded images, receipts, and work orders.
            </div>
          </div>
        ) : (
          <div className="timeline-container" style={{ position: 'relative' }}>
            {/* Single column layout for cleaner design */}
            <div>
              {/* Main timeline content */}
              <div>
                {/* Year-based timeline grid - render only selected year */}
                {(() => {
                  const filtered = filterType==='life' ? events.filter(e => (e as any).event_type==='life') : events;
                  const targetYear = selectedYear ?? currentTopYear;
                  if (!targetYear) return null;
                  const yearEvents = filtered.filter(e => yearFromDateOnly(toDateOnly((e as any).event_date)) === targetYear);

                  return (
                    <div
                      key={targetYear}
                      id={`year-${targetYear}`}
                      className="rounded-lg"
                      style={{
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        color: 'var(--text)',
                        padding: '12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px'
                      }}
                    >
                      {/* Year selector (horizontal, scrollable) */}
                      {yearIndex.length > 1 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                          <button
                            type="button"
                            className="btn-utility"
                            onClick={() => scrollYearsBy('left')}
                            title="Scroll years left"
                            aria-label="Scroll years left"
                            style={{
                              padding: 0,
                              width: 20,
                              height: 20,
                              lineHeight: '18px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flex: '0 0 auto',
                              fontSize: '9pt',
                              fontWeight: 800,
                            }}
                          >
                            ‹
                          </button>

                          <div
                            ref={yearsScrollerRef}
                            className="no-scrollbar"
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              overflowX: 'auto',
                              overflowY: 'hidden',
                              WebkitOverflowScrolling: 'touch',
                              minWidth: 0,
                              flex: '1 1 auto',
                              paddingBottom: 2,
                            }}
                          >
                            {yearIndex.map((y) => (
                              <button
                                key={y}
                                type="button"
                                className={`btn-utility ${targetYear === y ? 'active' : ''}`}
                                onClick={() => selectYear(y)}
                                title={`View ${y}`}
                                aria-pressed={targetYear === y}
                                style={{
                                  padding: '2px 6px',
                                  fontSize: '8pt',
                                  lineHeight: '16px',
                                  height: 20,
                                  whiteSpace: 'nowrap',
                                  flex: '0 0 auto',
                                }}
                              >
                                {y}
                              </button>
                            ))}
                          </div>

                          <button
                            type="button"
                            className="btn-utility"
                            onClick={() => scrollYearsBy('right')}
                            title="Scroll years right"
                            aria-label="Scroll years right"
                            style={{
                              padding: 0,
                              width: 20,
                              height: 20,
                              lineHeight: '18px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flex: '0 0 auto',
                              fontSize: '9pt',
                              fontWeight: 800,
                            }}
                          >
                            ›
                          </button>
                        </div>
                      )}

                      {/* Months header positioned above everything */}
                      <div style={{ marginBottom: '4px' }}>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '24px repeat(53, 12px)',
                            gap: '2px',
                            justifyContent: 'start'
                          }}
                        >
                          {/* empty cell to align with weekday label column */}
                          <div style={{ gridColumn: '1 / span 1' }} />
                          {/* Month labels - each month gets ~4.4 columns (53 weeks / 12 months) */}
                          {Array.from({ length: 12 }, (_, monthIndex) => {
                            const startWeek = Math.floor((monthIndex * 53) / 12);
                            const endWeek = Math.floor(((monthIndex + 1) * 53) / 12);
                            const monthWidth = endWeek - startWeek;
                            const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                            return (
                              <div
                                key={monthIndex}
                                style={{
                                  gridColumn: `${startWeek + 2} / span ${monthWidth}`,
                                  textAlign: 'center',
                                  fontSize: '8pt',
                                  color: 'var(--text-muted)',
                                  lineHeight: '8px',
                                  fontWeight: 500
                                }}
                              >
                                {monthNames[monthIndex]}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      
                      {/* Timeline grid */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px', minWidth: 0 }}>
                        {/* Timeline grid column */}
                        <div style={{ minWidth: 0, overflow: 'hidden' }}>


                      {/* Vertical Day Grid: Weekday labels + 7 rows × 53 columns */}
                      {(() => {
                        const year = targetYear;
                        // Build the grid in UTC to prevent timezone shifts when using toISOString().
                        const jan1 = new Date(Date.UTC(year, 0, 1));
                        const gridStart = new Date(jan1);
                        // Align to Monday on/before Jan 1 (UTC)
                        const dow = gridStart.getUTCDay(); // 0=Sun,1=Mon,...
                        const diffToMonday = (dow + 6) % 7; // 0 if Monday, 6 if Sunday
                        gridStart.setUTCDate(gridStart.getUTCDate() - diffToMonday);
                        const totalWeeks = 53;

                        const hoursForDay = (dayEvents: TimelineEvent[]): number => {
                          let hours = 0;
                          for (const ev of dayEvents) {
                            const md = (ev.metadata || {}) as any;
                            const imgCount = (Array.isArray(ev.image_urls) ? ev.image_urls.length : 0) || Number(md.uploaded_images || 0);
                            hours += Math.min(9, imgCount / 20);
                            hours += 0.25;
                          }
                          return Math.min(12, hours);
                        };

                        const colorForHours = (h: number) => {
                          if (h <= 0) return 'var(--heat-0)';
                          if (h < 1) return 'var(--heat-1)';
                          if (h < 3) return 'var(--heat-2)';
                          if (h < 6) return 'var(--heat-3)';
                          if (h < 12) return 'var(--heat-4)';
                          return 'var(--heat-5)';
                        };

                        return (
                          <div style={{ display: 'grid', gridTemplateColumns: '24px auto', gap: '2px' }}>
                            {/* Weekday labels (Mon-Sun) */}
                            <div style={{ display: 'grid', gridTemplateRows: 'repeat(7, 12px)', gap: '2px' }}>
                              {['M','T','W','T','F','S','S'].map((d, i) => (
                                <div key={i} style={{ textAlign: 'center', fontSize: '8pt', color: 'var(--text-muted)', lineHeight: '12px', fontWeight: 500 }}>{d}</div>
                              ))}
                            </div>
                            {/* Timeline grid */}
                            <div>
                              <div
                                className="timeline-grid"
                                style={{
                                  display: 'grid',
                                  gridTemplateRows: 'repeat(7, 12px)',
                                  gridTemplateColumns: `repeat(${Math.min(53, totalWeeks)}, 12px)`,
                                  gap: '2px',
                                  justifyContent: 'start'
                                }}
                              >
                                {/* Day boxes: fill column-first (vertically down, then next column) */}
                                {Array.from({ length: totalWeeks * 7 }, (_, idx) => {
                                  // Calculate column-first position
                                  const weekIdx = Math.floor(idx / 7);
                                  const dayIdx = idx % 7; // 0=Mon
                                  const date = new Date(gridStart);
                                  date.setUTCDate(date.getUTCDate() + weekIdx * 7 + dayIdx);
                                  const inYear = date.getUTCFullYear() === year;
                                  const dayYmd = date.toISOString().slice(0, 10);
                                  const dayEvents = inYear
                                    ? yearEvents.filter(e => {
                                        const evYmd = toDateOnly((e as any).event_date);
                                        return evYmd === dayYmd;
                                      })
                                    : [];
                                  
                                  // Include activity for this day (photos + auction activity)
                                  // Only count photo dates from the target year to prevent cross-year contamination
                                  const photoYear = yearFromDateOnly(dayYmd);
                                  const activityCount = (photoYear === targetYear ? photoDates.get(dayYmd) : 0) || 0;
                                  const hours = hoursForDay(dayEvents) + (activityCount > 0 ? Math.min(2, activityCount / 10) : 0);
                                  const clickable = dayEvents.length > 0 || activityCount > 0;
                                  return (
                                    <div
                                      key={idx}
                                      title={`${date.toLocaleDateString()}: ${clickable ? `${dayEvents.length} events${activityCount > 0 ? ` • ${activityCount} activity` : ''} • ~${hours.toFixed(1)} hrs` : 'No activity'}`}
                                      onClick={async () => {
                                        if (clickable) {
                                          if (onDateClick) {
                                            onDateClick(dayYmd, dayEvents);
                                          } else {
                                            // Day receipt: open the receipt directly for single-event days, otherwise show the day popup.
                                            if (dayEvents.length > 0) {
                                              const uniqueEvents = (dayEvents || []).filter((ev, idx, arr) =>
                                                arr.findIndex(e => e.id === ev.id || (e.title === ev.title && e.event_date === ev.event_date)) === idx
                                              );
                                              if (uniqueEvents.length === 1) {
                                                setSelectedEventForDetail(uniqueEvents[0].id);
                                              } else {
                                                setSelectedDayEvents(dayEvents as any);
                                                setShowDayPopup(true);
                                              }
                                            } else if (activityCount > 0) {
                                              // If day has activity but no events, get photos and auction activity for that date
                                              const dayStart = ymdToUtcStart(dayYmd);
                                              const dayEnd = ymdToUtcStart(addDaysYmd(dayYmd, 1));
                                              const { data: dayImages } = await supabase
                                                .from('vehicle_images')
                                                .select('*')
                                                .eq('vehicle_id', vehicleId)
                                                .gte('taken_at', dayStart)
                                                .lt('taken_at', dayEnd);

                                              const { data: dayAuction } = await supabase
                                                .from('auction_comments')
                                                .select(`
                                                  comment_text,
                                                  comment_type,
                                                  bid_amount,
                                                  is_leading_bid,
                                                  posted_at,
                                                  auction_events (
                                                    source_url,
                                                    outcome
                                                  )
                                                `)
                                                .eq('vehicle_id', vehicleId)
                                                .gte('posted_at', dayStart)
                                                .lt('posted_at', dayEnd);
                                              
                                              // Check if there's an existing event for this date
                                              const { data: existingEvent, error: eventError } = await supabase
                                                .from('timeline_events')
                                                .select('id')
                                                .eq('vehicle_id', vehicleId)
                                                .eq('event_date', dayYmd)
                                                .limit(1)
                                                .maybeSingle();
                                              
                                              // Handle query errors gracefully
                                              if (eventError) {
                                                console.warn('Error checking for existing event:', eventError);
                                                // Continue to show day popup on error
                                              }
                                              
                                              if (existingEvent) {
                                                // Open existing event receipt
                                                setSelectedEventForDetail(existingEvent.id);
                                              } else {
                                                // Show day popup for activity without events
                                                const photoCount = dayImages?.length || 0;
                                                const auctionCount = dayAuction?.length || 0;

                                                let title = '';
                                                let description = '';

                                                if (photoCount > 0 && auctionCount > 0) {
                                                  title = `${photoCount} photo${photoCount > 1 ? 's' : ''} • ${auctionCount} auction comment${auctionCount > 1 ? 's' : ''}`;
                                                  description = 'Photos taken and auction activity';
                                                } else if (photoCount > 0) {
                                                  title = `${photoCount} photo${photoCount > 1 ? 's' : ''} taken`;
                                                  description = 'Vehicle documentation';
                                                } else if (auctionCount > 0) {
                                                  title = `${auctionCount} auction comment${auctionCount > 1 ? 's' : ''}`;
                                                  description = 'Bring a Trailer auction activity';
                                                }

                                                const activityEvent = {
                                                  id: `activity-${dayYmd}`,
                                                  vehicle_id: vehicleId,
                                                  event_type: 'documentation' as any,
                                                  event_date: dayYmd,
                                                  title,
                                                  description,
                                                  image_urls: dayImages?.map(img => img.image_url) || [],
                                                  metadata: {
                                                    photo_date: photoCount > 0,
                                                    photo_count: photoCount,
                                                    image_ids: dayImages?.map((img: any) => img.id).filter(Boolean) || [],
                                                    auction_activity: auctionCount > 0,
                                                    auction_count: auctionCount,
                                                    auction_data: dayAuction
                                                  }
                                                };
                                                setSelectedDayEvents([activityEvent as any]);
                                                setShowDayPopup(true);
                                              }
                                            }
                                          }
                                        }
                                      }}
                                      className={clickable ? 'hover:ring-2 hover:ring-blue-300 transition-all cursor-pointer' : ''}
                                      style={{
                                        gridRow: dayIdx + 1,
                                        gridColumn: weekIdx + 1,
                                        width: '12px',
                                        height: '12px',
                                        backgroundColor: inYear ? colorForHours(hours) : 'var(--heat-0)',
                                        borderRadius: '2px',
                                        border: clickable ? '1px solid var(--heat-border)' : 'none',
                                        opacity: inYear ? 1 : 0.3
                                      }}
                                    />
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        )}

        {/* Image Lightbox for Grid Popup - USING PORTAL TO ESCAPE TIMELINE DIV */}
        {popupImageUrl && ReactDOM.createPortal(
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.85)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10002,
              overflow: 'hidden'
            }}
            onClick={() => setPopupImageUrl(null)}
          >
            <div style={{ position: 'relative', maxWidth: '1200px', width: '100%', margin: '0 16px' }} onClick={(e) => e.stopPropagation()}>
              <img
                src={popupImageUrl}
                alt="Event image"
                style={{ width: '100%', maxHeight: '80vh', objectFit: 'contain', borderRadius: 'var(--radius)' }}
              />
              <button
                onClick={() => setPopupImageUrl(null)}
                style={{
                  position: 'absolute',
                  top: '8px',
                  right: '8px',
                  padding: '6px 12px',
                  border: '2px solid rgba(255, 255, 255, 0.3)',
                  background: 'rgba(42, 42, 42, 0.85)',
                  color: '#ffffff',
                  borderRadius: 'var(--radius)',
                  fontSize: '10px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'var(--transition)'
                }}
                title="Close"
              >
                CLOSE
              </button>
            </div>
          </div>,
          document.body
        )}

        {/* Delete Confirmation Modal - USING PORTAL TO ESCAPE TIMELINE DIV */}
        {showDeleteConfirm && ReactDOM.createPortal(
          <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}>
            <div style={{
              background: 'var(--surface)',
              padding: 'var(--space-4)',
              borderRadius: 'var(--radius)',
              maxWidth: '400px',
              width: '90%',
              border: '2px solid var(--border)'
            }}>
              <h4 style={{ 
                marginBottom: 'var(--space-3)', 
                fontSize: '11px', 
                fontWeight: 700,
                color: 'var(--text)' 
              }}>
                Confirm Delete
              </h4>
              <p style={{ 
                marginBottom: 'var(--space-4)', 
                color: 'var(--text-secondary)',
                fontSize: '9px',
                lineHeight: '1.4'
              }}>
                Are you sure you want to delete this event? This action cannot be undone.
              </p>
              <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setShowDeleteConfirm(null)}
                  style={{
                    padding: '6px 12px',
                    border: '2px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    background: 'var(--surface)',
                    color: 'var(--text)',
                    fontSize: '9px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'var(--transition)'
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDeleteEvent(showDeleteConfirm)}
                  style={{
                    padding: '6px 12px',
                    background: 'var(--error)',
                    color: '#ffffff',
                    border: '2px solid var(--error)',
                    borderRadius: 'var(--radius)',
                    fontSize: '9px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'var(--transition)'
                  }}
                >
                  Delete Event
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Work Timeline Display */}
        {showWorkTimeline && (
          <div className="mb-6">
            <TechnicianWorkTimeline vehicleId={vehicleId} />
          </div>
        )}


        {/* Day Events Popup (for Grid View) - USING PORTAL TO ESCAPE TIMELINE DIV */}
        {showDayPopup && selectedDayEvents && selectedDayEvents.length > 0 && ReactDOM.createPortal(
          <div
            className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center"
            style={{ zIndex: 10001 }}
            onClick={() => setShowDayPopup(false)}
            onKeyDown={(e) => {
              // Keyboard navigation
              if (e.key === 'ArrowLeft') {
                // Go to previous day
                const currentDate = new Date(selectedDayEvents[0].event_date);
                currentDate.setDate(currentDate.getDate() - 1);
                const prevDayEvents = events.filter(ev => {
                  const evDate = new Date(ev.event_date).toISOString().slice(0, 10);
                  return evDate === currentDate.toISOString().slice(0, 10);
                });
                if (prevDayEvents.length > 0) {
                  setSelectedDayEvents(prevDayEvents);
                }
              } else if (e.key === 'ArrowRight') {
                // Go to next day
                const currentDate = new Date(selectedDayEvents[0].event_date);
                currentDate.setDate(currentDate.getDate() + 1);
                const nextDayEvents = events.filter(ev => {
                  const evDate = new Date(ev.event_date).toISOString().slice(0, 10);
                  return evDate === currentDate.toISOString().slice(0, 10);
                });
                if (nextDayEvents.length > 0) {
                  setSelectedDayEvents(nextDayEvents);
                }
              } else if (e.key === 'Escape') {
                setShowDayPopup(false);
              }
            }}
            tabIndex={0}
            ref={(el) => el?.focus()}
          >
            <div 
              className="card" 
              style={{ maxWidth: '800px', width: '90%', maxHeight: '80vh', overflow: 'auto' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <button
                    className="button button-secondary button-small"
                    onClick={(e) => {
                      e.stopPropagation();
                      const currentDate = new Date(selectedDayEvents[0].event_date);
                      currentDate.setDate(currentDate.getDate() - 1);
                      const prevDayEvents = events.filter(ev => {
                        const evDate = new Date(ev.event_date).toISOString().slice(0, 10);
                        return evDate === currentDate.toISOString().slice(0, 10);
                      });
                      if (prevDayEvents.length > 0) {
                        setSelectedDayEvents(prevDayEvents);
                      }
                    }}
                    style={{ fontSize: '9px', fontWeight: 700 }}
                  >
                    PREV DAY
                  </button>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <h4 style={{ fontSize: '10px', fontWeight: 700, margin: 0, color: 'var(--text)' }}>
                      {new Date(selectedDayEvents[0].event_date).toLocaleDateString('en-US', {
                        month: 'numeric',
                        day: 'numeric',
                        year: 'numeric'
                      })}
                    </h4>
                    {(() => {
                      const uniqueEvents = (selectedDayEvents || []).filter((ev, idx, arr) => 
                        arr.findIndex(e => e.id === ev.id || (e.title === ev.title && e.event_date === ev.event_date)) === idx
                      );
                      const daySummary = generateDaySummary(uniqueEvents);
                      if (daySummary.primary && daySummary.primary !== 'No events') {
                        return (
                          <div style={{ fontSize: '8px', color: 'var(--text-muted)', fontWeight: 500, lineHeight: 1.3 }}>
                            {daySummary.primary}
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>
                  {(() => {
                    const ev = selectedDayEvents[0] as any;
                    const md = (ev?.metadata || {}) as any;
                    const isAuctionReceipt = md?.auction_activity === true;
                    const isToday = ev?.event_date === new Date().toISOString().slice(0, 10);
                    const isOpen = Boolean(md?.receipt_open) || (isAuctionReceipt && isToday);
                    if (!isAuctionReceipt) return null;
                    return (
                      <span
                        className="badge"
                        style={{
                          background: isOpen ? '#dcfce7' : '#f3f4f6',
                          color: isOpen ? '#15803d' : '#6b7280',
                          border: `1px solid ${isOpen ? '#22c55e' : '#d1d5db'}`,
                          fontWeight: 700,
                          fontSize: '10px',
                          padding: '3px 8px',
                          borderRadius: '4px',
                        }}
                        title={isOpen ? 'Receipt is open (live auction day)' : 'Auction day receipt'}
                      >
                        {isOpen ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                            OPEN
                            <span className="receipt-open-dots" aria-hidden="true">
                              <span className="receipt-open-dot">.</span>
                              <span className="receipt-open-dot">.</span>
                              <span className="receipt-open-dot">.</span>
                            </span>
                          </span>
                        ) : (
                          'AUCTION'
                        )}
                      </span>
                    );
                  })()}
                  <button
                    className="button button-secondary button-small"
                    onClick={(e) => {
                      e.stopPropagation();
                      const currentDate = new Date(selectedDayEvents[0].event_date);
                      currentDate.setDate(currentDate.getDate() + 1);
                      const nextDayEvents = events.filter(ev => {
                        const evDate = new Date(ev.event_date).toISOString().slice(0, 10);
                        return evDate === currentDate.toISOString().slice(0, 10);
                      });
                      if (nextDayEvents.length > 0) {
                        setSelectedDayEvents(nextDayEvents);
                      }
                    }}
                    style={{ fontSize: '9px', fontWeight: 700 }}
                  >
                    NEXT DAY
                  </button>
                </div>
                <button 
                  className="button button-secondary button-small" 
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowDayPopup(false);
                  }}
                  style={{ fontSize: '9px', fontWeight: 700 }}
                >
                  CLOSE
                </button>
              </div>
              
              {/* Day Summary - Total Cost and Hours */}
              {(() => {
                const uniqueEvents = (selectedDayEvents || []).filter((ev, idx, arr) => 
                  arr.findIndex(e => e.id === ev.id || (e.title === ev.title && e.event_date === ev.event_date)) === idx
                );
                
                let totalCost = 0;
                let totalHours = 0;
                let photoCount = 0;
                let invoiceCount = 0;
                
                uniqueEvents.forEach(ev => {
                  const impact = calcEventImpact(ev);
                  const inv = dayInvoicesByEventId?.[String((ev as any)?.id || '').trim()];
                  const invTotal = inv?.total_amount != null ? Number(inv.total_amount) : null;
                  if (typeof invTotal === 'number' && Number.isFinite(invTotal) && invTotal > 0) {
                    totalCost += invTotal;
                    invoiceCount += 1;
                  } else {
                    totalCost += impact.valueUSD || 0;
                  }
                  totalHours += impact.hours || 0;
                  const urls = Array.isArray(ev.image_urls) ? ev.image_urls : [];
                  photoCount += urls.length;
                });
                
                if (totalCost > 0 || totalHours > 0 || photoCount > 0) {
                  return (
                    <div style={{
                      background: 'var(--grey-50)',
                      border: '2px solid var(--border)',
                      padding: '12px 16px',
                      margin: '0 16px 12px 16px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                        {totalCost > 0 && (
                          <div>
                            <div style={{ fontSize: '9pt', color: 'var(--text-muted)', fontWeight: 600 }}>TOTAL COST</div>
                            <div style={{ fontSize: '16pt', fontWeight: 700 }}>${Math.round(totalCost).toLocaleString()}</div>
                            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: 2 }}>
                              {dayInvoicesLoading ? 'Loading invoices…' : invoiceCount > 0 ? `From ${invoiceCount} invoice${invoiceCount === 1 ? '' : 's'} (fallback: estimate)` : 'Estimated (no invoices yet)'}
                            </div>
                          </div>
                        )}
                        {totalHours > 0 && (
                          <div>
                            <div style={{ fontSize: '9pt', color: 'var(--text-muted)', fontWeight: 600 }}>LABOR</div>
                            <div style={{ fontSize: '14pt', fontWeight: 700 }}>{totalHours.toFixed(1)}h</div>
                          </div>
                        )}
                        {photoCount > 0 && (
                          <div>
                            <div style={{ fontSize: '9pt', color: 'var(--text-muted)', fontWeight: 600 }}>DOCUMENTATION</div>
                            <div style={{ fontSize: '14pt', fontWeight: 700 }}>{photoCount} photos</div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
              
              <div className="card-body">
              <div className="space-y-2">
                {(() => {
                  const ev = selectedDayEvents[0] as any;
                  const md = (ev?.metadata || {}) as any;
                  if (!md?.auction_activity || !Array.isArray(md?.auction_data)) return null;
                  const rows = md.auction_data as any[];
                  const bidRows = rows.filter(r => typeof r?.bid_amount === 'number' && r.bid_amount > 0);
                  const bidCount = bidRows.length;
                  const commentCount = rows.length;
                  const highBid = bidRows.reduce((max: number, r: any) => Math.max(max, Number(r.bid_amount) || 0), 0);
                  const leadingChanges = bidRows.filter(r => r?.is_leading_bid === true).length;
                  const summaryParts: string[] = [];
                  summaryParts.push(`${commentCount} comment${commentCount === 1 ? '' : 's'}`);
                  if (bidCount > 0) summaryParts.push(`${bidCount} bid${bidCount === 1 ? '' : 's'}`);
                  if (highBid > 0) summaryParts.push(`high bid $${Math.round(highBid).toLocaleString()}`);
                  if (leadingChanges > 0) summaryParts.push(`${leadingChanges} lead change${leadingChanges === 1 ? '' : 's'}`);

                  return (
                    <div
                      style={{
                        background: 'var(--grey-50)',
                        border: '2px solid var(--border)',
                        padding: '12px 16px',
                        marginBottom: 12,
                      }}
                    >
                      <div style={{ fontSize: '9pt', fontWeight: 800, letterSpacing: '0.5px' }}>
                        Daily Auction Receipt
                      </div>
                      <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.35 }}>
                        {summaryParts.join(' • ')}
                      </div>
                      <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: 6 }}>
                        Vehicle-first note: we log auction activity as evidence about the vehicle and the market, not as an endorsement of the auction platform.
                      </div>
                    </div>
                  );
                })()}
                {(() => {
                  // Remove duplicates - same event ID or same title+date
                  const uniqueEvents = (selectedDayEvents || []).filter((ev, idx, arr) => 
                    arr.findIndex(e => e.id === ev.id || (e.title === ev.title && e.event_date === ev.event_date)) === idx
                  );
                  return uniqueEvents;
                })().map((ev) => {
                  // Special rendering for work session events (full provenance breakdown)
                  if (ev.source === 'work_session' && ev.metadata?.work_session_id) {
                    return (
                      <WorkSessionEventCard
                        key={ev.id}
                        event={{
                          id: ev.id,
                          title: ev.title || 'Work Session',
                          description: ev.description,
                          event_date: ev.event_date,
                          cost_amount: ev.cost_amount,
                          duration_hours: ev.duration_hours,
                          metadata: ev.metadata
                        }}
                      />
                    );
                  }

                  // If event has no images but it's a photo event, try to get image from metadata
                  let urls: string[] = Array.isArray(ev.image_urls) ? ev.image_urls : [];
                  
                  // Fallback: If this is a derived photo event, use the image from metadata
                  if (urls.length === 0 && ev.metadata?.derived && ev.metadata?.image_id) {
                    // This is a derived event from vehicle_images - it should have an image
                    const fallbackUrl = ev.metadata?.image_url || (ev as any).image_url;
                    if (fallbackUrl) {
                      urls = [fallbackUrl];
                    }
                  }
                  
                  const shown = urls.slice(0, 8);
                  const overflow = Math.max(0, urls.length - shown.length);
                  const at = new Date(ev.event_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  const typeBadge = getEventTypeColor(ev.event_type);
                  const isCreator = ev.metadata?.who?.user_id === currentUser?.id;
                  const isEditing = editingEvent === ev.id;
                  const isAuctionEvent = String(ev.event_type || '').toLowerCase().startsWith('auction_');
                  const isFutureAuction = ev.event_type === 'scheduled_auction' || ev.metadata?.is_future === true;
                  const isActivityEvent = String(ev.id || '').startsWith('activity-');
                  const mdAny = (ev?.metadata || {}) as any;
                  const activityImageIds: string[] = Array.isArray(mdAny?.image_ids) ? mdAny.image_ids.map((x: any) => String(x)).filter(Boolean) : [];
                  const canCreateWorkSession = isActivityEvent && activityImageIds.length > 0 && mdAny?.auction_activity !== true;
                  
                  return (
                    <div key={ev.id} className="alert alert-default" style={{ 
                      cursor: canCreateWorkSession ? 'default' : 'pointer',
                      ...(isFutureAuction ? {
                        borderStyle: 'dashed',
                        borderColor: '#3b82f6',
                        background: 'var(--blue-50, #eff6ff)',
                      } : {})
                    }} onClick={() => {
                      if (canCreateWorkSession) return;
                      // Open receipt directly, not image popup
                      setSelectedEventForDetail(ev.id);
                    }}>
                      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                        {shown.length > 0 && (
                          <img
                            src={shown[0]}
                            alt="Event photo"
                            style={{
                              width: '60px',
                              height: '60px',
                              objectFit: 'cover',
                              flexShrink: 0
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (canCreateWorkSession) return;
                              // Don't open image popup - open receipt instead
                              setSelectedEventForDetail(ev.id);
                            }}
                          />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {isEditing ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                              <input
                                type="text"
                                value={editingEventData.title}
                                onChange={(e) => setEditingEventData({...editingEventData, title: e.target.value})}
                                className="form-input"
                                placeholder="Event title"
                              />
                              <textarea
                                value={editingEventData.description}
                                onChange={(e) => setEditingEventData({...editingEventData, description: e.target.value})}
                                className="form-input"
                                rows={2}
                                placeholder="Description"
                              />
                            </div>
                          ) : (
                            <>
                              {(() => {
                                const isPhoto = String(ev.event_type || '').toLowerCase() === 'photo_added' || String(ev.title || '').toLowerCase().includes('photo') || String(ev.title || '').toLowerCase().includes('evidence');
                                const isFuture = ev.event_type === 'scheduled_auction' || ev.metadata?.is_future === true;
                                // Count unique images, not URLs (which may include variants)
                                const imageCount = urls.length;
                                const title = isPhoto ? `Evidence set (${imageCount} ${imageCount === 1 ? 'photo' : 'photos'})` : (ev.title || 'Work Session');
                                return (
                                  <h4 className="text" style={{ marginBottom: 'var(--space-1)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    {isFuture && (
                                      <span style={{
                                        fontSize: '7pt',
                                        fontWeight: 700,
                                        color: '#1d4ed8',
                                        background: '#dbeafe',
                                        padding: '2px 6px',
                                        borderRadius: '3px',
                                        letterSpacing: '0.5px',
                                      }}>
                                        SCHEDULED
                                      </span>
                                    )}
                                    {title}
                                  </h4>
                                );
                              })()}
                              {(() => {
                                const isPhoto = String(ev.event_type || '').toLowerCase() === 'photo_added' || String(ev.title || '').toLowerCase().includes('photo');
                                const desc = ev.metadata?.work_description || ev.description || '';
                                if (isPhoto) return null; // suppress generic "Vehicle photo uploaded"
                                if (!desc) return null;
                                return (
                                  <p className="text-small text-muted" style={{ marginBottom: 'var(--space-2)' }}>
                                    {desc}
                                  </p>
                                );
                              })()}
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
                                {canCreateWorkSession && (
                                  <button
                                    className="button button-primary button-small"
                                    disabled={creatingWorkSession}
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      try {
                                        setCreatingWorkSession(true);
                                        const ymd = String(ev.event_date || '').slice(0, 10);
                                        const { data, error } = await supabase.functions.invoke('create-work-session-from-evidence', {
                                          body: {
                                            vehicle_id: vehicleId,
                                            event_date: ymd,
                                            image_ids: activityImageIds
                                          }
                                        });
                                        if (error) throw error;
                                        const newId = (data as any)?.event_id;
                                        if (!newId) throw new Error('No event_id returned');
                                        setShowDayPopup(false);
                                        await loadTimelineEvents();
                                        setSelectedEventForDetail(String(newId));
                                      } catch (err: any) {
                                        console.error('Failed to create work session:', err);
                                        alert(err?.message || 'Failed to create work session');
                                      } finally {
                                        setCreatingWorkSession(false);
                                      }
                                    }}
                                    title="Create a work session event from these photos"
                                  >
                                    {creatingWorkSession ? 'Creating...' : 'Create work session'}
                                  </button>
                                )}
                                <span className="badge badge-secondary">
                                  {String(ev.event_type || 'event').replace('_', ' ')}
                                </span>
                                {isAuctionEvent && (ev.metadata?.bidder || ev.metadata?.buyer || ev.metadata?.seller || ev.metadata?.bat_username) ? (
                                  <>
                                    {ev.metadata?.bidder ? (
                                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                        <span className="badge">Bid by</span>
                                        <ParticipantBadge kind="bat_user" label={String(ev.metadata.bidder)} leadingIconUrl="https://bringatrailer.com" />
                                      </span>
                                    ) : null}
                                    {ev.metadata?.buyer ? (
                                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                        <span className="badge">Buyer</span>
                                        <ParticipantBadge kind="bat_user" label={String(ev.metadata.buyer)} leadingIconUrl="https://bringatrailer.com" />
                                      </span>
                                    ) : null}
                                    {ev.metadata?.seller ? (
                                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                        <span className="badge">Seller</span>
                                        <ParticipantBadge kind="bat_user" label={String(ev.metadata.seller)} leadingIconUrl="https://bringatrailer.com" />
                                      </span>
                                    ) : null}
                                    {!ev.metadata?.bidder && !ev.metadata?.buyer && !ev.metadata?.seller && ev.metadata?.bat_username ? (
                                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                        <span className="badge">User</span>
                                        <ParticipantBadge kind="bat_user" label={String(ev.metadata.bat_username)} leadingIconUrl="https://bringatrailer.com" />
                                      </span>
                                    ) : null}
                                  </>
                                ) : null}
                                {(() => {
                                  const met = calcEventImpact(ev);
                                  const tags: React.ReactNode[] = [];
                                  const inv = dayInvoicesByEventId?.[String((ev as any)?.id || '').trim()];
                                  const invTotal = inv?.total_amount != null ? Number(inv.total_amount) : null;
                                  if (typeof invTotal === 'number' && Number.isFinite(invTotal) && invTotal > 0) {
                                    tags.push(
                                      <span
                                        key="inv"
                                        className="badge badge-success"
                                        title={`Invoice ${String(inv?.invoice_number || '').trim() || ''}`.trim()}
                                      >
                                        INV ${Math.round(invTotal).toLocaleString()}
                                      </span>
                                    );
                                  } else if (met.valueUSD > 0) {
                                    tags.push(<span key="val" className="badge">${Math.round(met.valueUSD).toLocaleString()}</span>);
                                  }
                                  if (met.hours > 0) tags.push(<span key="hrs" className="badge">{met.hours.toFixed(1)}h</span>);
                                  if (shown.length > 1) tags.push(<span key="cnt" className="badge">{shown.length} photos</span>);
                                  return <>{tags}</>;
                                })()}
                              </div>
                            </>
                          )}
                        </div>

                        {/* Action buttons */}
                        {isCreator && !isEditing && (
                          <div style={{ display: 'flex', gap: 'var(--space-1)', flexShrink: 0 }}>
                            <button
                              className="button button-small"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingEvent(ev.id);
                                setEditingEventData({
                                  title: ev.title || '',
                                  description: ev.description || '',
                                  event_date: ev.event_date
                                });
                              }}
                              title="Edit event"
                            >
                              Edit
                            </button>
                          </div>
                        )}

                        {isEditing && (
                          <div style={{ display: 'flex', gap: 'var(--space-1)', flexShrink: 0 }}>
                            <button
                              className="button button-primary button-small"
                              onClick={async (e) => {
                                e.stopPropagation();
                                // Save changes
                                try {
                                  await supabase
                                    .from('vehicle_timeline_events')
                                    .update({
                                      title: editingEventData.title,
                                      description: editingEventData.description,
                                    })
                                    .eq('id', ev.id);
                                  setEditingEvent(null);
                                  loadTimelineEvents();
                                } catch (error) {
                                  console.error('Error saving event:', error);
                                }
                              }}
                            >
                              Save
                            </button>
                            <button
                              className="button button-small"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingEvent(null);
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Comments Section */}
                      {expandedComments.has(ev.id) && (
                        <div style={{ marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--border-light)' }} onClick={(e) => e.stopPropagation()}>
                          <TimelineEventComments
                            eventId={ev.id}
                            currentUser={currentUser}
                            eventCreatorId={ev.created_by || ''}
                            vehicleOwnerId={vehicleOwner || ''}
                            isExpanded={true}
                            onToggle={() => {}}
                          />
                        </div>
                      )}
                      {/* MVP: comments hint hidden to reduce clutter */}
                    </div>
                  );
                })}
              </div>
              </div>
            </div>
          </div>,
          document.body
        )}


        {/* Add Event Wizard Modal */}
        {showWizard && (
          <AddEventWizard
            vehicleId={vehicleId}
            currentUser={currentUser}
            onClose={() => setShowWizard(false)}
            onEventAdded={() => {
              loadTimelineEvents(); // Refresh timeline to show new event
              setShowWizard(false);
            }}
          />
        )}

        {/* Bulk Image Upload Modal - USING PORTAL TO ESCAPE TIMELINE DIV */}
        {showBulkUpload && ReactDOM.createPortal(
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center" style={{ zIndex: 10001 }}>
            <div className="bg-white p-6 rounded max-w-4xl w-full mx-4 max-h-screen overflow-auto">
              <UniversalImageUpload
                vehicleId={vehicleId}
                variant="bulk"
                category="general"
                maxFiles={20}
                onUploadSuccess={(results) => {
                  console.log('Images uploaded:', results);
                  loadTimelineEvents(); // Refresh timeline to show new images
                  setShowBulkUpload(false);
                }}
              />
            </div>
          </div>,
          document.body
        )}

        {/* Event Detail Modal - Receipt Style */}
        {selectedEventForDetail && (
          <ComprehensiveWorkOrderReceipt
            eventId={selectedEventForDetail}
            onClose={() => setSelectedEventForDetail(null)}
            onNavigate={(newEventId) => setSelectedEventForDetail(newEventId)}
          />
        )}
      </div>
    </div>
  );
};

export default VehicleTimeline;
