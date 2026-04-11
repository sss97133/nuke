import React, { useState, useMemo, useCallback } from 'react';
import { useBuildProfile, type ManifestDevice } from './hooks/useBuildProfile';
import { useQueryClient } from '@tanstack/react-query';
import { CollapsibleWidget } from '../../components/ui/CollapsibleWidget';
import { supabase } from '../../lib/supabase';

interface Props {
  vehicleId: string;
}

const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const WIRE_STEPS = ['not_started', 'wire_cut', 'terminated', 'installed', 'tested', 'verified'] as const;
type WireStatus = typeof WIRE_STEPS[number];

const WIRE_STEP_LABELS: Record<string, string> = {
  not_started: 'NOT STARTED',
  wire_cut: 'CUT',
  terminated: 'TERMINATED',
  installed: 'INSTALLED',
  tested: 'TESTED',
  verified: 'VERIFIED',
};

const WIRE_STEP_COLORS: Record<string, string> = {
  not_started: 'var(--vp-pencil, #888)',
  wire_cut: 'var(--vp-gulf-orange, #f48024)',
  terminated: '#c49000',
  installed: 'var(--vp-gulf-blue, #001f5b)',
  tested: '#2e7d32',
  verified: 'var(--vp-brg, #006847)',
};

const INTEGRATION_COLORS: Record<string, string> = {
  KEEP: 'var(--vp-brg, #006847)',
  REPLACE: 'var(--vp-martini-red, #c62828)',
  NEW: 'var(--vp-gulf-blue, #001f5b)',
  SPLICE: 'var(--vp-gulf-orange, #f48024)',
};

const ZONE_LABELS: Record<string, string> = {
  engine_bay: 'ENGINE',
  dash: 'DASH',
  doors: 'DOORS',
  rear: 'REAR',
  underbody: 'UNDER',
  firewall: 'F/WALL',
  roof: 'ROOF',
};

type GroupBy = 'zone' | 'category' | 'wire_status' | 'integration';

const BuildTimelineChart = React.lazy(() => import('./BuildTimelineChart'));

