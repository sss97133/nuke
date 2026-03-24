// generateCutList.ts — Produces a wire-by-wire bench document from overlay result
// This is what gets printed and taken to the wire bench.

import type { WireSpec, OverlayResult } from './overlayCompute';

export interface CutListEntry {
  wireNumber: number;
  label: string;
  from: string;
  to: string;
  spec: string;      // "18 AWG TXL" or "22 AWG SHIELDED 2C"
  gauge: number;
  color: string;
  lengthFt: number;
  isShielded: boolean;
  isTwistedPair: boolean;
  notes: string;
}

export interface CutListSection {
  section: string;
  wires: CutListEntry[];
  totalLengthFt: number;
}

export interface WirePurchaseSummary {
  gauge: number;
  totalLengthFt: number;
  suggestedSpoolFt: number;
  colors: string[];
  isShielded: boolean;
  isTwistedPair: boolean;
}

export interface CutListDocument {
  title: string;
  generatedAt: string;
  totalWires: number;
  totalLengthFt: number;
  sections: CutListSection[];
  purchaseSummary: WirePurchaseSummary[];
  shieldedWires: CutListEntry[];
  twistedPairs: CutListEntry[];
}

// Standard spool sizes
function suggestSpool(totalFt: number): number {
  if (totalFt <= 10) return 10;
  if (totalFt <= 25) return 25;
  if (totalFt <= 50) return 50;
  if (totalFt <= 100) return 100;
  if (totalFt <= 250) return 250;
  if (totalFt <= 500) return 500;
  return Math.ceil(totalFt / 100) * 100;
}

export function generateCutList(result: OverlayResult, wireTier = 'TXL'): CutListDocument {
  // Convert wires to cut list entries
  const entries: CutListEntry[] = result.wires.map(w => {
    let spec = `${w.gauge} AWG ${wireTier}`;
    const notes: string[] = [];
    if (w.isShielded) { spec = `${w.gauge} AWG SHIELDED 2C`; notes.push('Order as 2-conductor shielded cable'); }
    if (w.isTwistedPair) { spec = `${w.gauge} AWG TWISTED PAIR`; notes.push('Twisted pair with 120Ω termination'); }
    if (w.pdmChannel) notes.push(`PDM Ch${w.pdmChannel}`);
    if (w.fuseRating) notes.push(`Fuse: ${w.fuseRating}A`);

    return {
      wireNumber: w.wireNumber,
      label: w.label,
      from: w.from,
      to: w.to,
      spec,
      gauge: w.gauge,
      color: w.color,
      lengthFt: Math.round(w.lengthFt * 10) / 10,
      isShielded: w.isShielded,
      isTwistedPair: w.isTwistedPair,
      notes: notes.join('. '),
    };
  });

  // Group by harness section based on destination zone
  const sectionMap = new Map<string, CutListEntry[]>();
  for (const entry of entries) {
    // Determine section from wire destination
    let section = 'MISC';
    const w = result.wires.find(w => w.wireNumber === entry.wireNumber);
    if (!w) { /* skip */ }
    else if (w.signalType.includes('injector') || w.signalType.includes('coil') || w.label.includes('Crank') || w.label.includes('Cam') || w.label.includes('Knock') || w.label.includes('Throttle') || w.label.includes('MAP') || w.label.includes('Coolant') || w.label.includes('Oil') || w.label.includes('Intake') || w.label.includes('Fuel Injector') || w.label.includes('Ignition Coil')) {
      section = 'ENGINE LOOM';
    } else if (w.label.includes('Headlight') || w.label.includes('Tail') || w.label.includes('Turn') || w.label.includes('Backup') || w.label.includes('Marker') || w.label.includes('Clearance') || w.label.includes('License') || w.label.includes('Parking') || w.label.includes('Brake Light') || w.label.includes('Horn') || w.label.includes('Wiper') || w.label.includes('Washer')) {
      section = 'EXTERIOR / BODY';
    } else if (w.label.includes('Radio') || w.label.includes('Speaker') || w.label.includes('Amp') || w.label.includes('Sub')) {
      section = 'AUDIO';
    } else if (w.label.includes('Window') || w.label.includes('Lock') || w.label.includes('Door') || w.label.includes('Dome') || w.label.includes('Footwell') || w.label.includes('Dash') || w.label.includes('Gauge') || w.label.includes('Display') || w.label.includes('Lighter') || w.label.includes('USB') || w.label.includes('Blower')) {
      section = 'INTERIOR / DASH';
    } else if (w.label.includes('Fan') || w.label.includes('Fuel Pump') || w.label.includes('Water Pump') || w.label.includes('O2') || w.label.includes('Lambda') || w.label.includes('Speed Sensor') || w.label.includes('Parking Brake') || w.label.includes('AMP Research') || w.label.includes('Camera')) {
      section = 'CHASSIS / UNDERBODY';
    } else if (w.label.includes('CAN') || w.label.includes('Battery') || w.label.includes('Ground') || w.label.includes('Disconnect')) {
      section = 'POWER / COMMUNICATION';
    }

    const list = sectionMap.get(section) || [];
    list.push(entry);
    sectionMap.set(section, list);
  }

  const sections: CutListSection[] = Array.from(sectionMap.entries())
    .map(([section, wires]) => ({
      section,
      wires: wires.sort((a, b) => a.wireNumber - b.wireNumber),
      totalLengthFt: Math.round(wires.reduce((s, w) => s + w.lengthFt, 0) * 10) / 10,
    }))
    .sort((a, b) => {
      const order = ['ENGINE LOOM', 'EXTERIOR / BODY', 'INTERIOR / DASH', 'CHASSIS / UNDERBODY', 'AUDIO', 'POWER / COMMUNICATION', 'MISC'];
      return order.indexOf(a.section) - order.indexOf(b.section);
    });

  // Wire purchase summary — group by gauge
  const gaugeGroups = new Map<string, { gauge: number; totalFt: number; colors: Set<string>; shielded: boolean; twisted: boolean }>();
  for (const e of entries) {
    const key = e.isShielded ? `${e.gauge}-shielded` : e.isTwistedPair ? `${e.gauge}-twisted` : `${e.gauge}`;
    const g = gaugeGroups.get(key) || { gauge: e.gauge, totalFt: 0, colors: new Set<string>(), shielded: false, twisted: false };
    g.totalFt += e.lengthFt;
    g.colors.add(e.color);
    if (e.spec.includes('SHIELDED')) g.shielded = true;
    if (e.spec.includes('TWISTED')) g.twisted = true;
    gaugeGroups.set(key, g);
  }

  const purchaseSummary: WirePurchaseSummary[] = Array.from(gaugeGroups.values())
    .map(g => ({
      gauge: g.gauge,
      totalLengthFt: Math.round(g.totalFt),
      suggestedSpoolFt: suggestSpool(g.totalFt),
      colors: Array.from(g.colors).sort(),
      isShielded: g.shielded,
      isTwistedPair: g.twisted,
    }))
    .sort((a, b) => a.gauge - b.gauge);

  return {
    title: 'CUT LIST',
    generatedAt: new Date().toISOString(),
    totalWires: entries.length,
    totalLengthFt: Math.round(entries.reduce((s, e) => s + e.lengthFt, 0)),
    sections,
    purchaseSummary,
    shieldedWires: entries.filter(e => e.spec.includes('SHIELDED')),
    twistedPairs: entries.filter(e => e.spec.includes('TWISTED')),
  };
}

