import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

/**
 * 5 W's Investigation Tool for Vehicle Profiles
 * Helps identify potential duplicates using GPS, time, metadata
 */

interface InvestigationData {
  who: {
    photographer_device?: string;
    photographer_name?: string;
    uploader_name?: string;
    contributor_count: number;
  };
  what: {
    vehicle_name: string;
    image_count: number;
    event_count: number;
    has_real_vin: boolean;
    discovery_source?: string;
  };
  when: {
    first_photo_date?: string;
    last_photo_date?: string;
    creation_date: string;
    photo_time_span_days?: number;
    most_active_date?: string;
  };
  where: {
    gps_locations: Array<{ lat: number; lng: number; count: number; name?: string }>;
    primary_location?: { lat: number; lng: number; radius_meters: number };
    location_spread_km?: number;
  };
  why: {
    likely_purpose: string;
    confidence_score: number;
    red_flags: string[];
  };
}

interface NearbyVehicle {
  id: string;
  year: number;
  make: string;
  model: string;
  vin?: string;
  distance_meters: number;
  time_overlap_days: number;
  same_owner: boolean;
  duplicate_likelihood: number;
}

interface Props {
  vehicleId: string;
  onClose: () => void;
}

export default function VehicleInvestigationPanel({ vehicleId, onClose }: Props) {
  const [data, setData] = useState<InvestigationData | null>(null);
  const [nearbyVehicles, setNearbyVehicles] = useState<NearbyVehicle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    investigate();
  }, [vehicleId]);

  const investigate = async () => {
    setLoading(true);
    try {
      // Load vehicle
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('*')
        .eq('id', vehicleId)
        .single();

      if (!vehicle) return;

      // Load images with EXIF
      const { data: images } = await supabase
        .from('vehicle_images')
        .select('image_url, taken_at, latitude, longitude, exif_data, user_id, ghost_user_id')
        .eq('vehicle_id', vehicleId)
        .order('taken_at', { ascending: true });

      // Load timeline events
      const { data: events } = await supabase
        .from('timeline_events')
        .select('event_date, user_id')
        .eq('vehicle_id', vehicleId);

      // Load contributors
      const { data: contributors } = await supabase
        .from('vehicle_contributors')
        .select('user_id, role')
        .eq('vehicle_id', vehicleId);

      // WHO: Extract photographer info
      const ghostUsers = new Set((images || []).map(img => img.ghost_user_id).filter(Boolean));
      const ghostUser = ghostUsers.size === 1 ? Array.from(ghostUsers)[0] : undefined;
      
      let photographerDevice;
      if (ghostUser) {
        const { data: ghost } = await supabase
          .from('ghost_users')
          .select('camera_make, camera_model, display_name')
          .eq('id', ghostUser)
          .single();
        
        if (ghost) {
          photographerDevice = `${ghost.camera_make || ''} ${ghost.camera_model || ''}`.trim();
        }
      }

      // WHAT: Basic vehicle info
      const hasRealVin = vehicle.vin && !vehicle.vin.startsWith('VIVA-');

      // WHEN: Time span analysis
      const imageDates = (images || []).map(img => img.taken_at).filter(Boolean);
      const firstPhoto = imageDates.length > 0 ? new Date(imageDates[0]) : null;
      const lastPhoto = imageDates.length > 0 ? new Date(imageDates[imageDates.length - 1]) : null;
      const timeSpanDays = firstPhoto && lastPhoto 
        ? Math.floor((lastPhoto.getTime() - firstPhoto.getTime()) / (1000 * 60 * 60 * 24))
        : undefined;

      // Group by date to find most active
      const dateGroups: any = {};
      imageDates.forEach(date => {
        const dateStr = new Date(date).toISOString().split('T')[0];
        dateGroups[dateStr] = (dateGroups[dateStr] || 0) + 1;
      });
      const mostActiveDate = Object.entries(dateGroups)
        .sort((a: any, b: any) => b[1] - a[1])[0]?.[0];

      // WHERE: GPS analysis
      const gpsImages = (images || []).filter(img => img.latitude && img.longitude);
      const gpsLocations: Array<{ lat: number; lng: number; count: number }> = [];
      
      // Cluster GPS points (simple bucketing)
      gpsImages.forEach(img => {
        const existing = gpsLocations.find(loc => 
          Math.abs(loc.lat - img.latitude) < 0.001 && 
          Math.abs(loc.lng - img.longitude) < 0.001
        );
        
        if (existing) {
          existing.count++;
        } else {
          gpsLocations.push({
            lat: img.latitude,
            lng: img.longitude,
            count: 1
          });
        }
      });

      // Calculate primary location (most photos)
      const primaryLocation = gpsLocations.sort((a, b) => b.count - a.count)[0];

      // Calculate location spread
      let locationSpreadKm;
      if (gpsLocations.length > 1) {
        const distances = gpsLocations.map(loc => {
          if (!primaryLocation) return 0;
          const R = 6371; // Earth radius in km
          const dLat = (loc.lat - primaryLocation.lat) * Math.PI / 180;
          const dLon = (loc.lng - primaryLocation.lng) * Math.PI / 180;
          const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                   Math.cos(primaryLocation.lat * Math.PI / 180) * Math.cos(loc.lat * Math.PI / 180) *
                   Math.sin(dLon/2) * Math.sin(dLon/2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          return R * c;
        });
        locationSpreadKm = Math.max(...distances);
      }

      // WHY: Determine likely purpose and red flags
      const redFlags: string[] = [];
      
      if (!hasRealVin) redFlags.push('No real VIN (auto-generated)');
      if ((images?.length || 0) < 5) redFlags.push('Very few photos (< 5)');
      if ((events?.length || 0) === 0) redFlags.push('No timeline events');
      if (vehicle.discovery_source === 'dropbox_bulk_import') redFlags.push('From bulk Dropbox import');
      if (timeSpanDays && timeSpanDays < 1) redFlags.push('All photos from single day (possible duplicate session)');

      const investigationData: InvestigationData = {
        who: {
          photographer_device: photographerDevice,
          uploader_name: vehicle.uploaded_by,
          contributor_count: contributors?.length || 0
        },
        what: {
          vehicle_name: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
          image_count: images?.length || 0,
          event_count: events?.length || 0,
          has_real_vin: hasRealVin,
          discovery_source: vehicle.discovery_source
        },
        when: {
          first_photo_date: firstPhoto?.toISOString(),
          last_photo_date: lastPhoto?.toISOString(),
          creation_date: vehicle.created_at,
          photo_time_span_days: timeSpanDays,
          most_active_date: mostActiveDate
        },
        where: {
          gps_locations: gpsLocations,
          primary_location: primaryLocation ? {
            lat: primaryLocation.lat,
            lng: primaryLocation.lng,
            radius_meters: 400
          } : undefined,
          location_spread_km: locationSpreadKm
        },
        why: {
          likely_purpose: determinePurpose(vehicle, images, events, hasRealVin),
          confidence_score: calculateConfidence(vehicle, images, events, hasRealVin),
          red_flags: redFlags
        }
      };

      setData(investigationData);

      // Find nearby vehicles (GPS + time overlap)
      if (primaryLocation) {
        await findNearbyVehicles(
          primaryLocation.lat,
          primaryLocation.lng,
          firstPhoto,
          lastPhoto,
          vehicle
        );
      }

    } catch (error) {
      console.error('Investigation failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const findNearbyVehicles = async (
    lat: number,
    lng: number,
    timeStart: Date | null,
    timeEnd: Date | null,
    currentVehicle: any
  ) => {
    // Find all vehicles with photos taken within 400m and similar time frame
    const { data: candidates } = await supabase
      .from('vehicle_images')
      .select('vehicle_id, latitude, longitude, taken_at')
      .neq('vehicle_id', vehicleId)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null);

    if (!candidates) return;

    const nearby: Map<string, any> = new Map();

    candidates.forEach(img => {
      // Calculate distance
      const R = 6371000; // Earth radius in meters
      const dLat = (img.latitude - lat) * Math.PI / 180;
      const dLon = (img.longitude - lng) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
               Math.cos(lat * Math.PI / 180) * Math.cos(img.latitude * Math.PI / 180) *
               Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const distance = R * c;

      if (distance <= 400) { // Within 400 meters
        if (!nearby.has(img.vehicle_id)) {
          nearby.set(img.vehicle_id, {
            vehicle_id: img.vehicle_id,
            distance_meters: distance,
            photo_dates: []
          });
        }
        nearby.get(img.vehicle_id).photo_dates.push(new Date(img.taken_at));
      }
    });

    // Enrich with vehicle data and calculate time overlap
    const enriched = await Promise.all(
      Array.from(nearby.values()).map(async (entry) => {
        const { data: vehicle } = await supabase
          .from('vehicles')
          .select('id, year, make, model, vin, uploaded_by')
          .eq('id', entry.vehicle_id)
          .single();

        if (!vehicle) return null;

        // Calculate time overlap
        let timeOverlapDays = 0;
        if (timeStart && timeEnd) {
          const candidateStart = new Date(Math.min(...entry.photo_dates.map((d: Date) => d.getTime())));
          const candidateEnd = new Date(Math.max(...entry.photo_dates.map((d: Date) => d.getTime())));
          
          // Check overlap
          const overlapStart = candidateStart > timeStart ? candidateStart : timeStart;
          const overlapEnd = candidateEnd < timeEnd ? candidateEnd : timeEnd;
          
          if (overlapStart < overlapEnd) {
            timeOverlapDays = Math.floor((overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24));
          }
        }

        // Calculate duplicate likelihood
        let likelihood = 0;
        if (entry.distance_meters < 100) likelihood += 40;
        else if (entry.distance_meters < 400) likelihood += 20;
        
        if (timeOverlapDays > 0) likelihood += 30;
        if (vehicle.uploaded_by === currentVehicle.uploaded_by) likelihood += 20;
        if (vehicle.year === currentVehicle.year) likelihood += 10;

        return {
          id: vehicle.id,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          vin: vehicle.vin,
          distance_meters: Math.round(entry.distance_meters),
          time_overlap_days: timeOverlapDays,
          same_owner: vehicle.uploaded_by === currentVehicle.uploaded_by,
          duplicate_likelihood: likelihood
        };
      })
    );

    setNearbyVehicles(
      enriched
        .filter(v => v !== null)
        .sort((a: any, b: any) => b.duplicate_likelihood - a.duplicate_likelihood) as NearbyVehicle[]
    );
  };

  const determinePurpose = (vehicle: any, images: any[], events: any[], hasRealVin: boolean): string => {
    if (hasRealVin && images.length > 50 && events.length > 20) {
      return 'High-quality owner profile with extensive documentation';
    }
    if (!hasRealVin && images.length < 5 && vehicle.discovery_source === 'dropbox_bulk_import') {
      return 'Low-grade bulk import profile, likely duplicate';
    }
    if (images.length > 100) {
      return 'Comprehensive documentation, likely active restoration';
    }
    if (events.length === 0 && images.length > 0) {
      return 'Image collection without timeline data';
    }
    return 'Standard vehicle profile';
  };

  const calculateConfidence = (vehicle: any, images: any[], events: any[], hasRealVin: boolean): number => {
    let score = 50; // Base
    
    if (hasRealVin) score += 30;
    if (images && images.length > 10) score += 10;
    if (events && events.length > 5) score += 10;
    if (vehicle.discovery_source !== 'dropbox_bulk_import') score += 10;
    
    return Math.min(score, 100);
  };

  if (loading || !data) {
    return (
      <div className="card" style={{ padding: '24px', textAlign: 'center' }}>
        Investigating vehicle profile...
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: '0' }}>
      {/* Header */}
      <div className="card-header" style={{ 
        display: 'flex', 
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '12px 16px'
      }}>
        <span style={{ fontSize: '11pt', fontWeight: 700 }}>Vehicle Investigation (5 W's)</span>
        <button onClick={onClose} style={{ 
          background: 'none', 
          border: 'none', 
          fontSize: '14pt', 
          cursor: 'pointer',
          color: 'var(--text-muted)'
        }}>×</button>
      </div>

      <div className="card-body" style={{ padding: '16px' }}>
        {/* WHO */}
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '8px', color: '#3b82f6' }}>
            WHO (Photographer/Uploader)
          </h3>
          <div style={{ fontSize: '9pt', color: 'var(--text-secondary)' }}>
            {data.who.photographer_device && (
              <div>Camera: {data.who.photographer_device}</div>
            )}
            <div>👥 Contributors: {data.who.contributor_count}</div>
          </div>
        </div>

        {/* WHAT */}
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '8px', color: '#10b981' }}>
            WHAT (Vehicle Data)
          </h3>
          <div style={{ fontSize: '9pt', color: 'var(--text-secondary)' }}>
            <div>🚗 {data.what.vehicle_name}</div>
            <div>📸 {data.what.image_count} photos</div>
            <div>📅 {data.what.event_count} timeline events</div>
            <div>
              🔢 VIN: {data.what.has_real_vin ? '✅ Real' : '❌ Auto-generated'}
            </div>
            {data.what.discovery_source && (
              <div>📥 Source: {data.what.discovery_source}</div>
            )}
          </div>
        </div>

        {/* WHEN */}
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '8px', color: '#f59e0b' }}>
            WHEN (Timeline)
          </h3>
          <div style={{ fontSize: '9pt', color: 'var(--text-secondary)' }}>
            {data.when.first_photo_date && (
              <div>📅 First Photo: {new Date(data.when.first_photo_date).toLocaleDateString()}</div>
            )}
            {data.when.last_photo_date && (
              <div>📅 Last Photo: {new Date(data.when.last_photo_date).toLocaleDateString()}</div>
            )}
            {data.when.photo_time_span_days !== undefined && (
              <div>⏱️ Photo Span: {data.when.photo_time_span_days} days</div>
            )}
            {data.when.most_active_date && (
              <div>🔥 Most Active: {new Date(data.when.most_active_date).toLocaleDateString()}</div>
            )}
            <div>🆕 Profile Created: {new Date(data.when.creation_date).toLocaleDateString()}</div>
          </div>
        </div>

        {/* WHERE */}
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '8px', color: '#8b5cf6' }}>
            WHERE (GPS Locations)
          </h3>
          <div style={{ fontSize: '9pt', color: 'var(--text-secondary)' }}>
            {data.where.gps_locations.length > 0 ? (
              <>
                <div>📍 {data.where.gps_locations.length} unique location(s)</div>
                {data.where.primary_location && (
                  <div>
                    🎯 Primary: {data.where.primary_location.lat.toFixed(4)}, {data.where.primary_location.lng.toFixed(4)}
                  </div>
                )}
                {data.where.location_spread_km !== undefined && (
                  <div>📏 Spread: {data.where.location_spread_km.toFixed(2)} km</div>
                )}
              </>
            ) : (
              <div>❌ No GPS data in photos</div>
            )}
          </div>
        </div>

        {/* WHY */}
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '8px', color: '#ec4899' }}>
            WHY (Analysis)
          </h3>
          <div style={{ fontSize: '9pt', marginBottom: '8px' }}>
            <strong>Likely Purpose:</strong> {data.why.likely_purpose}
          </div>
          <div style={{ fontSize: '9pt', marginBottom: '8px' }}>
            <strong>Data Quality:</strong>{' '}
            <span style={{
              color: data.why.confidence_score >= 80 ? '#10b981' : data.why.confidence_score >= 50 ? '#f59e0b' : '#ef4444',
              fontWeight: 700
            }}>
              {data.why.confidence_score}%
            </span>
          </div>
          {data.why.red_flags.length > 0 && (
            <div style={{
              padding: '8px',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '3px',
              fontSize: '8pt'
            }}>
              <strong>🚩 Red Flags:</strong>
              <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                {data.why.red_flags.map((flag, idx) => (
                  <li key={idx}>{flag}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Nearby Vehicles (Potential Duplicates) */}
        {nearbyVehicles.length > 0 && (
          <div style={{
            marginTop: '24px',
            padding: '16px',
            background: '#fffbeb',
            border: '2px solid #f59e0b',
            borderRadius: '4px'
          }}>
            <h3 style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '12px', color: '#92400e' }}>
              ⚠️ Potential Duplicates Nearby ({nearbyVehicles.length})
            </h3>
            <div style={{ fontSize: '8pt', color: '#78350f', marginBottom: '12px' }}>
              Other vehicles photographed in same GPS location + time period
            </div>
            
            {nearbyVehicles.slice(0, 5).map(nearby => (
              <div
                key={nearby.id}
                style={{
                  padding: '10px',
                  background: 'white',
                  border: `2px solid ${nearby.duplicate_likelihood >= 70 ? '#dc2626' : '#d97706'}`,
                  borderRadius: '3px',
                  marginBottom: '8px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <div style={{ fontSize: '9pt', fontWeight: 700 }}>
                    {nearby.year} {nearby.make} {nearby.model}
                  </div>
                  <div style={{
                    background: nearby.duplicate_likelihood >= 70 ? '#dc2626' : '#f59e0b',
                    color: 'white',
                    padding: '2px 8px',
                    borderRadius: '2px',
                    fontSize: '7pt',
                    fontWeight: 700
                  }}>
                    {nearby.duplicate_likelihood}% MATCH
                  </div>
                </div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                  📍 {nearby.distance_meters}m away
                  {nearby.time_overlap_days > 0 && ` • ⏱️ ${nearby.time_overlap_days} day overlap`}
                  {nearby.same_owner && ' • 👤 Same owner'}
                </div>
                {nearby.vin && (
                  <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '4px' }}>
                    VIN: {nearby.vin}
                    {nearby.vin.startsWith('VIVA-') && <span style={{ color: '#dc2626' }}> (auto)</span>}
                  </div>
                )}
                <a
                  href={`/vehicle/${nearby.id}`}
                  target="_blank"
                  style={{
                    fontSize: '8pt',
                    color: '#3b82f6',
                    textDecoration: 'none',
                    marginTop: '6px',
                    display: 'inline-block'
                  }}
                >
                  View Profile →
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

