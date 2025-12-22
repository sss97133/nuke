import React, { useState, useEffect, useRef } from 'react';
import { supabase, getSupabaseFunctionsUrl } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { ImageHoverPreview, AnalysisModelPopup } from '../components/admin';
import { useAdminAccess } from '../hooks/useAdminAccess';

interface SystemStats {
  totalVehicles: number;
  totalImages: number;
  totalOrganizations: number;
  totalUsers: number;
  pendingAnalysis: number;
  investmentOpportunities: number;
  todayUploads: number;
  activeProcessing: number;
}

interface ImageRadarRow {
  kind: string;
  key: string;
  n: number;
  vehicles: number;
  sample_url: string | null;
  sample_vehicle_id: string | null;
}

const AdminMissionControl: React.FC = () => {
  const navigate = useNavigate();
  const { loading: adminLoading, isAdmin } = useAdminAccess();
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [inventoryCompleteness, setInventoryCompleteness] = useState<any | null>(null);
  const [angleCoverage, setAngleCoverage] = useState<any | null>(null);
  const [analysisQueue, setAnalysisQueue] = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [vehicleImageQueue, setVehicleImageQueue] = useState<any[]>([]);
  const [scanProgress, setScanProgress] = useState<any>(null);
  const [imageScanStats, setImageScanStats] = useState<any>(null);
  const [originBackfillRunning, setOriginBackfillRunning] = useState(false);
  const [originBackfillBatchSize, setOriginBackfillBatchSize] = useState(50);
  // 0 means "no cap" (ingest all images).
  const [originBackfillMaxImages, setOriginBackfillMaxImages] = useState(0);
  const [originBackfillIncludePartials, setOriginBackfillIncludePartials] = useState(true);
  const [originBackfillLastResult, setOriginBackfillLastResult] = useState<any | null>(null);
  const [batBackfillRunning, setBatBackfillRunning] = useState(false);
  const [batBackfillBatchSize, setBatBackfillBatchSize] = useState(10);
  const [batBackfillLastResult, setBatBackfillLastResult] = useState<any | null>(null);
  const [batRepairRunning, setBatRepairRunning] = useState(false);
  const [batRepairBatchSize, setBatRepairBatchSize] = useState(10);
  const [batRepairLastResult, setBatRepairLastResult] = useState<any | null>(null);
  const [batCleanupRunning, setBatCleanupRunning] = useState(false);
  const [batCleanupBatchSize, setBatCleanupBatchSize] = useState(25);
  const [batCleanupLastResult, setBatCleanupLastResult] = useState<any | null>(null);
  const [batCleanupVehicleId, setBatCleanupVehicleId] = useState('');
  const [batDomHealthRunning, setBatDomHealthRunning] = useState(false);
  const [batDomHealthBatchSize, setBatDomHealthBatchSize] = useState(50);
  const [batDomHealthLastResult, setBatDomHealthLastResult] = useState<any | null>(null);
  const [batDomHealthSummary, setBatDomHealthSummary] = useState<any | null>(null);
  const [batDomFieldBreakdown, setBatDomFieldBreakdown] = useState<any[] | null>(null);
  const [angleBackfillRunning, setAngleBackfillRunning] = useState(false);
  const [angleBackfillBatchSize, setAngleBackfillBatchSize] = useState(25);
  const [angleBackfillMinConfidence, setAngleBackfillMinConfidence] = useState(80);
  const [angleBackfillLastResult, setAngleBackfillLastResult] = useState<any | null>(null);
  const [imageRadarKind, setImageRadarKind] = useState<'normalized_url' | 'file_hash' | 'perceptual_hash' | 'dhash'>('normalized_url');
  const [imageRadarSource, setImageRadarSource] = useState<string>('');
  const [imageRadarMinCount, setImageRadarMinCount] = useState<number>(25);
  const [imageRadarLimit, setImageRadarLimit] = useState<number>(50);
  const [imageRadarRows, setImageRadarRows] = useState<ImageRadarRow[]>([]);
  const [imageRadarLoading, setImageRadarLoading] = useState<boolean>(false);
  const [imageRadarError, setImageRadarError] = useState<string | null>(null);
  const imageRadarInFlightRef = useRef(false);
  const [imageRadarLastUpdatedAt, setImageRadarLastUpdatedAt] = useState<Date | null>(null);
  const loadInFlightRef = useRef(false);
  const angleCoverageMetricsDisabledRef = useRef(false);
  const batDomFieldBreakdownDisabledRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    loadDashboard();
    const interval = setInterval(loadDashboard, 5000); // Refresh every 5 seconds for scanning
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (cancelled) return;
      await loadImageRadar();
    };

    load();
    const interval = setInterval(load, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [imageRadarKind, imageRadarSource, imageRadarMinCount, imageRadarLimit]);

  const loadImageRadar = async () => {
    if (imageRadarInFlightRef.current) return;
    imageRadarInFlightRef.current = true;
    setImageRadarLoading(true);
    setImageRadarError(null);
    try {
      const { data, error } = await supabase.rpc('admin_image_radar', {
        p_kind: imageRadarKind,
        p_source: imageRadarSource ? imageRadarSource : null,
        p_min_count: imageRadarMinCount,
        p_limit: imageRadarLimit,
      });

      if (error) {
        setImageRadarError(error.message || 'Failed to load image radar');
        setImageRadarRows([]);
        return;
      }

      setImageRadarRows((Array.isArray(data) ? data : []) as ImageRadarRow[]);
      setImageRadarLastUpdatedAt(new Date());
    } catch (e: any) {
      setImageRadarError(e?.message || 'Failed to load image radar');
      setImageRadarRows([]);
    } finally {
      imageRadarInFlightRef.current = false;
      setImageRadarLoading(false);
    }
  };

  const loadDashboard = async () => {
    // Prevent overlapping polls (if one refresh takes >5s, they can stack up and feel "slow")
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    try {
      const results = await Promise.allSettled([
        supabase.from('vehicles').select('id', { count: 'exact', head: true }),
        supabase.from('vehicle_images').select('id', { count: 'exact', head: true }),
        supabase.from('organization_inventory').select('organization_id', { count: 'exact', head: true }),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        // Only fetch what we render (cuts payload dramatically vs select '*')
        supabase
          .from('organization_analysis_queue')
          .select('organization_id,pending_count,oldest_image')
          .order('pending_count', { ascending: false })
          .limit(50),
        supabase.from('organization_narratives').select('id', { count: 'exact', head: true }),
        supabase.from('vehicle_images').select('id', { count: 'exact', head: true }).gte('created_at', new Date(new Date().setHours(0,0,0,0)).toISOString()),
        // Only fetch what we render (timeline_events can have large JSON columns)
        supabase
          .from('timeline_events')
          .select('id,event_type,description,created_at')
          .order('created_at', { ascending: false })
          .limit(10),
        // NOTE: `vehicle_images.ai_analysis` does not exist in production schema.
        // Use `ai_processing_status` to find images that have not been processed by the AI pipeline yet.
        supabase.from('vehicle_images').select('vehicle_id, created_at').is('ai_processing_status', null).limit(100),
        // Only fetch fields we render; avoid throwing if table is empty.
        supabase
          .from('ai_scan_progress')
          .select('status,scan_type,started_at,processed_images,total_images,failed_images,created_at')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.rpc('get_image_scan_stats'),
        supabase.rpc('get_inventory_completeness_metrics', {
          p_min_fill_pct: 90,
          p_confidence_threshold: 70,
          p_statuses: ['active', 'pending'],
          p_profile_origins: null,
          p_inventory_only: true,
        }),
        angleCoverageMetricsDisabledRef.current
          ? Promise.resolve({ data: null, error: null })
          : supabase.rpc('get_inventory_angle_coverage_metrics', {
              p_min_angle_confidence: 0.6,
              p_required_angles: ['front','front_3_4','rear','rear_3_4','side_driver','side_passenger','interior_front','interior_rear','engine_bay','odometer'],
              p_statuses: ['active', 'pending'],
              p_profile_origins: null,
              p_inventory_only: true,
            }),
        supabase.rpc('get_bat_dom_health_summary', { p_hours: 24 * 14 }),
        batDomFieldBreakdownDisabledRef.current
          ? Promise.resolve({ data: null, error: null })
          : supabase.rpc('get_bat_dom_health_field_breakdown', { p_hours: 24 * 14 })
      ]);

      const getFulfilled = <T,>(idx: number): T | null => {
        const r = results[idx];
        if (!r || r.status !== 'fulfilled') return null;
        return r.value as T;
      };

      const vehiclesCount = getFulfilled<any>(0);
      const imagesCount = getFulfilled<any>(1);
      const orgsCount = getFulfilled<any>(2);
      const usersCount = getFulfilled<any>(3);
      const queueData = getFulfilled<any>(4);
      const opportunitiesCount = getFulfilled<any>(5);
      const todayData = getFulfilled<any>(6);
      const recentData = getFulfilled<any>(7);
      const vehicleQueueData = getFulfilled<any>(8);
      const scanProgressData = getFulfilled<any>(9);
      const imageScanData = getFulfilled<any>(10);
      const completenessData = getFulfilled<any>(11);
      const angleCoverageData = getFulfilled<any>(12);
      const batHealthSummaryData = getFulfilled<any>(13);
      const batHealthFieldBreakdownData = getFulfilled<any>(14);

      if (!mountedRef.current) return;

      if (!angleCoverageMetricsDisabledRef.current && angleCoverageData?.error) {
        angleCoverageMetricsDisabledRef.current = true;
      }

      if (!batDomFieldBreakdownDisabledRef.current && batHealthFieldBreakdownData?.error) {
        const msg = String(batHealthFieldBreakdownData.error?.message || '').toLowerCase();
        const code = String(batHealthFieldBreakdownData.error?.code || '').toLowerCase();
        if (msg.includes('could not find') || msg.includes('not found') || code.includes('pgrst')) {
          batDomFieldBreakdownDisabledRef.current = true;
        }
      }

      setStats({
        totalVehicles: vehiclesCount?.count || 0,
        totalImages: imagesCount?.count || 0,
        totalOrganizations: orgsCount?.count || 0,
        totalUsers: usersCount?.count || 0,
        pendingAnalysis: queueData?.data?.reduce((sum: number, q: any) => sum + q.pending_count, 0) || 0,
        investmentOpportunities: opportunitiesCount?.count || 0,
        todayUploads: todayData?.count || 0,
        activeProcessing: 0
      });

      setAnalysisQueue(queueData?.data || []);
      setRecentActivity(recentData?.data || []);
      setScanProgress(scanProgressData?.data);
      setImageScanStats(imageScanData?.data);
      setInventoryCompleteness(completenessData?.data || null);
      setAngleCoverage(angleCoverageData?.data || null);
      setBatDomHealthSummary(batHealthSummaryData?.data || null);
      setBatDomFieldBreakdown(Array.isArray(batHealthFieldBreakdownData?.data) ? batHealthFieldBreakdownData.data : null);
      
      const vehicleGroups = (vehicleQueueData?.data || []).reduce((acc: any, img: any) => {
        if (!acc[img.vehicle_id]) {
          acc[img.vehicle_id] = { vehicle_id: img.vehicle_id, count: 0 };
        }
        acc[img.vehicle_id].count++;
        return acc;
      }, {});
      setVehicleImageQueue(Object.values(vehicleGroups));
      
    } catch (err) {
      console.error('Error loading dashboard:', err);
    } finally {
      loadInFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  };

  const runAnalysis = async (orgId: string) => {
    setProcessing(orgId);
    try {
      const functionsUrl = getSupabaseFunctionsUrl();
      const response = await fetch(`${functionsUrl}/analyze-organization-images`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
        },
        body: JSON.stringify({ organizationId: orgId, batch: true })
      });

      const result = await response.json();
      console.log('Analysis result:', result);
      alert(`Analysis started: ${result.imagesAnalyzed || 0} images processed`);
      loadDashboard();
    } catch (err) {
      console.error('Error running analysis:', err);
      alert('Failed to run analysis');
    } finally {
      setProcessing(null);
    }
  };

  const runOriginImageBackfill = async () => {
    setOriginBackfillRunning(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) {
        alert('You must be logged in to run backfill.');
        return;
      }

      const functionsUrl = getSupabaseFunctionsUrl();

      const resp = await fetch(`${functionsUrl}/admin-backfill-origin-images`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          batch_size: originBackfillBatchSize,
          max_images_per_vehicle: originBackfillMaxImages,
          include_partials: originBackfillIncludePartials,
          dry_run: false,
          force: false,
          include_profile_origins: ['url_scraper', 'bat_import', 'craigslist_scrape'],
        }),
      });

      const text = await resp.text();
      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }

      if (!resp.ok || parsed?.success === false) {
        console.error('Backfill failed:', parsed);
        alert(`Backfill failed: ${parsed?.error || resp.status}`);
        setOriginBackfillLastResult(parsed);
        return;
      }

      setOriginBackfillLastResult(parsed);
      alert(`Backfill complete. Attempted: ${parsed.attempted || 0}. Backfilled: ${parsed.backfilled || 0}. Failed: ${parsed.failed || 0}.`);
      loadDashboard();
    } catch (e: any) {
      console.error('Backfill error:', e);
      alert('Backfill failed.');
    } finally {
      setOriginBackfillRunning(false);
    }
  };

  const runBatMissingImagesBackfill = async () => {
    setBatBackfillRunning(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) {
        alert('You must be logged in to run backfill.');
        return;
      }

      const functionsUrl = getSupabaseFunctionsUrl();

      const resp = await fetch(`${functionsUrl}/admin-backfill-bat-missing-images`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          batch_size: batBackfillBatchSize,
          dry_run: false,
        }),
      });

      const text = await resp.text();
      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }

      if (!resp.ok || parsed?.success === false) {
        console.error('BaT backfill failed:', parsed);
        alert(`BaT backfill failed: ${parsed?.error || resp.status}`);
        setBatBackfillLastResult(parsed);
        return;
      }

      setBatBackfillLastResult(parsed);
      alert(`BaT backfill complete. Candidates: ${parsed.candidates || 0}. Invoked: ${parsed.invoked || 0}. Failed: ${parsed.failed || 0}.`);
      loadDashboard();
    } catch (e: any) {
      console.error('BaT backfill error:', e);
      alert('BaT backfill failed.');
    } finally {
      setBatBackfillRunning(false);
    }
  };

  const runBatDomHealthBatch = async () => {
    setBatDomHealthRunning(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) {
        alert('You must be logged in to run health checks.');
        return;
      }

      const functionsUrl = getSupabaseFunctionsUrl();

      const resp = await fetch(`${functionsUrl}/bat-dom-map-health-runner`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          limit: batDomHealthBatchSize,
          force_rescrape: false,
          persist_html: true,
          extractor_version: 'v1',
        }),
      });

      const text = await resp.text();
      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }

      if (!resp.ok || parsed?.success === false) {
        console.error('BaT DOM health batch failed:', parsed);
        alert(`BaT DOM health batch failed: ${parsed?.error || resp.status}`);
        setBatDomHealthLastResult(parsed);
        return;
      }

      setBatDomHealthLastResult(parsed);
      alert(`BaT DOM health batch complete. Processed: ${parsed.processed || 0}. OK: ${parsed.ok || 0}. Failed: ${parsed.failed || 0}.`);
      loadDashboard();
    } catch (e: any) {
      console.error('BaT DOM health batch error:', e);
      alert('BaT DOM health batch failed.');
    } finally {
      setBatDomHealthRunning(false);
    }
  };

  const runBatMakeProfilesCorrectBatch = async () => {
    setBatRepairRunning(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) {
        alert('You must be logged in to run BaT repair.');
        return;
      }

      const functionsUrl = getSupabaseFunctionsUrl();

      const resp = await fetch(`${functionsUrl}/bat-make-profiles-correct-runner`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          batch_size: batRepairBatchSize,
          dry_run: false,
          min_vehicle_age_hours: 6,
        }),
      });

      const text = await resp.text();
      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }

      if (!resp.ok || parsed?.success === false) {
        console.error('BaT repair batch failed:', parsed);
        alert(`BaT repair batch failed: ${parsed?.error || resp.status}`);
        setBatRepairLastResult(parsed);
        return;
      }

      setBatRepairLastResult(parsed);
      alert(`BaT repair batch complete. Scanned: ${parsed.scanned || 0}. Candidates: ${parsed.candidates || 0}. Repaired: ${parsed.repaired || 0}. Failed: ${parsed.failed || 0}.`);
      loadDashboard();
    } catch (e: any) {
      console.error('BaT repair batch error:', e);
      alert('BaT repair batch failed.');
    } finally {
      setBatRepairRunning(false);
    }
  };

  const runBatImageCleanup = async () => {
    setBatCleanupRunning(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) {
        alert('You must be logged in to run BaT cleanup.');
        return;
      }

      const functionsUrl = getSupabaseFunctionsUrl();

      const resp = await fetch(`${functionsUrl}/cleanup-bat-image-contamination`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          vehicle_id: batCleanupVehicleId.trim() || undefined,
          dry_run: false,
          limit: 1000, // Scan up to 1000 vehicles
          batch_size: batCleanupBatchSize,
        }),
      });

      const text = await resp.text();
      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }

      if (!resp.ok || parsed?.success === false) {
        console.error('BaT cleanup failed:', parsed);
        alert(`BaT cleanup failed: ${parsed?.error || resp.status}`);
        setBatCleanupLastResult(parsed);
        return;
      }

      setBatCleanupLastResult(parsed);
      alert(
        `BaT hygiene batch complete. Scanned: ${parsed.scanned || 0}. Candidates: ${parsed.candidates || 0}. Repaired: ${parsed.repaired || 0}. Refreshed canonical: ${parsed.refreshed_canonical || 0}. Skipped: ${parsed.skipped || 0}. Failed: ${parsed.failed || 0}.`
      );
      loadDashboard();
    } catch (e: any) {
      console.error('BaT cleanup error:', e);
      alert('BaT cleanup failed.');
    } finally {
      setBatCleanupRunning(false);
    }
  };

  const runAnglePoseBackfill = async () => {
    setAngleBackfillRunning(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) {
        alert('You must be logged in to run backfill.');
        return;
      }

      const functionsUrl = getSupabaseFunctionsUrl();

      const resp = await fetch(`${functionsUrl}/backfill-image-angles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          batchSize: angleBackfillBatchSize,
          dryRun: false,
          minConfidence: angleBackfillMinConfidence,
          requireReview: true,
        }),
      });

      const text = await resp.text();
      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }

      if (!resp.ok || parsed?.success === false) {
        console.error('Angle backfill failed:', parsed);
        alert(`Angle backfill failed: ${parsed?.error || resp.status}`);
        setAngleBackfillLastResult(parsed);
        return;
      }

      setAngleBackfillLastResult(parsed);
      alert(`Angle/Pose backfill complete. Processed: ${parsed.processed || 0}. Needs review: ${parsed.needsReview || 0}. Failed: ${parsed.failed || 0}.`);
      loadDashboard();
    } catch (e: any) {
      console.error('Angle backfill error:', e);
      alert('Angle/Pose backfill failed.');
    } finally {
      setAngleBackfillRunning(false);
    }
  };

  // Admin access check
  if (adminLoading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '8pt' }}>
        Checking admin access...
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '8pt' }}>
        <div style={{ marginBottom: '16px', fontWeight: 700 }}>Access Denied</div>
        <div style={{ marginBottom: '16px' }}>Admin privileges are required to access this page.</div>
        <button
          className="button button-secondary"
          onClick={() => navigate('/org/dashboard')}
          style={{ fontSize: '8pt', padding: '8px 16px' }}
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '8pt' }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1600px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px', borderBottom: '2px solid var(--border)', paddingBottom: '16px' }}>
        <h1 style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          ADMIN MISSION CONTROL
        </h1>
        <p style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
          Real-time system monitoring and control
        </p>
      </div>

      {/* ORIGIN IMAGE BACKFILL */}
      <div style={{ marginBottom: '24px' }} className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Image Backfill: origin_metadata → vehicle_images</span>
          <button
            className="button button-primary"
            style={{ fontSize: '8pt' }}
            disabled={originBackfillRunning}
            onClick={runOriginImageBackfill}
          >
            {originBackfillRunning ? 'Running...' : 'Run Backfill Batch'}
          </button>
        </div>
        <div className="card-body">
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '10px' }}>
            Fixes profiles that have `origin_metadata.image_urls` but no rows in `vehicle_images`. Runs in small batches to avoid load spikes.
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ fontSize: '8pt', color: 'var(--text-secondary)' }}>
              Batch size
              <input
                type="number"
                value={originBackfillBatchSize}
                min={1}
                max={200}
                onChange={(e) => setOriginBackfillBatchSize(Number(e.target.value || 50))}
                style={{ marginLeft: 8, width: 90, padding: '6px 8px', border: '1px solid var(--border)', fontSize: '9pt' }}
              />
            </label>
            <label style={{ fontSize: '8pt', color: 'var(--text-secondary)' }}>
              Max images/vehicle (0 = no cap)
              <input
                type="number"
                value={originBackfillMaxImages}
                min={0}
                max={5000}
                onChange={(e) => setOriginBackfillMaxImages(Number(e.target.value || 0))}
                style={{ marginLeft: 8, width: 110, padding: '6px 8px', border: '1px solid var(--border)', fontSize: '9pt' }}
              />
            </label>
            <label style={{ fontSize: '8pt', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={originBackfillIncludePartials}
                onChange={(e) => setOriginBackfillIncludePartials(e.target.checked)}
              />
              Include partial profiles (top off galleries)
            </label>
          </div>
          {originBackfillLastResult && (
            <pre style={{ marginTop: 12, fontSize: '8pt', background: 'var(--grey-100)', padding: 10, border: '1px solid var(--border)', overflow: 'auto', maxHeight: 220 }}>
{JSON.stringify(originBackfillLastResult, null, 2)}
            </pre>
          )}
        </div>
      </div>

      {/* BaT MISSING IMAGES BACKFILL */}
      <div style={{ marginBottom: '24px' }} className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Backfill: BaT vehicles with 0 images</span>
          <button
            className="button button-primary"
            style={{ fontSize: '9pt' }}
            disabled={batBackfillRunning}
            onClick={runBatMissingImagesBackfill}
          >
            {batBackfillRunning ? 'Running...' : 'Run BaT Backfill Batch'}
          </button>
        </div>
        <div className="card-body">
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '10px' }}>
            Fixes BaT profiles where the UI can show a gallery but `vehicle_images` has 0 rows by re-invoking `import-bat-listing` in a controlled batch.
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ fontSize: '8pt', color: 'var(--text-secondary)' }}>
              Batch size
              <input
                type="number"
                value={batBackfillBatchSize}
                min={1}
                max={25}
                onChange={(e) => setBatBackfillBatchSize(Number(e.target.value || 10))}
                style={{ marginLeft: 8, width: 90, padding: '6px 8px', border: '1px solid var(--border)', fontSize: '9pt' }}
              />
            </label>
          </div>
          {batBackfillLastResult && (
            <pre style={{ marginTop: 12, fontSize: '8pt', background: 'var(--grey-100)', padding: 10, border: '1px solid var(--border)', overflow: 'auto', maxHeight: 220 }}>
{JSON.stringify(batBackfillLastResult, null, 2)}
            </pre>
          )}
        </div>
      </div>

      {/* BaT DOM MAP HEALTH (coverage / gaps) */}
      <div style={{ marginBottom: '24px' }} className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>BaT DOM Health: template pass-rate (images/location/description/comments/bids)</span>
          <button
            className="button button-primary"
            style={{ fontSize: '9pt' }}
            disabled={batDomHealthRunning}
            onClick={runBatDomHealthBatch}
          >
            {batDomHealthRunning ? 'Running...' : 'Run Health Batch'}
          </button>
        </div>
        <div className="card-body">
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '10px' }}>
            Computes a deterministic BaT DOM-map over listings, persists HTML snapshots + per-field health, and shows coverage gaps so we can target backfills (especially images, location, comments, bids).
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ fontSize: '8pt', color: 'var(--text-secondary)' }}>
              Batch size
              <input
                type="number"
                value={batDomHealthBatchSize}
                min={1}
                max={500}
                onChange={(e) => setBatDomHealthBatchSize(Number(e.target.value || 50))}
                style={{ marginLeft: 8, width: 90, padding: '6px 8px', border: '1px solid var(--border)', fontSize: '9pt' }}
              />
            </label>
          </div>

          {batDomHealthSummary && (
            <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              <div style={{ border: '1px solid var(--border)', padding: 10 }}>
                <div style={{ fontSize: '14pt', fontWeight: 700 }}>{batDomHealthSummary?.[0]?.listings ?? '—'}</div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', fontWeight: 600 }}>LISTINGS (LAST 14 DAYS)</div>
              </div>
              <div style={{ border: '1px solid var(--border)', padding: 10 }}>
                <div style={{ fontSize: '14pt', fontWeight: 700 }}>{batDomHealthSummary?.[0]?.ok_listings ?? '—'}</div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', fontWeight: 600 }}>OK LISTINGS</div>
              </div>
              <div style={{ border: '1px solid var(--border)', padding: 10 }}>
                <div style={{ fontSize: '14pt', fontWeight: 700 }}>{batDomHealthSummary?.[0]?.fail_listings ?? '—'}</div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', fontWeight: 600 }}>FAILED LISTINGS</div>
              </div>
              <div style={{ border: '1px solid var(--border)', padding: 10 }}>
                <div style={{ fontSize: '14pt', fontWeight: 700 }}>{batDomHealthSummary?.[0]?.avg_score ?? '—'}</div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', fontWeight: 600 }}>AVG SCORE</div>
              </div>
              <div style={{ border: '1px solid var(--border)', padding: 10 }}>
                <div style={{ fontSize: '14pt', fontWeight: 700 }}>{batDomHealthSummary?.[0]?.p50_score ?? '—'}</div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', fontWeight: 600 }}>P50 SCORE</div>
              </div>
              <div style={{ border: '1px solid var(--border)', padding: 10 }}>
                <div style={{ fontSize: '14pt', fontWeight: 700 }}>{batDomHealthSummary?.[0]?.images_missing ?? '—'}</div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', fontWeight: 600 }}>IMAGES MISSING</div>
              </div>
              <div style={{ border: '1px solid var(--border)', padding: 10 }}>
                <div style={{ fontSize: '14pt', fontWeight: 700 }}>{batDomHealthSummary?.[0]?.location_missing ?? '—'}</div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', fontWeight: 600 }}>LOCATION MISSING</div>
              </div>
              <div style={{ border: '1px solid var(--border)', padding: 10 }}>
                <div style={{ fontSize: '14pt', fontWeight: 700 }}>{batDomHealthSummary?.[0]?.description_missing ?? '—'}</div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', fontWeight: 600 }}>DESCRIPTION MISSING</div>
              </div>
              <div style={{ border: '1px solid var(--border)', padding: 10 }}>
                <div style={{ fontSize: '14pt', fontWeight: 700 }}>{batDomHealthSummary?.[0]?.comments_missing ?? '—'}</div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', fontWeight: 600 }}>COMMENTS MISSING</div>
              </div>
              <div style={{ border: '1px solid var(--border)', padding: 10 }}>
                <div style={{ fontSize: '14pt', fontWeight: 700 }}>{batDomHealthSummary?.[0]?.bids_missing ?? '—'}</div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', fontWeight: 600 }}>BIDS MISSING</div>
              </div>
            </div>
          )}

          {Array.isArray(batDomFieldBreakdown) && batDomFieldBreakdown.length > 0 && (
            <div style={{ marginTop: 12, border: '1px solid var(--border)', overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8pt' }}>
                <thead>
                  <tr style={{ background: 'var(--grey-100)' }}>
                    <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--border)' }}>FIELD</th>
                    <th style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid var(--border)' }}>OK %</th>
                    <th style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid var(--border)' }}>OK</th>
                    <th style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid var(--border)' }}>MISSING</th>
                  </tr>
                </thead>
                <tbody>
                  {batDomFieldBreakdown.map((r: any) => (
                    <tr key={String(r.field_key)}>
                      <td style={{ padding: 8, borderBottom: '1px solid var(--border)', fontFamily: 'monospace' }}>{String(r.field_key)}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid var(--border)', textAlign: 'right' }}>{typeof r.ok_pct === 'number' ? `${r.ok_pct}%` : String(r.ok_pct ?? '—')}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid var(--border)', textAlign: 'right' }}>{String(r.ok_listings ?? '—')}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid var(--border)', textAlign: 'right' }}>{String(r.missing_listings ?? '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {batDomHealthLastResult && (
            <pre style={{ marginTop: 12, fontSize: '8pt', background: 'var(--grey-100)', padding: 10, border: '1px solid var(--border)', overflow: 'auto', maxHeight: 220 }}>
{JSON.stringify(batDomHealthLastResult, null, 2)}
            </pre>
          )}
        </div>
      </div>

      {/* BaT REPAIR LOOP (make profiles correct) */}
      <div style={{ marginBottom: '24px' }} className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>BaT Repair Loop: make profiles correct (images + description + location + comments)</span>
          <button
            className="button button-primary"
            style={{ fontSize: '9pt' }}
            disabled={batRepairRunning}
            onClick={runBatMakeProfilesCorrectBatch}
          >
            {batRepairRunning ? 'Running...' : 'Run Repair Batch'}
          </button>
        </div>
        <div className="card-body">
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '10px' }}>
            Selects incomplete BaT vehicles and re-invokes `import-bat-listing`, which chains image backfill, comprehensive extraction, and comment ingestion.
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ fontSize: '8pt', color: 'var(--text-secondary)' }}>
              Batch size
              <input
                type="number"
                value={batRepairBatchSize}
                min={1}
                max={50}
                onChange={(e) => setBatRepairBatchSize(Number(e.target.value || 10))}
                style={{ marginLeft: 8, width: 90, padding: '6px 8px', border: '1px solid var(--border)', fontSize: '9pt' }}
              />
            </label>
          </div>
          {batRepairLastResult && (
            <pre style={{ marginTop: 12, fontSize: '8pt', background: 'var(--grey-100)', padding: 10, border: '1px solid var(--border)', overflow: 'auto', maxHeight: 220 }}>
{JSON.stringify(batRepairLastResult, null, 2)}
            </pre>
          )}
        </div>
      </div>

      {/* BaT IMAGE CONTAMINATION CLEANUP */}
      <div style={{ marginBottom: '24px' }} className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>BaT Image Hygiene (canonical gallery + remove contamination)</span>
          <button
            className="button button-primary"
            style={{ fontSize: '9pt' }}
            disabled={batCleanupRunning}
            onClick={runBatImageCleanup}
          >
            {batCleanupRunning ? 'Running...' : (batCleanupVehicleId.trim() ? 'Fix This Vehicle' : 'Clean All BaT Images')}
          </button>
        </div>
        <div className="card-body">
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '10px' }}>
            Repairs BaT galleries using the ONLY canonical source: `vehicles.origin_metadata.image_urls` (BaT `data-gallery-items`).\n            Sets `vehicle_images.position` to match BaT order, marks non-canonical BaT-domain images as `is_duplicate`, and resets the primary image to the first canonical photo.\n            Run repeatedly until the BaT feed no longer shows BaT UI assets as primary images.
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ fontSize: '8pt', color: 'var(--text-secondary)' }}>
              Vehicle ID (optional)
              <input
                type="text"
                value={batCleanupVehicleId}
                placeholder="uuid"
                onChange={(e) => setBatCleanupVehicleId(e.target.value)}
                style={{ marginLeft: 8, width: 320, padding: '6px 8px', border: '1px solid var(--border)', fontSize: '9pt' }}
              />
            </label>
            <label style={{ fontSize: '8pt', color: 'var(--text-secondary)' }}>
              Batch size
              <input
                type="number"
                value={batCleanupBatchSize}
                min={1}
                max={100}
                onChange={(e) => setBatCleanupBatchSize(Number(e.target.value || 25))}
                style={{ marginLeft: 8, width: 90, padding: '6px 8px', border: '1px solid var(--border)', fontSize: '9pt' }}
              />
            </label>
          </div>
          {batCleanupLastResult && (
            <pre style={{ marginTop: 12, fontSize: '8pt', background: 'var(--grey-100)', padding: 10, border: '1px solid var(--border)', overflow: 'auto', maxHeight: 220 }}>
{JSON.stringify(batCleanupLastResult, null, 2)}
            </pre>
          )}
        </div>
      </div>

      {/* ANGLE + POSE BACKFILL */}
      <div style={{ marginBottom: '24px' }} className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Backfill: image angles + yaw (contextual, cheap)</span>
          <button
            className="button button-primary"
            style={{ fontSize: '9pt' }}
            disabled={angleBackfillRunning}
            onClick={runAnglePoseBackfill}
          >
            {angleBackfillRunning ? 'Running...' : 'Run Angle/Pose Batch'}
          </button>
        </div>
        <div className="card-body">
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '10px' }}>
            Tags images with a precise angle taxonomy and writes pose signals directly onto `vehicle_images` (`ai_detected_angle`, confidence, and `yaw_deg` when applicable).
            Uses a <AnalysisModelPopup modelName="gemini-1.5-flash">cheaper model</AnalysisModelPopup> and processes only images missing `ai_detected_angle`.
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ fontSize: '8pt', color: 'var(--text-secondary)' }}>
              Batch size
              <input
                type="number"
                value={angleBackfillBatchSize}
                min={1}
                max={200}
                onChange={(e) => setAngleBackfillBatchSize(Number(e.target.value || 25))}
                style={{ marginLeft: 8, width: 90, padding: '6px 8px', border: '1px solid var(--border)', fontSize: '9pt' }}
              />
            </label>
            <label style={{ fontSize: '8pt', color: 'var(--text-secondary)' }}>
              Min confidence
              <input
                type="number"
                value={angleBackfillMinConfidence}
                min={1}
                max={100}
                onChange={(e) => setAngleBackfillMinConfidence(Number(e.target.value || 80))}
                style={{ marginLeft: 8, width: 90, padding: '6px 8px', border: '1px solid var(--border)', fontSize: '9pt' }}
              />
            </label>
          </div>
          {angleBackfillLastResult && (
            <pre style={{ marginTop: 12, fontSize: '8pt', background: 'var(--grey-100)', padding: 10, border: '1px solid var(--border)', overflow: 'auto', maxHeight: 220 }}>
{JSON.stringify(angleBackfillLastResult, null, 2)}
            </pre>
          )}
        </div>
      </div>

      {/* AI SCANNING STATUS - PROMINENT */}
      {(scanProgress || imageScanStats) && (
        <div style={{ marginBottom: '24px', border: '2px solid #000', background: '#f8f8f8' }}>
          <div style={{
            background: '#000',
            color: '#fff',
            padding: '12px 16px',
            fontSize: '8pt',
            fontWeight: 700,
            letterSpacing: '0.5px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span>AI IMAGE SCANNING</span>
            {scanProgress?.status === 'running' && (
              <span style={{ background: '#10b981', color: '#000', padding: '4px 8px', fontSize: '8pt', fontWeight: 700 }}>
                ACTIVE
              </span>
            )}
          </div>
          <div style={{ padding: '20px' }}>
            {/* Overall Progress Bar */}
            {imageScanStats && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '8pt', fontWeight: 600 }}>OVERALL PROGRESS</span>
                  <span style={{ fontSize: '10pt', fontWeight: 700 }}>
                    {imageScanStats.scan_percentage || 0}%
                  </span>
                </div>
                <div style={{
                  width: '100%',
                  height: '24px',
                  background: '#e0e0e0',
                  border: '2px solid #000',
                  position: 'relative',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    width: `${imageScanStats.scan_percentage || 0}%`,
                    height: '100%',
                    background: '#000',
                    transition: 'width 0.5s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <span style={{ color: '#fff', fontSize: '8pt', fontWeight: 700 }}>
                      {imageScanStats.scan_percentage > 10 && `${imageScanStats.scan_percentage}%`}
                    </span>
                  </div>
      </div>

      {/* Stats Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '24px' }}>
                  <div style={{ border: '2px solid #000', padding: '16px', background: 'var(--surface)' }}>
                    <div style={{ fontSize: '8pt', color: '#666', marginBottom: '8px', fontWeight: 600 }}>
                      VEHICLE IMAGES
                    </div>
                    <div style={{ fontSize: '16pt', fontWeight: 700, marginBottom: '4px' }}>
                      {imageScanStats.scanned_vehicle_images?.toLocaleString()} / {imageScanStats.total_vehicle_images?.toLocaleString()}
                    </div>
                    <div style={{ fontSize: '8pt', color: '#666' }}>
                      {imageScanStats.unscanned_vehicle_images?.toLocaleString()} REMAINING
                    </div>
                  </div>
                  <div style={{ border: '2px solid #000', padding: '16px', background: 'var(--surface)' }}>
                    <div style={{ fontSize: '8pt', color: '#666', marginBottom: '8px', fontWeight: 600 }}>
                      ORGANIZATION IMAGES
                    </div>
                    <div style={{ fontSize: '16pt', fontWeight: 700, marginBottom: '4px' }}>
                      {imageScanStats.scanned_org_images?.toLocaleString()} / {imageScanStats.total_org_images?.toLocaleString()}
                    </div>
                    <div style={{ fontSize: '8pt', color: '#666' }}>
                      {imageScanStats.unscanned_org_images?.toLocaleString()} REMAINING
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Current Scan Details */}
            {scanProgress && scanProgress.status === 'running' && (
              <div style={{
                marginTop: '20px',
                padding: '16px',
                background: '#10b98110',
                border: '2px solid #10b981'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div>
                    <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '4px' }}>
                      CURRENT SCAN: {scanProgress.scan_type?.toUpperCase().replace(/_/g, ' ')}
                    </div>
                    <div style={{ fontSize: '8pt', color: '#666' }}>
                      Started: {new Date(scanProgress.started_at).toLocaleString()}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '12pt', fontWeight: 700 }}>
                      {scanProgress.processed_images}/{scanProgress.total_images}
                    </div>
                    <div style={{ fontSize: '8pt', color: '#ef4444', fontWeight: 600 }}>
                      {scanProgress.failed_images} FAILED
                    </div>
                  </div>
                </div>
                {scanProgress.total_images > 0 && (
                  <div style={{
                    width: '100%',
                    height: '6px',
                    background: '#e0e0e0',
                    border: '1px solid #000'
                  }}>
                    <div style={{
                      width: `${(scanProgress.processed_images / scanProgress.total_images) * 100}%`,
                      height: '100%',
                      background: '#10b981',
                      transition: 'width 0.3s ease'
                    }} />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* System Stats */}
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          SYSTEM STATISTICS
        </h2>
      <div style={{
        display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: '12px'
      }}>
        {[
            { label: 'VEHICLES', value: stats?.totalVehicles.toLocaleString() },
            { label: 'IMAGES', value: stats?.totalImages.toLocaleString() },
            { label: 'ORGANIZATIONS', value: stats?.totalOrganizations.toLocaleString() },
            { label: 'USERS', value: stats?.totalUsers.toLocaleString() },
            { label: 'PENDING ANALYSIS', value: stats?.pendingAnalysis.toLocaleString(), alert: (stats?.pendingAnalysis || 0) > 0 },
            { label: 'OPPORTUNITIES', value: stats?.investmentOpportunities.toLocaleString() },
            { label: 'TODAY UPLOADS', value: stats?.todayUploads.toLocaleString() },
            { label: 'PROCESSING', value: stats?.activeProcessing.toLocaleString() }
        ].map((stat, idx) => (
          <div
            key={idx}
            style={{
                border: '2px solid #000',
                background: stat.alert ? '#fef2f2' : '#fff',
                padding: '12px',
                textAlign: 'center'
              }}
            >
              <div style={{ fontSize: '16pt', fontWeight: 700, marginBottom: '4px', color: stat.alert ? '#ef4444' : '#000' }}>
                {stat.value}
              </div>
              <div style={{ fontSize: '8pt', color: '#666', fontWeight: 600 }}>
                {stat.label}
              </div>
            </div>
          ))}
            </div>
          </div>

      {/* Image Fingerprint Radar */}
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          IMAGE FINGERPRINT RADAR (DUPES + CONTAMINATION)
        </h2>
        <div style={{ border: '2px solid #000', background: '#fff', padding: '12px' }}>
          <div style={{ fontSize: '8pt', color: '#666', marginBottom: 10 }}>
            Finds image keys that appear many times across vehicles. This is the fastest way to detect BaT "chrome" images and cross-post reuse.
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ fontSize: '8pt', color: 'var(--text-secondary)' }}>
              Kind
              <select
                value={imageRadarKind}
                onChange={(e) => setImageRadarKind(e.target.value as any)}
                style={{ marginLeft: 8, padding: '6px 8px', border: '1px solid var(--border)', fontSize: '9pt' }}
              >
                <option value="normalized_url">normalized_url</option>
                <option value="file_hash">file_hash</option>
                <option value="perceptual_hash">perceptual_hash</option>
                <option value="dhash">dhash</option>
              </select>
            </label>

            <label style={{ fontSize: '8pt', color: 'var(--text-secondary)' }}>
              Source (optional)
              <input
                type="text"
                value={imageRadarSource}
                onChange={(e) => setImageRadarSource(e.target.value)}
                placeholder="bat_import / organization_import / ..."
                style={{ marginLeft: 8, width: 220, padding: '6px 8px', border: '1px solid var(--border)', fontSize: '9pt' }}
              />
            </label>

            <label style={{ fontSize: '8pt', color: 'var(--text-secondary)' }}>
              Min count
              <input
                type="number"
                value={imageRadarMinCount}
                min={2}
                max={1000000}
                onChange={(e) => setImageRadarMinCount(Number(e.target.value || 25))}
                style={{ marginLeft: 8, width: 110, padding: '6px 8px', border: '1px solid var(--border)', fontSize: '9pt' }}
              />
            </label>

            <label style={{ fontSize: '8pt', color: 'var(--text-secondary)' }}>
              Limit
              <input
                type="number"
                value={imageRadarLimit}
                min={1}
                max={500}
                onChange={(e) => setImageRadarLimit(Number(e.target.value || 50))}
                style={{ marginLeft: 8, width: 90, padding: '6px 8px', border: '1px solid var(--border)', fontSize: '9pt' }}
              />
            </label>

            <button
              className="button button-secondary"
              onClick={loadImageRadar}
              disabled={imageRadarLoading}
              style={{ fontSize: '9pt' }}
            >
              {imageRadarLoading ? 'Loading…' : 'Refresh'}
            </button>

            <div style={{ fontSize: '8pt', color: '#666' }}>
              {imageRadarLastUpdatedAt ? `Updated: ${imageRadarLastUpdatedAt.toLocaleString()}` : ''}
            </div>
          </div>

          {imageRadarError && (
            <div style={{ marginTop: 10, padding: 10, border: '2px solid #ef4444', background: '#fef2f2', fontSize: '8pt' }}>
              {imageRadarError}
            </div>
          )}

          <div style={{ marginTop: 12, border: '1px solid var(--border)', overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8pt' }}>
              <thead>
                <tr style={{ background: 'var(--grey-100)' }}>
                  <th style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid var(--border)' }}>COUNT</th>
                  <th style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid var(--border)' }}>VEHICLES</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--border)' }}>SAMPLE</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--border)' }}>KEY</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--border)' }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {(imageRadarRows || []).map((r) => (
                  <tr key={`${r.kind}:${r.key}`}>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--border)', textAlign: 'right', fontWeight: 700 }}>{Number(r.n || 0).toLocaleString()}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--border)', textAlign: 'right' }}>{Number(r.vehicles || 0).toLocaleString()}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
                      {r.sample_url ? (
                        <ImageHoverPreview imageUrl={r.sample_url} vehicleId={r.sample_vehicle_id || undefined}>
                          <img src={r.sample_url} style={{ width: 72, height: 54, objectFit: 'cover', border: '1px solid var(--border)', cursor: 'pointer' }} />
                        </ImageHoverPreview>
                      ) : (
                        <span style={{ color: '#999' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--border)', fontFamily: 'monospace', maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.key}>
                      {r.key}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {r.sample_url ? (
                          <ImageHoverPreview imageUrl={r.sample_url} vehicleId={r.sample_vehicle_id || undefined}>
                            <a className="button button-secondary" style={{ fontSize: '8pt' }} href={r.sample_url} target="_blank" rel="noreferrer">
                              Open image
                            </a>
                          </ImageHoverPreview>
                        ) : null}
                        {r.sample_vehicle_id ? (
                          <button
                            className="button button-secondary"
                            style={{ fontSize: '8pt' }}
                            onClick={() => navigate(`/vehicle/${r.sample_vehicle_id}`)}
                          >
                            Open vehicle
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {(!imageRadarRows || imageRadarRows.length === 0) && (
                  <tr>
                    <td colSpan={5} style={{ padding: 10, color: '#666' }}>
                      {imageRadarLoading ? 'Loading…' : 'No rows (try lowering Min count, or remove Source filter).'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Inventory Data Completeness */}
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          INVENTORY DATA COMPLETENESS (TRUTH-GATED)
        </h2>
        <div style={{ border: '2px solid #000', background: '#fff', padding: '12px' }}>
          <div style={{ fontSize: '8pt', color: '#666', marginBottom: 10 }}>
            Counts only fields with confidence at or above threshold. Default: 70.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div style={{ border: '2px solid #e5e5e5', padding: 10 }}>
              <div style={{ fontSize: '14pt', fontWeight: 700 }}>
                {inventoryCompleteness?.counts?.at_or_above_min ?? '—'} / {inventoryCompleteness?.counts?.total ?? '—'}
              </div>
              <div style={{ fontSize: '8pt', color: '#666', fontWeight: 600 }}>
                VEHICLES AT OR ABOVE 90% FIELDS
              </div>
            </div>
            <div style={{ border: '2px solid #e5e5e5', padding: 10 }}>
              <div style={{ fontSize: '14pt', fontWeight: 700 }}>
                {inventoryCompleteness?.counts?.avg_fill_pct ?? '—'}%
              </div>
              <div style={{ fontSize: '8pt', color: '#666', fontWeight: 600 }}>
                AVERAGE FIELD COMPLETENESS
              </div>
            </div>
            <div style={{ border: '2px solid #e5e5e5', padding: 10 }}>
              <div style={{ fontSize: '14pt', fontWeight: 700 }}>
                {inventoryCompleteness?.counts?.p50_fill_pct ?? '—'}%
              </div>
              <div style={{ fontSize: '8pt', color: '#666', fontWeight: 600 }}>
                MEDIAN FIELD COMPLETENESS
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Angle Coverage */}
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          IMAGE ANGLE COVERAGE
        </h2>
        <div style={{ border: '2px solid #000', background: '#fff', padding: '12px' }}>
          <div style={{ fontSize: '8pt', color: '#666', marginBottom: 10 }}>
            Coverage is computed from image angle tags (AI-detected) with confidence at or above 0.60.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div style={{ border: '2px solid #e5e5e5', padding: 10 }}>
              <div style={{ fontSize: '14pt', fontWeight: 700 }}>
                {angleCoverage?.counts?.full_coverage ?? '—'} / {angleCoverage?.counts?.vehicles ?? '—'}
              </div>
              <div style={{ fontSize: '8pt', color: '#666', fontWeight: 600 }}>
                FULL COVERAGE (ALL REQUIRED ANGLES)
              </div>
            </div>
            <div style={{ border: '2px solid #e5e5e5', padding: 10 }}>
              <div style={{ fontSize: '14pt', fontWeight: 700 }}>
                {angleCoverage?.counts?.at_or_above_90 ?? '—'} / {angleCoverage?.counts?.vehicles ?? '—'}
              </div>
              <div style={{ fontSize: '8pt', color: '#666', fontWeight: 600 }}>
                AT OR ABOVE 90% ANGLES
              </div>
            </div>
            <div style={{ border: '2px solid #e5e5e5', padding: 10 }}>
              <div style={{ fontSize: '14pt', fontWeight: 700 }}>
                {angleCoverage?.counts?.avg_angle_coverage_pct ?? '—'}%
              </div>
              <div style={{ fontSize: '8pt', color: '#666', fontWeight: 600 }}>
                AVERAGE ANGLE COVERAGE
              </div>
            </div>
          </div>
            </div>
          </div>

      {/* Quick Actions */}
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          QUICK ACTIONS
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          {[
            { label: 'SCRIPT CONTROL', sublabel: 'Batch operations', path: '/admin/scripts' },
            { label: 'IMAGE PROCESSING', sublabel: 'Monitor pipeline', path: '/admin/image-processing' },
            { label: 'LIVE ANALYSIS', sublabel: 'Real-time progress', path: '/admin/live-analysis', primary: true },
            { label: 'BATCH ANALYSIS', sublabel: 'AI vehicle analysis', path: '/admin/batch-analysis', primary: true },
            { label: 'EXTRACTION MONITOR', sublabel: 'Image extraction progress', path: '/admin/extraction-monitor', primary: true },
            { label: 'KSL SCRAPER', sublabel: 'Import trucks from KSL', path: '/admin/ksl-scraper', primary: true },
            { label: 'BUSINESS INTELLIGENCE', sublabel: 'Feedback inbox', path: '/admin/business-intelligence', primary: true },
            { label: 'VERIFICATIONS', sublabel: 'Review pending', path: '/admin/verifications' },
            { label: 'MERGE PROPOSALS', sublabel: 'Duplicate vehicles', path: '/admin/merge-proposals' },
            { label: 'PRICE EDITOR', sublabel: 'Bulk price edits', path: '/admin/price-editor' },
            { label: 'MEME LIBRARY', sublabel: 'Index packs + uploads', path: '/admin/meme-library' }
          ].map((action, idx) => (
            <button
              key={idx}
              onClick={() => navigate(action.path)}
              style={{
                padding: '16px',
                fontSize: '8pt',
                textAlign: 'left',
                border: action.primary ? '2px solid #000' : '2px solid #ccc',
                background: action.primary ? '#000' : '#fff',
                color: action.primary ? '#fff' : '#000',
                cursor: 'pointer',
                transition: 'all 0.12s ease',
                fontWeight: 600
              }}
              onMouseEnter={(e) => {
                if (!action.primary) {
                  e.currentTarget.style.borderColor = '#000';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }
              }}
              onMouseLeave={(e) => {
                if (!action.primary) {
                  e.currentTarget.style.borderColor = '#ccc';
                  e.currentTarget.style.transform = 'translateY(0)';
                }
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: '4px' }}>{action.label}</div>
              <div style={{ fontSize: '8pt', opacity: 0.7 }}>{action.sublabel}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Analysis Queue */}
      {analysisQueue.length > 0 && (
        <div style={{ marginBottom: '24px', border: '2px solid #f59e0b', background: '#fffbeb' }}>
          <div style={{
            background: '#f59e0b',
            color: '#000',
            padding: '12px 16px',
            fontSize: '8pt',
            fontWeight: 700,
            letterSpacing: '0.5px'
          }}>
            PENDING ANALYSIS ({analysisQueue.reduce((sum, q) => sum + q.pending_count, 0)} IMAGES)
          </div>
          <div style={{ padding: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {analysisQueue.map((queue) => (
                <div
                  key={queue.organization_id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px',
                    background: 'var(--surface)',
                    border: '2px solid #e5e5e5'
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '4px', fontFamily: 'monospace' }}>
                      ORG: {queue.organization_id.slice(0, 8)}
                    </div>
                    <div style={{ fontSize: '8pt', color: '#666' }}>
                      {queue.pending_count} images | Oldest: {new Date(queue.oldest_image).toLocaleDateString()}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => navigate(`/org/${queue.organization_id}`)}
                      style={{ 
                        fontSize: '8pt', 
                        padding: '8px 12px',
                        border: '2px solid #000',
                        background: 'var(--surface)',
                        cursor: 'pointer',
                        fontWeight: 600
                      }}
                    >
                      VIEW
                    </button>
                    <button
                      onClick={() => runAnalysis(queue.organization_id)}
                      style={{ 
                        fontSize: '8pt', 
                        padding: '8px 12px',
                        border: '2px solid #000',
                        background: '#000',
                        color: '#fff',
                        cursor: 'pointer',
                        fontWeight: 600
                      }}
                      disabled={processing === queue.organization_id}
                    >
                      {processing === queue.organization_id ? 'PROCESSING...' : `ANALYZE (${queue.pending_count})`}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Recent Activity */}
      <div style={{ border: '2px solid #000' }}>
        <div style={{
          background: '#000',
          color: '#fff',
          padding: '12px 16px',
          fontSize: '8pt',
          fontWeight: 700,
          letterSpacing: '0.5px'
        }}>
          RECENT ACTIVITY
        </div>
        <div style={{ padding: '16px', background: 'var(--surface)' }}>
          {recentActivity.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#999', fontSize: '8pt' }}>
              NO RECENT ACTIVITY
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {recentActivity.map((event, idx) => (
                <div
                  key={event.id || idx}
                  style={{
                    padding: '12px',
                    background: '#f8f8f8',
                    border: '1px solid #e5e5e5',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '8pt'
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, marginBottom: '4px', textTransform: 'uppercase' }}>
                      {event.event_type?.replace(/_/g, ' ')}
                    </div>
                    <div style={{ fontSize: '8pt', color: '#666' }}>
                      {event.description || 'No description'}
                    </div>
                  </div>
                  <div style={{ fontSize: '8pt', color: '#999', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                    {new Date(event.created_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminMissionControl;
