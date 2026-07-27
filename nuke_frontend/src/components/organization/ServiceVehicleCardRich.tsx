/**
 * Rich Service Vehicle Card
 * 
 * Shows actual useful info for people shopping around:
 * - Work photos grid (not just primary image)
 * - Total hours invested
 * - Estimated cost
 * - Work sessions count
 * - Timeline span
 * - Work type summary
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { optimizeImageUrl } from '../../lib/imageOptimizer';
import { ServiceReportModal } from './ServiceReportModal';

interface ServiceStats {
  totalSessions: number;
  totalImages: number;
  totalHours: number;
  firstSession: string | null;
  lastSession: string | null;
  recentImages: string[];
  workTypes: string[];
}

/**
 * One row of get_service_vehicles_for_org, handed down by the parent grid.
 * When present the card renders from it and fires ZERO queries of its own —
 * 46 cards used to cost 138 round trips. The self-fetch below is the fallback
 * for any caller that doesn't have the batch.
 */
export interface ServiceVehicleStatsRow {
  vehicle_id: string;
  photo_count?: number | null;
  first_photo_at?: string | null;
  last_photo_at?: string | null;
  recent_image_urls?: string[] | null;
  work_types?: string[] | null;
  job_count?: number | null;
  total_labor_hours?: number | null;
}

interface ServiceVehicleCardRichProps {
  vehicleId: string;
  vehicleYear?: number;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleVin?: string;
  organizationId: string;
  organizationName?: string;
  laborRate?: number;
  /** Pre-fetched row from the org-wide batch. Suppresses this card's own queries. */
  statsRow?: ServiceVehicleStatsRow | null;
  /** The org-wide batch is still in flight — hold the skeleton, don't self-fetch. */
  statsPending?: boolean;
}

