// generateBOM.ts — Bill of Materials from overlay result
// Links every device and wire material need to catalog parts with real pricing.

import type { OverlayResult, ManifestDevice } from './overlayCompute';
import type { TerminationRecord } from './terminationCompute';

export interface BOMLineItem {
  category: string;
  partName: string;
  partNumber?: string;
  manufacturer?: string;
  quantity: number;
  unitPrice?: number;
  totalPrice?: number;
  supplier?: string;
  inStock?: boolean;
  purchased: boolean;
  sourcingDifficulty?: string;
  notes?: string;
}

export interface BOMSection {
  section: string;
  items: BOMLineItem[];
  subtotal: number;
  itemCount: number;
  pricedCount: number;
  unpricedCount: number;
}

export interface BOMDocument {
  title: string;
  generatedAt: string;
  sections: BOMSection[];
  totalParts: number;
  totalCost: number;
  pricedItems: number;
  unpricedItems: number;
  purchasedItems: number;
  unpurchasedItems: number;
  ecuCost: number;
  pdmCost: number;
  estimatedLaborHours: number;
  estimatedLaborCost: number;
  grandTotal: number;
}

export function generateBOM(
  result: OverlayResult,
  devices: ManifestDevice[],
  laborRate = 65,
  terminations?: TerminationRecord[],
): BOMDocument {
  const sections: BOMSection[] = [];

  // ── Motec System ──
  const motecItems: BOMLineItem[] = [];
  motecItems.push({
    category: 'Motec',
    partName: `${result.recommendedConfig.ecu.model} ECU`,
    manufacturer: 'Motec',
    quantity: 1,
    unitPrice: result.recommendedConfig.ecu.price,
    totalPrice: result.recommendedConfig.ecu.price,
    purchased: devices.some(d => d.device_name === 'ECU' && d.purchased),
    notes: `Computed from I/O: ${result.io.injectorOutputs}inj + ${result.io.ignitionOutputs}ign + ${result.io.analogInputs}an`,
  });
  motecItems.push({
    category: 'Motec',
    partName: result.recommendedConfig.pdm.config,
    manufacturer: 'Motec',
    quantity: 1,
    unitPrice: result.recommendedConfig.pdm.price,
    totalPrice: result.recommendedConfig.pdm.price,
    purchased: devices.some(d => d.device_name === 'Power Distribution Module' && d.purchased),
    notes: `${result.pdmChannels.length} channels used`,
  });

  // Connector kits for ECU
  motecItems.push({
    category: 'Motec',
    partName: `${result.recommendedConfig.ecu.model} Complete Connector Kit`,
    partNumber: 'M150-CONN-KIT',
    manufacturer: 'ProWire USA',
    quantity: 1,
    unitPrice: 56.21,
    totalPrice: 56.21,
    purchased: false,
    supplier: 'ProWire USA',
    inStock: true,
    notes: 'All 4 connector housings + 120 terminals',
  });

  sections.push({
    section: 'MOTEC SYSTEM',
    items: motecItems,
    subtotal: motecItems.reduce((s, i) => s + (i.totalPrice || 0), 0),
    itemCount: motecItems.length,
    pricedCount: motecItems.filter(i => i.unitPrice).length,
    unpricedCount: motecItems.filter(i => !i.unitPrice).length,
  });

  // ── Vehicle Devices ──
  const categoryOrder = ['sensors', 'actuators', 'lighting', 'body', 'brakes', 'fuel', 'drivetrain', 'interior', 'audio', 'accessories', 'safety', 'engine_mgmt'];
  for (const cat of categoryOrder) {
    const catDevices = devices.filter(d => d.device_category === cat
      && d.device_name !== 'ECU' && d.device_name !== 'Power Distribution Module'
      && d.device_name !== 'Star Ground Point' && d.device_name !== 'Body Ground Point'
      && d.device_name !== 'CAN Bus Network');

    if (catDevices.length === 0) continue;

    const items: BOMLineItem[] = catDevices.map(d => ({
      category: cat,
      partName: d.device_name,
      partNumber: d.part_number || undefined,
      manufacturer: d.manufacturer || undefined,
      quantity: 1,
      unitPrice: d.price || undefined,
      totalPrice: d.price || undefined,
      purchased: d.purchased || false,
      supplier: (d as any).supplier || undefined,
      sourcingDifficulty: (d as any).sourcing_difficulty || undefined,
    }));

    sections.push({
      section: cat.toUpperCase().replace('_', ' '),
      items,
      subtotal: items.reduce((s, i) => s + (i.totalPrice || 0), 0),
      itemCount: items.length,
      pricedCount: items.filter(i => i.unitPrice).length,
      unpricedCount: items.filter(i => !i.unitPrice).length,
    });
  }

  // ── Wire and Consumables ──
  const wireItems: BOMLineItem[] = [];
  const totalWireFt = result.totalWireLengthFt;

  // Wire — always present
  wireItems.push({
    category: 'wire',
    partName: `TXL Wire (assorted gauges, ${totalWireFt} ft total)`,
    manufacturer: 'ProWire USA',
    quantity: 1,
    unitPrice: Math.round(totalWireFt * 0.15),
    totalPrice: Math.round(totalWireFt * 0.15),
    purchased: false,
    supplier: 'ProWire USA',
    notes: `${result.shieldedWires} shielded + ${result.twistedPairs} twisted pair included`,
  });

  if (terminations && terminations.length > 0) {
    // ── Per-endpoint itemization from termination data ──

    // Connector housings — deduplicate by P/N
    const housings = new Map<string, { name: string; qty: number }>();
    for (const t of terminations) {
      for (const ep of [t.sourceEndpoint, t.deviceEndpoint]) {
        const pn = ep.termination.housing;
        if (pn && pn !== 'UNKNOWN' && pn !== 'N/A') {
          const existing = housings.get(pn);
          if (existing) existing.qty++;
          else housings.set(pn, { name: `${ep.connectorFamily} Housing`, qty: 1 });
        }
      }
    }
    for (const [pn, { name, qty }] of housings) {
      wireItems.push({
        category: 'wire', partName: name, partNumber: pn,
        quantity: qty, unitPrice: 3.50, totalPrice: Math.round(qty * 3.50),
        purchased: false, supplier: 'ProWire USA',
      });
    }

    // Terminal contacts — group by P/N
    const contacts = new Map<string, number>();
    for (const t of terminations) {
      for (const ep of [t.sourceEndpoint, t.deviceEndpoint]) {
        for (const pn of [ep.termination.contactMale, ep.termination.contactFemale]) {
          if (pn && pn !== 'UNKNOWN') contacts.set(pn, (contacts.get(pn) ?? 0) + 1);
        }
      }
    }
    for (const [pn, qty] of contacts) {
      wireItems.push({
        category: 'wire', partName: 'Terminal Contact', partNumber: pn,
        quantity: qty, unitPrice: 0.85, totalPrice: Math.round(qty * 0.85),
        purchased: false, supplier: 'ProWire USA',
      });
    }

    // Pin seals — group by P/N
    const seals = new Map<string, number>();
    for (const t of terminations) {
      for (const ep of [t.sourceEndpoint, t.deviceEndpoint]) {
        const pn = ep.termination.pinSeal;
        if (pn) seals.set(pn, (seals.get(pn) ?? 0) + 1);
      }
    }
    for (const [pn, qty] of seals) {
      wireItems.push({
        category: 'wire', partName: 'Pin Seal', partNumber: pn,
        quantity: qty, unitPrice: 0.35, totalPrice: Math.round(qty * 0.35),
        purchased: false, supplier: 'ProWire USA',
      });
    }

    // Boots — group by P/N
    const boots = new Map<string, number>();
    for (const t of terminations) {
      for (const ep of [t.sourceEndpoint, t.deviceEndpoint]) {
        const pn = ep.termination.boot;
        if (pn) boots.set(pn, (boots.get(pn) ?? 0) + 1);
      }
    }
    for (const [pn, qty] of boots) {
      wireItems.push({
        category: 'wire', partName: 'Connector Boot', partNumber: pn,
        quantity: qty, unitPrice: 2.50, totalPrice: Math.round(qty * 2.50),
        purchased: false, supplier: 'ProWire USA',
      });
    }

    // Heat shrink — group by size, 6" per endpoint
    const shrinkBySize = new Map<string, { pn: string; qty: number }>();
    for (const t of terminations) {
      const key = t.heatShrink.size;
      const existing = shrinkBySize.get(key);
      if (existing) existing.qty += 2; // 2 endpoints per wire
      else shrinkBySize.set(key, { pn: t.heatShrink.pn, qty: 2 });
    }
    for (const [size, { pn, qty }] of shrinkBySize) {
      const ftNeeded = Math.ceil((qty * 6) / 12); // 6" per endpoint → ft
      wireItems.push({
        category: 'wire', partName: `DR-25 Heat Shrink ${size}`, partNumber: pn,
        manufacturer: 'Raychem', quantity: ftNeeded,
        unitPrice: 5, totalPrice: ftNeeded * 5,
        purchased: false, supplier: 'ProWire USA',
        notes: `${qty} pieces @ 6" each`,
      });
    }

    // Labels — one per wire
    wireItems.push({
      category: 'wire', partName: 'Wire Labels (self-laminating)',
      quantity: terminations.length, unitPrice: 0.50,
      totalPrice: Math.round(terminations.length * 0.50),
      purchased: false, supplier: 'ProWire USA',
    });

    // Crimp tools — deduplicate, qty = 1 each
    const crimpTools = new Set<string>();
    for (const t of terminations) {
      for (const ep of [t.sourceEndpoint, t.deviceEndpoint]) {
        const pn = ep.termination.crimpTool;
        if (pn && pn !== 'UNKNOWN') crimpTools.add(pn);
      }
    }
    for (const pn of crimpTools) {
      wireItems.push({
        category: 'wire', partName: 'Crimp Tool', partNumber: pn,
        quantity: 1, unitPrice: 450, totalPrice: 450,
        purchased: false, supplier: 'ProWire USA',
        notes: 'Reusable — one per tool type',
      });
    }
  } else {
    // ── Lump estimates (no termination data) ──
    const dtmCount = Math.max(10, Math.round(result.deviceCount * 0.15));
    wireItems.push({
      category: 'wire',
      partName: `DTM Connector Kits (assorted 2-12 pin, ~${dtmCount} sets)`,
      manufacturer: 'ProWire USA',
      quantity: dtmCount, unitPrice: 7, totalPrice: dtmCount * 7,
      purchased: false, supplier: 'ProWire USA',
    });
    wireItems.push({
      category: 'wire', partName: 'DR-25 Heat Shrink (assorted sizes)',
      manufacturer: 'Raychem', quantity: 1, unitPrice: 70, totalPrice: 70,
      purchased: false, supplier: 'ProWire USA',
    });
    wireItems.push({
      category: 'wire', partName: 'Terminals, boots, tape, lacing cord, misc consumables',
      quantity: 1, unitPrice: 100, totalPrice: 100, purchased: false,
    });
  }

  sections.push({
    section: 'WIRE AND CONSUMABLES',
    items: wireItems,
    subtotal: wireItems.reduce((s, i) => s + (i.totalPrice || 0), 0),
    itemCount: wireItems.length,
    pricedCount: wireItems.filter(i => i.unitPrice).length,
    unpricedCount: 0,
  });

  // ── Totals ──
  const totalParts = sections.reduce((s, sec) => s + sec.itemCount, 0);
  const totalCost = sections.reduce((s, sec) => s + sec.subtotal, 0);
  const pricedItems = sections.reduce((s, sec) => s + sec.pricedCount, 0);
  const unpricedItems = sections.reduce((s, sec) => s + sec.unpricedCount, 0);
  const purchasedItems = devices.filter(d => d.purchased).length;

  // Labor estimate: ~30 min per wire for professional tier
  const laborHours = Math.round(result.wireCount * 0.5);
  const laborCost = laborHours * laborRate;

  return {
    title: 'BILL OF MATERIALS',
    generatedAt: new Date().toISOString(),
    sections,
    totalParts,
    totalCost,
    pricedItems,
    unpricedItems,
    purchasedItems,
    unpurchasedItems: devices.filter(d => !d.purchased).length,
    ecuCost: result.recommendedConfig.ecu.price,
    pdmCost: result.recommendedConfig.pdm.price,
    estimatedLaborHours: laborHours,
    estimatedLaborCost: laborCost,
    grandTotal: totalCost + laborCost,
  };
}

