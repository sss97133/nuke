/**
 * UserTodayCard — "Today" / "Now Working On" surface.
 *
 * Substrate: vehicle_images created today by this user, grouped by vehicle.
 * Pulls the most-photographed vehicle of the day, recent thumbnails, and
 * this-week rollup. Lives at the TOP of the user's workspace as a live mirror.
 *
 * Self-guarding: returns null if no activity in the last 7 days.
 */
import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { optimizeImageUrl } from '../../lib/imageOptimizer';
import { useUserProfile } from './UserProfileContext';

interface TodayRow {
  vehicle_id: string | null;
  count: number;
  last_at: string;
}

interface VehicleMeta {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  title: string | null;
}

interface RecentImage {
  id: string;
  image_url: string;
  vehicle_id: string | null;
  taken_at: string | null;
  created_at: string;
}

const UserTodayCard: React.FC = () => {
  const { userId, isOwnProfile } = useUserProfile();
  const [todayByVehicle, setTodayByVehicle] = useState<TodayRow[]>([]);
  const [weekTotal, setWeekTotal] = useState<number>(0);
  const [vehicleMeta, setVehicleMeta] = useState<Map<string, VehicleMeta>>(new Map());
  const [recentImages, setRecentImages] = useState<RecentImage[]>([]);
  const [loaded, setLoaded] = useState(false);

  // ── Fetch today + this week ──
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    (async () => {
      // "Working on today" = photos TAKEN today, not ingested today. Keying on
      // created_at (import time) made freshly bulk-imported OLD photos (e.g.
      // 2018-shot, imported this morning) masquerade as today's work — a
      // provenance violation (C0). taken_at is the truth, the captured day is
      // the unit. We fetch a window of recent imports and bucket them by
      // taken_at::date client-side so EXIF capture time governs.
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const startOfWeek = new Date();
      startOfWeek.setDate(startOfWeek.getDate() - 7);
      const ymd = (d: Date) => d.toISOString().slice(0, 10);
      const todayYmd = ymd(startOfToday);
      const weekYmd = ymd(startOfWeek);
      // taken_at has no index on this 36M-row table; querying the recent
      // upload window (created_at) and filtering by taken_at client-side keeps
      // the query fast while honoring capture time.
      const lookbackStart = new Date();
      lookbackStart.setDate(lookbackStart.getDate() - 14);

      const { data: recentUploads } = await supabase
        .from('vehicle_images')
        .select('id, image_url, vehicle_id, taken_at, created_at')
        .eq('user_id', userId)
        .gte('created_at', lookbackStart.toISOString())
        .order('created_at', { ascending: false })
        .limit(2000);

      if (cancelled) return;

      // Capture day for a row: EXIF taken_at when present, else upload day.
      const captureDay = (img: { taken_at: string | null; created_at: string }): string =>
        (img.taken_at || img.created_at || '').slice(0, 10);

      const todayImgs = (recentUploads || []).filter(img => captureDay(img) === todayYmd);
      const weekImgs = (recentUploads || []).filter(img => captureDay(img) >= weekYmd);

      // Group today's by vehicle (capture time). NULL-vehicle imports are NOT
      // eligible to become the named "WORKING ON <vehicle>" headline — a bulk
      // of unattributed imports must never drive a vehicle headline.
      const byVehicle = new Map<string, TodayRow>();
      for (const img of todayImgs) {
        if (!img.vehicle_id) continue;
        const key = img.vehicle_id;
        const stamp = img.taken_at || img.created_at;
        const ex = byVehicle.get(key) || {
          vehicle_id: img.vehicle_id,
          count: 0,
          last_at: stamp,
        };
        ex.count += 1;
        if (stamp > ex.last_at) ex.last_at = stamp;
        byVehicle.set(key, ex);
      }

      const rows = Array.from(byVehicle.values()).sort((a, b) => b.count - a.count);

      // Recent strip = the PRIMARY (named) vehicle's photos only, so the
      // thumbnails always belong to the headline vehicle.
      const primaryId = rows[0]?.vehicle_id ?? null;
      const recents: RecentImage[] = primaryId
        ? todayImgs.filter(img => img.vehicle_id === primaryId).slice(0, 6)
        : [];

      setTodayByVehicle(rows);
      setWeekTotal(weekImgs.length);
      setRecentImages(recents);

      // Resolve vehicle names for the top 5 today
      const ids = rows.slice(0, 5).map(r => r.vehicle_id).filter((x): x is string => !!x);
      if (ids.length > 0) {
        const { data: vehicles } = await supabase
          .from('vehicles')
          .select('id, year, make, model, title')
          .in('id', ids);
        if (!cancelled && vehicles) {
          const m = new Map<string, VehicleMeta>();
          for (const v of vehicles) m.set(v.id, v as VehicleMeta);
          setVehicleMeta(m);
        }
      }

      setLoaded(true);
    })();

    return () => { cancelled = true; };
  }, [userId]);

  const todayTotal = useMemo(
    () => todayByVehicle.reduce((s, r) => s + r.count, 0),
    [todayByVehicle],
  );

  const primaryVehicle = todayByVehicle[0];
  const primaryMeta = primaryVehicle?.vehicle_id
    ? vehicleMeta.get(primaryVehicle.vehicle_id)
    : undefined;

  const vehicleLabel = (meta?: VehicleMeta): string => {
    if (!meta) return 'unattributed photos';
    const parts = [meta.year, meta.make, meta.model].filter(Boolean).join(' ');
    return meta.title || parts || meta.id.slice(0, 8);
  };

  const todayStr = useMemo(() => {
    const d = new Date();
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}`;
  }, []);

  // Self-guard: don't render until loaded, and if no recent activity at all
  if (!loaded) return null;
  if (todayTotal === 0 && weekTotal === 0) return null;

  return (
    <div
      className="up-today-card"
      style={{
        border: '2px solid #1a1a1a',
        padding: '12px',
        marginBottom: '8px',
        fontFamily: 'Arial, sans-serif',
      }}
      data-user-id={userId}
      data-today-count={todayTotal}
      data-week-count={weekTotal}
    >
      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: '8px',
          paddingBottom: '6px',
          borderBottom: '1px solid #1a1a1a',
        }}
      >
        <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em' }}>
          TODAY · {todayStr}
        </span>
        <span style={{ fontSize: '8px', color: '#666', letterSpacing: '0.06em' }}>
          {todayTotal} TODAY · {weekTotal} THIS WEEK
        </span>
      </div>

      {/* Primary vehicle of the day */}
      {primaryVehicle && (
        <div style={{ marginBottom: '10px' }}>
          <div style={{ fontSize: '8px', color: '#666', letterSpacing: '0.1em', marginBottom: '2px' }}>
            {isOwnProfile ? 'WORKING ON' : 'ACTIVITY ON'}
          </div>
          <div style={{ fontSize: '13px', fontWeight: 700 }}>
            {primaryVehicle.vehicle_id ? (
              <a
                href={`/vehicle/${primaryVehicle.vehicle_id}`}
                style={{ color: '#1a1a1a', textDecoration: 'none', borderBottom: '1px solid #1a1a1a' }}
              >
                {vehicleLabel(primaryMeta)}
              </a>
            ) : (
              vehicleLabel(undefined)
            )}
          </div>
          <div style={{ fontSize: '9px', color: '#666', marginTop: '2px' }}>
            {primaryVehicle.count} photo{primaryVehicle.count !== 1 ? 's' : ''} · last at{' '}
            {new Date(primaryVehicle.last_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      )}

      {/* Recent photo strip */}
      {recentImages.length > 0 && (
        <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', marginBottom: '8px' }}>
          {recentImages.map((img) => (
            <a key={img.id} href={img.vehicle_id ? `/vehicle/${img.vehicle_id}/image/${img.id}` : '#'}>
              <img
                src={optimizeImageUrl(img.image_url, 'thumbnail') || img.image_url}
                alt=""
                width={64}
                height={64}
                style={{ width: 64, height: 64, objectFit: 'cover', border: '1px solid #ccc' }}
                loading="lazy"
              />
            </a>
          ))}
        </div>
      )}

      {/* Other vehicles touched today */}
      {todayByVehicle.length > 1 && (
        <div style={{ fontSize: '9px', color: '#444' }}>
          <span style={{ fontSize: '8px', color: '#666', letterSpacing: '0.1em', marginRight: '4px' }}>
            ALSO TODAY:
          </span>
          {todayByVehicle.slice(1, 4).map((r, i) => {
            const meta = r.vehicle_id ? vehicleMeta.get(r.vehicle_id) : undefined;
            return (
              <span key={r.vehicle_id || `none-${i}`}>
                {i > 0 ? ' · ' : ''}
                {r.vehicle_id ? (
                  <a href={`/vehicle/${r.vehicle_id}`} style={{ color: '#444' }}>
                    {vehicleLabel(meta)} ({r.count})
                  </a>
                ) : (
                  `${vehicleLabel(undefined)} (${r.count})`
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* Empty-today, week-non-empty fallback */}
      {todayTotal === 0 && weekTotal > 0 && (
        <div style={{ fontSize: '11px', color: '#444' }}>
          No new photos today — {weekTotal} uploaded in the last 7 days.
        </div>
      )}
    </div>
  );
};

export default UserTodayCard;
