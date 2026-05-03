// Place.tsx — Minimal "toddler-mode" placement workspace.
// Routes: /vehicle/:vehicleId/place
//
// Single page. Single canvas. Single device card.
// Goal: place every device on the K5 silhouette, in build order, with zero
// distractions.
//
// Compared to /wiring (which has 8 tabs and a detail panel), this is a
// dedicated focused tool — like the Pomodoro of harness placement.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { TOP_DOWN } from '../components/wiring/vehicleSilhouettes';

type Device = {
  id: string;
  device_name: string;
  manufacturer: string | null;
  part_number: string | null;
  pos_x_pct: number | null;
  pos_y_pct: number | null;
  device_category: string | null;
};

// Build order — first match wins. From K5_PLACEMENT_LOG.md
const BUILD_STEPS: Array<{ match: RegExp; label: string; hint: string }> = [
  { match: /^battery$/i,                  label: '1. Battery',                hint: 'Source of power. Factory K5: passenger fender well.' },
  { match: /battery disconnect/i,         label: '2. Battery Disconnect',     hint: 'Inline on negative cable, ~6" off battery (-) terminal.' },
  { match: /alternator/i,                 label: '3. Alternator',             hint: 'Engine accessory bracket (front-left of LS3).' },
  { match: /star ground|^body ground/i,   label: '4. Star Ground Point',      hint: 'Single ground busbar on cab firewall, driver side.' },
  { match: /bulkhead|d38999/i,            label: '5. Firewall Bulkhead',      hint: 'H3 grommet on firewall driver side.' },
  { match: /^ECU$/i,                      label: '6. ECU (M150)',             hint: 'Under dash, driver side, behind kick panel.' },
  { match: /Power Distribution Module \(Secondary\)/i, label: '7. PDM15 (rear)',  hint: 'Behind passenger seat or rear cargo area.' },
  { match: /Power Distribution Module/i,  label: '8. PDM30 (primary)',        hint: 'Under dash near ECU.' },
  { match: /Throttle Body/i,              label: '9. Throttle Body',          hint: 'On intake manifold throat.' },
  { match: /Accelerator Pedal/i,          label: '10. Accelerator Pedal',     hint: 'Floor pan, driver side.' },
  { match: /Ignition Coil/i,              label: '11. Ignition Coils',        hint: 'Valve cover or central mount. 8 coils.' },
  { match: /Fuel Injector/i,              label: '12. Fuel Injectors',        hint: 'In intake runners, 4 per bank.' },
  { match: /Crank Position|Cam Position/i,label: '13. CKP / CMP sensors',     hint: 'CKP at flywheel; CMP at front of cam.' },
  { match: /MAP Sensor/i,                 label: '14. MAP Sensor',            hint: 'On intake manifold (front for Gen V truck).' },
  { match: /Coolant Temp/i,               label: '15. Coolant Temp',          hint: 'In cylinder head water passage.' },
  { match: /Knock Sensor/i,               label: '16. Knock Sensors',         hint: 'In valley, under intake. 2 sensors.' },
  { match: /Wideband|LSU/i,               label: '17. Wideband O2',           hint: 'Bung in exhaust collector.' },
  { match: /iBooster/i,                   label: '18. iBooster',              hint: 'Replaces brake booster, mounts to firewall.' },
  { match: /Cluster|VHX|Dakota/i,         label: '19. Cluster',               hint: 'Dash binnacle.' },
  { match: /Head Unit|Hermosa/i,          label: '20. Head Unit',             hint: 'Center dash radio bay.' },
  { match: /Headlight$/i,                 label: '21. Headlights',            hint: 'Front buckets, driver + passenger.' },
  { match: /Tail Light/i,                 label: '22. Tail Lights',           hint: 'Rear quarter panels.' },
  { match: /Fuel Pump/i,                  label: '23. Fuel Pump',             hint: 'In tank or external near fuel cell.' },
  { match: /Window Switch|Power Window/i, label: '24. Windows',               hint: 'In each door.' },
  { match: /Lock/i,                       label: '25. Door Locks',            hint: 'In each door.' },
  { match: /Speaker|Subwoofer|Amplifier/i,label: '26. Audio',                 hint: 'Amp in cargo, speakers in doors + rear.' },
  { match: /Camera/i,                     label: '27. Camera',                hint: 'Rear bumper / tailgate.' },
  { match: /Trailer/i,                    label: '28. Trailer Connector',     hint: 'Rear bumper / hitch.' },
];

