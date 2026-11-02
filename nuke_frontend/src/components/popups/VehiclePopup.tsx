/**
 * VehiclePopup — Full vehicle intelligence in a stacking popup.
 *
 * Principle: "Show specific things, not summaries."
 *
 * Surfaces real intelligence from:
 * - comment_discoveries (126K vehicles): sentiment, expert insights, key quotes, concerns
 * - description_discoveries (31K vehicles): red flags, mods, work history, condition
 * - nuke_estimate + heat_score + deal_score
 * - vehicle_events: apparition history (cross-platform sightings)
 * - recent comparable sales with actual prices
 *
 * Single RPC call via popup_vehicle_intel() — one round trip for all intelligence.
 */

import React, { useEffect, useState } from 'react';
import type { FeedVehicle } from '../../feed/types/feed';
import { resolveVehiclePrice } from '../../feed/utils/feedPriceResolution';
import { supabase } from '../../lib/supabase';
import { VEHICLE_POPUP_COLUMNS } from './vehiclePopupColumns';
import { usePopup } from './usePopup';
import { optimizeImageUrl } from '../../lib/imageOptimizer';
import { useViewHistory } from '../../hooks/useViewHistory';
import { useInterests } from '../../hooks/useInterests';
import { MakePopup } from './MakePopup';
import { ModelPopup } from './ModelPopup';
import { SourcePopup } from './SourcePopup';
import './vehicle-popup.css';
import PrefetchLink from '../PrefetchLink';
import type { CompScope } from '../../pages/vehicle-profile/hooks/useVehicleIntel';

interface Props {
  vehicle: Pick<FeedVehicle, 'id'> & Partial<FeedVehicle>;
  searchQuery?: string;
  /** Attribute exploration keeps unrelated model sale lists out of the selected context. */
  showRelatedSales?: boolean;
}

interface VehicleIntel {
  comment_intel: CommentIntel | null;
  description_intel: DescriptionIntel | null;
  scores: ScoreData | null;
  apparitions: Apparition[] | null;
  recent_comps: CompSale[] | null;
  recent_comps_scope?: CompScope | null;
}

interface CommentIntel {
  sentiment: { score: number; overall: string; mood_keywords?: string[]; emotional_themes?: string[] } | null;
  key_quotes: (string | { quote: string; significance?: string })[] | null;
  expert_insights: (string | { insight: string; expertise_level?: string })[] | null;
  community_concerns: (string | { concern: string })[] | null;
  price_sentiment: { community_view?: string; reasoning?: string; overall?: string; comments?: string } | null;
  market_signals: { demand?: string; rarity?: string; price_trend?: string; value_factors?: string[] } | null;
  seller_disclosures: string[] | null;
  authenticity: { concerns_raised?: boolean | string; details?: string } | null;
  overall_sentiment: string | null;
  sentiment_score: number | null;
  comment_count: number | null;
}

interface DescriptionIntel {
  red_flags: { f: string; sev: string }[] | null;
  mods: string[] | null;
  work_history: { d: string; s: string | null; w: string }[] | null;
  condition: string | null;
  condition_note: string | null;
  title_status: string | null;
  owner_count: number | null;
  matching_numbers: boolean | null;
  documentation: string[] | null;
  option_codes: { c: string; d: string; p: string; r: string }[] | null;
  equipment: string[] | null;
  price_positive: string[] | null;
  price_negative: string[] | null;
}

interface ScoreData {
  nuke_estimate: number | null;
  nuke_confidence: number | null;
  heat_score: number | null;
  deal_score: number | null;
}

interface Apparition {
  platform: string;
  url: string | null;
  event_type: string | null;
  event_date: string | null;
  price: number | null;
}

interface CompSale {
  id: string;
  year: number | null;
  model: string | null;
  sale_price: number;
  sale_date: string | null;
  thumbnail: string | null;
  mileage: number | null;
}

