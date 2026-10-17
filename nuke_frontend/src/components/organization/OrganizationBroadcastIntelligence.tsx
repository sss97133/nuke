import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import './OrganizationBroadcastIntelligence.css';

interface BroadcastObservationRow {
  id: string;
  source_identifier: string;
  source_url: string | null;
  observed_at: string | null;
  ingested_at: string | null;
  confidence: string | null;
  confidence_score: number | null;
  content_text: string | null;
  structured_data: Record<string, any> | null;
}

interface BoundBroadcastVehicle {
  vehicle_id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  vin: string | null;
  sale_price: number | null;
  broadcast_claim_count: number;
  bound_property_count?: number;
  total_observation_count: number;
  sample_broadcast_url: string | null;
  video_id: string | null;
  publication_id?: string | null;
  auction_event_id?: string | null;
}

interface BoundBroadcastPublication {
  publication_id: string;
  platform: string;
  video_id: string;
  title: string;
  platform_url: string;
  publication_date: string | null;
  bound_claim_count: number;
  bound_vehicle_count: number;
  bound_event_count: number;
}

interface OrganizationBroadcastIntelligenceProps {
  organizationId: string;
  organizationName?: string | null;
}

function formatSeconds(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '0:00';
  const total = Math.max(0, Math.floor(sec));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${mins}:${String(s).padStart(2, '0')}`;
}

export const OrganizationBroadcastIntelligence: React.FC<OrganizationBroadcastIntelligenceProps> = ({
  organizationId,
  organizationName,
}) => {
  const [observations, setObservations] = useState<BroadcastObservationRow[]>([]);
  const [boundVehicles, setBoundVehicles] = useState<BoundBroadcastVehicle[]>([]);
  const [publications, setPublications] = useState<BoundBroadcastPublication[]>([]);
  const [nativeProfile, setNativeProfile] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeSubTab, setActiveSubTab] = useState<'all' | 'visual_ocr' | 'captions' | 'claims'>('all');
  const [claimSearch, setClaimSearch] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!organizationId) return;
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc('get_organization_broadcast_intelligence', {
          p_organization_id: organizationId,
        });

        if (!cancelled && !error && data && typeof data === 'object') {
          const payload = data as {
            observations?: BroadcastObservationRow[];
            bound_vehicles?: BoundBroadcastVehicle[];
            publications?: BoundBroadcastPublication[];
            native_profile?: Record<string, any> | null;
          };
          setObservations(Array.isArray(payload.observations) ? payload.observations : []);
          setBoundVehicles(Array.isArray(payload.bound_vehicles) ? payload.bound_vehicles : []);
          setPublications(Array.isArray(payload.publications) ? payload.publications : []);
          setNativeProfile(payload.native_profile ?? null);
          setLoading(false);
          return;
        }

        // Fallback direct query using indexed YouTube source_id
        const { data: fallbackRows } = await supabase
          .from('vehicle_observations')
          .select('id, source_identifier, source_url, observed_at, ingested_at, confidence, confidence_score, content_text, structured_data')
          .eq('source_id', 'e980c7bd-404f-41f6-8a17-1c7cabd1d8a4')
          .eq('subject_type', 'organization')
          .eq('subject_id', organizationId)
          .eq('is_superseded', false)
          .order('source_identifier', { ascending: true });

        if (!cancelled) {
          setObservations((fallbackRows ?? []) as BroadcastObservationRow[]);
        }
      } catch (err) {
        console.error('[OrganizationBroadcastIntelligence] error loading:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const byProperty = useMemo(() => {
    const map = new Map<string, BroadcastObservationRow>();
    for (const row of observations) {
      const prop = row.structured_data?.property;
      if (typeof prop === 'string') {
        map.set(prop, row);
      }
    }
    return map;
  }, [observations]);

  const surfaceCensus = byProperty.get('broadcast_channel_surface_census')?.structured_data?.value ?? null;
  const captionFold = byProperty.get('broadcast_caption_discovery_fold')?.structured_data?.value ?? null;
  const visualOcr = byProperty.get('broadcast_visual_ocr_evidence')?.structured_data?.value ?? null;
  const claimsRollup = byProperty.get('broadcast_reviewed_claims_rollup')?.structured_data?.value ?? null;
  const acousticAssay = byProperty.get('broadcast_acoustic_rhythm_assay')?.structured_data?.value ?? null;

  const channelHandle =
    surfaceCensus?.channel_handle ||
    byProperty.get('broadcast_channel_surface_census')?.structured_data?.channel_handle ||
    null;

  const channelUrl =
    byProperty.get('broadcast_channel_surface_census')?.source_url ||
    byProperty.get('broadcast_caption_discovery_fold')?.source_url ||
    null;

  const totalPublicVideos = surfaceCensus?.unique_video_ids ?? surfaceCensus?.public_video_count ?? 0;
  const surfaceCounts = surfaceCensus?.surface_counts ?? surfaceCensus?.tab_counts ?? null;
  const scannedVideoCount = captionFold?.broadcasts_scanned ?? captionFold?.scanned_video_count ?? 0;
  const scannedDurationHours = captionFold?.total_duration_hours ?? captionFold?.scanned_duration_hours ?? 0;
  const totalWords = captionFold?.total_word_tokens ?? captionFold?.total_words ?? 0;
  const totalCues = captionFold?.total_caption_cues ?? 0;
  const totalGrains = captionFold?.total_candidate_grains ?? 0;
  const totalTransitions = captionFold?.total_presentation_transition_candidates ?? captionFold?.total_presentation_transitions ?? 0;
  const totalReviewedClaims = claimsRollup?.total_reviewed_observations ?? claimsRollup?.total_reviewed_claims ?? 0;
  const vehicleBoundClaimsCount =
    claimsRollup?.vehicle_bound_count ??
    boundVehicles.reduce((acc, v) => acc + (v.broadcast_claim_count || 0), 0);

  const sampleCues = useMemo(() => {
    if (!captionFold) return [];
    if (Array.isArray(captionFold.sample_high_signal_cues)) return captionFold.sample_high_signal_cues;
    const broadcasts = Array.isArray(captionFold.broadcasts) ? captionFold.broadcasts : [];
    const collected: any[] = [];
    for (const b of broadcasts) {
      for (const ex of b.example_cues || []) {
        collected.push({
          ...ex,
          video_id: b.video_id,
          video_title: b.title,
        });
      }
    }
    return collected;
  }, [captionFold]);

  const filteredClaims = useMemo(() => {
    const list: any[] = Array.isArray(claimsRollup?.claims) ? claimsRollup.claims : [];
    const q = claimSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => {
      const valStr = typeof c.value === 'object' && c.value !== null ? JSON.stringify(c.value) : String(c.value ?? '');
      const hay = `${c.property || ''} ${valStr} ${c.auction || ''} ${c.lot || ''} ${c.video_id || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [claimsRollup, claimSearch]);

  if (loading || observations.length === 0) {
    return null;
  }

  const featuredLot = visualOcr?.featured_lot ?? null;
  const frameSeries: any[] = Array.isArray(visualOcr?.frame_series) ? visualOcr.frame_series : [];
  const framesWithImages = frameSeries.filter((f) => Boolean(f.frame_image_url || f.frame_asset));

  return (
    <div
      className="obi-s1"
    >
      {/* Top Brutalist Header Bar */}
      <div
        className="obi-s2"
      >
        <div className="obi-s3">
          <span
            className="obi-s4"
          >
            LIVE BROADCAST &amp; VIDEO OCR
          </span>
          <span
            className="obi-s5"
          >
            {organizationName || surfaceCensus?.organization_name || 'Auction House'} Broadcast Intelligence Fold
          </span>
          {channelHandle && (
            <a
              href={channelUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="obi-s6"
            >
              {channelHandle} ↗
            </a>
          )}
        </div>

        {/* Sub-tab selector */}
        <div className="obi-s7">
          {[
            { id: 'all', label: `ALL (${observations.length} FOLDS)` },
            ...(visualOcr ? [{ id: 'visual_ocr', label: `FRAME OCR (${frameSeries.length} POINTS)` }] : []),
            ...(captionFold ? [{ id: 'captions', label: `CAPTION MINING (${totalGrains.toLocaleString()} GRAINS)` }] : []),
            ...(claimsRollup ? [{ id: 'claims', label: `ATOMIC CLAIMS (${totalReviewedClaims})` }] : []),
          ].map((tab) => {
            const active = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveSubTab(tab.id as any)}
                className={active ? "obi-subtab-btn obi-subtab-btn-active" : "obi-subtab-btn"}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* KPI Strip: Channel Surface Census + Caption Discovery + Reviewed Claims */}
      <div
        className="obi-s8"
      >
        <div className="obi-s9">
          <div className="obi-s10">
            PUBLIC BROADCAST ARCHIVE
          </div>
          <div className="obi-s11">
            {totalPublicVideos.toLocaleString()} videos
          </div>
          <div className="obi-s12">
            {surfaceCounts
              ? `${(surfaceCounts.videos || 0).toLocaleString()} uploads · ${(surfaceCounts.streams || 0).toLocaleString()} streams · ${(surfaceCounts.shorts || 0).toLocaleString()} shorts`
              : 'YouTube public catalog'}
          </div>
        </div>

        <div className="obi-s9">
          <div className="obi-s10">
            INDEXED FOOTAGE DURATION
          </div>
          <div className="obi-s11">
            {(surfaceCensus?.known_duration_hours ?? scannedDurationHours ?? 0).toLocaleString()} hrs
          </div>
          <div className="obi-s12">
            {scannedVideoCount > 0
              ? `${scannedVideoCount} full broadcasts deep-scanned (${scannedDurationHours}h)`
              : 'Catalog duration census'}
          </div>
        </div>

        <div className="obi-s9">
          <div className="obi-s10">
            CAPTION GRAIN EXTRACTION (V3)
          </div>
          <div className="obi-s11">
            {totalGrains.toLocaleString()} grains
          </div>
          <div className="obi-s12">
            {totalWords.toLocaleString()} words · {totalCues.toLocaleString()} cues · {totalTransitions.toLocaleString()} lot transitions
          </div>
        </div>

        <div className="obi-s9">
          <div className="obi-s10">
            INGESTED ATOMIC CLAIMS &amp; OCR
          </div>
          <div className="obi-s11">
            {totalReviewedClaims.toLocaleString()} claims
          </div>
          <div className="obi-s12">
            {observations.length} org folds · {publications.length} carrier publications · {vehicleBoundClaimsCount} vehicle-bound
          </div>
        </div>
      </div>

      {/* Native Incremental Presentation Fold & Carrier Publications Strip */}
      {(nativeProfile?.fold || publications.length > 0) && (
        <div
          className="obi-s13"
        >
          <div className="obi-s3">
            <span
              className="obi-s14"
            >
              CANONICAL DATA MODEL (C15)
            </span>
            <span className="obi-s15">
              <strong>{publications.length}</strong> <code className="obi-s16">publications</code> (YouTube carriers) ·{' '}
              <strong>{publications.reduce((s, p) => s + (p.bound_claim_count || 0), 0)}</strong> <code className="obi-s16">citation_publication_id</code> FKs bound
            </span>
          </div>
          {nativeProfile?.fold && (
            <div className="obi-s17">
              FOLD ({nativeProfile.fold.version}): {nativeProfile.fold.covered_presentations} presentation ·{' '}
              {nativeProfile.fold.source_claims} source claims · {nativeProfile.fold.eligible_display_samples}/{nativeProfile.fold.display_samples} display samples ·{' '}
              OLS proxy +${Number(nativeProfile.fold.display_proxy_event_sum || 0).toFixed(2)} USD/s
            </div>
          )}
        </div>
      )}

      {/* Canonical Vehicles Bound from Broadcast Evidence */}
      {boundVehicles.length > 0 && (
        <div className="obi-s18">
          <div className="obi-s19">
            <span className="obi-s20">
              CANONICAL VEHICLES LINKED TO BROADCAST EVIDENCE ({boundVehicles.length})
            </span>
            <span className="obi-s21">
              relink_testimony · public.vehicle_observations
            </span>
          </div>
          <div
            className="obi-s22"
          >
            {boundVehicles.map((bv) => {
              const title = [bv.year, bv.make, bv.model, bv.trim?.trim()].filter(Boolean).join(' ') || 'Canonical Vehicle';
              return (
                <div
                  key={bv.vehicle_id}
                  className="obi-s23"
                >
                  <div className="obi-s24">
                    <Link
                      to={`/vehicle/${bv.vehicle_id}`}
                      className="obi-s25"
                    >
                      {title} →
                    </Link>
                    {bv.sale_price && (
                      <span className="obi-s26">
                        ${Number(bv.sale_price).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <div className="obi-s27">
                    <span className="obi-s21">
                      {bv.vin ? `VIN ${bv.vin} · ` : ''}
                      <strong>{bv.broadcast_claim_count}</strong> broadcast claims ({bv.total_observation_count} total obs)
                    </span>
                    {bv.sample_broadcast_url && (
                      <a
                        href={bv.sample_broadcast_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="obi-s28"
                      >
                        YouTube {bv.video_id || 'Clip'} ↗
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SECTION 1: LIVE VIDEO FRAME OCR & CHYRON TELEMETRY */}
      {visualOcr && (activeSubTab === 'all' || activeSubTab === 'visual_ocr') && (
        <div className="obi-s29">
          <div className="obi-s30">
            <div>
              <span
                className="obi-s31"
              >
                FRAME OCR + CHYRON TELEMETRY
              </span>
              <span className="obi-s32">
                {featuredLot
                  ? `${featuredLot.auction} · Lot ${featuredLot.lot} · ${featuredLot.vehicle_label}`
                  : visualOcr.subject_vehicle || 'Broadcast Frame OCR'}
              </span>
              {featuredLot?.vehicle_id && (
                <Link
                  to={`/vehicle/${featuredLot.vehicle_id}`}
                  className="obi-s33"
                >
                  [Open Vehicle Dossier →]
                </Link>
              )}
            </div>
            {featuredLot && featuredLot.first_sampled_bid_usd != null && (featuredLot.final_displayed_sold_usd != null || featuredLot.final_displayed_bid_usd != null) && (
              <div className="obi-s34">
                ${Number(featuredLot.first_sampled_bid_usd).toLocaleString()} → $
                {Number(featuredLot.final_displayed_sold_usd ?? featuredLot.final_displayed_bid_usd).toLocaleString()} (+$
                {Number(featuredLot.endpoint_delta_usd || 0).toLocaleString()} in {featuredLot.sampled_elapsed_seconds}s · $
                {Number(featuredLot.endpoint_growth_usd_per_nominal_second || 0).toLocaleString()}/s)
              </div>
            )}
          </div>

          {/* Extracted Broadcast Frames Grid (only frames that have an extracted image asset) */}
          {framesWithImages.length > 0 && (
            <div
              className={frameSeries.length > 1 ? "obi-frame-grid obi-mb-10" : "obi-frame-grid"}
            >
              {framesWithImages.map((frame: any, idx: number) => {
                const imgSrc = frame.frame_image_url || frame.frame_asset;
                const statusLabel = frame.overlay_status || frame.bid_status || 'FRAME OCR';
                const amountUsd = frame.overlay_amount_usd ?? frame.visible_bid_usd ?? null;
                const captionText = frame.ocr_caption || frame.chyron_text || '';
                return (
                  <div
                    key={idx}
                    className="obi-s35"
                  >
                    <div className="obi-s36">
                      <img
                        src={imgSrc}
                        alt={captionText || `Broadcast frame at ${frame.timestamp_seconds}s`}
                        className="obi-s37"
                      />
                      <span
                        className="obi-s38"
                      >
                        t={frame.timestamp_seconds}s ({formatSeconds(frame.timestamp_seconds)})
                      </span>
                      {frame.lot && (
                        <span
                          className="obi-s39"
                        >
                          LOT {frame.lot} · {statusLabel}
                        </span>
                      )}
                    </div>
                    <div className="obi-s40">
                      {amountUsd != null && (
                        <div className="obi-s41">
                          CHYRON DISPLAYED AMOUNT: ${Number(amountUsd).toLocaleString()} USD ({statusLabel})
                        </div>
                      )}
                      {captionText && (
                        <div
                          className="obi-s42"
                        >
                          {captionText}
                        </div>
                      )}
                      {Array.isArray(frame.camera_views) && frame.camera_views.length > 0 && (
                        <div className="obi-s43">
                          <span className="obi-s44">
                            VIEWS: {frame.camera_views.join(' + ')}
                          </span>
                          {frame.youtube_url && (
                            <a
                              href={frame.youtube_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="obi-s28"
                            >
                              Open Frame @ {frame.timestamp_seconds}s ↗
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Multi-Point Visual Price Ladder + Presence Interval SVG (when present) */}
          {frameSeries.some((f) => f.overlay_amount_usd != null) && (
            <div className="obi-s45">
              <div className="obi-s46">
                SAMPLED ON-SCREEN CHYRON PRICE TRAJECTORY ({frameSeries.filter((f) => f.overlay_amount_usd != null).length} VISUAL POINTS)
              </div>
              <div className={featuredLot?.interval_figure_url ? "obi-flex-chips obi-mb-8" : "obi-flex-chips"}>
                {frameSeries
                  .filter((f) => f.overlay_amount_usd != null)
                  .map((pt: any, i: number) => (
                    <a
                      key={i}
                      href={pt.youtube_url || `https://www.youtube.com/watch?v=${pt.video_id}&t=${pt.timestamp_seconds}s`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="obi-s47"
                    >
                      <strong>t={pt.timestamp_seconds}s</strong>: ${Number(pt.overlay_amount_usd).toLocaleString()} ({pt.overlay_status})
                    </a>
                  ))}
              </div>
              {featuredLot?.interval_figure_url && (
                <div className="obi-s48">
                  <img
                    src={featuredLot.interval_figure_url}
                    alt="Presence interval and visual price trajectory"
                    className="obi-s49"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* SECTION 2: ACOUSTIC / AUCTIONEER RHYTHM ASSAY (when present) */}
      {acousticAssay && activeSubTab === 'all' && (
        <div className="obi-s50">
          <div className="obi-s51">
            <span className="obi-s20">
              CAUSAL ACOUSTIC &amp; AUCTIONEER CHANT TELEMETRY · {acousticAssay.lot} ({acousticAssay.video_id})
            </span>
            <span className="obi-s21">
              {Number(acousticAssay.causal_feature_rows || 0).toLocaleString()} causal feature rows · {acousticAssay.decoded_audio_seconds}s audio · {acousticAssay.asr_span_union_seconds}s ASR span
            </span>
          </div>
          {Array.isArray(acousticAssay.recovered_chant_categories) && (
            <div className={acousticAssay.rhythm_report_image_url ? "obi-flex-chips obi-mb-8" : "obi-flex-chips"}>
              {acousticAssay.recovered_chant_categories.map((cat: string, idx: number) => (
                <span
                  key={idx}
                  className="obi-s52"
                >
                  {cat}
                </span>
              ))}
            </div>
          )}
          {(acousticAssay.rhythm_report_image_url || acousticAssay.all_stars_report_image_url) && (
            <div className="obi-s53">
              {acousticAssay.rhythm_report_image_url && (
                <div className="obi-s54">
                  <img
                    src={acousticAssay.rhythm_report_image_url}
                    alt="Auctioneer rhythm contour report"
                    className="obi-s55"
                  />
                </div>
              )}
              {acousticAssay.all_stars_report_image_url && (
                <div className="obi-s54">
                  <img
                    src={acousticAssay.all_stars_report_image_url}
                    alt="Mecum all-stars acoustic cadence report"
                    className="obi-s55"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* SECTION 3: FULL-BROADCAST CAPTION MINING (mecum-caption-cues-v3) */}
      {captionFold && (activeSubTab === 'all' || activeSubTab === 'captions') && (
        <div className="obi-s29">
          <div className="obi-s56">
            <div>
              <span
                className="obi-s31"
              >
                CAPTION MINING V3
              </span>
              <span className="obi-s32">
                {scannedVideoCount} Broadcasts Scanned ({scannedDurationHours} hrs · {totalWords.toLocaleString()} words)
              </span>
            </div>

            {/* Top Make Mentions */}
            {captionFold.make_mention_frequencies && Object.keys(captionFold.make_mention_frequencies).length > 0 && (
              <div className="obi-s7">
                <span className="obi-s57">
                  SPOKEN MAKES:
                </span>
                {Object.entries(captionFold.make_mention_frequencies)
                  .sort((a, b) => Number(b[1]) - Number(a[1]))
                  .slice(0, 8)
                  .map(([make, cnt]) => (
                    <span
                      key={make}
                      className="obi-s58"
                    >
                      {make.replace(/^make_/, '')}: <strong>{String(cnt)}</strong>
                    </span>
                  ))}
              </div>
            )}
          </div>

          {/* Semantic Grain Category Breakdown Pills */}
          {captionFold.category_totals && (
            <div className="obi-s59">
              {Object.entries(captionFold.category_totals)
                .sort((a, b) => Number(b[1]) - Number(a[1]))
                .map(([cat, count]) => (
                  <div
                    key={cat}
                    className="obi-s60"
                  >
                    <span className="obi-s61">{cat.replace(/_/g, ' ')}:</span>{' '}
                    <strong className="obi-s62">{Number(count).toLocaleString()}</strong>
                  </div>
                ))}
            </div>
          )}

          {/* Scanned Videos Table */}
          {Array.isArray(captionFold.broadcasts) && captionFold.broadcasts.length > 0 && (
            <div className="obi-s63">
              <table className="obi-s64">
                <thead>
                  <tr className="obi-s65">
                    <th className="obi-s66">Broadcast</th>
                    <th className="obi-s67">Duration</th>
                    <th className="obi-s67">Words</th>
                    <th className="obi-s67">Candidate Grains</th>
                    <th className="obi-s67">Review Windows</th>
                    <th className="obi-s67">Lot Transitions</th>
                  </tr>
                </thead>
                <tbody>
                  {captionFold.broadcasts.map((sv: any, idx: number) => (
                    <tr key={sv.video_id || idx} className="obi-s68">
                      <td className="obi-s69">
                        <a
                          href={sv.youtube_url || `https://www.youtube.com/watch?v=${sv.video_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="obi-s70"
                        >
                          {sv.title || sv.video_id}
                        </a>
                        <span className="obi-s71">
                          [{sv.video_id}]
                        </span>
                      </td>
                      <td className="obi-s72">
                        {formatSeconds(sv.duration_seconds)}
                      </td>
                      <td className="obi-s72">
                        {(sv.word_tokens || 0).toLocaleString()}
                      </td>
                      <td className="obi-s73">
                        {(sv.candidate_grains || 0).toLocaleString()}
                      </td>
                      <td className="obi-s72">
                        {(sv.review_windows || 0).toLocaleString()}
                      </td>
                      <td className="obi-s72">
                        {(sv.presentation_transition_candidates || 0).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Sample High-Signal Speech / Transition Cues */}
          {sampleCues.length > 0 && (
            <div>
              <div className="obi-s74">
                SAMPLE TIMESTAMPED LOT TRANSITION &amp; BIDDING SPEECH WINDOWS
              </div>
              <div className="obi-s75">
                {sampleCues.slice(0, 6).map((cue: any, i: number) => (
                  <div
                    key={i}
                    className="obi-s76"
                  >
                    <div className="obi-s77">
                      <a
                        href={cue.youtube_url || `https://www.youtube.com/watch?v=${cue.video_id}&t=${Math.floor(cue.start_seconds || 0)}s`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="obi-s78"
                      >
                        {cue.video_id} @ {formatSeconds(cue.start_seconds)} ↗
                      </a>
                      <span className="obi-s61">
                        {String(cue.property || '').replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="obi-s79">
                      &ldquo;{cue.text}&rdquo;
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SECTION 4: REVIEWED ATOMIC BROADCAST & LOT CLAIMS */}
      {claimsRollup && (activeSubTab === 'all' || activeSubTab === 'claims') && (
        <div className="obi-s80">
          <div className="obi-s56">
            <div>
              <span
                className="obi-s31"
              >
                ATOMIC BROADCAST CLAIMS ({filteredClaims.length} / {totalReviewedClaims})
              </span>
              <span className="obi-s81">
                Ingested into <code className="obi-s82">public.vehicle_observations</code> ({vehicleBoundClaimsCount} bound to canonical vehicles)
              </span>
            </div>
            <input
              type="text"
              value={claimSearch}
              onChange={(e) => setClaimSearch(e.target.value)}
              placeholder="Filter claims by lot, vehicle, property, value..."
              className="obi-s83"
            />
          </div>

          <div className="obi-s84">
            <table className="obi-s64">
              <thead>
                <tr className="obi-s85">
                  <th className="obi-s66">Subject / Lot</th>
                  <th className="obi-s66">Property</th>
                  <th className="obi-s66">Extracted Value</th>
                  <th className="obi-s66">Role</th>
                  <th className="obi-s67">Source Offset</th>
                </tr>
              </thead>
              <tbody>
                {filteredClaims.map((claim: any, idx: number) => {
                  const valStr =
                    typeof claim.value === 'object' && claim.value !== null
                      ? JSON.stringify(claim.value)
                      : String(claim.value ?? '');
                  const lotLabel = claim.lot || claim.lot_number || null;
                  const subjectText = claim.auction || claim.subject_label || 'Broadcast Subject';
                  return (
                    <tr key={claim.source_identifier || idx} className="obi-s68">
                      <td className="obi-s86">
                        {lotLabel ? (
                          <span
                            className="obi-s87"
                          >
                            Lot {lotLabel}
                          </span>
                        ) : null}
                        {claim.vehicle_id ? (
                          <Link
                            to={`/vehicle/${claim.vehicle_id}`}
                            className="obi-s88"
                          >
                            {subjectText} →
                          </Link>
                        ) : (
                          <span>{subjectText}</span>
                        )}
                      </td>
                      <td className="obi-s89">
                        {String(claim.property || '').replace(/_/g, ' ')}
                      </td>
                      <td className="obi-s90">
                        {valStr}
                        {claim.unit ? ` ${claim.unit}` : ''}
                      </td>
                      <td className="obi-s91">
                        {String(claim.claim_role || claim.kind || 'caption').replace(/_/g, ' ')}
                      </td>
                      <td className="obi-s92">
                        {claim.raw_source_ref ? (
                          <a
                            href={claim.raw_source_ref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="obi-s88"
                          >
                            {claim.video_id || 'yt'} @ {formatSeconds(claim.start_seconds)} ↗
                          </a>
                        ) : (
                          <span>{formatSeconds(claim.start_seconds)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrganizationBroadcastIntelligence;
