/**
 * ChannelSwitchboard.tsx
 * ---------------------------------------------------------------------------
 * One toggle per outlet. Flip it on, the listing goes out — the mechanism
 * behind it (API / dealer feed / AI auto-pilot / human concierge) is hidden.
 * Reads live state from listing_exports so each toggle reflects what's actually
 * armed, submitted, or live. Replaces the dumb partner-checkbox grid.
 *
 * Source of truth for the outlets: services/channelRegistry.ts.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import {
  CHANNELS,
  MECHANISMS,
  MECHANISM_ORDER,
  meetsReadiness,
  readinessFloorLabel,
  type ChannelDef,
  type ChannelMechanism,
} from '../../services/channelRegistry';
import { ListingExportService, type ListingExport } from '../../services/listingExportService';

interface ArsState {
  tier: string | null;
  composite_score: number | null;
  photo_zones_missing: string[];
}

// ---------------------------------------------------------------------------
// Style constants (unified design system: Arial, 2px borders, 0 radius, no shadow)
// ---------------------------------------------------------------------------

const FONT_BODY = 'Arial, sans-serif';

const LABEL: React.CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  fontSize: '8px',
  fontWeight: 700,
  color: 'var(--text-secondary, #666)',
  fontFamily: FONT_BODY,
};

const BADGE: React.CSSProperties = {
  fontFamily: FONT_BODY,
  fontSize: '8px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  padding: '1px 5px',
  border: '2px solid',
  color: 'var(--text, #2a2a2a)',
  whiteSpace: 'nowrap',
};

// Status of an armed channel → pill text + accent.
const STATUS_PILL: Record<string, { text: string; color: string }> = {
  prepared: { text: 'ARMED', color: 'var(--accent-papaya, #cc5803)' },
  submitted: { text: 'SUBMITTED', color: 'var(--accent-gulf, #1e6091)' },
  active: { text: 'LIVE', color: 'var(--accent-brg, #1b4332)' },
  sold: { text: 'SOLD', color: 'var(--accent-brg, #1b4332)' },
  expired: { text: 'EXPIRED', color: 'var(--text-secondary, #666)' },
};

const MUTED = 'var(--text-secondary, #999)';

// Owner sign-offs the agent cannot resolve (canonical human-key taxonomy:
// sales-channels-are-service-businesses.md). Surfaced on an armed agent_pilot row.
const HUMAN_KEY_LABEL: Record<string, string> = {
  ownership_attestation: 'Upload title photo',
  final_approval: 'Set reserve & submit',
  identity_grant: 'Confirm seller identity',
  contract_signature: 'Sign consignment contract',
};

function tierShort(tier: string | null): string {
  if (!tier) return 'Unrated';
  const t = tier.toUpperCase();
  if (t.includes('TIER_1') || t.includes('EXCEPTIONAL')) return 'Exceptional';
  if (t.includes('TIER_2') || t.includes('COMPETITIVE')) return 'Competitive';
  if (t.includes('TIER_3') || t.includes('VIABLE')) return 'Viable';
  if (t.includes('TIER_4') || t.includes('INCOMPLETE')) return 'Incomplete';
  if (t.includes('DISCOVERY')) return 'Discovery';
  return tier;
}

// ---------------------------------------------------------------------------
// Toggle (CSS-only, square knob, no radius)
// ---------------------------------------------------------------------------

function Toggle({
  on,
  busy,
  disabled,
  onClick,
}: {
  on: boolean;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled || busy}
      onClick={onClick}
      title={disabled ? 'Only the vehicle owner / lead contributor can list' : on ? 'Click to withdraw' : 'Click to list'}
      style={{
        position: 'relative',
        width: 38,
        height: 20,
        flexShrink: 0,
        padding: 0,
        border: '2px solid var(--border, #bdbdbd)',
        background: on ? 'var(--accent-brg, #1b4332)' : 'transparent',
        cursor: disabled || busy ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'background 180ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 1,
          left: on ? 19 : 1,
          width: 14,
          height: 14,
          background: on ? '#fff' : 'var(--text-secondary, #666)',
          transition: 'left 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      />
      {busy && (
        <span
          style={{
            position: 'absolute',
            top: -14,
            left: 0,
            right: 0,
            textAlign: 'center',
            ...LABEL,
            fontSize: '7px',
            color: 'var(--text-secondary, #666)',
          }}
        >
          …
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Switchboard
// ---------------------------------------------------------------------------

export interface ChannelSwitchboardProps {
  vehicleId: string;
  /** Highest-ranking contributor / verified owner — only they can flip the keys. */
  canList: boolean;
  askingPriceCents?: number;
  reserveCents?: number;
  /** Open the listing composer to edit the package before/after arming. */
  onCompose?: () => void;
}