export function ServiceVehicleCardRich({
  vehicleId,
  vehicleYear = 0,
  vehicleMake = '',
  vehicleModel = '',
  vehicleVin,
  organizationId,
  organizationName,
  laborRate = 125,
  statsRow = null,
  statsPending = false
}: ServiceVehicleCardRichProps) {
  const [stats, setStats] = useState<ServiceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    if (statsRow) {
      setStats({
        totalSessions: statsRow.job_count ?? 0,
        totalImages: statsRow.photo_count ?? 0,
        totalHours: Math.round(Number(statsRow.total_labor_hours ?? 0) * 10) / 10,
        firstSession: statsRow.first_photo_at ?? null,
        lastSession: statsRow.last_photo_at ?? null,
        recentImages: statsRow.recent_image_urls ?? [],
        workTypes: statsRow.work_types ?? []
      });
      setLoading(false);
      return;
    }
    // Hold the skeleton while the org-wide batch is in flight. Self-fetching
    // here would re-create the 3-queries-per-card fan-out this replaces.
    if (statsPending) {
      setLoading(true);
      return;
    }
    loadServiceStats();
  }, [vehicleId, organizationId, statsRow, statsPending]);

  const loadServiceStats = async () => {
    try {
      // Get timeline events for this vehicle from this org
      const { data: events, error: eventsError } = await supabase
        .from('timeline_events')
        .select('id, event_date, title, metadata, duration_hours, labor_hours, cost_amount')
        .eq('vehicle_id', vehicleId)
        .eq('organization_id', organizationId)
        .order('event_date', { ascending: false });

      if (eventsError) throw eventsError;

      // Get recent images + the true total (count, not a page of 6)
      const { data: images, error: imagesError, count: imageCount } = await supabase
        .from('vehicle_images')
        .select('id, image_url, thumbnail_url, taken_at', { count: 'exact' })
        .eq('vehicle_id', vehicleId)
        .not('taken_at', 'is', null)
        .order('taken_at', { ascending: false })
        .limit(6);

      if (imagesError) throw imagesError;

      // Oldest documented frame, so a vehicle with photos but no timeline
      // events still shows a real date span instead of "No dates".
      const { data: oldestImage } = await supabase
        .from('vehicle_images')
        .select('taken_at')
        .eq('vehicle_id', vehicleId)
        .not('taken_at', 'is', null)
        .order('taken_at', { ascending: true })
        .limit(1);

      // Calculate stats
      const totalSessions = events?.length || 0;
      // Count the frames we actually hold, not timeline_events.metadata.image_count
      // (never populated — it printed "0 photos documented" under six rendered photos).
      const totalImages = imageCount ?? images?.length ?? 0;
      let totalHours = 0;
      const workTypes = new Set<string>();

      events?.forEach(event => {
        const meta = event.metadata || {};
        // labor_hours is the only hours column anything actually populates —
        // duration_hours is NULL on every org-scoped timeline_event on the
        // platform (measured 2026-07-26, 91 rows). Reading only the first two
        // is why every card in every shop showed 0h.
        totalHours += meta.duration_hours || event.duration_hours || event.labor_hours || 0;

        // Extract work type from title
        if (event.title?.includes('Paint') || event.title?.includes('paint')) workTypes.add('Paint');
        if (event.title?.includes('Body') || event.title?.includes('body')) workTypes.add('Body Work');
        if (event.title?.includes('Interior') || event.title?.includes('interior')) workTypes.add('Interior');
        if (event.title?.includes('Engine') || event.title?.includes('engine')) workTypes.add('Mechanical');
        if (event.title?.includes('Upholster')) workTypes.add('Upholstery');
      });

      setStats({
        totalSessions,
        totalImages,
        totalHours: Math.round(totalHours * 10) / 10,
        // The span the card renders is the DOCUMENTED PHOTO span, always — same
        // meaning whether it came from here or from the org-wide batch. Event
        // dates would silently mean something different on the two vehicles
        // that have events.
        firstSession: oldestImage?.[0]?.taken_at ?? null,
        lastSession: images?.[0]?.taken_at ?? null,
        recentImages: images?.map(img => img.thumbnail_url || img.image_url) || [],
        workTypes: Array.from(workTypes)
      });

    } catch (err) {
      console.error('Error loading service stats:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  if (loading) {
    return (
      <div style={{ 
        padding: '16px', 
        marginBottom: '12px', 
        border: '2px solid var(--border)', background: 'var(--card-bg)'
      }}>
        <div style={{ height: 64, background: 'var(--border)', opacity: 0.5 }} />
      </div>
    );
  }

  return (
    <>
    <div 
      style={{ 
        padding: '0', 
        marginBottom: '12px', 
        border: '2px solid var(--border)', background: 'var(--card-bg)',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'border-color 0.12s ease'
      }}
      onClick={() => setReportOpen(true)}
      onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
      onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
    >
      {/* Image Grid - Top.
          These thumbs render at ~37px in a 6-per-row grid, and every frame was
          being fetched as the full-resolution original: measured 2026-07-26 on
          this org, 140 storage requests, 224.8 MB, ZERO through the render API,
          and after 25 seconds only 43 of 259 thumbnails had painted — which is
          why the grid read as a wall of grey boxes. thumbnail_url and
          medium_url are NULL on all 365 strip frames and `variants` is `{}`
          with optimization_status='pending', so there is no pre-made small
          version to reach for. optimizeImageUrl already solves this (it is what
          ServiceVehicleCard uses) by routing through Supabase's render API with
          resize=contain. No new machinery. */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(6, 1fr)', 
        gap: '2px',
        background: 'var(--border)'
      }}>
        {stats?.recentImages.slice(0, 6).map((url, idx) => (
          <div key={idx} style={{ aspectRatio: '1', overflow: 'hidden' }}>
            <img
              src={optimizeImageUrl(url, 'thumbnail') || url}
              alt=""
              loading="lazy"
              decoding="async"
              width={150}
              height={150}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover'
              }}
            />
          </div>
        ))}
        {/* Fill empty slots */}
        {Array.from({ length: Math.max(0, 6 - (stats?.recentImages.length || 0)) }).map((_, idx) => (
          <div key={`empty-${idx}`} style={{ 
            aspectRatio: '1', 
            background: 'var(--surface-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <span style={{ fontSize: '11px', opacity: 0.3 }}>+</span>
          </div>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '12px' }}>
        {/* Vehicle Name */}
        <div style={{ 
          fontSize: '11px', 
          fontWeight: 700, 
          color: 'var(--text-primary)',
          marginBottom: '4px'
        }}>
          {vehicleYear || ''} {vehicleMake || ''} {vehicleModel || 'Unknown Vehicle'}
        </div>

        {/* Work Type Tags */}
        {stats?.workTypes && stats.workTypes.length > 0 && (
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '8px' }}>
            {stats.workTypes.map(type => (
              <span key={type} style={{
                fontSize: '11px',
                padding: '2px 6px', background: 'var(--accent-dim)',
                color: 'var(--accent)',
                fontWeight: 600
              }}>
                {type}
              </span>
            ))}
          </div>
        )}

        {/* Evidence block — replaces the SESSIONS / HOURS / EST. VALUE grid.
            Measured on this org 2026-07-26: no timeline_event carries a
            cost_amount and the hours that exist are AI-estimated from shop
            photos, so estimatedCost (= hours x laborRate) rendered "$0" in
            green on 46 of 46 cards, in the card's most prominent row — while
            the one fact the shop actually holds (the frame count and its
            documented span: 62 of 63 vehicles, up to 3,641 frames) sat muted
            underneath. So photos lead. Work renders only when work was logged
            ("No Empty Shells" — .claude/rules/frontend.md). No dollar figure at
            all: a price we can't defend is blocked, never softened
            (memory: feedback_valuation_block_when_not_defensible). The fixed
            minHeight + nowrap is what keeps card heights even across the grid. */}
        {(() => {
          const photos = stats?.totalImages ?? 0;
          const sessions = stats?.totalSessions ?? 0;
          const hours = stats?.totalHours ?? 0;
          const first = stats?.firstSession ?? null;
          const last = stats?.lastSession ?? null;

          // Day precision is what wrapped the old bottom row onto two lines.
          // The exact dates stay on hover and in the service report.
          const monthYear = (d: string) =>
            new Date(d).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
          const span = first && last
            ? (monthYear(first) === monthYear(last)
                ? monthYear(last)
                : `${monthYear(first)} – ${monthYear(last)}`)
            : null;

          // "est." not "logged": every hour on file came from
          // source='AI-generated work log from shop images' / 'ai_consolidated'.
          // Nobody clocked these.
          const work = hours > 0
            ? `${hours}h est.`
            : (sessions > 0 ? `${sessions} session${sessions === 1 ? '' : 's'}` : null);

          return (
            <div style={{
              marginTop: '6px',
              minHeight: '34px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}>
              {(photos > 0 || work) ? (
                <div style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: '8px',
                  whiteSpace: 'nowrap'
                }}>
                  {photos > 0 && (
                    <span
                      style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
                      title={`${photos.toLocaleString()} dated frames on file for this vehicle`}
                    >
                      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {photos.toLocaleString()}
                      </span>
                      {/* A real space, not just the 4px margin — margin is
                          invisible to copy-paste and to a screen reader, which
                          read this as "314photos". */}
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {' '}{photos === 1 ? 'photo' : 'photos'}
                      </span>
                    </span>
                  )}
                  {work && (
                    <span
                      style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-primary)', flexShrink: 0 }}
                      title={
                        `${sessions} logged work event${sessions === 1 ? '' : 's'}` +
                        (hours > 0
                          ? ` · ${hours}h, estimated from shop photos — not clocked`
                          : ' · no hours recorded')
                      }
                    >
                      {work}
                    </span>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Not documented yet
                </div>
              )}

              {span && (
                <div
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                  title={`First documented ${formatDate(first)} · last documented ${formatDate(last)}`}
                >
                  {span}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>

    <ServiceReportModal
      isOpen={reportOpen}
      onClose={() => setReportOpen(false)}
      vehicleId={vehicleId}
      vehicleYear={vehicleYear}
      vehicleMake={vehicleMake}
      vehicleModel={vehicleModel}
      organizationId={organizationId}
      organizationName={organizationName}
      laborRate={laborRate}
    />
    </>
  );
}

export default ServiceVehicleCardRich;

