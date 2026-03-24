// generate-cut-list — Wire-by-wire bench document for harness building
// Input: vehicle_id
// Output: Sectioned cut list with wire purchase summary

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AWG_TABLE = [
  { gauge: 22, ohmsPerFt: 0.01614, maxAmps: 5 },
  { gauge: 20, ohmsPerFt: 0.01015, maxAmps: 7.5 },
  { gauge: 18, ohmsPerFt: 0.00639, maxAmps: 10 },
  { gauge: 16, ohmsPerFt: 0.00402, maxAmps: 15 },
  { gauge: 14, ohmsPerFt: 0.00253, maxAmps: 20 },
  { gauge: 12, ohmsPerFt: 0.00159, maxAmps: 25 },
  { gauge: 10, ohmsPerFt: 0.001, maxAmps: 35 },
  { gauge: 8, ohmsPerFt: 0.000628, maxAmps: 50 },
  { gauge: 6, ohmsPerFt: 0.000395, maxAmps: 65 },
  { gauge: 4, ohmsPerFt: 0.000249, maxAmps: 85 },
];

function selectGauge(amps: number, lengthFt: number): number {
  const effective = amps * 1.25;
  const maxDrop = 0.36; // 3% of 12V
  for (const e of AWG_TABLE) {
    const drop = effective * e.ohmsPerFt * lengthFt * 2;
    if (drop <= maxDrop && e.maxAmps >= effective) return e.gauge;
  }
  return 4;
}

const ZONE_LENGTHS: Record<string, number> = {
  engine_bay: 4, firewall: 2, dash: 3, doors: 6, rear: 16, underbody: 10, roof: 5,
};

const COLOR_MAP: Record<string, string> = {
  injector: 'GRN', ignition_coil: 'WHT', crank_cam: 'BLU/WHT',
  sensor_signal: 'VIO', temp_sensor: 'TAN', knock: 'GRY',
  o2_wideband: 'VIO/BLU', throttle_motor: 'ORG',
  can_high: 'WHT/GRN', headlight_high: 'LT GRN', headlight_low: 'TAN',
  tail_park: 'BRN', turn_left: 'LT BLU', turn_right: 'DK BLU',
  backup: 'LT GRN', horn: 'DK GRN', wiper: 'PPL',
  window_motor: 'DK BLU', lock_motor: 'BLK', accessory: 'ORN',
  pdm_high: 'RED/BLK', pdm_medium: 'ORN/BLK',
};

const STRIPES = ['', '/WHT', '/BLK', '/RED', '/BLU', '/YEL', '/VIO', '/ORG'];

function classifyDevice(d: any): string {
  if (d.device_name?.startsWith('Fuel Injector')) return 'injector';
  if (d.device_name?.startsWith('Ignition Coil')) return 'ignition_coil';
  if (d.device_name?.includes('Crank') || d.device_name?.includes('Cam')) return 'crank_cam';
  if (d.signal_type === 'analog_temp') return 'temp_sensor';
  if (d.signal_type === 'piezoelectric') return 'knock';
  if (d.signal_type === 'wideband_lambda') return 'o2_wideband';
  if (d.signal_type === 'h_bridge_motor') return 'throttle_motor';
  if (d.signal_type === 'can_bus') return 'can_high';
  if (d.signal_type === 'led_lighting') {
    if (d.device_name?.includes('Headlight')) return 'headlight_high';
    if (d.device_name?.includes('Tail')) return 'tail_park';
    if (d.device_name?.includes('Turn') && d.device_name?.includes('Left')) return 'turn_left';
    if (d.device_name?.includes('Turn')) return 'turn_right';
    return 'tail_park';
  }
  if (d.signal_type === 'motor') {
    if (d.device_name?.includes('Window')) return 'window_motor';
    if (d.device_name?.includes('Lock')) return 'lock_motor';
    if (d.device_name?.includes('Wiper')) return 'wiper';
    return 'pdm_medium';
  }
  if (d.signal_type === 'analog_5v') return 'sensor_signal';
  return 'accessory';
}

function classifySection(d: any): string {
  const n = d.device_name || '';
  const s = d.signal_type || '';
  if (n.includes('Injector') || n.includes('Coil') || n.includes('Crank') || n.includes('Cam') || n.includes('Knock') || n.includes('Throttle') || n.includes('MAP') || n.includes('Coolant') || n.includes('Oil') || n.includes('Intake') || n.includes('Fuel Pressure')) return 'ENGINE LOOM';
  if (n.includes('Headlight') || n.includes('Tail') || n.includes('Turn') || n.includes('Backup') || n.includes('Marker') || n.includes('Clearance') || n.includes('License') || n.includes('Park') || n.includes('Horn') || n.includes('Wiper') || n.includes('Washer') || n.includes('Brake Light')) return 'EXTERIOR / BODY';
  if (n.includes('Radio') || n.includes('Speaker') || n.includes('Amp') || n.includes('Sub')) return 'AUDIO';
  if (n.includes('Window') || n.includes('Lock') || n.includes('Door') || n.includes('Dome') || n.includes('Footwell') || n.includes('Dash') || n.includes('Gauge') || n.includes('Display') || n.includes('Lighter') || n.includes('USB') || n.includes('Blower')) return 'INTERIOR / DASH';
  if (n.includes('Fan') || n.includes('Fuel Pump') || n.includes('Water Pump') || n.includes('O2') || n.includes('Lambda') || n.includes('Speed Sensor') || n.includes('Parking Brake') || n.includes('AMP Research') || n.includes('Camera')) return 'CHASSIS / UNDERBODY';
  if (n.includes('CAN') || n.includes('Battery') || n.includes('Ground') || n.includes('Disconnect') || n.includes('Alternator') || n.includes('Starter')) return 'POWER / COMM';
  return 'MISC';
}

function suggestSpool(ft: number): number {
  if (ft <= 10) return 10;
  if (ft <= 25) return 25;
  if (ft <= 50) return 50;
  if (ft <= 100) return 100;
  return Math.ceil(ft / 100) * 100;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { vehicle_id, wire_tier = 'TXL', format = 'json' } = await req.json();
    if (!vehicle_id) return new Response(JSON.stringify({ error: "vehicle_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: devices } = await supabase.from("vehicle_build_manifest").select("*").eq("vehicle_id", vehicle_id).order("device_category");
    if (!devices?.length) return new Response(JSON.stringify({ error: "No manifest" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Load vehicle info
    const { data: vehicle } = await supabase.from("vehicles").select("year, make, model").eq("id", vehicle_id).single();
    const vehicleName = vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : vehicle_id;

    // ── Load ECU pin maps for precise references ──
    // Determine ECU model from I/O count (same logic as compute-wiring-overlay)
    const injCount = devices.filter((d: any) => d.device_name?.startsWith('Fuel Injector')).length;
    const ecuModel = injCount <= 8 ? 'M130' : injCount <= 12 ? 'M150' : 'M1';

    const { data: ecuPins } = await supabase.from("device_pin_maps")
      .select("pin_number, pin_function, signal_type")
      .eq("device_model", ecuModel)
      .order("connector_name").order("pin_number");

    // Build pin assignment trackers
    const injPins = (ecuPins || []).filter((p: any) => p.signal_type === 'injector_output')
      .sort((a: any, b: any) => (parseInt(a.pin_function.replace(/\D/g,''))||0) - (parseInt(b.pin_function.replace(/\D/g,''))||0));
    const ignPins = (ecuPins || []).filter((p: any) => p.signal_type === 'ignition_output')
      .sort((a: any, b: any) => (parseInt(a.pin_function.replace(/\D/g,''))||0) - (parseInt(b.pin_function.replace(/\D/g,''))||0));
    const avPins = (ecuPins || []).filter((p: any) => p.signal_type === 'analog_voltage_input');
    const atPins = (ecuPins || []).filter((p: any) => p.signal_type === 'analog_temp_input');
    const knockPins = (ecuPins || []).filter((p: any) => p.signal_type === 'knock_input');
    const crankPin = (ecuPins || []).find((p: any) => p.pin_function === 'UDIG1');
    const camPin = (ecuPins || []).find((p: any) => p.pin_function === 'UDIG2');

    let iInj = 0, iIgn = 0, iAv = 0, iAt = 0, iKnk = 0;

    // Pre-compute PDM channel assignments (same logic as compute-wiring-overlay)
    const pdmCandidates = devices.filter((d: any) =>
      d.pdm_controlled !== false && d.power_draw_amps > 0
      && d.signal_type !== 'power_source' && d.signal_type !== 'ground' && d.signal_type !== 'can_bus'
      && !d.device_name?.startsWith('Fuel Injector') && !d.device_name?.startsWith('Ignition Coil')
      && !d.device_name?.startsWith('Throttle Position'));

    // Group devices that share PDM channels
    const pdmGroupMap = new Map<string, number>(); // device_name → output number
    const groupTotals = new Map<string, { amps: number; members: string[] }>();
    const individualPDM: Array<{ name: string; amps: number }> = [];

    for (const d of pdmCandidates) {
      if (d.pdm_channel_group) {
        const g = groupTotals.get(d.pdm_channel_group) || { amps: 0, members: [] };
        g.amps += d.power_draw_amps || 0;
        g.members.push(d.device_name);
        groupTotals.set(d.pdm_channel_group, g);
      } else {
        individualPDM.push({ name: d.device_name, amps: d.power_draw_amps || 5 });
      }
    }
    for (const [groupName, g] of groupTotals) {
      individualPDM.push({ name: `[${groupName}]`, amps: g.amps });
    }
    // Sort by amps descending (heavy loads get low channel numbers)
    individualPDM.sort((a, b) => b.amps - a.amps);

    // Assign output numbers 1-30
    let pdmOut = 1;
    for (const entry of individualPDM) {
      if (pdmOut > 30) break;
      const outNum = pdmOut++;
      if (entry.name.startsWith('[')) {
        // Group — assign same output to all members
        const groupName = entry.name.slice(1, -1);
        const g = groupTotals.get(groupName);
        if (g) for (const member of g.members) pdmGroupMap.set(member, outNum);
      } else {
        pdmGroupMap.set(entry.name, outNum);
      }
    }

    function getFromRef(d: any): string {
      const n = d.device_name || '';
      // Check PDM assignment first
      const pdmCh = pdmGroupMap.get(n);
      if (pdmCh) return `PDM30:OUT${pdmCh}`;
      if (d.pdm_controlled && !n.startsWith('Fuel Injector') && !n.startsWith('Ignition Coil')) return 'PDM30';
      // ECU pin assignments
      if (n.startsWith('Fuel Injector') && iInj < injPins.length) return `${ecuModel}:${injPins[iInj++].pin_number}`;
      if (n.startsWith('Ignition Coil') && iIgn < ignPins.length) return `${ecuModel}:${ignPins[iIgn++].pin_number}`;
      if (n.includes('Crank') && crankPin) return `${ecuModel}:${crankPin.pin_number}`;
      if (n.includes('Cam') && camPin) return `${ecuModel}:${camPin.pin_number}`;
      if (n.includes('Knock') && iKnk < knockPins.length) return `${ecuModel}:${knockPins[iKnk++].pin_number}`;
      if (d.signal_type === 'analog_temp' && iAt < atPins.length) return `${ecuModel}:${atPins[iAt++].pin_number}`;
      if (d.signal_type === 'analog_5v' && iAv < avPins.length) return `${ecuModel}:${avPins[iAv++].pin_number}`;
      return 'ECU';
    }

    // Generate wires
    const wires: any[] = [];
    let wireNum = 1;
    const funcCounters: Record<string, number> = {};

    for (const d of devices) {
      if (!d.pin_count || d.pin_count === 0) continue;
      if (d.signal_type === 'ground' || d.signal_type === 'power_source') continue;

      const amps = d.power_draw_amps || 1;
      const len = (ZONE_LENGTHS[d.location_zone] || 5) * 1.15;
      const gauge = d.wire_gauge_recommended || selectGauge(amps, len);
      const func = classifyDevice(d);
      const idx = funcCounters[func] || 0;
      funcCounters[func] = idx + 1;
      const base = COLOR_MAP[func] || 'WHT';
      const color = idx === 0 ? base : base + (STRIPES[idx % STRIPES.length] || '');

      let spec = `${gauge} AWG ${wire_tier}`;
      const notes: string[] = [];
      if (d.requires_shielding) { spec = `${gauge} AWG SHIELDED 2C`; notes.push('2-conductor shielded cable'); }
      if (d.signal_type === 'can_bus') { spec = `${gauge} AWG TWISTED PAIR`; notes.push('120Ω termination each end'); }

      const section = classifySection(d);

      const fromRef = getFromRef(d);

      wires.push({
        wireNumber: wireNum++,
        label: d.device_name,
        from: fromRef,
        to: d.device_name,
        section,
        spec,
        gauge,
        color,
        lengthFt: Math.round(len * 10) / 10,
        isShielded: d.requires_shielding || false,
        isTwistedPair: d.signal_type === 'can_bus',
        notes: notes.join('. '),
      });
    }

    // Group by section
    const sectionMap = new Map<string, typeof wires>();
    for (const w of wires) {
      const list = sectionMap.get(w.section) || [];
      list.push(w);
      sectionMap.set(w.section, list);
    }

    const sectionOrder = ['ENGINE LOOM', 'EXTERIOR / BODY', 'INTERIOR / DASH', 'CHASSIS / UNDERBODY', 'AUDIO', 'POWER / COMM', 'MISC'];
    const sections = sectionOrder
      .filter(s => sectionMap.has(s))
      .map(s => ({
        section: s,
        wires: sectionMap.get(s)!.sort((a: any, b: any) => a.wireNumber - b.wireNumber),
        totalLengthFt: Math.round(sectionMap.get(s)!.reduce((sum: number, w: any) => sum + w.lengthFt, 0) * 10) / 10,
      }));

    // Wire purchase summary
    const gaugeGroups = new Map<string, { gauge: number; totalFt: number; colors: Set<string>; shielded: boolean; twisted: boolean }>();
    for (const w of wires) {
      const key = w.isShielded ? `${w.gauge}-S` : w.isTwistedPair ? `${w.gauge}-T` : `${w.gauge}`;
      const g = gaugeGroups.get(key) || { gauge: w.gauge, totalFt: 0, colors: new Set(), shielded: false, twisted: false };
      g.totalFt += w.lengthFt;
      g.colors.add(w.color);
      if (w.isShielded) g.shielded = true;
      if (w.isTwistedPair) g.twisted = true;
      gaugeGroups.set(key, g);
    }

    const purchaseSummary = Array.from(gaugeGroups.values()).map(g => ({
      gauge: g.gauge,
      totalLengthFt: Math.round(g.totalFt),
      suggestedSpoolFt: suggestSpool(g.totalFt),
      colorCount: g.colors.size,
      colors: Array.from(g.colors).sort(),
      isShielded: g.shielded,
      isTwistedPair: g.twisted,
    })).sort((a, b) => a.gauge - b.gauge);

    const result = {
      title: `CUT LIST — ${vehicleName}`,
      generatedAt: new Date().toISOString(),
      wireTier: wire_tier,
      totalWires: wires.length,
      totalLengthFt: Math.round(wires.reduce((s: number, w: any) => s + w.lengthFt, 0)),
      shieldedWires: wires.filter((w: any) => w.isShielded).length,
      twistedPairs: wires.filter((w: any) => w.isTwistedPair).length,
      sections,
      purchaseSummary,
    };

    if (format === 'text') {
      // Plain text for printing
      const lines: string[] = [];
      lines.push(result.title);
      lines.push(`Generated: ${new Date().toLocaleDateString()} | ${wire_tier} tier`);
      lines.push(`${result.totalWires} wires | ${result.totalLengthFt} ft total | ${result.shieldedWires} shielded | ${result.twistedPairs} twisted pair`);
      lines.push('='.repeat(90));
      for (const sec of sections) {
        lines.push('');
        lines.push(`>> ${sec.section} (${sec.wires.length} wires, ${sec.totalLengthFt} ft)`);
        lines.push('-'.repeat(90));
        lines.push(`${'#'.padEnd(5)}${'LABEL'.padEnd(32)}${'FROM'.padEnd(14)}${'SPEC'.padEnd(22)}${'COLOR'.padEnd(12)}${'LENGTH'.padEnd(8)}NOTES`);
        for (const w of sec.wires) {
          lines.push(`${('#' + w.wireNumber).padEnd(5)}${w.label.slice(0, 30).padEnd(32)}${(w.from || '').slice(0, 12).padEnd(14)}${w.spec.padEnd(22)}${w.color.padEnd(12)}${(w.lengthFt + 'ft').padEnd(8)}${w.notes}`);
        }
      }
      lines.push('');
      lines.push('='.repeat(90));
      lines.push('WIRE PURCHASE SUMMARY');
      lines.push('-'.repeat(90));
      for (const p of purchaseSummary) {
        const type = p.isShielded ? 'SHIELDED' : p.isTwistedPair ? 'TWISTED PAIR' : wire_tier;
        lines.push(`${p.gauge} AWG ${type}: ${p.totalLengthFt}ft needed -> order ${p.suggestedSpoolFt}ft (${p.colorCount} colors)`);
      }

      return new Response(lines.join('\n'), { headers: { ...corsHeaders, "Content-Type": "text/plain" } });
    }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
