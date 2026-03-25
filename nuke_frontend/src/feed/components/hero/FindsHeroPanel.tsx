/**
 * FindsHeroPanel -- STORY-style hero for the FINDS lens.
 *
 * Three sections in a horizontal scroll:
 * - Multi-signal: deal + heat overlap with comment counts
 * - Multi-platform: same car on 2+ platforms
 * - Rare finds: recently discovered rare models
 *
 * Design: 2px borders, zero radius, Courier New for scores, story cards.
 */

import { useRef, useState } from 'react';
import { useHeroFinds, type MultiSignalItem, type MultiPlatformItem, type RareFindItem } from '../../hooks/useHeroFinds';
import { optimizeImageUrl } from '../../../lib/imageOptimizer';
import type { HeroFilter } from '../HeroPanel';

function fmtPrice(n: number | null | undefined): string {
  if (n == null) return '--';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`;
  return `$${n.toLocaleString()}`;
}

function SignalBadge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontFamily: "'Courier New', monospace", fontSize: 7, fontWeight: 700,
      color: '#fff', background: color, padding: '1px 3px', lineHeight: 1,
      letterSpacing: '0.02em', textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

function MultiSignalCard({ item, rank, onClick }: { item: MultiSignalItem; rank: number; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [imgError, setImgError] = useState(false);
  const ymm = [item.year, item.make?.toUpperCase(), item.model?.toUpperCase()].filter(Boolean).join(' ');
  const thumbUrl = optimizeImageUrl(item.thumbnail, 'small');
  let flavor = '';
  if (item.deal_score && item.deal_score > 80) flavor = ' -- SLEEPER DEAL';
  else if (item.recent_comments > 20) flavor = ' -- HOT COMMODITY';
  else if (item.deal_score && item.deal_score > 70) flavor = ' -- UNDERVALUED';
  const headline = ymm + flavor;

  return (
    <div onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{
      width: 220, minWidth: 220, height: '100%',
      border: `2px solid ${hovered ? 'var(--text)' : 'var(--border)'}`,
      background: hovered ? 'var(--surface-hover)' : 'var(--surface)',
      cursor: 'pointer', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      transition: 'border-color 120ms ease-out, background 120ms ease-out', userSelect: 'none', position: 'relative',
    }}>
      <div style={{ width: '100%', height: 80, overflow: 'hidden', position: 'relative', background: 'var(--bg)' }}>
        {thumbUrl && !imgError ? (
          <img src={thumbUrl} alt={headline} onError={() => setImgError(true)} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Courier New', monospace", fontSize: 9, color: 'var(--text-disabled)' }}>NO IMG</div>
        )}
        <div style={{ position: 'absolute', top: 4, left: 4, background: 'var(--text)', color: 'var(--surface)', fontFamily: "'Courier New', monospace", fontSize: 8, fontWeight: 700, padding: '1px 3px', lineHeight: 1 }}>#{rank}</div>
      </div>
      <div style={{ padding: '5px 6px', flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 9, fontWeight: 800, textTransform: 'uppercase', color: 'var(--text)', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '0.04em' }}>{headline || 'UNKNOWN'}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          {item.price != null && <span style={{ fontFamily: "'Courier New', monospace", fontSize: 10, fontWeight: 700, color: 'var(--text)' }}>{fmtPrice(item.price)}</span>}
          {item.deal_score != null && item.deal_score > 50 && <SignalBadge label={`DEAL ${Math.round(item.deal_score)}%`} color="#16825d" />}
          {item.recent_comments > 0 && <SignalBadge label={`${item.recent_comments} CMT`} color="#dc6b16" />}
          {item.heat_score != null && item.heat_score > 0 && <SignalBadge label="HOT" color="#dc6b16" />}
        </div>
        <div style={{ fontFamily: "'Courier New', monospace", fontSize: 7, color: 'var(--text-secondary)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 'auto', letterSpacing: '0.02em' }}>
          {item.deal_score && item.deal_score > 70 ? `${Math.round(item.deal_score)}% deal` : ''}{item.deal_score && item.deal_score > 70 && item.recent_comments > 0 ? ' + ' : ''}{item.recent_comments > 0 ? `${item.recent_comments} comments this week` : ''}
        </div>
      </div>
    </div>
  );
}

function PlatformCard({ item, onClick }: { item: MultiPlatformItem; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [imgError, setImgError] = useState(false);
  const ymm = [item.year, item.make?.toUpperCase(), item.model?.toUpperCase()].filter(Boolean).join(' ');
  const thumbUrl = optimizeImageUrl(item.thumbnail, 'small');
  const platformStr = (item.platforms ?? []).map(p => (p ?? '').toUpperCase().replace(/[-_]/g, ' ').slice(0, 5)).join(' + ');

  return (
    <div onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{
      width: 200, minWidth: 200, height: '100%',
      border: `2px solid ${hovered ? 'var(--text)' : 'var(--border)'}`,
      background: hovered ? 'var(--surface-hover)' : 'var(--surface)',
      cursor: 'pointer', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      transition: 'border-color 120ms ease-out, background 120ms ease-out', userSelect: 'none',
    }}>
      <div style={{ width: '100%', height: 70, overflow: 'hidden', position: 'relative', background: 'var(--bg)' }}>
        {thumbUrl && !imgError ? (
          <img src={thumbUrl} alt={ymm} onError={() => setImgError(true)} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Courier New', monospace", fontSize: 9, color: 'var(--text-disabled)' }}>--</div>
        )}
        <div style={{ position: 'absolute', top: 4, right: 4, background: '#6d28d9', color: '#fff', fontFamily: "'Courier New', monospace", fontSize: 8, fontWeight: 700, padding: '1px 4px', lineHeight: 1 }}>{item.platform_count}x PLATFORM</div>
      </div>
      <div style={{ padding: '4px 6px', flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 8, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text)', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ymm || 'UNKNOWN'}</div>
        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 9, fontWeight: 700, color: 'var(--text)' }}>{fmtPrice(item.price)}</span>
        <div style={{ fontFamily: "'Courier New', monospace", fontSize: 7, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 'auto' }}>{platformStr}</div>
      </div>
    </div>
  );
}

function RareCard({ item, onClick }: { item: RareFindItem; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [imgError, setImgError] = useState(false);
  const ymm = [item.year, item.make?.toUpperCase(), item.model?.toUpperCase()].filter(Boolean).join(' ');
  const thumbUrl = optimizeImageUrl(item.thumbnail, 'small');

  return (
    <div onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{
      width: 200, minWidth: 200, height: '100%',
      border: `2px solid ${hovered ? 'var(--text)' : 'var(--border)'}`,
      background: hovered ? 'var(--surface-hover)' : 'var(--surface)',
      cursor: 'pointer', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      transition: 'border-color 120ms ease-out, background 120ms ease-out', userSelect: 'none',
    }}>
      <div style={{ width: '100%', height: 70, overflow: 'hidden', position: 'relative', background: 'var(--bg)' }}>
        {thumbUrl && !imgError ? (
          <img src={thumbUrl} alt={ymm} onError={() => setImgError(true)} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Courier New', monospace", fontSize: 9, color: 'var(--text-disabled)' }}>--</div>
        )}
        <div style={{ position: 'absolute', top: 4, right: 4, background: '#b45309', color: '#fff', fontFamily: "'Courier New', monospace", fontSize: 8, fontWeight: 700, padding: '1px 4px', lineHeight: 1 }}>RARE</div>
      </div>
      <div style={{ padding: '4px 6px', flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 8, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text)', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ymm || 'UNKNOWN'}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontFamily: "'Courier New', monospace", fontSize: 9, fontWeight: 700, color: 'var(--text)' }}>{fmtPrice(item.price)}</span>
          {item.deal_score != null && item.deal_score > 50 && <SignalBadge label={`DEAL ${Math.round(item.deal_score)}%`} color="#16825d" />}
        </div>
        <div style={{ fontFamily: "'Courier New', monospace", fontSize: 7, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 'auto' }}>{item.model_count === 1 ? 'only 1 in database' : `only ${item.model_count} in database`}</div>
      </div>
    </div>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', width: 3, minWidth: 3, height: '100%', position: 'relative' }}>
      <div style={{ width: 1, height: '100%', background: 'var(--border)' }} />
      <div style={{ position: 'absolute', background: 'var(--surface)', padding: '2px 0', fontFamily: 'Arial, sans-serif', fontSize: 6, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-disabled)', writingMode: 'vertical-lr', textOrientation: 'mixed', letterSpacing: '1px' }}>{label}</div>
    </div>
  );
}

function ArrowButton({ direction, onClick }: { direction: 'left' | 'right'; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button type="button" onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{
      width: 20, height: 16, border: `1px solid ${hovered ? 'var(--text)' : 'var(--border)'}`,
      background: hovered ? 'var(--surface-hover)' : 'transparent', color: hovered ? 'var(--text)' : 'var(--text-disabled)',
      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Arial, sans-serif', fontSize: 10, fontWeight: 700, padding: 0, transition: 'all 120ms ease-out',
    }}>
      {direction === 'left' ? '\u2190' : '\u2192'}
    </button>
  );
}

function LoadingSkeleton() {
  return (
    <div style={{ width: '100%', height: '100%', padding: '8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ height: 12, width: 240, background: 'var(--border)', opacity: 0.4 }} />
      <div style={{ display: 'flex', gap: 2, flex: 1 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{ width: 220, minWidth: 220, height: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ height: 80, background: 'var(--border)', opacity: 0.2 }} />
            <div style={{ height: 8, width: '80%', background: 'var(--border)', opacity: 0.3 }} />
            <div style={{ height: 8, width: '50%', background: 'var(--border)', opacity: 0.25 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export interface FindsHeroPanelProps { onFilter: (filter: HeroFilter) => void; }

export function FindsHeroPanel({ onFilter }: FindsHeroPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { data, isLoading, error } = useHeroFinds(true);
  const scroll = (dir: 'left' | 'right') => { if (scrollRef.current) scrollRef.current.scrollBy({ left: dir === 'left' ? -440 : 440, behavior: 'smooth' }); };
  const multiSignal = data?.multi_signal ?? [];
  const multiPlatform = data?.multi_platform ?? [];
  const rareFinds = data?.rare_finds ?? [];
  const totalFinds = multiSignal.length + multiPlatform.length + rareFinds.length;

  if (isLoading) return <LoadingSkeleton />;
  if (error || totalFinds === 0) {
    return (<div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Arial, sans-serif', fontSize: 8, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-disabled)', letterSpacing: '0.5px' }}>NO FINDS DATA</div>);
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px 2px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontFamily: "'Courier New', monospace", fontSize: 14, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>{totalFinds}</span>
          <span style={{ fontFamily: 'Arial, sans-serif', fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-disabled)' }}>MULTI-SIGNAL DISCOVERIES</span>
        </div>
        <div style={{ display: 'flex', gap: 2 }}>
          <ArrowButton direction="left" onClick={() => scroll('left')} />
          <ArrowButton direction="right" onClick={() => scroll('right')} />
        </div>
      </div>
      <div ref={scrollRef} style={{ flex: 1, display: 'flex', gap: 2, overflowX: 'auto', overflowY: 'hidden', padding: '2px 8px 6px', scrollbarWidth: 'none' }}>
        {multiSignal.slice(0, 10).map((item, i) => (<MultiSignalCard key={item.id} item={item} rank={i + 1} onClick={() => { if (item.make) onFilter({ makes: [item.make], sort: 'finds' as any }); }} />))}
        {multiPlatform.length > 0 && multiSignal.length > 0 && <SectionDivider label="MULTI" />}
        {multiPlatform.slice(0, 8).map((item) => (<PlatformCard key={item.id} item={item} onClick={() => { if (item.make) onFilter({ makes: [item.make], sort: 'finds' as any }); }} />))}
        {rareFinds.length > 0 && (multiSignal.length > 0 || multiPlatform.length > 0) && <SectionDivider label="RARE" />}
        {rareFinds.slice(0, 8).map((item) => (<RareCard key={item.id} item={item} onClick={() => { if (item.make) onFilter({ makes: [item.make], sort: 'finds' as any }); }} />))}
      </div>
    </div>
  );
}
