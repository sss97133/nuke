/**
 * LiveFloor — the "live area": a parametrized, realtime floor of latest vehicles.
 *
 * The spin (Skylar's #3 ask): not a feed you scroll — a standing query you shop.
 * Set the parameters, watch new inventory land live, long-press any rig to Watch /
 * Compare / Make offer (those actions come from the global peek-menu affordance
 * seam, so they work here and everywhere). Compare is side-by-side. Offers accrue
 * as a demand signal shown right on the card.
 *
 * Real data only — every card is a live browse-RPC row wired to its real vehicle.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveFloor, type LiveParams, type LiveRow } from './useLiveFloor';

function money(n: number | null): string {
  return n ? `$${n.toLocaleString()}` : '—';
}
function ymmOf(r: LiveRow): string {
  return [r.year, r.make, r.model].filter(Boolean).join(' ') || 'Vehicle';
}
/** "2d 4h" / "3h 12m" / "48m" until the auction ends; null if passed/absent. */
function endsIn(iso: string | null | undefined, nowMs: number): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - nowMs;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

const inputStyle: React.CSSProperties = {
  padding: '5px 7px', border: '2px solid var(--border)', borderRadius: 0,
  background: 'var(--surface)', color: 'var(--text)', font: 'inherit', fontSize: 12, minWidth: 0,
};

function ParamBar({ params, onChange }: { params: LiveParams; onChange: (p: LiveParams) => void }) {
  const [local, setLocal] = useState(params);
  const set = (patch: Partial<LiveParams>) => setLocal((p) => ({ ...p, ...patch }));
  const num = (v: string) => (v ? Number(v.replace(/[^0-9]/g, '')) || undefined : undefined);
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '8px 12px', borderBottom: '2px solid var(--text)' }}>
      <input style={inputStyle} placeholder="Make" value={local.make || ''} onChange={(e) => set({ make: e.target.value || undefined })} />
      <input style={inputStyle} placeholder="Model" value={local.model || ''} onChange={(e) => set({ model: e.target.value || undefined })} />
      <input style={{ ...inputStyle, width: 70 }} placeholder="Yr min" value={local.yearMin || ''} onChange={(e) => set({ yearMin: num(e.target.value) })} />
      <input style={{ ...inputStyle, width: 70 }} placeholder="Yr max" value={local.yearMax || ''} onChange={(e) => set({ yearMax: num(e.target.value) })} />
      <input style={{ ...inputStyle, width: 90 }} placeholder="$ min" value={local.priceMin || ''} onChange={(e) => set({ priceMin: num(e.target.value) })} />
      <input style={{ ...inputStyle, width: 90 }} placeholder="$ max" value={local.priceMax || ''} onChange={(e) => set({ priceMax: num(e.target.value) })} />
      <button
        data-press
        onClick={() => onChange(local)}
        style={{ padding: '6px 14px', border: '2px solid var(--text)', borderRadius: 0, background: 'var(--text)', color: 'var(--surface)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer' }}
      >
        Shop
      </button>
    </div>
  );
}

function CompareTray({ rows, onClear, onRemove }: { rows: LiveRow[]; onClear: () => void; onRemove: (id: string) => void }) {
  if (!rows.length) return null;
  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 8000, background: 'var(--surface)', borderTop: '2px solid var(--text)', padding: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Compare · {rows.length}</span>
        <button data-press onClick={onClear} style={{ background: 'none', border: '2px solid var(--text)', borderRadius: 0, padding: '3px 8px', fontSize: 10, textTransform: 'uppercase', cursor: 'pointer' }}>Clear</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${rows.length}, 1fr)`, gap: 8 }}>
        {rows.map((r) => (
          <div key={r.id} style={{ border: '2px solid var(--border)', padding: 8, fontSize: 11 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{ymmOf(r)}</strong>
              <button onClick={() => onRemove(r.id)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
            </div>
            <div>Price {money(r.sold_price)}</div>
            <div>Body {r.body_style || '—'}</div>
            <div>Source {r.source || '—'}</div>
            <div>Offers {r.offer_count || 0}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LiveFloor() {
  const { params, setParams, rows, loading, newCount, refresh } = useLiveFloor();
  const [compare, setCompare] = useState<LiveRow[]>([]);
  // Countdown tick — re-render every 30s so "ends in" stays honest without refetching.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Bridge: the peek-menu "Compare" affordance dispatches nuke:compare.
  useEffect(() => {
    const onCompare = (e: Event) => {
      const id = (e as CustomEvent).detail?.id as string;
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      setCompare((c) => (c.find((x) => x.id === id) ? c : [...c, row].slice(-3)));
    };
    window.addEventListener('nuke:compare', onCompare as EventListener);
    return () => window.removeEventListener('nuke:compare', onCompare as EventListener);
  }, [rows]);

  return (
    <div style={{ paddingBottom: compare.length ? 180 : 0 }}>
      <div style={{ padding: '10px 12px 0' }}>
        <h1 style={{ fontSize: 14, letterSpacing: '0.06em', textTransform: 'uppercase', margin: 0 }}>Live Floor</h1>
        <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>Set your parameters. Shop off-market inventory. Long-press a rig to watch, compare, or make an offer.</div>
      </div>

      <ParamBar params={params} onChange={setParams} />

      {newCount > 0 && (
        <button
          data-press
          onClick={refresh}
          style={{ margin: '8px 12px', padding: '6px 12px', border: '2px solid var(--text)', borderRadius: 0, background: 'var(--surface)', color: 'var(--text)', fontSize: 11, cursor: 'pointer' }}
        >
          ● {newCount} new listing{newCount === 1 ? '' : 's'} landed — refresh
        </button>
      )}

      {loading ? (
        <div style={{ padding: 24, fontSize: 12, opacity: 0.6 }}>Loading floor…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 24, fontSize: 12, opacity: 0.6 }}>No inventory matches those parameters.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10, padding: 12 }}>
          {rows.map((r) => {
            const ymm = ymmOf(r);
            const href = `/vehicle/${r.id}`;
            return (
              <Link
                key={r.id}
                to={href}
                data-press
                data-entity-type="vehicle"
                data-entity-id={r.id}
                data-href={href}
                data-ymm={ymm}
                data-ask={r.sold_price ? String(r.sold_price * 100) : undefined}
                style={{ display: 'block', border: '2px solid var(--border)', textDecoration: 'none', color: 'inherit', background: 'var(--surface)' }}
              >
                <div style={{ aspectRatio: '4 / 3', backgroundImage: r.primary_image_url ? `url(${r.primary_image_url})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center', background: r.primary_image_url ? undefined : 'var(--surface-hover)' }} />
                <div style={{ padding: '6px 8px' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ymm}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 2 }}>
                    {r.live_bid_cents ? (
                      <span style={{ fontWeight: 700 }}>BID {money(Math.round(r.live_bid_cents / 100))}</span>
                    ) : (
                      <span>{money(r.sold_price)}</span>
                    )}
                    {r.offer_count ? <span style={{ fontWeight: 700 }}>{r.offer_count} offer{r.offer_count === 1 ? '' : 's'}</span> : <span style={{ opacity: 0.5 }}>{r.source || ''}</span>}
                  </div>
                  {endsIn(r.live_end_time, nowMs) && (
                    <div style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2, opacity: 0.7 }}>
                      ● Live · ends in {endsIn(r.live_end_time, nowMs)}
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <CompareTray rows={compare} onClear={() => setCompare([])} onRemove={(id) => setCompare((c) => c.filter((x) => x.id !== id))} />
    </div>
  );
}
