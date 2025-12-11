import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import VehicleCardDense from '../components/vehicles/VehicleCardDense';
import { UserInteractionService } from '../services/userInteractionService';
import VehicleSearch from '../components/VehicleSearch';

interface HypeVehicle {
  id: string;
  year?: number;
  make?: string;
  model?: string;
  current_value?: number;
  purchase_price?: number;
  sale_price?: number;
  asking_price?: number;
  display_price?: number; // Computed smart price
  roi_pct?: number;
  image_count?: number;
  event_count?: number;
  activity_7d?: number;
  view_count?: number;
  primary_image_url?: string;
  hype_score?: number;
  hype_reason?: string;
  created_at?: string;
  updated_at?: string;
  image_url?: string;
  mileage?: number;
  vin?: string;
  is_for_sale?: boolean;
  all_images?: Array<{ id: string; url: string; is_primary: boolean }>;
}

type TimePeriod = 'ALL' | 'AT' | '1Y' | 'Q' | 'W' | 'D' | 'RT';
type ViewMode = 'gallery' | 'grid' | 'technical';
type SortBy = 'year' | 'make' | 'model' | 'mileage' | 'newest' | 'oldest' | 'popular' | 'price_high' | 'price_low' | 'volume' | 'images' | 'events' | 'views';
type SortDirection = 'asc' | 'desc';

// Component to lazy load images when vehicle card comes into view
const LazyLoadVehicleImages: React.FC<{
  vehicleId: string;
  onVisible: (vehicleId: string) => void;
  children: React.ReactNode;
}> = ({ vehicleId, onVisible, children }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            onVisible(vehicleId);
            observer.disconnect();
          }
        });
      },
      {
        rootMargin: '200px', // Start loading 200px before coming into view
        threshold: 0.01
      }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [vehicleId, onVisible]);

  return <div ref={ref}>{children}</div>;
};

// Rotating action verbs hook (inspired by Claude's thinking animation)
const useRotatingVerb = () => {
  const verbs = [
    // Core Activities
    'Wrenching', 'Building', 'Restoring', 'Cruising', 'Fabricating', 'Tuning', 'Spinning', 'Racing',
    'Modding', 'Upgrading', 'Boosting', 'Drifting', 'Revving', 'Detailing', 'Collecting', 'Showing',
    'Flipping', 'Trading', 'Swapping', 'Hunting', 'Sourcing', 'Inspecting', 'Diagnosing', 'Tweaking',
    'Dialing', 'Hooning', 'Launching', 'Burnouts', 'Drag', 'Tracking', 'AutoXing', 'Rallying',
    'Attacking', 'Ripping', 'Shredding', 'Lapping', 'Gridding', 'Pitting', 'Qualifying',
    
    // Fabrication & Metalwork
    'Welding', 'Grinding', 'Cutting', 'Machining', 'Milling', 'Turning', 'Drilling', 'Tapping',
    'Threading', 'Boring', 'Honing', 'Reaming', 'Countersinking', 'Chamfering', 'Facing', 'Parting',
    'Grooving', 'Knurling', 'Forming', 'Bending', 'Folding', 'Crimping', 'Flaring', 'Beading',
    'Swaging', 'Stamping', 'Punching', 'Shearing', 'Sawing', 'Plasma', 'TIG', 'MIG', 'Stick',
    'Brazing', 'Soldering', 'Forging', 'Casting', 'Pouring', 'Molding', 'Extruding', 'Drawing',
    'Hammering', 'Planishing', 'Shrinking', 'Stretching', 'Fitting', 'Tacking',
    
    // Bodywork & Paint
    'Painting', 'Polishing', 'Spraying', 'Buffing', 'Claying', 'Correcting', 'Waxing', 'Sealing',
    'Debadging', 'Shaving', 'Frenching', 'Smoothing', 'Louvering', 'Venting', 'Widening',
    'Chopping', 'Sectioning', 'Channeling', 'Triangulating', 'Linking', 'Tabbing', 'Bracing',
    'Caging', 'Gutting', 'Deleting', 'Relocating', 'Blocking', 'Sanding', 'Scuffing', 'Priming',
    'Basecoating', 'Clearing', 'Masking', 'Taping', 'Stripping', 'Feathering', 'Blending',
    'Blasting', 'Etching', 'Prepping', 'Filling', 'Skimming', 'Pulling', 'Straightening',
    'Aligning', 'Gapping',
    
    // Finishing & Surface Treatment
    'Chroming', 'Plating', 'Anodizing', 'Powder', 'Cerakoting', 'Wrapping', 'Dipping',
    'Coating', 'Electroplating', 'Brushing', 'Finishing', 'Vapor', 'Blasting', 'Shot', 'Peening',
    'Pickling', 'Passivating', 'Oxidizing', 'Galvanizing',
    
    // Suspension & Chassis
    'Slamming', 'Bagging', 'Coiling', 'Dropping', 'Raising', 'Camber', 'Tucking', 'Stretching',
    'Stance', 'Squatting', 'Raking', 'Leveling', 'Lifting', 'Lowering', 'Shimming', 'Preloading',
    'Weighting', 'Balancing', 'Aligning', 'Toeing', 'Castering', 'Adjusting', 'Torquing',
    'Compressing', 'Extending', 'Rebuilding', 'Revalving', 'Upgrading', 'Replacing',
    
    // Engine Work
    'Rebuilding', 'Boring', 'Stroking', 'Porting', 'Machining', 'Balancing', 'Blueprinting',
    'Dynoing', 'Mapping', 'Flashing', 'Coding', 'Logging', 'Scanning', 'Tuning', 'Calibrating',
    'Timing', 'Advancing', 'Retarding', 'Lapping', 'Seating', 'Cutting', 'Reconditioning',
    'Resurfacing', 'Decking', 'Cleaning', 'Tanking', 'Magnafluxing', 'Testing', 'Benching',
    'Milling', 'Prepping', 'Installing', 'Sleeving', 'Torquing', 'Sequencing', 'Degreeing',
    'Fitting', 'Gapping', 'Grinding', 'Polishing', 'Priming',
    
    // Electrical & Electronics
    'Wiring', 'Soldering', 'Crimping', 'Routing', 'Tucking', 'Wrapping', 'Taping', 'Shrinking',
    'Stripping', 'Splicing', 'Terminating', 'Connecting', 'Testing', 'Troubleshooting', 'Diagnosing',
    'Scanning', 'Reading', 'Clearing', 'Flashing', 'Programming', 'Mapping', 'Tuning', 'Calibrating',
    'Installing', 'Mounting', 'Configuring', 'Monitoring',
    
    // Transmission & Drivetrain
    'Rebuilding', 'Clutching', 'Replacing', 'Resurfacing', 'Installing', 'Changing', 'Adjusting',
    'Rebuilding', 'Setting', 'Balancing', 'Flashing', 'Updating', 'Calibrating',
    
    // Brakes & Wheels
    'Bleeding', 'Flushing', 'Changing', 'Replacing', 'Turning', 'Resurfacing', 'Rebuilding',
    'Flaring', 'Fitting', 'Testing', 'Diagnosing', 'Balancing', 'Mounting', 'Torquing',
    'Rotating', 'Programming', 'Repairing', 'Straightening',
    
    // Computer & Software (automotive focused)
    'Coding', 'Programming', 'Scripting', 'Debugging', 'Flashing', 'Mapping', 'Tuning',
    'Logging', 'Analyzing', 'Processing', 'Monitoring', 'Calibrating', 'Configuring',
    
    // Racing & Performance
    'Dynoing', 'Launching', 'Testing', 'Optimizing', 'Analyzing', 'Data', 'Logging', 'Tuning',
    
    // Physical Activities
    'Lifting', 'Dropping', 'Pushing', 'Pulling', 'Rotating', 'Spinning', 'Rolling', 'Tucking'
  ];
  const [currentVerb, setCurrentVerb] = useState(verbs[0]);
  
  useEffect(() => {
    const getRandomInterval = () => {
      // Variable speeds: 50% chance fast (500-1000ms), 30% medium (1000-2000ms), 20% slow (2000-4000ms)
      const rand = Math.random();
      if (rand < 0.5) {
        return Math.random() * 500 + 500; // 500-1000ms (FAST)
      } else if (rand < 0.8) {
        return Math.random() * 1000 + 1000; // 1000-2000ms (MEDIUM)
      } else {
        return Math.random() * 2000 + 2000; // 2000-4000ms (SLOW)
      }
    };
    
    let timeoutId: NodeJS.Timeout;
    
    const scheduleNext = () => {
      timeoutId = setTimeout(() => {
        setCurrentVerb(prev => {
          const currentIndex = verbs.indexOf(prev);
          const nextIndex = (currentIndex + 1) % verbs.length;
          return verbs[nextIndex];
        });
        scheduleNext();
      }, getRandomInterval());
    };
    
    scheduleNext();
    
    return () => clearTimeout(timeoutId);
  }, []);
  
  return currentVerb;
};

