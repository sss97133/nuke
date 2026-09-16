// generateEZWireCSV.ts — Export harness as CSV for EZ Wire and Autodesk Inventor
// Standard wire list CSV format: one row per wire with endpoint info
// Ref: https://help.autodesk.com/cloudhelp/2023/ENU/Inventor-Help/files/GUID-30B323C1-2032-4469-AD2A-6E1C3DC3706A.htm

import type { OverlayResult, WireSpec } from './overlayCompute';

export interface EZWireRow {
  wireNumber: number;
  wireLabel: string;
  fromComponent: string;
  fromPin: string;
  toComponent: string;
  toPin: string;
  gauge: number;
  color: string;
  lengthMm: number;
  lengthFt: number;
  wireType: string;
  signalType: string;
  fuseRating: string;
  pdmChannel: string;
  notes: string;
}

const CSV_HEADERS = [
  'Wire_Number',
  'Wire_Label',
  'From_Component',
  'From_Pin',
  'To_Component',
  'To_Pin',
  'Gauge_AWG',
  'Color',
  'Length_mm',
  'Length_ft',
  'Wire_Type',
  'Signal_Type',
  'Fuse_Rating_A',
  'PDM_Channel',
  'Notes',
];

function escapeCSV(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

export function generateEZWireCSV(result: OverlayResult): string {
  const rows: string[] = [];

  // Comment header
  rows.push(`// Wire List Export — ${result.deviceCount} devices, ${result.wireCount} wires`);
  rows.push(`// Generated: ${new Date().toISOString()}`);
  rows.push(`// ECU: ${result.recommendedConfig.ecu.model} | PDM: ${result.recommendedConfig.pdm.config}`);

  // Column headers
  rows.push(CSV_HEADERS.join(','));

  // ECU pin tracking
  let ecuPin = 1;
  let pdmPin = 1;

  for (const w of result.wires) {
    const fromComponent = w.from === 'ECU' ? 'ECU' : 'PDM';
    const fromPin = w.from === 'ECU' ? String(ecuPin++) : `Ch${pdmPin++}`;

    let wireType = 'TXL';
    if (w.isShielded) wireType = 'SHIELDED_2C';
    else if (w.isTwistedPair) wireType = 'TWISTED_PAIR';

    const values = [
      String(w.wireNumber),
      escapeCSV(w.label),
      escapeCSV(fromComponent),
      escapeCSV(fromPin),
      escapeCSV(w.to),
      '1',
      String(w.gauge),
      escapeCSV(w.color),
      String(Math.round(w.lengthFt * 304.8)),
      String(Math.round(w.lengthFt * 10) / 10),
      wireType,
      escapeCSV(w.signalType),
      w.fuseRating ? String(w.fuseRating) : '',
      w.pdmChannel ? String(w.pdmChannel) : '',
      '',
    ];

    rows.push(values.join(','));
  }

  return rows.join('\n');
}

// ── BOM CSV (for purchasing/shop) ───────────────────────────────────

export function generateBOMCSV(
  result: OverlayResult,
  devices: { device_name: string; part_number?: string; manufacturer?: string; price?: number; purchased?: boolean; supplier?: string }[],
): string {
  const rows: string[] = [];

  rows.push('// Bill of Materials Export');
  rows.push(`// Generated: ${new Date().toISOString()}`);
  rows.push('Part_Number,Device_Name,Manufacturer,Supplier,Qty,Unit_Price,Total_Price,Purchased,Category');

  for (const d of devices) {
    const values = [
      escapeCSV(d.part_number || ''),
      escapeCSV(d.device_name),
      escapeCSV(d.manufacturer || ''),
      escapeCSV(d.supplier || ''),
      '1',
      d.price ? String(d.price) : '',
      d.price ? String(d.price) : '',
      d.purchased ? 'YES' : 'NO',
      '',
    ];
    rows.push(values.join(','));
  }

  return rows.join('\n');
}