const BuildManifestPanel: React.FC<Props> = ({ vehicleId }) => {
  const { manifest, manifestStats, snapshots, loading } = useBuildProfile(vehicleId);
  const queryClient = useQueryClient();
  const [groupBy, setGroupBy] = useState<GroupBy>('zone');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['engine_bay', 'dash']));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState<string | null>(null);

  // Group devices
  const grouped = useMemo(() => {
    if (!manifest || !Array.isArray(manifest)) return {};
    let list = manifest;
    if (filter) {
      const f = filter.toLowerCase();
      list = list.filter(d =>
        d.device_name.toLowerCase().includes(f) ||
        (d.device_category || '').toLowerCase().includes(f) ||
        (d.location_zone || '').toLowerCase().includes(f) ||
        (d.signal_type || '').toLowerCase().includes(f)
      );
    }
    const groups: Record<string, ManifestDevice[]> = {};
    for (const d of list) {
      let key: string;
      switch (groupBy) {
        case 'zone': key = d.location_zone || 'unknown'; break;
        case 'category': key = d.device_category || 'other'; break;
        case 'wire_status': key = d.wire_status || 'not_started'; break;
        case 'integration': key = d.integration_decision || 'NONE'; break;
        default: key = 'all';
      }
      if (!groups[key]) groups[key] = [];
      groups[key].push(d);
    }
    return groups;
  }, [manifest, groupBy, filter]);

  // Wire status progress
  const wireProgress = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of WIRE_STEPS) counts[s] = 0;
    if (!manifest) return counts;
    for (const d of manifest) counts[d.wire_status || 'not_started']++;
    return counts;
  }, [manifest]);

  // Integration summary
  const integrationCounts = useMemo(() => {
    const c: Record<string, number> = { KEEP: 0, REPLACE: 0, NEW: 0, SPLICE: 0 };
    if (!manifest) return c;
    for (const d of manifest) {
      const dec = d.integration_decision || 'NEW';
      c[dec] = (c[dec] || 0) + 1;
    }
    return c;
  }, [manifest]);

  // Update wire status
  const updateWireStatus = useCallback(async (deviceId: string, newStatus: WireStatus) => {
    setSaving(deviceId);
    await supabase
      .from('vehicle_build_manifest')
      .update({ wire_status: newStatus })
      .eq('id', deviceId);
    queryClient.invalidateQueries({ queryKey: ['build-profile', vehicleId] });
    setSaving(null);
  }, [vehicleId, queryClient]);

  // Advance wire status to next step
  const advanceWireStatus = useCallback((device: ManifestDevice) => {
    const current = device.wire_status || 'not_started';
    const idx = WIRE_STEPS.indexOf(current as WireStatus);
    if (idx < WIRE_STEPS.length - 1) {
      updateWireStatus(device.id, WIRE_STEPS[idx + 1]);
    }
  }, [updateWireStatus]);

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const selectedDevice = selectedId && manifest ? manifest.find(d => d.id === selectedId) : null;

  if (loading || !manifest || manifestStats.total === 0) return null;

  const totalAmps = manifest.reduce((s, d) => s + (d.power_draw_amps || 0), 0);
  const blockerCount = manifest.filter(d => d.open_questions).length;

  return (
    <>
      <CollapsibleWidget variant="profile" title="Build Workspace" defaultCollapsed={false}
        badge={<span className="widget__count">{manifest.length} DEVICES</span>}
      >
        <div style={{ fontFamily: 'var(--vp-font-sans)', fontSize: '9px' }}>

          {/* ── Progress Bar ── */}
          <div style={{ marginBottom: '8px' }}>
            <div style={{ display: 'flex', height: '6px', border: '1px solid var(--vp-border)' }}>
              {WIRE_STEPS.map(step => {
                const count = wireProgress[step];
                if (!count) return null;
                const pct = (count / manifest.length) * 100;
                return (
                  <div key={step} style={{
                    width: `${pct}%`,
                    background: WIRE_STEP_COLORS[step],
                  }} title={`${WIRE_STEP_LABELS[step]}: ${count}`} />
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '3px', flexWrap: 'wrap' }}>
              {WIRE_STEPS.map(step => {
                const count = wireProgress[step];
                if (!count) return null;
                return (
                  <span key={step} style={{ fontSize: '7px', fontFamily: 'var(--vp-font-mono)', color: WIRE_STEP_COLORS[step], fontWeight: 700 }}>
                    {WIRE_STEP_LABELS[step]} {count}
                  </span>
                );
              })}
            </div>
          </div>

          {/* ── Stats Row ── */}
          <div style={{
            display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '6px',
            padding: '4px 6px', border: '1px solid var(--vp-border)',
          }}>
            {Object.entries(integrationCounts).filter(([,v]) => v > 0).map(([k, v]) => (
              <span key={k} style={{ fontSize: '7px', fontWeight: 700, letterSpacing: '0.08em', color: INTEGRATION_COLORS[k] || 'var(--vp-pencil)' }}>
                {k} {v}
              </span>
            ))}
            <span style={{ marginLeft: 'auto', fontSize: '7px', fontFamily: 'var(--vp-font-mono)', color: 'var(--vp-pencil)' }}>
              {Math.round(totalAmps)}A
            </span>
            {blockerCount > 0 && (
              <span style={{ fontSize: '7px', fontWeight: 700, color: 'var(--vp-martini-red, #c62828)' }}>
                {blockerCount} BLOCKED
              </span>
            )}
          </div>

          {/* ── Toolbar: Group By + Filter ── */}
          <div style={{ display: 'flex', gap: '4px', marginBottom: '6px', alignItems: 'center' }}>
            {(['zone', 'category', 'wire_status', 'integration'] as GroupBy[]).map(g => (
              <button key={g} onClick={() => setGroupBy(g)} style={{
                fontSize: '7px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                padding: '2px 6px', cursor: 'pointer', border: '1px solid var(--vp-border)',
                background: groupBy === g ? 'var(--vp-ink, #222)' : 'transparent',
                color: groupBy === g ? 'var(--vp-paper, #fff)' : 'var(--vp-pencil)',
              }}>
                {g.replace('_', ' ')}
              </button>
            ))}
            <input
              type="text"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="FILTER..."
              style={{
                marginLeft: 'auto', fontSize: '8px', fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.05em', padding: '2px 6px', border: '1px solid var(--vp-border)',
                background: 'transparent', color: 'var(--vp-ink)', outline: 'none',
                fontFamily: 'var(--vp-font-sans)', width: '100px',
              }}
            />
          </div>

          {/* ── Device Groups ── */}
          {Object.keys(grouped).sort().map(key => {
            const devices = grouped[key];
            const isExpanded = expandedGroups.has(key);
            const groupLabel = groupBy === 'zone' ? (ZONE_LABELS[key] || key.toUpperCase().replace(/_/g, ' '))
              : groupBy === 'wire_status' ? (WIRE_STEP_LABELS[key] || key.toUpperCase())
              : key.toUpperCase().replace(/_/g, ' ');
            const groupAmps = devices.reduce((s, d) => s + (d.power_draw_amps || 0), 0);
            const groupDone = devices.filter(d => d.wire_status === 'verified' || d.wire_status === 'tested').length;

            return (
              <div key={key} style={{ marginBottom: '2px' }}>
                <div
                  onClick={() => toggleGroup(key)}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '3px 6px', cursor: 'pointer',
                    border: '2px solid var(--vp-border)',
                    background: isExpanded ? 'var(--vp-bg-alt, #fafafa)' : 'transparent',
                    userSelect: 'none',
                  }}
                >
                  <span style={{ fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {isExpanded ? '\u25BE' : '\u25B8'} {groupLabel}
                  </span>
                  <span style={{ fontFamily: 'var(--vp-font-mono)', fontSize: '7px', color: 'var(--vp-pencil)' }}>
                    {groupDone}/{devices.length}
                    {groupAmps > 0 ? ` \u00B7 ${Math.round(groupAmps)}A` : ''}
                  </span>
                </div>
                {isExpanded && (
                  <div style={{ borderLeft: '2px solid var(--vp-border)', borderRight: '2px solid var(--vp-border)', borderBottom: '2px solid var(--vp-border)' }}>
                    {devices.map(d => {
                      const ws = d.wire_status || 'not_started';
                      const isSelected = d.id === selectedId;
                      const isSaving = saving === d.id;
                      return (
                        <div key={d.id}>
                          <div
                            onClick={() => setSelectedId(isSelected ? null : d.id)}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '4px 1fr auto auto auto',
                              gap: '2px 4px',
                              alignItems: 'center',
                              padding: '3px 6px',
                              borderBottom: isSelected ? 'none' : '1px solid var(--vp-bg-alt, #f0f0f0)',
                              fontSize: '8px',
                              cursor: 'pointer',
                              background: isSelected ? 'var(--vp-bg-alt, #f5f5f5)' : undefined,
                            }}
                          >
                            {/* Wire status dot */}
                            <span style={{
                              display: 'inline-block', width: '4px', height: '4px',
                              background: WIRE_STEP_COLORS[ws], flexShrink: 0,
                            }} />

                            {/* Device name */}
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
                              {d.device_name}
                            </span>

                            {/* Integration decision badge */}
                            {d.integration_decision && (
                              <span style={{
                                fontSize: '6px', fontWeight: 700, padding: '0 3px',
                                letterSpacing: '0.08em', border: `1px solid ${INTEGRATION_COLORS[d.integration_decision] || 'var(--vp-pencil)'}`,
                                color: INTEGRATION_COLORS[d.integration_decision] || 'var(--vp-pencil)',
                                fontFamily: 'var(--vp-font-mono)',
                              }}>
                                {d.integration_decision}
                              </span>
                            )}

                            {/* Wire status — clickable to advance */}
                            <span
                              onClick={(e) => { e.stopPropagation(); advanceWireStatus(d); }}
                              title={`Click to advance: ${WIRE_STEP_LABELS[ws]} \u2192 next`}
                              style={{
                                fontSize: '6px', fontWeight: 700, padding: '1px 4px',
                                letterSpacing: '0.08em', cursor: 'pointer',
                                border: `1px solid ${WIRE_STEP_COLORS[ws]}`,
                                color: WIRE_STEP_COLORS[ws],
                                fontFamily: 'var(--vp-font-mono)',
                                opacity: isSaving ? 0.4 : 1,
                              }}
                            >
                              {isSaving ? '...' : WIRE_STEP_LABELS[ws]}
                            </span>

                            {/* Price */}
                            <span style={{ fontFamily: 'var(--vp-font-mono)', textAlign: 'right', minWidth: '32px', color: 'var(--vp-pencil)' }}>
                              {d.price != null ? fmt(d.price) : ''}
                            </span>
                          </div>

                          {/* Expanded detail row */}
                          {isSelected && (
                            <div style={{
                              padding: '4px 6px 6px 14px',
                              borderBottom: '1px solid var(--vp-bg-alt, #f0f0f0)',
                              background: 'var(--vp-bg-alt, #f5f5f5)',
                              fontSize: '8px', lineHeight: '1.6',
                            }}>
                              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '1px 10px' }}>
                                {d.manufacturer && <><Label>MFR</Label><span>{d.manufacturer}{d.model_number ? ` ${d.model_number}` : ''}</span></>}
                                {d.part_number && <><Label>PART</Label><span style={{ fontFamily: 'var(--vp-font-mono)' }}>{d.part_number}</span></>}
                                {d.signal_type && <><Label>SIGNAL</Label><span>{d.signal_type.replace(/_/g, ' ')}</span></>}
                                {d.connector_type && <><Label>CONNECTOR</Label><span>{d.connector_type.replace(/_/g, ' ')}</span></>}
                                {d.pin_count != null && <><Label>PINS</Label><span>{d.pin_count}</span></>}
                                {d.power_draw_amps != null && d.power_draw_amps > 0 && <><Label>AMPS</Label><span>{d.power_draw_amps}A{d.wire_gauge_recommended ? ` / ${d.wire_gauge_recommended} AWG` : ''}</span></>}
                                {d.pdm_controlled && <><Label>PDM</Label><span>{d.pdm_channel_group?.startsWith('pdm15:') ? 'PDM15' : 'PDM30'}{d.pdm_channel_group ? ` (${d.pdm_channel_group.replace('pdm15:', '')})` : ''}</span></>}
                                {d.location_zone && groupBy !== 'zone' && <><Label>ZONE</Label><span>{d.location_zone.replace(/_/g, ' ').toUpperCase()}</span></>}
                              </div>

                              {d.notes && (
                                <div style={{ marginTop: '4px', color: 'var(--vp-pencil)', fontSize: '7px', lineHeight: '1.5' }}>
                                  {d.notes.length > 200 ? d.notes.slice(0, 200) + '...' : d.notes}
                                </div>
                              )}

                              {d.open_questions && (
                                <div style={{ marginTop: '4px', padding: '2px 4px', border: '1px solid var(--vp-martini-red, #c62828)', fontSize: '7px', color: 'var(--vp-martini-red, #c62828)' }}>
                                  BLOCKER: {d.open_questions}
                                </div>
                              )}

                              {/* Wire status stepper */}
                              <div style={{ display: 'flex', gap: '2px', marginTop: '6px' }}>
                                {WIRE_STEPS.map(step => {
                                  const isCurrent = ws === step;
                                  const stepIdx = WIRE_STEPS.indexOf(step);
                                  const currentIdx = WIRE_STEPS.indexOf(ws as WireStatus);
                                  const isPast = stepIdx < currentIdx;
                                  return (
                                    <button
                                      key={step}
                                      onClick={() => updateWireStatus(d.id, step)}
                                      disabled={isSaving}
                                      style={{
                                        fontSize: '6px', fontWeight: 700, padding: '2px 4px',
                                        letterSpacing: '0.06em', cursor: isSaving ? 'wait' : 'pointer',
                                        border: `1px solid ${isCurrent ? WIRE_STEP_COLORS[step] : 'var(--vp-border)'}`,
                                        background: isPast || isCurrent ? WIRE_STEP_COLORS[step] : 'transparent',
                                        color: isPast || isCurrent ? '#fff' : 'var(--vp-pencil)',
                                        fontFamily: 'var(--vp-font-mono)',
                                      }}
                                    >
                                      {WIRE_STEP_LABELS[step]}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CollapsibleWidget>

      {snapshots.length > 0 && (
        <CollapsibleWidget variant="profile" title="Build Timeline" defaultCollapsed={true}
          badge={<span className="widget__count">{snapshots.length} MONTHS</span>}
        >
          <React.Suspense fallback={null}>
            <BuildTimelineChart snapshots={snapshots} />
          </React.Suspense>
        </CollapsibleWidget>
      )}
    </>
  );
};

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.08em',
      fontSize: '7px', fontWeight: 700,
    }}>
      {children}
    </span>
  );
}

export default BuildManifestPanel;