interface FilterState {
  yearMin: number | null;
  yearMax: number | null;
  makes: string[];
  priceMin: number | null;
  priceMax: number | null;
  hasImages: boolean;
  forSale: boolean;
  zipCode: string;
  radiusMiles: number;
  showPrices: boolean;
  showDetailOverlay: boolean;
  showPending: boolean;
}

const CursorHomepage: React.FC = () => {
  const rotatingVerb = useRotatingVerb();
  const [feedVehicles, setFeedVehicles] = useState<HypeVehicle[]>([]);
  const [filteredVehicles, setFilteredVehicles] = useState<HypeVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('AT');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sortBy, setSortBy] = useState<SortBy>('newest');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [showFilters, setShowFilters] = useState(true);
  const [timePeriodCollapsed, setTimePeriodCollapsed] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    yearMin: null,
    yearMax: null,
    makes: [],
    priceMin: null,
    priceMax: null,
    hasImages: false,
    forSale: false,
    zipCode: '',
    radiusMiles: 50,
    showPrices: true,
    showDetailOverlay: true,
    showPending: false
  });
  const [stats, setStats] = useState({
    totalBuilds: 0,
    totalValue: 0,
    activeToday: 0
  });
  const [statsLoading, setStatsLoading] = useState(true);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [filterBarMinimized, setFilterBarMinimized] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [loadedVehicleImages, setLoadedVehicleImages] = useState<Map<string, any[]>>(new Map());
  const [loadingImagesFor, setLoadingImagesFor] = useState<Set<string>>(new Set());
  const navigate = useNavigate();

  useEffect(() => {
    loadSession();
    
    // Scroll listener for sticky filter bar and scroll-to-top button
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      setScrollY(currentScrollY);
      
      // Show scroll-to-top button after scrolling down 500px
      setShowScrollTop(currentScrollY > 500);
      
      // Minimize filter bar after scrolling down 200px (if filters are shown)
      // Only auto-minimize, don't auto-expand (let user control expansion)
      if (showFilters && currentScrollY > 200 && !filterBarMinimized) {
        setFilterBarMinimized(true);
      }
    };
    
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [showFilters]);

  useEffect(() => {
    // Load accurate stats from database
    loadAccurateStats();
    // Refresh stats every 30 seconds
    const statsInterval = setInterval(loadAccurateStats, 30000);
    
    // Load feed for all users (authenticated and unauthenticated)
    // Public vehicles (is_public=true) are visible to everyone
    loadHypeFeed();
    
    return () => clearInterval(statsInterval);
  }, [timePeriod, filters.showPending]);

  // Also reload when session changes (user logs in/out)
  useEffect(() => {
    if (session !== null) {
      loadHypeFeed();
    }
  }, [session]);

  // Handle vehicle cards coming into view - batch image loading
  const visibleVehicleIdsRef = useRef<Set<string>>(new Set());
  const loadImagesTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleVehicleVisible = useCallback((vehicleId: string) => {
    // Add to batch
    visibleVehicleIdsRef.current.add(vehicleId);
    
    // Debounce: wait 100ms to batch multiple vehicles together
    if (loadImagesTimeoutRef.current) {
      clearTimeout(loadImagesTimeoutRef.current);
    }
    
    loadImagesTimeoutRef.current = setTimeout(() => {
      const idsToLoad = Array.from(visibleVehicleIdsRef.current);
      visibleVehicleIdsRef.current.clear();
      
      if (idsToLoad.length > 0) {
        loadImagesForVehicles(idsToLoad);
      }
    }, 100);
  }, [loadImagesForVehicles]);

  // Apply filters and sorting whenever vehicles or settings change
  useEffect(() => {
    applyFiltersAndSort();
  }, [feedVehicles, filters, sortBy, sortDirection]);

  const loadSession = async () => {
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    setSession(currentSession);
    setLoading(false); // Always set loading to false after session check
    
    // Load user preference
    if (currentSession?.user) {
      try {
        const { data: prefs, error: prefsError } = await supabase
          .from('user_preferences')
          .select('preferred_view_mode, preferred_device, enable_gestures, enable_haptic_feedback, preferred_vendors, hidden_tags, favorite_makes, interaction_style')
          .eq('user_id', currentSession.user.id)
          .maybeSingle();
        
        // Handle table not existing or query errors gracefully
        if (prefsError) {
          // PGRST301 = table doesn't exist, PGRST116 = relation not found, 400 = bad request (might be missing column or RLS issue)
          if (prefsError.code === 'PGRST116' || prefsError.code === 'PGRST301' || prefsError.code === 'PGRST202' || prefsError.code === '42P01' || prefsError.code === '42703') {
            // Table/column doesn't exist or RLS blocking - silently ignore
            return;
          }
          // For other errors, log as warning but don't break the app
          console.warn('Error loading user preferences:', prefsError);
          return;
        }
        
        // Note: user_preferences doesn't have a 'settings' column
        // If we need preferred_time_period, we'd need to add it as a column
        // For now, just use defaults
      } catch (err) {
        // Table might not exist or other error - silently ignore
        // Don't log to avoid console noise
      }
    }
  };

  // Load accurate stats from database (not filtered feed)
  const loadAccurateStats = async () => {
    try {
      const { data: statsData, error: statsError } = await supabase.rpc('get_vehicle_feed_stats');
      
      if (!statsError && statsData) {
        setStats({
          totalBuilds: statsData.active_builds || 0,
          totalValue: statsData.total_value || 0,
          activeToday: statsData.updated_today || 0
        });
      } else {
        console.warn('Failed to load accurate stats:', statsError);
      }
    } catch (err) {
      console.warn('Error loading accurate stats:', err);
    } finally {
      setStatsLoading(false);
    }
  };

  // Load images for vehicles on demand (lazy loading)
  const loadImagesForVehicles = useCallback(async (vehicleIds: string[]) => {
    // Filter out vehicles that are already loaded or currently loading
    const idsToLoad = vehicleIds.filter(id => 
      !loadedVehicleImages.has(id) && !loadingImagesFor.has(id)
    );
    
    if (idsToLoad.length === 0) return;
    
    // Mark as loading
    setLoadingImagesFor(prev => {
      const next = new Set(prev);
      idsToLoad.forEach(id => next.add(id));
      return next;
    });
    
    try {
      const BATCH_SIZE = 50;
      const allImages: any[] = [];
      
      // Batch the queries
      for (let i = 0; i < idsToLoad.length; i += BATCH_SIZE) {
        const batch = idsToLoad.slice(i, i + BATCH_SIZE);
        const { data: batchImages, error: imagesError } = await supabase
          .from('vehicle_images')
          .select('*')
          .in('vehicle_id', batch)
          .eq('is_document', false)
          .order('is_primary', { ascending: false })
          .order('created_at', { ascending: false });

        if (imagesError) {
          console.error(`❌ Error loading images for batch:`, imagesError);
        } else if (batchImages) {
          allImages.push(...batchImages);
        }
      }
      
      // Group images by vehicle_id
      const newImagesByVehicle = new Map<string, any[]>();
      allImages.forEach((img: any) => {
        if (!newImagesByVehicle.has(img.vehicle_id)) {
          newImagesByVehicle.set(img.vehicle_id, []);
        }
        newImagesByVehicle.get(img.vehicle_id)!.push(img);
      });
      
      // Update state with new images
      setLoadedVehicleImages(prev => {
        const next = new Map(prev);
        newImagesByVehicle.forEach((images, vehicleId) => {
          next.set(vehicleId, images);
        });
        return next;
      });
      
      // Update feed vehicles with new images
      setFeedVehicles(prev => prev.map(vehicle => {
        const images = newImagesByVehicle.get(vehicle.id);
        if (!images || images.length === 0) return vehicle;
        
        // Use SAME logic as VehicleProfile - just use image_url directly
        const all_images = images
          .map((img: any) => {
            const url = img.image_url;
            if (url && typeof url === 'string' && url.trim() !== '') {
              return {
                id: img.id,
                url: url.trim(),
                is_primary: img.is_primary || false,
                created_at: img.created_at
              };
            }
            return null;
          })
          .filter((img: any) => img !== null)
          .sort((a: any, b: any) => {
            if (a.is_primary && !b.is_primary) return -1;
            if (!a.is_primary && b.is_primary) return 1;
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          })
          .slice(0, 5);
        
        // Use SAME logic as VehicleProfile
        const primaryImage = images.find((img: any) => img.is_primary === true) || images[0];
        const primaryImageUrl = primaryImage ? (primaryImage.large_url || primaryImage.image_url) : null;
        
        return {
          ...vehicle,
          primary_image_url: primaryImageUrl || vehicle.primary_image_url,
          image_url: primaryImageUrl || vehicle.image_url,
          all_images: all_images.length > 0 ? all_images : vehicle.all_images
        };
      }));
      
    } catch (error) {
      console.error('Error loading images for vehicles:', error);
    } finally {
      // Remove from loading set
      setLoadingImagesFor(prev => {
        const next = new Set(prev);
        idsToLoad.forEach(id => next.delete(id));
        return next;
      });
    }
  }, [loadedVehicleImages, loadingImagesFor]);

  const getTimePeriodFilter = () => {
    const now = new Date();
    switch (timePeriod) {
      case 'ALL':
        return null; // No time filter - show everything
      case 'D':
        return new Date(now.setDate(now.getDate() - 1)).toISOString();
      case 'W':
        return new Date(now.setDate(now.getDate() - 7)).toISOString();
      case 'Q':
        return new Date(now.setMonth(now.getMonth() - 3)).toISOString();
      case '1Y':
        return new Date(now.setFullYear(now.getFullYear() - 1)).toISOString();
      case 'RT':
        return new Date(now.setHours(now.getHours() - 1)).toISOString();
      case 'AT':
      default:
        return null; // Active = no strict time filter
    }
  };

  const loadHypeFeed = async () => {
    try {
      setLoading(true);
      setError(null);
      const timeFilter = getTimePeriodFilter();

      // Check Supabase connection first
      const { data: healthCheck, error: healthError } = await supabase
        .from('vehicles')
        .select('id')
        .limit(1);

      if (healthError) {
        console.error('❌ Supabase connection error:', healthError);
        setError(`Database connection failed: ${healthError.message}`);
        setDebugInfo({
          error: healthError.message,
          code: healthError.code,
          details: healthError.details,
          hint: healthError.hint
        });
        setFeedVehicles([]);
        setLoading(false);
        return;
      }

      // Query vehicles directly with is_public filter
      // Get vehicles with basic info - we'll fetch images separately for better performance
      const { data: vehicles, error } = await supabase
        .from('vehicles')
        .select('id, year, make, model, vin, created_at, updated_at, sale_price, current_value, purchase_price, asking_price, is_for_sale, mileage, condition_rating, status, is_public')
        .eq('is_public', true)
        .neq('status', 'pending')
        .order('updated_at', { ascending: false })
        .limit(1000);
      
      // If showPending filter is enabled, also fetch pending vehicles
      let pendingVehicles: any[] = [];
      if (filters.showPending) {
        const { data: pending, error: pendingError } = await supabase
          .from('vehicles')
          .select('id, year, make, model, current_value, purchase_price, sale_price, asking_price, is_for_sale, mileage, vin, condition_rating, created_at, updated_at')
          .eq('status', 'pending')
          .eq('is_public', true)
          .order('created_at', { ascending: false })
          .limit(500);
        
        if (!pendingError && pending) {
          // Add basic tier info for pending vehicles
          pendingVehicles = pending.map((v: any) => ({
            ...v,
            view_count: 0,
            image_count: 0,
            tier: 'minimal',
            tier_label: 'Tier 1'
          }));
        }
      }
      
      // Merge active and pending vehicles
      const allVehicles = [...(vehicles || []), ...pendingVehicles];
      
      // Apply time filter if needed
      let filteredVehicles = allVehicles;
      if (timeFilter && allVehicles) {
        filteredVehicles = allVehicles.filter((v: any) => 
          new Date(v.updated_at) >= new Date(timeFilter)
        );
      }
      
      console.log('🔍 LoadHypeFeed Debug:', {
        timePeriod,
        timeFilter,
        vehicleCount: vehicles?.length || 0,
        error: error?.message,
        hasSupabaseUrl: !!import.meta.env.VITE_SUPABASE_URL,
        hasSupabaseKey: !!import.meta.env.VITE_SUPABASE_ANON_KEY
      });

      if (error) {
        console.error('❌ Error loading vehicles:', error);
        setError(`Failed to load vehicles: ${error.message}`);
        setDebugInfo({
          error: error.message,
          code: error.code,
          details: error.details
        });
        setFeedVehicles([]);
        setLoading(false);
        return;
      }
      
      if (!allVehicles || allVehicles.length === 0) {
        console.warn('⚠️ No vehicles found with is_public=true');
        setFeedVehicles([]);
        setLoading(false);
        return;
      }

      // Use filtered vehicles if time filter was applied
      const vehiclesToProcess = filteredVehicles || allVehicles || [];

      // LAZY LOADING: Only load images for initial visible batch (first 30 vehicles)
      // Remaining images will be loaded on-demand as vehicles scroll into view
      const INITIAL_IMAGE_BATCH = 30;
      const vehicleIds = vehiclesToProcess.map((v: any) => v.id);
      const initialVehicleIds = vehicleIds.slice(0, INITIAL_IMAGE_BATCH);
      
      // Batch image queries to avoid URL length limits and resource exhaustion
      // Process in chunks of 50 vehicle IDs at a time
      const BATCH_SIZE = 50;
      const allImages: any[] = [];
      
      // Use SAME query as VehicleProfile - select('*') to get all fields
      // VehicleProfile line 1119-1125
      for (let i = 0; i < initialVehicleIds.length; i += BATCH_SIZE) {
        const batch = initialVehicleIds.slice(i, i + BATCH_SIZE);
        const { data: batchImages, error: imagesError } = await supabase
          .from('vehicle_images')
          .select('*')
          .in('vehicle_id', batch)
          .eq('is_document', false) // Filter out documents (same as VehicleProfile line 1122)
          .order('is_primary', { ascending: false })
          .order('created_at', { ascending: false });

        if (imagesError) {
          console.error(`❌ Error loading images for batch ${i / BATCH_SIZE + 1}:`, imagesError);
        } else if (batchImages) {
          allImages.push(...batchImages);
        }
      }

      console.log(`✅ Loaded ${allImages.length} images for ${initialVehicleIds.length} vehicles (lazy loading: initial batch only)`);
      if (allImages.length > 0) {
        // Log sample image to see structure
        console.log('Sample image:', allImages[0]);
        console.log('Sample image variants:', allImages[0]?.variants);
        console.log('Sample image URLs:', {
          image_url: allImages[0]?.image_url,
          thumbnail_url: allImages[0]?.thumbnail_url,
          medium_url: allImages[0]?.medium_url,
          large_url: allImages[0]?.large_url
        });
      } else {
        console.warn('⚠️ No images loaded for initial batch!');
      }

      // Group images by vehicle_id
      const imagesByVehicle = new Map<string, any[]>();
      (allImages || []).forEach((img: any) => {
        if (!imagesByVehicle.has(img.vehicle_id)) {
          imagesByVehicle.set(img.vehicle_id, []);
        }
        imagesByVehicle.get(img.vehicle_id)!.push(img);
      });
      
      // Store initial loaded images in state (merge with existing)
      setLoadedVehicleImages(prev => {
        const next = new Map(prev);
        imagesByVehicle.forEach((images, vehicleId) => {
          next.set(vehicleId, images);
        });
        return next;
      });
      
      // Fetch event counts for all vehicles (batched)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const recentEvents: any[] = [];
      
      for (let i = 0; i < vehicleIds.length; i += BATCH_SIZE) {
        const batch = vehicleIds.slice(i, i + BATCH_SIZE);
        const { data: batchEvents } = await supabase
          .from('timeline_events')
          .select('vehicle_id')
          .in('vehicle_id', batch)
          .gte('created_at', sevenDaysAgo);
        
        if (batchEvents) {
          recentEvents.push(...batchEvents);
        }
      }

      // Group events by vehicle_id
      const eventsByVehicle = new Map<string, number>();
      recentEvents.forEach((event: any) => {
        const count = eventsByVehicle.get(event.vehicle_id) || 0;
        eventsByVehicle.set(event.vehicle_id, count + 1);
      });

      // Process vehicles with their images
      const enriched = vehiclesToProcess.map((v: any) => {
        // Get images for this vehicle (use local map first, then state as fallback)
        const images = imagesByVehicle.get(v.id) || [];
        
        // Use the SAME logic as VehicleProfile - simple and reliable
        // Just use image_url directly from database (like VehicleProfile does)
        const all_images = images
          .map((img: any) => {
            // Use image_url directly (same as VehicleProfile line 1151)
            const url = img.image_url;
            
            if (url && typeof url === 'string' && url.trim() !== '') {
              return {
                id: img.id,
                url: url.trim(),
                is_primary: img.is_primary || false,
                created_at: img.created_at
              };
            }
            
            return null;
          })
          .filter((img: any) => img !== null)
          .sort((a: any, b: any) => {
            // Primary images first
            if (a.is_primary && !b.is_primary) return -1;
            if (!a.is_primary && b.is_primary) return 1;
            // Then by creation date (newest first)
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          })
          .slice(0, 5); // Limit to 5 for performance

          // SMART PRICING: Use hierarchy (sale_price > asking_price > current_value)
          // Priority: actual sale > owner asking > estimated value
          // Convert to numbers and handle nulls explicitly
          const salePrice = v.sale_price ? Number(v.sale_price) : 0;
          const askingPrice = v.asking_price ? Number(v.asking_price) : 0;
          const currentValue = v.current_value ? Number(v.current_value) : 0;
          
          const displayPrice = salePrice > 0 
            ? salePrice 
            : askingPrice > 0
            ? askingPrice
            : currentValue;

          const activity7d = eventsByVehicle.get(v.id) || 0;
          const totalImages = images.length; // Use actual total, not limited all_images
          const age_hours = (Date.now() - new Date(v.created_at).getTime()) / (1000 * 60 * 60);
          const update_hours = (Date.now() - new Date(v.updated_at).getTime()) / (1000 * 60 * 60);
          const is_new = age_hours < 24;
          const is_hot = update_hours < 1;

          let hypeScore = 0;
          let hypeReason = '';

          if (is_hot && timePeriod === 'RT') {
            hypeScore += 60;
            hypeReason = 'LIVE NOW';
          }

          if (is_new && totalImages > 10) {
            hypeScore += 50;
            hypeReason = hypeReason || 'JUST POSTED';
          }

          if (activity7d >= 5) {
            hypeScore += 30;
            hypeReason = hypeReason || 'ACTIVE BUILD';
          }

          if (totalImages > 100) {
            hypeScore += 20;
          }

          if ((v.view_count || 0) > 20) {
            hypeScore += 15;
            hypeReason = hypeReason || 'TRENDING';
          }

          // Use SAME logic as VehicleProfile - find primary or use first
          // VehicleProfile line 1131: find((r: any) => r.is_primary === true) || imageRecords[0]
          const primaryImage = images.find((img: any) => img.is_primary === true) || images[0];
          // VehicleProfile line 1136: large_url || image_url
          const primaryImageUrl = primaryImage ? (primaryImage.large_url || primaryImage.image_url) : null;
          
          // Debug logging for first few vehicles to see what's happening
          if (vehiclesToProcess.indexOf(v) < 5) {
            console.log(`🔍 Vehicle ${v.id} (${v.year} ${v.make} ${v.model}):`, {
              totalImages,
              all_images_count: all_images.length,
              primaryImageUrl,
              firstImageUrl: all_images[0]?.url,
              rawImages: images.slice(0, 1).map(img => ({
                id: img.id,
                variants: img.variants,
                image_url: img.image_url,
                medium_url: img.medium_url,
                thumbnail_url: img.thumbnail_url
              }))
            });
          }
          
          // Debug logging for vehicles without images
          if (!primaryImageUrl && totalImages === 0) {
            console.warn(`⚠️ Vehicle ${v.id} (${v.year} ${v.make} ${v.model}) has no images`);
          } else if (!primaryImageUrl && totalImages > 0) {
            console.warn(`⚠️ Vehicle ${v.id} has ${totalImages} images but no valid URL in all_images array`);
            console.warn('Images data:', images.slice(0, 2));
          }

            return {
            ...v,
            display_price: displayPrice, // Add smart price for display
            image_count: totalImages, // Use actual count from images query
            view_count: 0, // TODO: Add view_count query if needed
            event_count: activity7d,
            activity_7d: activity7d,
            hype_score: hypeScore,
            hype_reason: hypeReason,
            primary_image_url: primaryImageUrl,
            image_url: primaryImageUrl,
            all_images: all_images,
            tier: 'C', // Default tier - can be calculated later if needed
            tier_label: 'Tier C' // Default tier label
          };
        });
      
      const sorted = enriched.sort((a, b) => (b.hype_score || 0) - (a.hype_score || 0));
      setFeedVehicles(sorted);

      // Stats are now loaded separately via loadAccurateStats() to get real database counts
      // Don't override with filtered feed stats

    } catch (error: any) {
      console.error('❌ Unexpected error loading hype feed:', error);
      setError(`Unexpected error: ${error?.message || 'Unknown error'}`);
      setDebugInfo({
        error: error?.message,
        stack: error?.stack,
        name: error?.name
      });
      setFeedVehicles([]);
    } finally {
      setLoading(false);
    }
  };

  const applyFiltersAndSort = () => {
    let result = [...feedVehicles];
    
    // Apply filters
    if (filters.yearMin) {
      result = result.filter(v => (v.year || 0) >= filters.yearMin!);
    }
    if (filters.yearMax) {
      result = result.filter(v => (v.year || 0) <= filters.yearMax!);
    }
    if (filters.makes.length > 0) {
      result = result.filter(v => filters.makes.some(m => 
        v.make?.toLowerCase().includes(m.toLowerCase())
      ));
    }
    if (filters.priceMin) {
      result = result.filter(v => (v.display_price || 0) >= filters.priceMin!);
    }
    if (filters.priceMax) {
      result = result.filter(v => (v.display_price || 0) <= filters.priceMax!);
    }
    if (filters.hasImages) {
      result = result.filter(v => (v.image_count || 0) > 0);
    }
    if (filters.forSale) {
      result = result.filter(v => v.is_for_sale);
    }
    
    // Location filter (ZIP code + radius)
    // Note: This requires vehicles to have zip_code or GPS coordinates stored
    if (filters.zipCode && filters.zipCode.length === 5) {
      // For now, filter by exact ZIP match
      // TODO: Implement haversine distance calculation with GPS coordinates
      result = result.filter(v => {
        const vehicleZip = (v as any).zip_code || (v as any).location_zip;
        return vehicleZip === filters.zipCode;
      });
    }
    
    // Apply sorting with direction
    const dir = sortDirection === 'desc' ? 1 : -1;
    switch (sortBy) {
      case 'year':
        result.sort((a, b) => dir * ((b.year || 0) - (a.year || 0)));
        break;
      case 'make':
        result.sort((a, b) => dir * (a.make || '').localeCompare(b.make || ''));
        break;
      case 'model':
        result.sort((a, b) => dir * (a.model || '').localeCompare(b.model || ''));
        break;
      case 'mileage':
        result.sort((a, b) => dir * ((b.mileage || 0) - (a.mileage || 0)));
        break;
      case 'newest':
        // Sort by created_at first (newest vehicles), then updated_at as fallback
        result.sort((a, b) => {
          const aTime = new Date(a.created_at || a.updated_at || 0).getTime();
          const bTime = new Date(b.created_at || b.updated_at || 0).getTime();
          return dir * (bTime - aTime); // Descending: newest first
        });
        break;
      case 'oldest':
        result.sort((a, b) => 
          dir * (new Date(a.updated_at || a.created_at || 0).getTime() - 
          new Date(b.updated_at || b.created_at || 0).getTime())
        );
        break;
      case 'price_high':
        result.sort((a, b) => dir * ((b.display_price || 0) - (a.display_price || 0)));
        break;
      case 'price_low':
        result.sort((a, b) => dir * ((a.display_price || 0) - (b.display_price || 0)));
        break;
      case 'volume':
        // TODO: Add trading volume data from share_holdings table
        result.sort((a, b) => 0); // Placeholder until we have volume data
        break;
      case 'images':
        result.sort((a, b) => dir * ((b.image_count || 0) - (a.image_count || 0)));
        break;
      case 'events':
        result.sort((a, b) => dir * ((b.event_count || 0) - (a.event_count || 0)));
        break;
      case 'views':
        result.sort((a, b) => dir * ((b.view_count || 0) - (a.view_count || 0)));
        break;
      default:
        // Hype score (default)
        result.sort((a, b) => dir * ((b.hype_score || 0) - (a.hype_score || 0)));
    }
    
    setFilteredVehicles(result);
  };

  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(1)}M`;
    }
    if (value >= 1000) {
      return `$${(value / 1000).toFixed(0)}k`;
    }
    return `$${value.toLocaleString()}`;
  };

  const handleTimePeriodChange = async (period: TimePeriod) => {
    setTimePeriod(period);
    
    if (session?.user) {
      try {
        await UserInteractionService.logInteraction(
          session.user.id,
          'view',
          'vehicle',
          'time-period-filter',
          {
            source_page: '/homepage'
          } as any
        );

        // Note: user_preferences table doesn't have a 'settings' column
        // It has individual columns. For now, we'll skip this update
        // TODO: Add preferred_time_period column to user_preferences table if needed
        // Silently skip - table structure doesn't support this yet
      } catch (error: any) {
        // For other errors, log as warning but don't break the app
        console.warn('Error saving user preferences:', error);
      }
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
        <div className="text">Loading...</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Stats Bar */}
      {stats.totalBuilds > 0 && (
        <div style={{
          background: 'var(--white)',
          borderBottom: '2px solid var(--border)',
          padding: '12px var(--space-4)',
          display: 'flex',
          gap: '32px',
          justifyContent: 'center',
          fontSize: '9pt',
          color: 'var(--text-muted)'
        }}>
          <span><strong>{stats.totalBuilds}</strong> active builds</span>
          <span><strong>{formatCurrency(stats.totalValue)}</strong> in play</span>
          {stats.activeToday > 0 && <span><strong>{stats.activeToday}</strong> updated today</span>}
        </div>
      )}

      {/* Feed Section */}
      <div style={{
        maxWidth: '1400px',
        margin: '0 auto',
        padding: 'var(--space-4)'
      }}>
        {/* Unified Header (without global search to avoid layout shifts) */}
        <div style={{
          background: 'var(--white)',
          border: '2px solid var(--border)',
          padding: 'var(--space-3)',
          marginBottom: 'var(--space-4)'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 'var(--space-3)',
            flexWrap: 'wrap',
            gap: '12px'
          }}>
            <h2 style={{ fontSize: '12pt', fontWeight: 'bold', margin: 0 }}>
              <span style={{ 
                transition: 'opacity 0.3s ease',
                display: 'inline-block',
                minWidth: '80px' // keep search/nav from shifting when verb length changes
              }}>
                {rotatingVerb}
              </span>
              {' '}
              <span style={{ fontSize: '8pt', color: 'var(--text-muted)', fontWeight: 'normal' }}>
                {filteredVehicles.length} vehicles
              </span>
            </h2>
            
            {/* Metrics Row */}
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '16px',
              flexWrap: 'wrap',
              fontSize: '8pt',
              color: 'var(--text-muted)',
              marginLeft: 'auto'
            }}>
              {(() => {
                const totalValue = filteredVehicles.reduce((sum, v) => sum + (v.display_price || 0), 0);
                const avgValue = filteredVehicles.length > 0 ? totalValue / filteredVehicles.length : 0;
                const forSaleCount = filteredVehicles.filter(v => v.is_for_sale).length;
                const totalImages = filteredVehicles.reduce((sum, v) => sum + (v.image_count || 0), 0);
                const totalEvents = filteredVehicles.reduce((sum, v) => sum + (v.event_count || 0), 0);
                const totalViews = filteredVehicles.reduce((sum, v) => sum + (v.view_count || 0), 0);
                
                return (
                  <>
                    {totalValue > 0 && (
                      <span>
                        <strong style={{ color: 'var(--text)' }}>{formatCurrency(totalValue)}</strong> total value
                      </span>
                    )}
                    {avgValue > 0 && filteredVehicles.length > 1 && (
                      <span>
                        <strong style={{ color: 'var(--text)' }}>{formatCurrency(avgValue)}</strong> avg
                      </span>
                    )}
                    {forSaleCount > 0 && (
                      <span>
                        <strong style={{ color: 'var(--text)' }}>{forSaleCount}</strong> for sale
                      </span>
                    )}
                    {totalImages > 0 && (
                      <span>
                        <strong style={{ color: 'var(--text)' }}>{totalImages.toLocaleString()}</strong> images
                      </span>
                    )}
                    {totalEvents > 0 && (
                      <span>
                        <strong style={{ color: 'var(--text)' }}>{totalEvents.toLocaleString()}</strong> events
                      </span>
                    )}
                    {totalViews > 0 && (
                      <span>
                        <strong style={{ color: 'var(--text)' }}>{totalViews.toLocaleString()}</strong> views
                      </span>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
            
          {/* Controls Row */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '12px', 
            flexWrap: 'wrap',
            borderTop: '1px solid var(--border)',
            paddingTop: 'var(--space-2)'
          }}>
            {/* Time Period Selector - Collapsible */}
            <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
              {[
                { id: 'ALL', label: 'All Time' },
                { id: 'AT', label: 'Active' },
                { id: '1Y', label: 'Yr' },
                { id: 'Q', label: 'Qtr' },
                { id: 'W', label: 'Wk' },
                { id: 'D', label: 'Day' },
                { id: 'RT', label: 'Live' }
              ].map(period => {
                const isSelected = timePeriod === period.id;
                const shouldShow = !timePeriodCollapsed || isSelected;
                
                return (
                  <button
                    key={period.id}
                    onClick={() => {
                      if (isSelected) {
                        setTimePeriodCollapsed(!timePeriodCollapsed);
                      } else {
                        handleTimePeriodChange(period.id as TimePeriod);
                        setTimePeriodCollapsed(false);
                      }
                    }}
                    style={{
                      background: isSelected ? 'var(--grey-600)' : 'var(--white)',
                      color: isSelected ? 'var(--white)' : 'var(--text)',
                      border: '1px solid var(--border)',
                      padding: '3px 6px',
                      fontSize: '7pt',
                      cursor: 'pointer',
                      fontWeight: isSelected ? 'bold' : 'normal',
                      transition: 'all 0.12s',
                      display: shouldShow ? 'inline-block' : 'none'
                    }}
                  >
                    {period.label}
                  </button>
                );
              })}
            </div>

            {/* View Mode Switcher */}
            <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
              {(['gallery', 'grid', 'technical'] as ViewMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  style={{
                    background: viewMode === mode ? 'var(--grey-600)' : 'var(--white)',
                    color: viewMode === mode ? 'var(--white)' : 'var(--text)',
                    border: '1px solid var(--border)',
                    padding: '4px 8px',
                    fontSize: '8pt',
                    cursor: 'pointer',
                    fontWeight: viewMode === mode ? 'bold' : 'normal',
                    transition: 'all 0.12s'
                  }}
                >
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>

            {/* Filters Toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              style={{
                background: showFilters ? 'var(--grey-600)' : 'var(--white)',
                color: showFilters ? 'var(--white)' : 'var(--text)',
                border: '1px solid var(--border)',
                padding: '4px 8px',
                fontSize: '8pt',
                cursor: 'pointer',
                fontWeight: showFilters ? 'bold' : 'normal',
                transition: 'background 0.12s, color 0.12s'
              }}
            >
              Filters {(filters.yearMin || filters.yearMax || filters.makes.length > 0 || filters.hasImages || filters.forSale) && '●'}
            </button>
          </div>
        </div>

        {/* Filter Panel - Sticky with minimize */}
        {showFilters && (
          <div style={{ 
            position: 'sticky',
            top: 0,
            background: filterBarMinimized ? 'rgba(255, 255, 255, 0.95)' : 'var(--grey-50)',
            backdropFilter: filterBarMinimized ? 'blur(10px)' : 'none',
            border: '1px solid var(--border)',
            padding: filterBarMinimized ? '8px 12px' : '12px',
            marginBottom: '12px',
            zIndex: 100,
            boxShadow: filterBarMinimized ? '0 2px 8px rgba(0,0,0,0.1)' : 'none',
            transition: 'padding 0.2s ease, background 0.2s ease',
            opacity: 1
          }}>
            {/* Collapsible header bar */}
            <div 
              onClick={() => setFilterBarMinimized(!filterBarMinimized)}
              style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                cursor: 'pointer',
                fontSize: '8pt',
                fontWeight: 'bold',
                marginBottom: filterBarMinimized ? 0 : '8px',
                paddingBottom: filterBarMinimized ? 0 : '4px',
                borderBottom: filterBarMinimized ? 'none' : '1px solid var(--border)'
              }}
            >
              <span>Filters {filterBarMinimized && `Active (${Object.values(filters).filter(v => v && v !== '' && v !== false && (Array.isArray(v) ? v.length > 0 : true)).length})`}</span>
              <span style={{ fontSize: '10pt' }}>{filterBarMinimized ? '▲' : '▼'}</span>
            </div>
            
            {/* Full filter controls */}
            <div style={{ 
              display: filterBarMinimized ? 'none' : 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
              gap: '12px', 
              fontSize: '8pt' 
            }}>
              {/* Year Range */}
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Year Range</label>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <input
                    type="number"
                    placeholder="Min"
                    value={filters.yearMin || ''}
                    onChange={(e) => setFilters({...filters, yearMin: e.target.value ? parseInt(e.target.value) : null})}
                    style={{
                      width: '70px',
                      padding: '4px 6px',
                      border: '1px solid var(--border)',
                      fontSize: '8pt'
                    }}
                  />
                  <span>–</span>
                  <input
                    type="number"
                    placeholder="Max"
                    value={filters.yearMax || ''}
                    onChange={(e) => setFilters({...filters, yearMax: e.target.value ? parseInt(e.target.value) : null})}
                    style={{
                      width: '70px',
                      padding: '4px 6px',
                      border: '1px solid var(--border)',
                      fontSize: '8pt'
                    }}
                  />
                </div>
              </div>

              {/* Price Range */}
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Price Range</label>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <input
                    type="number"
                    placeholder="Min"
                    value={filters.priceMin || ''}
                    onChange={(e) => setFilters({...filters, priceMin: e.target.value ? parseInt(e.target.value) : null})}
                    style={{
                      width: '80px',
                      padding: '4px 6px',
                      border: '1px solid var(--border)',
                      fontSize: '8pt'
                    }}
                  />
                  <span>–</span>
                  <input
                    type="number"
                    placeholder="Max"
                    value={filters.priceMax || ''}
                    onChange={(e) => setFilters({...filters, priceMax: e.target.value ? parseInt(e.target.value) : null})}
                    style={{
                      width: '80px',
                      padding: '4px 6px',
                      border: '1px solid var(--border)',
                      fontSize: '8pt'
                    }}
                  />
                </div>
              </div>

              {/* Location Filter */}
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Location</label>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginBottom: '4px' }}>
                  <input
                    type="text"
                    placeholder="ZIP code"
                    value={filters.zipCode}
                    onChange={(e) => setFilters({...filters, zipCode: e.target.value})}
                    maxLength={5}
                    style={{
                      width: '70px',
                      padding: '4px 6px',
                      border: '1px solid var(--border)',
                      fontSize: '8pt'
                    }}
                  />
                  <span>within</span>
                  <select
                    value={filters.radiusMiles}
                    onChange={(e) => setFilters({...filters, radiusMiles: parseInt(e.target.value)})}
                    style={{
                      padding: '4px 6px',
                      border: '1px solid var(--border)',
                      fontSize: '8pt'
                    }}
                  >
                    <option value="10">10 mi</option>
                    <option value="25">25 mi</option>
                    <option value="50">50 mi</option>
                    <option value="100">100 mi</option>
                    <option value="250">250 mi</option>
                    <option value="500">500 mi</option>
                  </select>
                </div>
              </div>

              {/* Make Filter */}
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Make</label>
                <input
                  type="text"
                  placeholder="Ford, Chevy, etc"
                  value={filters.makes.join(', ')}
                  onChange={(e) => {
                    const makes = e.target.value.split(',').map(m => m.trim()).filter(m => m.length > 0);
                    setFilters({...filters, makes});
                  }}
                  style={{
                    width: '100%',
                    padding: '4px 6px',
                    border: '1px solid var(--border)',
                    fontSize: '8pt'
                  }}
                />
              </div>

              {/* Status & Display Toggles */}
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Status</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', marginBottom: '4px' }}>
                  <input
                    type="checkbox"
                    checked={filters.forSale}
                    onChange={(e) => setFilters({...filters, forSale: e.target.checked})}
                  />
                  <span>For Sale Only</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', marginBottom: '4px' }}>
                  <input
                    type="checkbox"
                    checked={filters.showPending}
                    onChange={(e) => {
                      setFilters({...filters, showPending: e.target.checked});
                      // Reload feed when this changes
                      setTimeout(() => loadHypeFeed(), 100);
                    }}
                  />
                  <span>Show Pending Vehicles</span>
                </label>
                <div style={{ marginTop: '6px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', marginBottom: '2px' }}>
                    <input
                      type="checkbox"
                      checked={filters.showPrices}
                      onChange={(e) => setFilters({ ...filters, showPrices: e.target.checked })}
                    />
                    <span>Show Prices</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={filters.showDetailOverlay}
                      onChange={(e) => setFilters({ ...filters, showDetailOverlay: e.target.checked })}
                    />
                    <span>Show Detail Card</span>
                  </label>
                </div>
              </div>

              {/* Sort By */}
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Sort By</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortBy)}
                  style={{
                    width: '100%',
                    padding: '4px 6px',
                    border: '1px solid var(--border)',
                    fontSize: '8pt',
                    marginBottom: '4px'
                  }}
                >
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                  <option value="year">Year</option>
                  <option value="make">Make</option>
                  <option value="model">Model</option>
                  <option value="mileage">Mileage</option>
                  <option value="price_high">Price (High to Low)</option>
                  <option value="price_low">Price (Low to High)</option>
                  <option value="popular">Most Popular</option>
                  <option value="images">Most Images</option>
                  <option value="events">Most Events</option>
                  <option value="views">Most Views</option>
                </select>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={sortDirection === 'desc'}
                    onChange={(e) => setSortDirection(e.target.checked ? 'desc' : 'asc')}
                  />
                  <span>Descending</span>
                </label>
              </div>

              {/* Clear Filters */}
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button
                    onClick={() => setFilters({
                    yearMin: null,
                    yearMax: null,
                    makes: [],
                    priceMin: null,
                    priceMax: null,
                    hasImages: false,
                    forSale: false,
                    zipCode: '',
                    radiusMiles: 50,
                    showPrices: true,
                    showDetailOverlay: true
                  })}
                  style={{
                    padding: '4px 12px',
                    background: 'var(--white)',
                    border: '1px solid var(--border)',
                    cursor: 'pointer',
                    fontSize: '8pt',
                    fontWeight: 'bold'
                  }}
                >
                  Clear All
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Technical View with Sortable Columns */}
        {viewMode === 'technical' && (
          <div style={{ 
            background: 'var(--white)',
            border: '1px solid var(--border)',
            overflowX: 'auto',
            overflowY: 'visible',
            position: 'relative'
          }}>
            <table style={{ 
              width: '100%', 
              fontSize: '8pt', 
              borderCollapse: 'collapse'
            }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--grey-50)' }}>
                <tr style={{ background: 'var(--grey-50)', borderBottom: '2px solid var(--border)' }}>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'left',
                    fontWeight: 'bold',
                    whiteSpace: 'nowrap',
                    borderRight: '1px solid var(--border)',
                    position: 'sticky',
                    left: 0,
                    background: 'var(--grey-50)',
                    zIndex: 11
                  }}>
                    Image
                  </th>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'center',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    borderRight: '1px solid var(--border)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => {
                    if (sortBy === 'year') {
                      setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
                    } else {
                      setSortBy('year');
                      setSortDirection('desc');
                    }
                  }}
                  >
                    Year {sortBy === 'year' && (sortDirection === 'desc' ? '▼' : '▲')}
                  </th>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    borderRight: '1px solid var(--border)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => {
                    if (sortBy === 'make') {
                      setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
                    } else {
                      setSortBy('make');
                      setSortDirection('desc');
                    }
                  }}
                  >
                    Make {sortBy === 'make' && (sortDirection === 'desc' ? '▼' : '▲')}
                  </th>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    borderRight: '1px solid var(--border)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => {
                    if (sortBy === 'model') {
                      setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
                    } else {
                      setSortBy('model');
                      setSortDirection('desc');
                    }
                  }}
                  >
                    Model {sortBy === 'model' && (sortDirection === 'desc' ? '▼' : '▲')}
                  </th>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'right',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    borderRight: '1px solid var(--border)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => {
                    if (sortBy === 'mileage') {
                      setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
                    } else {
                      setSortBy('mileage');
                      setSortDirection('desc');
                    }
                  }}
                  >
                    Mileage {sortBy === 'mileage' && (sortDirection === 'desc' ? '▼' : '▲')}
                  </th>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'right',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    borderRight: '1px solid var(--border)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => {
                    if (sortBy === 'price_high' || sortBy === 'price_low') {
                      setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
                    } else {
                      setSortBy('price_high');
                      setSortDirection('desc');
                    }
                  }}
                  >
                    Price {(sortBy === 'price_high' || sortBy === 'price_low') && (sortDirection === 'desc' ? '▼' : '▲')}
                  </th>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'right',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    borderRight: '1px solid var(--border)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => {
                    if (sortBy === 'volume') {
                      setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
                    } else {
                      setSortBy('volume');
                      setSortDirection('desc');
                    }
                  }}
                  >
                    Volume {sortBy === 'volume' && (sortDirection === 'desc' ? '▼' : '▲')}
                  </th>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'right',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    borderRight: '1px solid var(--border)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => {
                    if (sortBy === 'images') {
                      setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
                    } else {
                      setSortBy('images');
                      setSortDirection('desc');
                    }
                  }}
                  >
                    Images {sortBy === 'images' && (sortDirection === 'desc' ? '▼' : '▲')}
                  </th>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'right',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    borderRight: '1px solid var(--border)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => {
                    if (sortBy === 'events') {
                      setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
                    } else {
                      setSortBy('events');
                      setSortDirection('desc');
                    }
                  }}
                  >
                    Events {sortBy === 'events' && (sortDirection === 'desc' ? '▼' : '▲')}
                  </th>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'right',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    borderRight: '1px solid var(--border)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => {
                    if (sortBy === 'views') {
                      setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
                    } else {
                      setSortBy('views');
                      setSortDirection('desc');
                    }
                  }}
                  >
                    Views {sortBy === 'views' && (sortDirection === 'desc' ? '▼' : '▲')}
                  </th>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => {
                    if (sortBy === 'newest' || sortBy === 'oldest') {
                      setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
                    } else {
                      setSortBy('newest');
                      setSortDirection('desc');
                    }
                  }}
                  >
                    Updated {(sortBy === 'newest' || sortBy === 'oldest') && (sortDirection === 'desc' ? '▼' : '▲')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredVehicles.map(vehicle => {
                  return (
                    <tr 
                      key={vehicle.id}
                      onClick={() => navigate(`/vehicle/${vehicle.id}`)}
                      style={{ 
                        borderBottom: '1px solid var(--border)',
                        cursor: 'pointer',
                        transition: 'background 0.12s ease'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--grey-50)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      {/* Image - Sticky left column */}
                      <td style={{ 
                        padding: '4px',
                        borderRight: '1px solid var(--border)',
                        position: 'sticky',
                        left: 0,
                        background: 'var(--white)',
                        zIndex: 1
                      }}>
                        {vehicle.primary_image_url ? (
                          <img 
                            src={vehicle.primary_image_url}
                            alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                            loading="lazy"
                            style={{
                              width: 'min(100px, 15vw)',
                              height: 'min(60px, 9vw)',
                              objectFit: 'cover',
                              border: '1px solid var(--border)',
                              display: 'block'
                            }}
                          />
                        ) : (
                          <div style={{
                            width: 'min(100px, 15vw)',
                            height: 'min(60px, 9vw)',
                            background: 'var(--grey-200)',
                            border: '1px solid var(--border)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}>
                            <img src="/n-zero.png" alt="N-Zero" style={{ width: '60%', opacity: 0.3, objectFit: 'contain' }} />
                          </div>
                        )}
                      </td>

                      {/* Year */}
                      <td style={{ 
                        padding: '8px',
                        textAlign: 'center',
                        fontWeight: 'bold',
                        borderRight: '1px solid var(--border)',
                        whiteSpace: 'nowrap'
                      }}>
                        {vehicle.year || '—'}
                      </td>

                      {/* Make */}
                      <td style={{ 
                        padding: '8px',
                        fontWeight: 'bold',
                        borderRight: '1px solid var(--border)',
                        whiteSpace: 'nowrap'
                      }}>
                        {vehicle.make || '—'}
                      </td>

                      {/* Model */}
                      <td style={{ 
                        padding: '8px',
                        borderRight: '1px solid var(--border)'
                      }}>
                        {vehicle.model || '—'}
                        {vehicle.hype_reason && (
                          <div style={{ 
                            fontSize: '7pt', 
                            color: 'var(--accent)', 
                            fontWeight: 'bold',
                            marginTop: '2px'
                          }}>
                            {vehicle.hype_reason}
                          </div>
                        )}
                      </td>

                      {/* Mileage */}
                      <td style={{ 
                        padding: '8px',
                        textAlign: 'right',
                        borderRight: '1px solid var(--border)',
                        whiteSpace: 'nowrap'
                      }}>
                        {vehicle.mileage 
                          ? `${vehicle.mileage.toLocaleString()}` 
                          : '—'
                        }
                      </td>

                      {/* Price */}
                      <td style={{ 
                        padding: '8px',
                        textAlign: 'right',
                        fontWeight: 'bold',
                        borderRight: '1px solid var(--border)',
                        whiteSpace: 'nowrap'
                      }}>
                        {vehicle.display_price 
                          ? `$${vehicle.display_price.toLocaleString()}` 
                          : '—'
                        }
                      </td>

                      {/* Volume (Trading Volume - placeholder) */}
                      <td style={{ 
                        padding: '8px',
                        textAlign: 'right',
                        borderRight: '1px solid var(--border)',
                        whiteSpace: 'nowrap',
                        color: 'var(--text-muted)'
                      }}>
                        —
                      </td>

                      {/* Images Count */}
                      <td style={{ 
                        padding: '8px',
                        textAlign: 'right',
                        borderRight: '1px solid var(--border)',
                        whiteSpace: 'nowrap'
                      }}>
                        {vehicle.image_count || 0}
                      </td>

                      {/* Events Count */}
                      <td style={{ 
                        padding: '8px',
                        textAlign: 'right',
                        borderRight: '1px solid var(--border)',
                        whiteSpace: 'nowrap'
                      }}>
                        {vehicle.event_count || 0}
                      </td>

                      {/* Views Count */}
                      <td style={{ 
                        padding: '8px',
                        textAlign: 'right',
                        borderRight: '1px solid var(--border)',
                        whiteSpace: 'nowrap'
                      }}>
                        {vehicle.view_count || 0}
                      </td>

                      {/* Updated */}
                      <td style={{ 
                        padding: '8px',
                        color: 'var(--text-muted)',
                        whiteSpace: 'nowrap'
                      }}>
                        {vehicle.updated_at 
                          ? new Date(vehicle.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                          : '—'
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Gallery View */}
        {viewMode === 'gallery' && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
            gap: '4px'
          }}>
            {filteredVehicles.map((vehicle) => (
              <LazyLoadVehicleImages
                key={vehicle.id}
                vehicleId={vehicle.id}
                onVisible={handleVehicleVisible}
              >
                <VehicleCardDense
                  vehicle={{
                    ...vehicle,
                    primary_image_url: vehicle.primary_image_url
                  }}
                  viewMode="gallery"
                  showPriceOverlay={filters.showPrices}
                  showDetailOverlay={filters.showDetailOverlay}
                />
              </LazyLoadVehicleImages>
            ))}
          </div>
        )}

        {/* Grid View - Instagram-style with zero spacing */}
        {viewMode === 'grid' && (
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '0'
        }}>
            {filteredVehicles.map((vehicle, index) => {
              // Debug first 3 vehicles
              if (index < 3) {
                console.log(`🔍 Grid vehicle ${index} (${vehicle.id}):`, {
                  primary_image_url: vehicle.primary_image_url,
                  all_images: vehicle.all_images,
                  all_images_length: vehicle.all_images?.length,
                  image_url: vehicle.image_url,
                  image_count: vehicle.image_count
                });
              }
              
              return (
                <LazyLoadVehicleImages
                  key={vehicle.id}
                  vehicleId={vehicle.id}
                  onVisible={handleVehicleVisible}
                >
                  <VehicleCardDense
                    vehicle={{
                      ...vehicle,
                      primary_image_url: vehicle.primary_image_url,
                      all_images: vehicle.all_images || [],
                      image_url: vehicle.image_url || vehicle.primary_image_url
                    }}
                    viewMode="grid"
                    showPriceOverlay={filters.showPrices}
                    showDetailOverlay={filters.showDetailOverlay}
                  />
                </LazyLoadVehicleImages>
              );
            })}
        </div>
        )}

        {/* Error Display */}
        {error && (
          <div style={{
            background: '#fee',
            border: '2px solid #f00',
            padding: 'var(--space-8)',
            margin: 'var(--space-4)',
            textAlign: 'left'
          }}>
            <div style={{ fontSize: '10pt', fontWeight: 'bold', marginBottom: '8px', color: '#c00' }}>
              ⚠️ Error Loading Content
            </div>
            <div style={{ fontSize: '9pt', color: '#800', marginBottom: '8px' }}>
              {error}
            </div>
            {debugInfo && (
              <details style={{ fontSize: '8pt', color: '#666', marginTop: '8px' }}>
                <summary style={{ cursor: 'pointer', marginBottom: '4px' }}>Debug Info</summary>
                <pre style={{ 
                  background: '#fff', 
                  padding: '8px', 
                  border: '1px solid #ddd',
                  overflow: 'auto',
                  fontSize: '7pt'
                }}>
                  {JSON.stringify(debugInfo, null, 2)}
                </pre>
              </details>
            )}
            <div style={{ fontSize: '8pt', color: '#666', marginTop: '8px' }}>
              Check browser console for more details. Verify environment variables are set in Vercel.
            </div>
          </div>
        )}

        {filteredVehicles.length === 0 && !loading && !error && (
          <div style={{
            background: 'var(--white)',
            border: '2px solid var(--border)',
            padding: 'var(--space-8)',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '10pt', fontWeight: 'bold', marginBottom: '8px' }}>
              No vehicles found
            </div>
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '16px' }}>
              {feedVehicles.length === 0 
                ? 'Be the first to add a build and start the hype train!'
                : 'Try adjusting your filters to see more results.'
              }
            </div>
            {feedVehicles.length === 0 && (
              <button
                onClick={() => navigate('/add-vehicle')}
                style={{
                  background: 'var(--grey-600)',
                  color: 'var(--white)',
                  border: '2px solid var(--border)',
                  padding: '8px 16px',
                  fontSize: '9pt',
                  cursor: 'pointer',
                  fontFamily: '"MS Sans Serif", sans-serif'
                }}
              >
                Add Your First Vehicle
              </button>
            )}
          </div>
        )}
      </div>
      
      {/* Scroll to Top Button - Appears after scrolling down */}
      {showScrollTop && (
        <button
          onClick={() => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            background: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(10px)',
            border: '2px solid rgba(255, 255, 255, 0.3)',
            color: 'white',
            fontSize: '20px',
            fontWeight: 'bold',
            cursor: 'pointer',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(0, 0, 0, 0.9)';
            e.currentTarget.style.transform = 'scale(1.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(0, 0, 0, 0.7)';
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          ↑
        </button>
      )}
    </div>
  );
};

export default CursorHomepage;
