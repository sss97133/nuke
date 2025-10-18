import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

// Lightweight Leaflet loader via CDN to avoid adding npm deps right now
const ensureLeaflet = (): Promise<typeof window & { L: any }> => {
  return new Promise((resolve, reject) => {
    if ((window as any).L) return resolve(window as any);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.async = true;
    script.onload = () => resolve(window as any);
    script.onerror = reject;
    document.body.appendChild(script);
  });
};

interface EventMapProps {
  vehicleId: string;
  showLifeOnly?: boolean; // ignored now (we map all time)
}

interface TimelineEvent {
  id: string;
  event_type?: string;
  event_date?: string;
  title?: string;
  image_urls?: string[];
  metadata?: any;
}

const EventMap: React.FC<EventMapProps> = ({ vehicleId, showLifeOnly = false }) => {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [imagePoints, setImagePoints] = useState<Array<{ lat: number; lon: number; url: string; id?: string; takenAt?: string }>>([]);

  const loadEvents = async () => {
    try {
      setLoading(true);
      setError(null);
      const [vte, legacy] = await Promise.all([
        supabase.from('vehicle_timeline_events').select('*').eq('vehicle_id', vehicleId),
        supabase.from('vehicle_timeline_events').select('*').eq('vehicle_id', vehicleId).limit(200)
      ]);
      const merged: TimelineEvent[] = [
        ...((vte.data || []) as any[]),
        ...((legacy.data || []) as any[])
      ];
      setEvents(merged);
    } catch (e: any) {
      setError(e?.message || 'Failed to load events');
    } finally {
      setLoading(false);
    }
  };

  // Load ALL vehicle_images with GPS data from EXIF
  const loadImagePoints = async () => {
    try {
      console.log('Loading image points for vehicle:', vehicleId);
      const { data, error } = await supabase
        .from('vehicle_images')
        .select('id,image_url,exif_data,created_at,file_name,latitude,longitude')
        .eq('vehicle_id', vehicleId)
        .limit(1000);
      
      if (error) {
        console.error('Error loading vehicle images:', error);
        return;
      }
      
      console.log(`Found ${data?.length || 0} images to check for GPS data`);
      
      const pts: Array<{ lat: number; lon: number; url: string; id?: string; takenAt?: string }> = [];
      
      for (const img of (data || [])) {
        let lat: number | null = null;
        let lon: number | null = null;
        
        // Try EXIF data first (preferred)
        if (img.exif_data && img.exif_data.location) {
          lat = img.exif_data.location.latitude;
          lon = img.exif_data.location.longitude;
          console.log(`Image ${img.file_name}: EXIF GPS ${lat}, ${lon}`);
        }
        // Fallback to direct columns (legacy)
        else if (img.latitude && img.longitude) {
          lat = img.latitude;
          lon = img.longitude;
          console.log(`Image ${img.file_name}: Direct GPS ${lat}, ${lon}`);
        }
        
        // Validate coordinates
        if (lat && lon && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
          pts.push({
            lat: lat,
            lon: lon,
            url: img.image_url as string,
            id: img.id,
            takenAt: img.created_at
          });
          
          // Debug location
          if (lat >= 33.2 && lat <= 33.8 && lon >= -112.3 && lon <= -111.6) {
            console.log(`   📍 Phoenix area: ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
          } else {
            console.log(`   📍 Other location: ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
          }
        } else if (lat || lon) {
          console.log(`Image ${img.file_name}: Invalid GPS coordinates ${lat}, ${lon}`);
        }
      }
      
      console.log(`Loaded ${pts.length} map points with valid GPS data`);
      setImagePoints(pts);
    } catch (error) {
      console.error('Error loading image points:', error);
    }
  };

  const backfillCoordinates = async () => {
    try {
      const piexif = await import('piexifjs');
      const updatedIds: string[] = [];

      const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const geocode = async (query: string): Promise<{ lat: number; lon: number } | null> => {
        try {
          const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`;
          const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
          if (!res.ok) return null;
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            const first = data[0];
            const lat = Number(first.lat);
            const lon = Number(first.lon);
            if (!Number.isNaN(lat) && !Number.isNaN(lon)) return { lat, lon };
          }
          return null;
        } catch {
          return null;
        }
      };

      for (const ev of events) {
        try {
          const hasCoords = !!ev?.metadata?.location_coords;
          if (hasCoords) continue;

          let found: { latitude: number; longitude: number } | null = null;

          // 1) Try all event images for EXIF GPS
          const urls = Array.isArray(ev.image_urls) ? ev.image_urls : [];
          for (const url of urls) {
            try {
              const res = await fetch(url);
              const blob = await res.blob();
              const dataUrl = await new Promise<string>((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(r.result as string);
                r.onerror = reject;
                r.readAsDataURL(blob);
              });
              const binary = atob(dataUrl.split(',')[1] || '');
              const exifObj = piexif.load(binary);
              const latArr = exifObj?.GPS?.[piexif.GPSIFD.GPSLatitude];
              const lonArr = exifObj?.GPS?.[piexif.GPSIFD.GPSLongitude];
              const latRef = exifObj?.GPS?.[piexif.GPSIFD.GPSLatitudeRef];
              const lonRef = exifObj?.GPS?.[piexif.GPSIFD.GPSLongitudeRef];
              if (latArr && lonArr) {
                const toDec = (arr: any[]) => arr[0][0]/arr[0][1] + arr[1][0]/(arr[1][1]*60) + arr[2][0]/(arr[2][1]*3600);
                let lat = toDec(latArr);
                let lon = toDec(lonArr);
                if (latRef === 'S') lat = -lat; if (lonRef === 'W') lon = -lon;
                found = { latitude: lat, longitude: lon };
                break;
              }
            } catch {}
          }

          // 2) Fallback: geocode string location
          if (!found && ev?.metadata?.location && typeof ev.metadata.location === 'string' && ev.metadata.location.trim().length > 3) {
            const res = await geocode(ev.metadata.location);
            if (res) {
              found = { latitude: res.lat, longitude: res.lon };
              await delay(1000); // polite throttle
            }
          }

          if (found) {
            await supabase
              .from('vehicle_timeline_events')
              .update({ metadata: { ...(ev.metadata || {}), location_coords: found } })
              .eq('id', ev.id);
            updatedIds.push(ev.id);
          }

        } catch {}
      }
      if (updatedIds.length > 0) await loadEvents();
    } catch (e) {
      console.warn('Backfill EXIF/geocode failed:', e);
    }
  };

  useEffect(() => {
    Promise.all([loadEvents(), loadImagePoints()]).then(() => setLoading(false));
    
    // Listen for image upload events to refresh map
    const handleImageUpdate = (event: CustomEvent) => {
      if (event.detail?.vehicleId === vehicleId) {
        console.log('Images updated, refreshing map');
        loadImagePoints();
      }
    };
    
    window.addEventListener('vehicle_images_updated', handleImageUpdate as any);
    return () => {
      window.removeEventListener('vehicle_images_updated', handleImageUpdate as any);
    };
  }, [vehicleId]);

  useEffect(() => {
    let map: any;
    let markers: any[] = [];
    (async () => {
      try {
        const w = await ensureLeaflet();
        const L = (w as any).L;
        if (!mapRef.current) return;
        // init map
        if ((mapRef.current as any).__map) {
          map = (mapRef.current as any).__map;
        } else {
          map = L.map(mapRef.current).setView([37.0902, -95.7129], 4); // USA default view
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap contributors'
          }).addTo(map);
          (mapRef.current as any).__map = map;
        }
        // clear old markers
        markers.forEach(m => m.remove());
        markers = [];
        const points: [number, number, TimelineEvent][] = [];
        for (const ev of events) {
          const coords = ev?.metadata?.location_coords || ev?.metadata?.coordinates || ev?.metadata?.location || ev?.metadata?.location_gps;
          if (coords && typeof coords === 'object' && 'latitude' in coords && 'longitude' in coords) {
            points.push([coords.latitude, coords.longitude, ev]);
          }
        }
        const photoPoints = imagePoints;
        if (points.length > 0 || photoPoints.length > 0) {
          points.forEach(([lat, lon, ev]) => {
            const m = L.marker([lat, lon]).addTo(map);
            const dateStr = ev.event_date ? new Date(ev.event_date).toLocaleDateString() : '';
            const title = ev.title || ev.event_type || 'Event';
            const img = Array.isArray(ev.image_urls) && ev.image_urls[0] ? `<div style="margin-top:6px;"><img src="${ev.image_urls[0]}" style="width:120px;height:90px;object-fit:cover;border-radius:4px;border:1px solid #e5e7eb;" /></div>` : '';
            m.bindPopup(`<div style="font-family:Arial,sans-serif;font-size:12px;max-width:180px;"><div style="font-weight:600;">${title}</div><div>${dateStr}</div>${img}</div>`);
            markers.push(m);
          });
          // Render photo markers (smaller icon)
          photoPoints.forEach((p) => {
            const m = L.circleMarker([p.lat, p.lon], { radius: 5, color: '#2563eb', fillColor: '#3b82f6', fillOpacity: 0.85 }).addTo(map);
            const img = `<div style="margin-top:6px;"><img src="${p.url}" style="width:140px;height:100px;object-fit:cover;border-radius:4px;border:1px solid #e5e7eb;" /></div>`;
            m.bindPopup(`<div style="font-family:Arial,sans-serif;font-size:12px;max-width:200px;"><div style="font-weight:600;">Photo</div>${img}</div>`);
            markers.push(m);
          });
          const latLngs = points.map(p => [p[0], p[1]] as [number, number]);
          const photoLatLngs = photoPoints.map(p => [p.lat, p.lon] as [number, number]);
          const all = [...latLngs, ...photoLatLngs];
          if (all.length > 0) map.fitBounds(all as any, { padding: [20, 20] });
        }
      } catch (e) {
        console.warn('Map init failed:', e);
      }
    })();
    return () => {};
  }, [events, imagePoints]);

  return (
    <div className="card">
      <div className="card-body">
        {loading && <div className="text-sm text-gray-600">Loading events…</div>}
        {error && <div className="text-sm text-red-600">{error}</div>}
        <div ref={mapRef} style={{ width: '100%', height: 360, borderRadius: 8, border: '1px solid #e5e7eb' }} />
      </div>
    </div>
  );
};

export default EventMap;