export default function Place() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);

  // Load manifest
  useEffect(() => {
    if (!vehicleId) return;
    (async () => {
      const { data, error } = await supabase
        .from('vehicle_build_manifest')
        .select('id, device_name, manufacturer, part_number, pos_x_pct, pos_y_pct, device_category')
        .eq('vehicle_id', vehicleId);
      if (error) {
        console.error('manifest load failed', error);
      } else {
        setDevices((data as Device[]) || []);
      }
      setLoading(false);
    })();
  }, [vehicleId]);

  // Find next device in build order without a position
  const queue = useMemo(() => {
    const out: Array<{ device: Device; step: typeof BUILD_STEPS[number] }> = [];
    for (const step of BUILD_STEPS) {
      const matches = devices.filter(
        d => step.match.test(d.device_name) && (d.pos_x_pct == null || d.pos_y_pct == null)
      );
      for (const m of matches) out.push({ device: m, step });
    }
    return out;
  }, [devices]);

  const current = queue[0];
  const placed = devices.filter(d => d.pos_x_pct != null && d.pos_y_pct != null);

  // Click-to-place handler
  const handleSvgClick = async (e: React.MouseEvent<SVGSVGElement>) => {
    if (!current || !svgRef.current) return;
    const pt = svgRef.current.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) return;
    const local = pt.matrixTransform(ctm.inverse());
    // K5 silhouette is 1000×1000 viewBox
    const x_pct = Math.max(0, Math.min(100, (local.x / 1000) * 100));
    const y_pct = Math.max(0, Math.min(100, (local.y / 1000) * 100));
    // Optimistic update
    setDevices(prev => prev.map(d => d.id === current.device.id ? { ...d, pos_x_pct: x_pct, pos_y_pct: y_pct } : d));
    // Persist
    const { error } = await supabase
      .from('vehicle_build_manifest')
      .update({ pos_x_pct: x_pct, pos_y_pct: y_pct })
      .eq('id', current.device.id);
    if (error) {
      console.error('placement save failed', error);
    }
  };

  const handleSkip = () => {
    if (!current) return;
    // Move current to end of queue locally — won't change DB, just hides for this session
    setDevices(prev => prev.map(d =>
      d.id === current.device.id ? { ...d, _skipped: true } as any : d
    ));
  };

  const handleResetCurrent = async () => {
    if (!current) return;
    setDevices(prev => prev.map(d => d.id === current.device.id ? { ...d, pos_x_pct: null, pos_y_pct: null } : d));
    await supabase.from('vehicle_build_manifest')
      .update({ pos_x_pct: null, pos_y_pct: null })
      .eq('id', current.device.id);
  };

  if (loading) return <div style={loadingStyle}>loading…</div>;

  return (
    <div style={pageStyle}>
      {/* Header: just count, no clutter */}
      <div style={headerStyle}>
        <div>K5 PLACEMENT</div>
        <div style={{ color: '#888' }}>{placed.length} placed · {queue.length} remaining</div>
      </div>

      {/* Canvas */}
      <div style={canvasContainerStyle}>
        <svg
          ref={svgRef}
          viewBox="0 0 1000 1000"
          style={{ width: '100%', height: '100%', cursor: current ? 'crosshair' : 'default' }}
          onClick={handleSvgClick}
        >
          {/* Body shell */}
          {TOP_DOWN.layers.filter(l => l.id === 'body').map(layer => (
            <g key={layer.id}>
              {layer.paths.map((p, i) => (
                <path key={i} d={p.d as string} fill={p.fill as string} fillOpacity={0.15} stroke="#666" strokeWidth={1.5} />
              ))}
            </g>
          ))}
          {/* Frame rails (light) */}
          {TOP_DOWN.layers.filter(l => l.id === 'frame').map(layer => (
            <g key={layer.id} opacity={0.3}>
              {layer.paths.map((p, i) => (
                <path key={i} d={p.d as string} fill={p.fill as string} />
              ))}
            </g>
          ))}
          {/* Already-placed devices: small dots, dimmed */}
          {placed.map(d => (
            <g key={d.id} transform={`translate(${(d.pos_x_pct! / 100) * 1000} ${(d.pos_y_pct! / 100) * 1000})`}>
              <circle r={6} fill="#22c55e" opacity={0.5} />
              <text x={10} y={4} fontSize={10} fill="#888" fontFamily="Arial">{d.device_name.slice(0, 18)}</text>
            </g>
          ))}
          {/* Current device: big highlighted target appears wherever they last hovered? */}
        </svg>
      </div>

      {/* Single-device card overlay (top right) */}
      {current ? (
        <div style={cardStyle}>
          <div style={cardLabel}>{current.step.label}</div>
          <div style={cardName}>{current.device.device_name}</div>
          <div style={cardPart}>
            {current.device.manufacturer || '—'} {current.device.part_number || ''}
          </div>
          <div style={cardHint}>{current.step.hint}</div>
          <div style={cardActions}>
            <div style={cardClickPrompt}>↳ click on the K5 to place</div>
            <button style={skipBtn} onClick={handleSkip}>Skip</button>
          </div>
        </div>
      ) : (
        <div style={cardStyle}>
          <div style={{ color: '#22c55e', fontSize: 18, fontWeight: 700 }}>✓ ALL PLACED</div>
          <div style={{ color: '#888', fontSize: 12, marginTop: 6 }}>
            {placed.length} devices have positions. Switch to /wiring to run wires between them.
          </div>
        </div>
      )}

      {/* Footer: tiny reset link */}
      {current && (
        <div style={footerStyle}>
          <button style={resetBtn} onClick={handleResetCurrent}>↺ undo last placement</button>
        </div>
      )}
    </div>
  );
}