// ── Plain text export (for printing) ────────────────────────────────
export function cutListToText(doc: CutListDocument, vehicleName = ''): string {
  const lines: string[] = [];
  lines.push(`${doc.title}${vehicleName ? ` — ${vehicleName}` : ''}`);
  lines.push(`Generated: ${new Date(doc.generatedAt).toLocaleDateString()}`);
  lines.push(`${doc.totalWires} wires | ${doc.totalLengthFt} ft total`);
  lines.push('═'.repeat(80));
  lines.push('');

  for (const section of doc.sections) {
    lines.push(`▸ ${section.section} (${section.wires.length} wires, ${section.totalLengthFt} ft)`);
    lines.push('─'.repeat(80));
    lines.push(`${'#'.padEnd(4)} ${'LABEL'.padEnd(30)} ${'SPEC'.padEnd(18)} ${'COLOR'.padEnd(10)} ${'LENGTH'.padEnd(8)} NOTES`);
    for (const w of section.wires) {
      lines.push(
        `${('#' + w.wireNumber).padEnd(4)} ${w.label.padEnd(30).slice(0, 30)} ${w.spec.padEnd(18)} ${w.color.padEnd(10)} ${(w.lengthFt + 'ft').padEnd(8)} ${w.notes}`
      );
    }
    lines.push('');
  }

  lines.push('═'.repeat(80));
  lines.push('WIRE PURCHASE SUMMARY');
  lines.push('─'.repeat(80));
  for (const p of doc.purchaseSummary) {
    const type = p.isShielded ? 'SHIELDED' : p.isTwistedPair ? 'TWISTED PAIR' : 'STANDARD';
    lines.push(`${p.gauge} AWG ${type}: ${p.totalLengthFt} ft needed → order ${p.suggestedSpoolFt} ft (${p.colors.length} colors: ${p.colors.join(', ')})`);
  }

  if (doc.shieldedWires.length > 0) {
    lines.push('');
    lines.push(`★ ${doc.shieldedWires.length} SHIELDED wires — order as 2-conductor shielded cable, not individual wires`);
  }
  if (doc.twistedPairs.length > 0) {
    lines.push(`★ ${doc.twistedPairs.length} TWISTED PAIR wires — order as pre-twisted pair`);
  }

  return lines.join('\n');
}