function formatPrice(n: number | null): string {
  if (n == null || n <= 0) return '--';
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

const MONO = 'var(--font-family)';
const SANS = 'var(--font-family)';

export function VehiclePopup({ vehicle, showRelatedSales = true }: Props) {
  const { openPopup, closeAll } = usePopup();
  const { recordView, endView } = useViewHistory();
  const { recordInterest } = useInterests();
  const price = resolveVehiclePrice(vehicle);
  const [intel, setIntel] = useState<VehicleIntel | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  // Track view
  useEffect(() => {
    recordView(vehicle.id, 'popup');
    if (vehicle.make) recordInterest('make', vehicle.make);
    if (vehicle.model) recordInterest('model', vehicle.model);
    return () => { endView(vehicle.id); };
  }, [vehicle.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Single RPC call for all intelligence
  useEffect(() => {
    let cancelled = false;

    async function fetchIntel() {
      setUnavailable(false);
      try {
        const { data, error } = await supabase.rpc('popup_vehicle_intel', {
          p_vehicle_id: vehicle.id,
        });
        if (error) throw error;
        if (!cancelled && !error && data) {
          setIntel(data as VehicleIntel);
        }
      } catch {
        if (!cancelled) setUnavailable(true);
      }
      if (!cancelled) setLoading(false);
    }

    fetchIntel();
    return () => { cancelled = true; };
  }, [vehicle.id]);

  const title = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle';

  const handleMakeClick = () => {
    if (vehicle.make) openPopup(<MakePopup make={vehicle.make} />, vehicle.make, 480);
  };
  const handleModelClick = () => {
    if (vehicle.make && vehicle.model) openPopup(<ModelPopup make={vehicle.make} model={vehicle.model} />, vehicle.model, 420);
  };
  const handleSourceClick = () => {
    const src = vehicle.discovery_source || vehicle.profile_origin;
    if (src) openPopup(<SourcePopup source={src} />, src.toUpperCase(), 420);
  };
  const handleCompClick = (comp: CompSale) => {
    supabase.from('vehicles').select(VEHICLE_POPUP_COLUMNS).eq('id', comp.id).single().then(({ data }) => {
      if (data) openPopup(<VehiclePopup vehicle={data as unknown as FeedVehicle} />, [comp.year, comp.model].filter(Boolean).join(' '), 480);
    });
  };

  const scores = intel?.scores;
  const ci = intel?.comment_intel;
  const di = intel?.description_intel;
  const apparitions = intel?.apparitions;
  const comps = showRelatedSales ? intel?.recent_comps : null;

  return (
    <div className="vehicle-popup-body">
      {/* Hero image */}
      {vehicle.thumbnail_url && (
        <div style={{ width: '100%', height: 220, overflow: 'hidden', background: 'var(--border)' }}>
          <img src={optimizeImageUrl(vehicle.thumbnail_url, 'medium') || vehicle.thumbnail_url} alt={title} width={640} height={400} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        </div>
      )}

      {/* Title + Price */}
      <div style={{ padding: '10px 12px 6px', borderBottom: '1px solid var(--border)' }}>
        <div className="vehicle-popup-heading">
          <span style={{ fontFamily: SANS, fontSize: 'var(--text-body)', fontWeight: 600, color: 'var(--text)', lineHeight: 1.2 }}>
            {vehicle.year && <span style={{ color: 'var(--text-secondary)' }}>{vehicle.year} </span>}
            {vehicle.make && <ClickableText onClick={handleMakeClick}>{vehicle.make}</ClickableText>}
            {vehicle.model && <> <ClickableText onClick={handleModelClick}>{vehicle.model}</ClickableText></>}
            {vehicle.series && <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}> {vehicle.series}</span>}
          </span>
          <span style={{ fontFamily: MONO, fontSize: 'var(--text-body)', fontWeight: 700, color: price.isSold ? 'var(--vehicle-popup-success)' : 'var(--text)', flexShrink: 0, whiteSpace: 'nowrap' }}>
            {price.formatted}
          </span>
        </div>
        {price.isSold && price.showSoldBadge && (
          <span style={{ fontFamily: SANS, fontSize: 'var(--text-caption)', fontWeight: 600, color: 'var(--vehicle-popup-success)' }}>Sold</span>
        )}
        {vehicle.is_for_sale && !price.isSold && (
          <span style={{ fontFamily: SANS, fontSize: 'var(--text-caption)', fontWeight: 600, color: 'var(--link)' }}>For sale</span>
        )}
      </div>

      {/* Nuke Estimate + Scores — the live computation */}
      {scores && (scores.nuke_estimate || scores.heat_score || scores.deal_score) && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {scores.nuke_estimate && scores.nuke_estimate > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Label>Nuke estimate</Label>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontFamily: MONO, fontSize: 'var(--text-body)', fontWeight: 700, color: 'var(--text)' }}>
                  {formatPrice(scores.nuke_estimate)}
                </span>
                {price.amount && price.amount > 0 && (() => {
                  const diff = Math.round(((price.amount - scores.nuke_estimate!) / scores.nuke_estimate!) * 100);
                  const color = diff > 5 ? 'var(--vehicle-popup-error)' : diff < -5 ? 'var(--vehicle-popup-success)' : 'var(--text-secondary)';
                  return (
                    <span style={{ fontFamily: MONO, fontSize: 'var(--text-callout)', fontWeight: 700, color }}>
                      {diff > 0 ? '+' : ''}{diff}%
                    </span>
                  );
                })()}
              </div>
              {scores.nuke_confidence != null && (
                <span style={{ fontFamily: MONO, fontSize: 'var(--text-caption)', color: 'var(--text-secondary)' }}>{scores.nuke_confidence}% confidence</span>
              )}
            </div>
          )}
          {scores.heat_score != null && scores.heat_score > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Label>Heat</Label>
              <span style={{ fontFamily: MONO, fontSize: 'var(--text-body)', fontWeight: 700, color: scores.heat_score > 70 ? 'var(--vehicle-popup-error)' : scores.heat_score > 40 ? 'var(--vehicle-popup-warning)' : 'var(--text-secondary)' }}>
                {scores.heat_score}
              </span>
            </div>
          )}
          {scores.deal_score != null && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Label>Deal</Label>
              <span style={{ fontFamily: MONO, fontSize: 'var(--text-body)', fontWeight: 700, color: scores.deal_score > 70 ? 'var(--vehicle-popup-success)' : scores.deal_score < 30 ? 'var(--vehicle-popup-error)' : 'var(--text-secondary)' }}>
                {scores.deal_score}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Key specs */}
      {(() => {
        const specs = buildSpecs(vehicle);
        if (specs.length === 0) return null;
        return (
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
            <SpecGrid specs={specs} />
          </div>
        );
      })()}

      {/* Comment Intelligence — the gold */}
      {ci && (ci.key_quotes || ci.expert_insights || ci.community_concerns) && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <Label>Community summaries</Label>
            {ci.overall_sentiment && (
              <SentimentBadge sentiment={ci.overall_sentiment} score={ci.sentiment_score} />
            )}
            {ci.comment_count && (
              <span style={{ fontFamily: MONO, fontSize: 'var(--text-caption)', color: 'var(--text-secondary)' }}>{ci.comment_count} comments</span>
            )}
          </div>

          {/* Key quotes */}
          {ci.key_quotes && ci.key_quotes.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              {ci.key_quotes.slice(0, 3).map((q, i) => {
                const quoteText = typeof q === 'string' ? q : q.quote;
                return (
                  <div key={i} style={{
                    fontFamily: SANS, fontSize: 'var(--text-callout)', color: 'var(--text-secondary)', lineHeight: 1.4,
                    padding: '3px 0 3px 8px', borderLeft: '2px solid var(--border)', marginBottom: 3,
                    fontStyle: 'italic',
                  }}>
                    {quoteText.length > 120 ? quoteText.slice(0, 120) + '...' : quoteText}
                  </div>
                );
              })}
            </div>
          )}

          {/* Expert insights */}
          {ci.expert_insights && ci.expert_insights.length > 0 && (
            <div style={{ marginBottom: 4 }}>
              <SubLabel>Reported expert insights</SubLabel>
              {ci.expert_insights.slice(0, 3).map((e, i) => {
                const text = typeof e === 'string' ? e : e.insight;
                return (
                  <div key={i} style={{ fontFamily: SANS, fontSize: 'var(--text-callout)', color: 'var(--text)', lineHeight: 1.4, marginBottom: 2 }}>
                    {text.length > 140 ? text.slice(0, 140) + '...' : text}
                  </div>
                );
              })}
            </div>
          )}

          {/* Concerns */}
          {ci.community_concerns && ci.community_concerns.length > 0 && (
            <div>
              <SubLabel>Concerns raised</SubLabel>
              {ci.community_concerns.slice(0, 3).map((c, i) => {
                const text = typeof c === 'string' ? c : c.concern;
                return (
                  <div key={i} style={{ fontFamily: SANS, fontSize: 'var(--text-callout)', color: 'var(--vehicle-popup-error)', lineHeight: 1.4, marginBottom: 1 }}>
                    {text}
                  </div>
                );
              })}
            </div>
          )}

          {/* Market signals */}
          {ci.market_signals && (ci.market_signals.demand || ci.market_signals.rarity || ci.market_signals.price_trend) && (
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              {ci.market_signals.demand && <MiniStat label="DEMAND" value={ci.market_signals.demand} />}
              {ci.market_signals.rarity && <MiniStat label="RARITY" value={ci.market_signals.rarity} />}
              {ci.market_signals.price_trend && <MiniStat label="TREND" value={ci.market_signals.price_trend} />}
            </div>
          )}
        </div>
      )}

      {/* Description Intelligence — red flags, mods, condition */}
      {di && (hasRedFlags(di) || hasMods(di) || di.condition_note || di.matching_numbers != null) && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
          <Label>Listing summaries</Label>

          {/* Condition summary */}
          {di.condition_note && (
            <div style={{ fontFamily: SANS, fontSize: 'var(--text-callout)', color: 'var(--text-secondary)', lineHeight: 1.4, marginTop: 4, marginBottom: 4 }}>
              {di.condition_note.length > 200 ? di.condition_note.slice(0, 200) + '...' : di.condition_note}
            </div>
          )}

          {/* Quick badges */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4, marginBottom: 4 }}>
            {/* title_status / owner_count are raw extraction output and can arrive as objects or lists */}
            {typeof di.title_status === 'string' && di.title_status && <IntelBadge label={`TITLE: ${di.title_status}`} color="var(--vehicle-popup-success)" />}
            {di.matching_numbers === true && <IntelBadge label="MATCHING NUMBERS" color="var(--vehicle-popup-success)" />}
            {di.matching_numbers === false && <IntelBadge label="NOT MATCHING" color="var(--vehicle-popup-error)" />}
            {di.condition && <IntelBadge label={di.condition.toUpperCase()} color="var(--text)" />}
            {typeof di.owner_count === 'number' && <IntelBadge label={`${di.owner_count} OWNER${di.owner_count !== 1 ? 'S' : ''}`} color="var(--text-secondary)" />}
          </div>

          {/* Red flags */}
          {hasRedFlags(di) && (
            <div style={{ marginBottom: 4 }}>
              <SubLabel>Reported concerns</SubLabel>
              {(di.red_flags || []).slice(0, 3).map((f, i) => (
                <div key={i} style={{ fontFamily: SANS, fontSize: 'var(--text-callout)', color: 'var(--vehicle-popup-error)', lineHeight: 1.3, marginBottom: 1 }}>
                  <span style={{ fontFamily: MONO, fontSize: 'var(--text-caption)', fontWeight: 700, marginRight: 4, textTransform: 'none' }}>
                    {f.sev || 'FLAG'}
                  </span>
                  {f.f}
                </div>
              ))}
            </div>
          )}

          {/* Modifications */}
          {hasMods(di) && (
            <div style={{ marginBottom: 4 }}>
              <SubLabel>Modifications ({(di.mods || []).length})</SubLabel>
              <div style={{ fontFamily: SANS, fontSize: 'var(--text-callout)', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                {(di.mods || []).slice(0, 5).join(' / ')}
                {(di.mods || []).length > 5 && <span style={{ color: 'var(--text-secondary)' }}> +{(di.mods || []).length - 5} more</span>}
              </div>
            </div>
          )}

          {/* Documentation */}
          {di.documentation && di.documentation.length > 0 && (
            <div>
              <SubLabel>Documentation</SubLabel>
              <div style={{ fontFamily: SANS, fontSize: 'var(--text-callout)', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                {di.documentation.slice(0, 4).join(' / ')}
                {di.documentation.length > 4 && <span style={{ color: 'var(--text-secondary)' }}> +{di.documentation.length - 4} more</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Comparable sales — specific vehicles, not stats */}
      {comps && comps.length > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
          <Label>Recent sold context</Label>
          <div title={intel?.recent_comps_scope?.basis || undefined} style={{ fontFamily: SANS, fontSize: 'var(--text-callout)', color: 'var(--text-secondary)', marginTop: 4 }}>
            {intel?.recent_comps_scope?.label && <span>{intel.recent_comps_scope.label} · </span>}
            Condition not matched
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginTop: 6 }}>
            {comps.slice(0, 5).map((c) => (
              <button type="button" className="vehicle-popup-comp"
                key={c.id}
                onClick={() => handleCompClick(c)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '4px 0', borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                }}

              >
                {c.thumbnail && (
                  <img src={optimizeImageUrl(c.thumbnail, 'micro') || c.thumbnail} alt="" width={64} height={44} loading="lazy" style={{ width: 64, height: 44, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--border)' }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontFamily: SANS, fontSize: 'var(--text-callout)', fontWeight: 700, color: 'var(--text)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[c.year, c.model].filter(Boolean).join(' ')}
                  </span>
                  {c.mileage && (
                    <span style={{ fontFamily: MONO, fontSize: 'var(--text-caption)', color: 'var(--text-secondary)' }}>{Math.floor(c.mileage).toLocaleString()} mi</span>
                  )}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <span style={{ fontFamily: MONO, fontSize: 'var(--text-callout)', fontWeight: 700, color: 'var(--vehicle-popup-success)' }}>{formatPrice(c.sale_price)}</span>
                  {c.sale_date && (
                    <div style={{ fontFamily: MONO, fontSize: 'var(--text-caption)', color: 'var(--text-secondary)' }}>
                      {new Date(c.sale_date).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Apparition history — cross-platform sightings */}
      {apparitions && apparitions.length > 1 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
          <Label>Recorded sightings</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
            {apparitions.slice(0, 6).map((a, i) => (
              <div key={i} className="vehicle-popup-sighting">
                <span style={{ fontFamily: SANS, fontSize: 'var(--text-caption)', fontWeight: 700, color: 'var(--text-secondary)', width: 80, flexShrink: 0 }}>
                  {a.platform || 'unknown'}
                </span>
                <span style={{ fontFamily: MONO, fontSize: 'var(--text-caption)', color: 'var(--text-secondary)', width: 50, flexShrink: 0 }}>
                  {a.event_type || ''}
                </span>
                {a.price && a.price > 0 && (
                  <span style={{ fontFamily: MONO, fontSize: 'var(--text-callout)', fontWeight: 700, color: 'var(--vehicle-popup-success)' }}>{formatPrice(a.price)}</span>
                )}
                {a.event_date && (
                  <span style={{ fontFamily: MONO, fontSize: 'var(--text-caption)', color: 'var(--text-secondary)', marginLeft: 'auto' }}>
                    {new Date(a.event_date).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Source + listing */}
      <div style={{ padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          {(vehicle.discovery_source || vehicle.profile_origin) && (
            <ClickableText onClick={handleSourceClick}>
              <span style={{ fontFamily: MONO, fontSize: 'var(--text-caption)', fontWeight: 700, padding: '2px 5px', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                {vehicle.discovery_source || vehicle.profile_origin}
              </span>
            </ClickableText>
          )}
        </div>
      </div>

      <div className="vehicle-popup-actions">
        {(vehicle.discovery_url || vehicle.listing_url) && <a className="vehicle-popup-action"
          href={vehicle.discovery_url || vehicle.listing_url || '#'} target="_blank" rel="noopener noreferrer">View listing</a>}
        <PrefetchLink className="vehicle-popup-action vehicle-popup-action-primary" to={`/vehicle/${vehicle.id}`} onClick={event => {
          if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) closeAll();
        }}>Open full profile</PrefetchLink>
      </div>

      {/* Loading state for intel */}
      {(loading || unavailable) && (
        <div style={{ padding: '8px 12px', textAlign: 'center' }}>
          <span style={{ fontFamily: MONO, fontSize: 'var(--text-caption)', color: 'var(--text-secondary)', }}>
            {unavailable ? 'Vehicle intelligence unavailable.' : 'Loading intelligence...'}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function hasRedFlags(di: DescriptionIntel): boolean {
  return di.red_flags != null && di.red_flags.length > 0;
}

function hasMods(di: DescriptionIntel): boolean {
  return di.mods != null && di.mods.length > 0;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontFamily: SANS, fontSize: 'var(--text-caption)', fontWeight: 600,
      color: 'var(--text-secondary)', lineHeight: 1,
    }}>
      {children}
    </span>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: SANS, fontSize: 'var(--text-caption)', fontWeight: 600,
      color: 'var(--text-secondary)', marginBottom: 2,
    }}>
      {children}
    </div>
  );
}

function ClickableText({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button type="button" className="vehicle-popup-text-action" onClick={event => { event.stopPropagation(); onClick(); }}>
    {children}
  </button>;
}

function SentimentBadge({ sentiment, score }: { sentiment: string; score: number | null }) {
  const color = sentiment === 'positive' ? 'var(--vehicle-popup-success)' : sentiment === 'negative' ? 'var(--vehicle-popup-error)' : 'var(--text-secondary)';
  return (
    <span style={{
      fontFamily: SANS, fontSize: 'var(--text-caption)', fontWeight: 600,
      color, padding: '1px 4px', border: `1px solid ${color}`,
    }}>
      {sentiment}{score != null ? ` ${Math.round(score * 100)}%` : ''}
    </span>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  const color = value === 'high' || value === 'rising' ? 'var(--vehicle-popup-success)' : value === 'low' || value === 'falling' ? 'var(--vehicle-popup-error)' : 'var(--text-secondary)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <span style={{ fontFamily: SANS, fontSize: 'var(--text-caption)', fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: 'var(--text-callout)', fontWeight: 700, color, textTransform: 'none' }}>{value}</span>
    </div>
  );
}

function IntelBadge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontFamily: SANS, fontSize: 'var(--text-caption)', fontWeight: 600,
      color, padding: '1px 5px', border: `1px solid ${color}`,
      background: 'var(--surface)' ,
    }}>
      {label}
    </span>
  );
}

interface SpecItem {
  label: string;
  value: string;
  onClick?: () => void;
}

function buildSpecs(v: Props['vehicle']): SpecItem[] {
  const specs: SpecItem[] = [];
  if (v.mileage) specs.push({ label: 'Mileage', value: `${Math.floor(v.mileage).toLocaleString()} mi` });
  if (v.transmission_model || v.transmission) specs.push({ label: 'Transmission', value: v.transmission_model || v.transmission! });
  if (v.drivetrain) specs.push({ label: 'Drivetrain', value: v.drivetrain });
  if (v.engine_size) specs.push({ label: 'Engine', value: v.engine_size });
  if (v.canonical_body_style || v.body_style) specs.push({ label: 'Body', value: v.canonical_body_style || v.body_style || '' });
  if (v.fuel_type) specs.push({ label: 'Fuel', value: v.fuel_type });
  if (v.vin) specs.push({ label: 'VIN', value: `...${v.vin.slice(-8)}` });
  if (v.location) specs.push({ label: 'Location', value: v.location });
  return specs;
}

function SpecGrid({ specs }: { specs: SpecItem[] }) {
  if (specs.length === 0) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '4px 12px' }}>
      {specs.map((s) => (
        <div key={s.label} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontFamily: SANS, fontSize: 'var(--text-caption)', fontWeight: 600, color: 'var(--text-secondary)', lineHeight: 1 }}>
            {s.label}
          </span>
          {s.onClick ? (
            <span role="button" tabIndex={0} onClick={s.onClick} style={{
              fontFamily: MONO, fontSize: 'var(--text-callout)', fontWeight: 700, color: 'var(--text)', lineHeight: 1.2, cursor: 'pointer',
              borderBottom: '1px dashed var(--text-secondary)', width: 'fit-content',
            }}>
              {s.value}
            </span>
          ) : (
            <span style={{ fontFamily: MONO, fontSize: 'var(--text-callout)', fontWeight: 700, color: 'var(--text)', lineHeight: 1.4, overflowWrap: 'anywhere' }}>
              {s.value}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