// Styles — clean, minimal, single-task
const pageStyle: React.CSSProperties = {
  position: 'fixed', inset: 0,
  background: '#0a0a14',
  color: '#e0e0e8',
  fontFamily: 'Arial, sans-serif',
};
const loadingStyle: React.CSSProperties = {
  ...pageStyle, display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const headerStyle: React.CSSProperties = {
  position: 'absolute', top: 0, left: 0, right: 0, height: 40,
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '0 20px',
  fontSize: 11, letterSpacing: 1, fontWeight: 600,
  borderBottom: '1px solid #2a2a5e',
};
const canvasContainerStyle: React.CSSProperties = {
  position: 'absolute', top: 40, bottom: 40, left: 0, right: 0,
};
const cardStyle: React.CSSProperties = {
  position: 'absolute', top: 60, right: 20,
  width: 320,
  background: 'rgba(22, 33, 62, 0.95)',
  border: '2px solid #6c8cff',
  padding: 16,
  fontSize: 12,
};
const cardLabel: React.CSSProperties = {
  fontSize: 9, letterSpacing: 0.8, color: '#6c8cff', marginBottom: 6,
};
const cardName: React.CSSProperties = {
  fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 4,
};
const cardPart: React.CSSProperties = {
  fontSize: 10, color: '#aaa', fontFamily: 'Courier New, monospace', marginBottom: 12,
};
const cardHint: React.CSSProperties = {
  fontSize: 12, color: '#cce', lineHeight: 1.5, marginBottom: 14,
};
const cardActions: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
};
const cardClickPrompt: React.CSSProperties = {
  fontSize: 10, color: '#6c8cff', letterSpacing: 0.5,
};
const skipBtn: React.CSSProperties = {
  background: 'transparent', color: '#888', border: '1px solid #2a2a5e',
  padding: '6px 10px', fontSize: 10, letterSpacing: 0.5, cursor: 'pointer',
};
const footerStyle: React.CSSProperties = {
  position: 'absolute', bottom: 0, left: 0, right: 0, height: 40,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderTop: '1px solid #2a2a5e',
};
const resetBtn: React.CSSProperties = {
  background: 'transparent', color: '#888', border: 'none',
  fontSize: 10, letterSpacing: 0.5, cursor: 'pointer',
};
