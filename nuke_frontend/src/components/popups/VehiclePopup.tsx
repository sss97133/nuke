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
import { usePopup } from './usePopup';
import { optimizeImageUrl } from '../../lib/imageOptimizer';
import { useViewHistory } from '../../hooks/useViewHistory';
import { useInterests } from '../../hooks/useInterests';
import { MakePopup } from './MakePopup';
import { ModelPopup } from './ModelPopup';
import { SourcePopup } from './SourcePopup';

interface Props {
  vehicle: FeedVehicle;
  searchQuery?: string;
}

interface VehicleIntel {
  comment_intel: CommentIntel | null;
  description_intel: DescriptionIntel | null;
  scores: ScoreData | null;
  apparitions: Apparition[] | null;
  recent_comps: CompSale[] | null;
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

const MONO = "'Courier New', Courier, monospace";
const SANS = 'Arial, Helvetica, sans-serif';

export function VehiclePopup({ vehicle, searchQuery }: Props) {
  const { openPopup } = usePopup();
  const { recordView, endView } = useViewHistory();
  const { recordInterest } = useInterests();
  const price = resolveVehiclePrice(vehicle);
  const [intel, setIntel] = useState<VehicleIntel | null>(null);
  const [loading, setLoading] = useState(true);

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
      try {
        const { data, error } = await supabase.rpc('popup_vehicle_intel', {
          p_vehicle_id: vehicle.id,
        });
        if (!cancelled && !error && data) {
          setIntel(data as VehicleIntel);
        }
      } catch {
        // fail silently
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
    supabase.from('vehicles').select('*').eq('id', comp.id).single().then(({ data }) => {
      if (data) openPopup(<VehiclePopup vehicle={data as unknown as FeedVehicle} />, [comp.year, comp.model].filter(Boolean).join(' '), 480);
    });
  };

  const scores = intel?.scores;
  const ci = intel?.comment_intel;
  const di = intel?.description_intel;
  const apparitions = intel?.apparitions;
  const comps = intel?.recent_comps;

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Hero image */}
      {vehicle.thumbnail_url && (
        <div style={{ width: '100%', height: 220, overflow: 'hidden', background: '#e0e0e0' }}>
          <img src={optimizeImageUrl(vehicle.thumbnail_url, 'medium') || vehicle.thumbnail_url} alt={title} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        </div>
      )}