const ChannelSwitchboard: React.FC<ChannelSwitchboardProps> = ({
  vehicleId,
  canList,
  askingPriceCents,
  reserveCents,
  onCompose,
}) => {
  const [exports, setExports] = useState<ListingExport[]>([]);
  const [ars, setArs] = useState<ArsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [rows, arsRes] = await Promise.all([
      ListingExportService.getVehicleExports(vehicleId),
      supabase
        .from('auction_readiness')
        .select('tier, composite_score, photo_zones_missing')
        .eq('vehicle_id', vehicleId)
        .maybeSingle(),
    ]);
    setExports(rows);
    if (arsRes.data) {
      setArs({
        tier: (arsRes.data as any).tier ?? null,
        composite_score: (arsRes.data as any).composite_score ?? null,
        photo_zones_missing: ((arsRes.data as any).photo_zones_missing as string[]) ?? [],
      });
    }
    setLoading(false);
  }, [vehicleId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Match a channel to its current (non-cancelled) export row.
  const exportFor = useCallback(
    (channel: ChannelDef): ListingExport | undefined => {
      const live = exports.filter((e) => e.status !== 'cancelled');
      // Prefer explicit channel_id match (set on everything we arm).
      const byId = live.find((e) => (e.metadata as any)?.channel_id === channel.id);
      if (byId) return byId;
      // Legacy rows: match by platform enum when it isn't the shared 'other' bucket.
      if (channel.platform !== 'other') {
        return live.find((e) => e.platform === channel.platform && !(e.metadata as any)?.channel_id);
      }
      return undefined;
    },
    [exports],
  );

  const setBusyFor = (id: string, val: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (val) next.add(id);
      else next.delete(id);
      return next;
    });

  const toggle = useCallback(
    async (channel: ChannelDef) => {
      if (!canList) return;
      setError(null);
      const current = exportFor(channel);
      setBusyFor(channel.id, true);
      try {
        if (current) {
          const res = await ListingExportService.withdrawFromChannel(current.id);
          if (!res.success) throw new Error(res.error);
        } else {
          if (!meetsReadiness(channel, ars?.tier)) {
            throw new Error(`Not ready for ${channel.label} — needs ${readinessFloorLabel(channel)}.`);
          }
          const res = await ListingExportService.submitToChannel({
            vehicle_id: vehicleId,
            channel,
            asking_price_cents: askingPriceCents,
            reserve_price_cents: reserveCents,
          });
          if (!res.success) throw new Error(res.error);
        }
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Action failed');
      } finally {
        setBusyFor(channel.id, false);
      }
    },
    [canList, exportFor, vehicleId, askingPriceCents, reserveCents, load, ars],
  );

  const grouped = useMemo(() => {
    const m = new Map<ChannelMechanism, ChannelDef[]>();
    for (const c of CHANNELS) {
      if (!m.has(c.mechanism)) m.set(c.mechanism, []);
      m.get(c.mechanism)!.push(c);
    }
    return m;
  }, []);

  const armedCount = exports.filter((e) => e.status !== 'cancelled').length;

  return (
    <div style={{ fontFamily: FONT_BODY }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={LABEL}>Sales Channels {armedCount > 0 ? `· ${armedCount} armed` : ''}</div>
        {onCompose && (
          <button
            type="button"
            onClick={onCompose}
            style={{ ...LABEL, fontSize: '8px', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', color: 'var(--text, #2a2a2a)' }}
          >
            Edit listing package
          </button>
        )}
      </div>

      {ars && (
        <div style={{ fontSize: '10px', color: 'var(--text-secondary, #666)', marginBottom: 10, lineHeight: 1.4 }}>
          Readiness <strong style={{ color: 'var(--text, #2a2a2a)' }}>{ars.composite_score ?? '—'}/100</strong>
          {ars.tier ? ` · ${tierShort(ars.tier)}` : ''} — the gate decides which channels you can arm.
          {ars.photo_zones_missing.length > 0 && (
            <span> Missing: {ars.photo_zones_missing.slice(0, 3).join(', ')}{ars.photo_zones_missing.length > 3 ? '…' : ''}.</span>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ ...LABEL, color: 'var(--text-secondary, #666)' }}>Loading channels…</div>
      ) : (
        MECHANISM_ORDER.filter((mech) => grouped.has(mech)).map((mech) => {
          const meta = MECHANISMS[mech];
          return (
            <div key={mech} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span style={{ ...BADGE, borderColor: meta.accentVar, color: meta.accentVar }}>{meta.badge}</span>
                <span style={{ ...LABEL, color: 'var(--text-secondary, #666)', fontWeight: 400, textTransform: 'none', fontSize: '10px' }}>
                  {meta.blurb}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {grouped.get(mech)!.map((channel) => {
                  const row = exportFor(channel);
                  const on = !!row;
                  const meta = (row?.metadata as any) || {};
                  const needs = meta.needs as string | undefined; // adapter credential blocker
                  const dispatch = meta.dispatch as string | undefined;
                  const ready = meetsReadiness(channel, ars?.tier);
                  const gated = !ready && channel.minReadiness !== 'any';
                  const pill = row ? STATUS_PILL[row.status] : null;
                  const toggleDisabled = !canList || (!on && !ready);
                  // Owner sign-offs still owed on an armed row (agent_pilot/concierge).
                  const humanKeys = (meta.job?.human_keys as string[] | undefined) ?? [];

                  // Reason line: armed shows the dispatch note; un-armed-but-gated shows the floor.
                  const reason = on
                    ? (dispatch || channel.note)
                    : gated
                      ? `Locked — needs ${readinessFloorLabel(channel)}`
                      : channel.note;

                  return (
                    <div
                      key={channel.id}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 10,
                        padding: '6px 8px',
                        border: '2px solid var(--border, #bdbdbd)',
                        background: on ? 'var(--surface-raised, #f7f7f5)' : 'transparent',
                        opacity: !on && gated ? 0.6 : 1,
                      }}
                    >
                      <Toggle on={on} busy={busy.has(channel.id)} disabled={toggleDisabled} onClick={() => void toggle(channel)} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text, #2a2a2a)' }}>{channel.label}</span>
                          {pill && (
                            <span style={{ ...BADGE, borderColor: pill.color, color: pill.color }}>{pill.text}</span>
                          )}
                          {on && needs && (
                            <span style={{ ...BADGE, borderColor: 'var(--accent-gulf, #1e6091)', color: 'var(--accent-gulf, #1e6091)' }}>
                              CONNECT
                            </span>
                          )}
                          {!on && gated && (
                            <span style={{ ...BADGE, borderColor: MUTED, color: MUTED }}>LOCKED</span>
                          )}
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--text-secondary, #666)', marginTop: 2 }}>
                          {channel.economics}
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--text-secondary, #888)', marginTop: 2, lineHeight: 1.4 }}>
                          {reason}
                        </div>
                        {on && canList && humanKeys.length > 0 && (
                          <div style={{ marginTop: 6, borderTop: '2px solid var(--border, #e5e5e5)', paddingTop: 4 }}>
                            <div style={{ ...LABEL, fontSize: '8px', marginBottom: 3 }}>Your sign-offs to finish</div>
                            {humanKeys.map((k) => (
                              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '10px', color: 'var(--text, #2a2a2a)', marginTop: 2 }}>
                                <span style={{ width: 8, height: 8, border: '2px solid var(--accent-papaya, #cc5803)', flexShrink: 0 }} />
                                {HUMAN_KEY_LABEL[k] ?? k}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}

      {error && (
        <div style={{ ...LABEL, color: 'var(--accent-papaya, #cc5803)', marginTop: 6 }}>{error}</div>
      )}

      {!canList && (
        <div style={{ ...LABEL, color: 'var(--text-secondary, #999)', fontWeight: 400, textTransform: 'none', fontSize: '10px', marginTop: 6 }}>
          Listing keys are held by the vehicle owner / lead contributor.
        </div>
      )}
    </div>
  );
};

export default ChannelSwitchboard;