// ── Plain text export ───────────────────────────────────────────────
export function bomToText(doc: BOMDocument, vehicleName = ''): string {
  const lines: string[] = [];
  lines.push(`${doc.title}${vehicleName ? ` — ${vehicleName}` : ''}`);
  lines.push(`Generated: ${new Date(doc.generatedAt).toLocaleDateString()}`);
  lines.push('═'.repeat(90));

  for (const section of doc.sections) {
    lines.push('');
    lines.push(`▸ ${section.section} (${section.itemCount} items, ${section.pricedCount} priced)`);
    lines.push('─'.repeat(90));

    for (const item of section.items) {
      const price = item.totalPrice ? `$${item.totalPrice.toLocaleString()}` : 'QUOTE';
      const status = item.purchased ? '✓ PURCHASED' : '';
      const pn = item.partNumber ? ` [${item.partNumber}]` : '';
      lines.push(`  ${item.quantity}× ${item.partName}${pn} — ${price} ${status}`);
      if (item.notes) lines.push(`     ${item.notes}`);
    }
    lines.push(`  SUBTOTAL: $${section.subtotal.toLocaleString()}`);
  }

  lines.push('');
  lines.push('═'.repeat(90));
  lines.push(`PARTS TOTAL:        $${doc.totalCost.toLocaleString()}`);
  lines.push(`LABOR (${doc.estimatedLaborHours} hrs @ $${doc.estimatedLaborCost / doc.estimatedLaborHours}/hr): $${doc.estimatedLaborCost.toLocaleString()}`);
  lines.push(`GRAND TOTAL:        $${doc.grandTotal.toLocaleString()}`);
  lines.push('');
  lines.push(`Priced: ${doc.pricedItems}/${doc.totalParts} | Purchased: ${doc.purchasedItems} | Still needed: ${doc.unpurchasedItems}`);

  return lines.join('\n');
}