      {/* Title + Price */}
      <div style={{ padding: '10px 12px 6px', borderBottom: '1px solid #ccc' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontFamily: SANS, fontSize: 13, fontWeight: 800, color: '#1a1a1a', lineHeight: 1.2 }}>
            {vehicle.year && <span style={{ color: '#666' }}>{vehicle.year} </span>}
            {vehicle.make && <ClickableText onClick={handleMakeClick}>{vehicle.make}</ClickableText>}
            {vehicle.model && <> <ClickableText onClick={handleModelClick}>{vehicle.model}</ClickableText></>}
            {vehicle.series && <span style={{ fontWeight: 400, color: '#666' }}> {vehicle.series}</span>}
          </span>
          <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: price.isSold ? 'var(--vp-sold, #16825d)' : '#1a1a1a', flexShrink: 0, whiteSpace: 'nowrap' }}>
            {price.formatted}
          </span>
        </div>
        {price.isSold && price.showSoldBadge && (
          <span style={{ fontFamily: SANS, fontSize: 7, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--vp-sold, #16825d)' }}>SOLD</span>
        )}
        {vehicle.is_for_sale && !price.isSold && (
          <span style={{ fontFamily: SANS, fontSize: 7, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#0078d4' }}>FOR SALE</span>
        )}
      </div>

      {/* Nuke Estimate + Scores — the live computation */}
      {scores && (scores.nuke_estimate || scores.heat_score || scores.deal_score) && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #ccc', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {scores.nuke_estimate && scores.nuke_estimate > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Label>NUKE ESTIMATE</Label>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>
                  {formatPrice(scores.nuke_estimate)}
                </span>
                {price.amount && price.amount > 0 && (() => {
                  const diff = Math.round(((price.amount - scores.nuke_estimate!) / scores.nuke_estimate!) * 100);
                  const color = diff > 5 ? 'var(--vp-danger, #8a0020)' : diff < -5 ? 'var(--vp-brg, #004225)' : '#666';
                  return (
                    <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, color }}>
                      {diff > 0 ? '+' : ''}{diff}%
                    </span>
                  );
                })()}
              </div>
              {scores.nuke_confidence != null && (
                <span style={{ fontFamily: MONO, fontSize: 7, color: '#999' }}>{scores.nuke_confidence}% confidence</span>
              )}
            </div>
          )}
          {scores.heat_score != null && scores.heat_score > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Label>HEAT</Label>
              <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: scores.heat_score > 70 ? 'var(--vp-danger, #8a0020)' : scores.heat_score > 40 ? '#b05a00' : '#666' }}>
                {scores.heat_score}
              </span>
            </div>
          )}
          {scores.deal_score != null && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Label>DEAL</Label>
              <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: scores.deal_score > 70 ? 'var(--vp-brg, #004225)' : scores.deal_score < 30 ? 'var(--vp-danger, #8a0020)' : '#666' }}>
                {scores.deal_score}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Key specs */}
      {(() => {
        const specs = buildSpecs(vehicle, handleMakeClick, handleModelClick);
        if (specs.length === 0) return null;
        return (
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #ccc' }}>
            <SpecGrid specs={specs} />
          </div>
        );
      })()}

      {/* Comment Intelligence — the gold */}
      {ci && (ci.key_quotes || ci.expert_insights || ci.community_concerns) && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #ccc' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <Label>COMMUNITY INTELLIGENCE</Label>
            {ci.overall_sentiment && (
              <SentimentBadge sentiment={ci.overall_sentiment} score={ci.sentiment_score} />
            )}
            {ci.comment_count && (
              <span style={{ fontFamily: MONO, fontSize: 7, color: '#999' }}>{ci.comment_count} comments</span>
            )}
          </div>

          {/* Key quotes */}
          {ci.key_quotes && ci.key_quotes.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              {ci.key_quotes.slice(0, 3).map((q, i) => {
                const quoteText = typeof q === 'string' ? q : q.quote;
                return (
                  <div key={i} style={{
                    fontFamily: SANS, fontSize: 9, color: '#444', lineHeight: 1.4,
                    padding: '3px 0 3px 8px', borderLeft: '2px solid #ccc', marginBottom: 3,
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
              <SubLabel>EXPERT INSIGHTS</SubLabel>
              {ci.expert_insights.slice(0, 3).map((e, i) => {
                const text = typeof e === 'string' ? e : e.insight;
                return (
                  <div key={i} style={{ fontFamily: SANS, fontSize: 9, color: '#333', lineHeight: 1.4, marginBottom: 2 }}>
                    {text.length > 140 ? text.slice(0, 140) + '...' : text}
                  </div>
                );
              })}
            </div>
          )}

          {/* Concerns */}
          {ci.community_concerns && ci.community_concerns.length > 0 && (
            <div>
              <SubLabel>CONCERNS RAISED</SubLabel>
              {ci.community_concerns.slice(0, 3).map((c, i) => {
                const text = typeof c === 'string' ? c : c.concern;
                return (
                  <div key={i} style={{ fontFamily: SANS, fontSize: 9, color: 'var(--vp-danger, #8a0020)', lineHeight: 1.4, marginBottom: 1 }}>
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
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #ccc' }}>
          <Label>VEHICLE INTELLIGENCE</Label>

          {/* Condition summary */}
          {di.condition_note && (
            <div style={{ fontFamily: SANS, fontSize: 9, color: '#444', lineHeight: 1.4, marginTop: 4, marginBottom: 4 }}>
              {di.condition_note.length > 200 ? di.condition_note.slice(0, 200) + '...' : di.condition_note}
            </div>
          )}

          {/* Quick badges */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4, marginBottom: 4 }}>
            {di.title_status && <IntelBadge label={`TITLE: ${di.title_status}`} color="var(--vp-brg, #004225)" />}
            {di.matching_numbers === true && <IntelBadge label="MATCHING NUMBERS" color="var(--vp-brg, #004225)" />}
            {di.matching_numbers === false && <IntelBadge label="NOT MATCHING" color="var(--vp-danger, #8a0020)" />}
            {di.condition && <IntelBadge label={di.condition.toUpperCase()} color="#1a1a1a" />}
            {di.owner_count != null && <IntelBadge label={`${di.owner_count} OWNER${di.owner_count !== 1 ? 'S' : ''}`} color="#666" />}
          </div>

          {/* Red flags */}
          {hasRedFlags(di) && (
            <div style={{ marginBottom: 4 }}>
              <SubLabel>RED FLAGS</SubLabel>
              {(di.red_flags || []).slice(0, 3).map((f, i) => (
                <div key={i} style={{ fontFamily: SANS, fontSize: 9, color: 'var(--vp-danger, #8a0020)', lineHeight: 1.3, marginBottom: 1 }}>
                  <span style={{ fontFamily: MONO, fontSize: 7, fontWeight: 700, marginRight: 4, textTransform: 'uppercase' }}>
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
              <SubLabel>MODIFICATIONS ({(di.mods || []).length})</SubLabel>
              <div style={{ fontFamily: SANS, fontSize: 9, color: '#444', lineHeight: 1.4 }}>
                {(di.mods || []).slice(0, 5).join(' / ')}
                {(di.mods || []).length > 5 && <span style={{ color: '#999' }}> +{(di.mods || []).length - 5} more</span>}
              </div>
            </div>
          )}

          {/* Documentation */}
          {di.documentation && di.documentation.length > 0 && (
            <div>
              <SubLabel>DOCUMENTATION</SubLabel>
              <div style={{ fontFamily: SANS, fontSize: 9, color: '#444', lineHeight: 1.4 }}>
                {di.documentation.slice(0, 4).join(' / ')}
                {di.documentation.length > 4 && <span style={{ color: '#999' }}> +{di.documentation.length - 4} more</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Comparable sales — specific vehicles, not stats */}
      {comps && comps.length > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #ccc' }}>
          <Label>RECENT COMPARABLE SALES</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginTop: 6 }}>
            {comps.slice(0, 5).map((c) => (
              <div
                key={c.id}
                onClick={() => handleCompClick(c)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '4px 0', borderBottom: '1px solid #f0f0f0',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f5f5'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                {c.thumbnail && (
                  <img src={optimizeImageUrl(c.thumbnail, 'micro') || c.thumbnail} alt="" loading="lazy" style={{ width: 40, height: 27, objectFit: 'cover', flexShrink: 0, border: '1px solid #e0e0e0' }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontFamily: SANS, fontSize: 9, fontWeight: 700, color: '#1a1a1a', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[c.year, c.model].filter(Boolean).join(' ')}
                  </span>
                  {c.mileage && (
                    <span style={{ fontFamily: MONO, fontSize: 7, color: '#999' }}>{Math.floor(c.mileage).toLocaleString()} mi</span>
                  )}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: 'var(--vp-sold, #16825d)' }}>{formatPrice(c.sale_price)}</span>
                  {c.sale_date && (
                    <div style={{ fontFamily: MONO, fontSize: 7, color: '#999' }}>
                      {new Date(c.sale_date).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Apparition history — cross-platform sightings */}
      {apparitions && apparitions.length > 1 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #ccc' }}>
          <Label>APPARITION HISTORY</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
            {apparitions.slice(0, 6).map((a, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: SANS, fontSize: 8, fontWeight: 700, textTransform: 'uppercase', color: '#666', width: 80, flexShrink: 0 }}>
                  {a.platform || 'unknown'}
                </span>
                <span style={{ fontFamily: MONO, fontSize: 8, color: '#999', width: 50, flexShrink: 0 }}>
                  {a.event_type || ''}
                </span>
                {a.price && a.price > 0 && (
                  <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, color: 'var(--vp-sold, #16825d)' }}>{formatPrice(a.price)}</span>
                )}
                {a.event_date && (
                  <span style={{ fontFamily: MONO, fontSize: 7, color: '#999', marginLeft: 'auto' }}>
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
              <span style={{ fontFamily: MONO, fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', padding: '2px 5px', border: '1px solid #ccc', color: '#666' }}>
                {vehicle.discovery_source || vehicle.profile_origin}
              </span>
            </ClickableText>
          )}
        </div>
        {(vehicle.discovery_url || vehicle.listing_url) && (
          <a
            href={vehicle.discovery_url || vehicle.listing_url || '#'}
            target="_blank" rel="noopener noreferrer"
            style={{ fontFamily: MONO, fontSize: 8, fontWeight: 700, textTransform: 'uppercase', color: '#2a2a2a', textDecoration: 'none', borderBottom: '1px dashed #999' }}
          >
            VIEW SOURCE
          </a>
        )}
      </div>

      {/* Full profile link */}
      <div style={{ padding: '0 12px 10px', textAlign: 'right' }}>
        <a
          href={`/vehicle/${vehicle.id}`}
          style={{
            fontFamily: SANS, fontSize: 9, fontWeight: 800,
            textTransform: 'uppercase', letterSpacing: '0.3px',
            padding: '4px 12px', border: '2px solid #2a2a2a',
            background: '#2a2a2a', color: '#fff',
            textDecoration: 'none', display: 'inline-block',
            transition: 'opacity 150ms ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.8'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
        >
          OPEN FULL PROFILE
        </a>
      </div>

      {/* Loading state for intel */}
      {loading && (
        <div style={{ padding: '8px 12px', textAlign: 'center' }}>
          <span style={{ fontFamily: MONO, fontSize: 8, color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Loading intelligence...
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
      fontFamily: SANS, fontSize: 7, fontWeight: 800,
      textTransform: 'uppercase', letterSpacing: '0.5px',
      color: '#999', lineHeight: 1,
    }}>
      {children}
    </span>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: SANS, fontSize: 7, fontWeight: 800,
      textTransform: 'uppercase', letterSpacing: '0.3px',
      color: '#999', marginBottom: 2,
    }}>
      {children}
    </div>
  );
}

function ClickableText({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <span
      role="button" tabIndex={0}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
      style={{ cursor: 'pointer', borderBottom: '1px dashed #999', transition: 'border-color 150ms ease' }}
      onMouseEnter={(e) => { e.currentTarget.style.borderBottomColor = '#2a2a2a'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderBottomColor = '#999'; }}
    >
      {children}
    </span>
  );
}

function SentimentBadge({ sentiment, score }: { sentiment: string; score: number | null }) {
  const color = sentiment === 'positive' ? 'var(--vp-brg, #004225)' : sentiment === 'negative' ? 'var(--vp-danger, #8a0020)' : '#666';
  return (
    <span style={{
      fontFamily: SANS, fontSize: 7, fontWeight: 800,
      textTransform: 'uppercase', letterSpacing: '0.3px',
      color, padding: '1px 4px', border: `1px solid ${color}40`,
    }}>
      {sentiment}{score != null ? ` ${Math.round(score * 100)}%` : ''}
    </span>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  const color = value === 'high' || value === 'rising' ? 'var(--vp-brg, #004225)' : value === 'low' || value === 'falling' ? 'var(--vp-danger, #8a0020)' : '#666';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <span style={{ fontFamily: SANS, fontSize: 6, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.3px', color: '#999' }}>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, color, textTransform: 'uppercase' }}>{value}</span>
    </div>
  );
}

function IntelBadge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontFamily: SANS, fontSize: 7, fontWeight: 800,
      textTransform: 'uppercase', letterSpacing: '0.3px',
      color, padding: '1px 5px', border: `1px solid ${color}30`,
      background: `${color}08`,
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

function buildSpecs(v: FeedVehicle, onMakeClick: () => void, onModelClick: () => void): SpecItem[] {
  const specs: SpecItem[] = [];
  if (v.mileage) specs.push({ label: 'MILEAGE', value: `${Math.floor(v.mileage).toLocaleString()} mi` });
  if (v.transmission) specs.push({ label: 'TRANS', value: v.transmission });
  if (v.drivetrain) specs.push({ label: 'DRIVE', value: v.drivetrain });
  if (v.engine_size) specs.push({ label: 'ENGINE', value: v.engine_size });
  if (v.canonical_body_style || v.body_style) specs.push({ label: 'BODY', value: v.canonical_body_style || v.body_style || '' });
  if (v.fuel_type) specs.push({ label: 'FUEL', value: v.fuel_type });
  if (v.vin) specs.push({ label: 'VIN', value: `...${v.vin.slice(-8)}` });
  if (v.location) specs.push({ label: 'LOCATION', value: v.location });
  return specs;
}

function SpecGrid({ specs }: { specs: SpecItem[] }) {
  if (specs.length === 0) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px 12px' }}>
      {specs.map((s) => (
        <div key={s.label} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontFamily: SANS, fontSize: 7, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#999', lineHeight: 1 }}>
            {s.label}
          </span>
          {s.onClick ? (
            <span role="button" tabIndex={0} onClick={s.onClick} style={{
              fontFamily: MONO, fontSize: 10, fontWeight: 700, color: '#1a1a1a', lineHeight: 1.2, cursor: 'pointer',
              borderBottom: '1px dashed #999', width: 'fit-content',
            }}>
              {s.value}
            </span>
          ) : (
            <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: '#1a1a1a', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {s.value}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
