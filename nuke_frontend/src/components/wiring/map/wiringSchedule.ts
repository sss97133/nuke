// One schedule definition for the current record table and its Excel workbook.
// These are presentations of loaded rows, never another harness derivation.
import type { MapWire, WiringMapData } from './useWiringMap';
import { SECTIONS } from './useWiringMap';
import { mask, publicName, wireGaugeDisplay, type SiteFiles } from './useWorkspaceSelection';

export type ScheduleCell = string | number | null;
export type ScheduleId = 'wires' | 'pins' | 'conns';
export interface ScheduleColumn { key: string; label: string; width?: number; numeric?: boolean; link?: boolean }
export interface ScheduleRow { id: string; selection: string; cells: Record<string, ScheduleCell> }
export interface ScheduleTable { id: ScheduleId; title: string; columns: ScheduleColumn[]; rows: ScheduleRow[] }
export interface WiringSchedule { tables: ScheduleTable[]; vehicleId: string; readAt: string | null; isOwner: boolean }

const finite = (n: number | null | undefined): number | null => typeof n === 'number' && Number.isFinite(n) ? n : null;
const section = (id: string | null) => SECTIONS.find(s => s.id === id)?.label ?? id ?? null;
const word = (s: string | null | undefined) => s ? s.replaceAll('_', ' ') : null;
const compare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
const col = (key: string, label: string, width = 22, numeric = false): ScheduleColumn => ({ key, label, width, numeric });
const recordColumn: ScheduleColumn = { key: 'record', label: 'Open record', width: 25, link: true };

/** Keep engineering uncertainty verbatim; redact amounts/order IDs with the same mask as the UI. */
export const engineeringText = (value: string | null | undefined): string | null => value == null || value === '' ? null : mask(value);

/** The shared numeric AWG keys stay in the records; screen and XLSX use trade notation. */
export function scheduleCellValue(column: Pick<ScheduleColumn, 'key'>, value: ScheduleCell): ScheduleCell {
  return column.key === 'gauge' && typeof value === 'number' ? wireGaugeDisplay(value) : value;
}

export function scheduleLength(wire: MapWire): { planned: number | null; kind: string | null; basis: string | null } {
  const planned = finite(wire.plannedLengthFt);
  if (planned !== null) return { planned, kind: word(wire.plannedLengthKind) ?? 'Basis not recorded', basis: wire.plannedLengthBasis ?? null };
  // The circuit reader owns this value. A browser route-model sum is a different
  // claim and must not fill a missing database length in cards or worksheets.
  return { planned: null, kind: null, basis: null };
}

export function buildWiringSchedule(map: WiringMapData, site: SiteFiles, vehicleId: string, isOwner: boolean): WiringSchedule {
  const nodes = new Map(map.nodes.map(n => [n.id, n]));
  const wires = new Map(map.wires.map(w => [w.id, w]));
  const base = `https://nuke.ag/vehicle/${encodeURIComponent(vehicleId)}/wiring?tab=map&door=schedule&sel=`;
  const record = (selection: string) => base + encodeURIComponent(selection);
  const wireColumns: ScheduleColumn[] = [
    col('code', 'Wire', 18), col('design', 'Design state', 18), col('name', 'Function', 40), col('from', 'From', 24), col('fromCavity', 'From cavity', 34),
    col('to', 'To', 24), col('toCavity', 'To cavity', 42), col('gauge', 'AWG', 9, true), col('color', 'Colour', 18),
    col('spec', 'Wire specification', 24), col('planned', 'Planned length (ft)', 20, true), col('lengthKind', 'Length basis', 30),
    col('measured', 'Measured length (ft)', 22, true), col('build', 'Build state', 18), col('section', 'Section', 24),
  ];
  if (isOwner) wireColumns.push(col('basisDetail', 'Length evidence', 65), col('checks', 'Recorded rule checks', 65),
    col('checkedAt', 'Checks recorded at', 28), col('checksVersion', 'Check version', 38), col('observedAt', 'Observed at', 28),
    col('source', 'Source', 55), col('trust', 'Source trust', 16));
  wireColumns.push(col('id', 'Circuit record ID', 38), recordColumn);
  const wireRows: ScheduleRow[] = map.wires.slice().sort((a, b) => compare(a.code, b.code)).map(w => {
    const length = scheduleLength(w), selection = 'w:' + w.code;
    const cells: ScheduleRow['cells'] = {
      code: w.code, name: publicName(w.name), from: nodes.get(w.fromId ?? '')?.code ?? engineeringText(w.fromText),
      fromCavity: engineeringText(w.fromCavity), to: nodes.get(w.toId ?? '')?.code ?? engineeringText(w.toText), toCavity: engineeringText(w.toCavity),
      gauge: finite(w.gauge), color: engineeringText(w.color), spec: engineeringText(w.spec), planned: length.planned,
      lengthKind: length.kind, measured: finite(w.measuredLengthFt), design: word(w.designStatus), build: word(w.buildState),
      section: section(w.section), id: w.id, record: record(selection),
    };
    if (isOwner) Object.assign(cells, {
      basisDetail: length.basis,
      checks: w.checks && Object.keys(w.checks).length ? Object.entries(w.checks).map(([rule, [result, note]]) => `${rule}: ${result}${note ? ` — ${note}` : ''}`).join('\n') : null,
      checkedAt: w.checkedAt ?? null, checksVersion: w.checksVersion ?? null, observedAt: w.observedAt ?? null, source: w.source ?? null, trust: w.trust ?? null,
    });
    return { id: w.id, selection, cells };
  });
  const endColumns: ScheduleColumn[] = [col('wire', 'Wire', 18), col('node', 'Connection point', 26), col('cavity', 'Cavity / stud', 45),
    col('terminal', 'Terminal part', 36), col('seal', 'Seal part', 30), col('tool', 'Crimp tool', 30), col('design', 'Circuit design state', 24)];
  if (isOwner) endColumns.push(col('source', 'Source', 65));
  endColumns.push(col('id', 'Termination record ID', 38), col('circuitId', 'Circuit record ID', 38), col('endpointId', 'Endpoint record ID', 38), recordColumn);
  // Preserve every loaded end, including one whose linked circuit/endpoint is
  // unavailable. An unresolved relationship must not disappear from the export.
  const endRows: ScheduleRow[] = map.ends.map((e, i) => {
    const node = nodes.get(e.endpointId), wire = wires.get(e.circuitId), selection = wire ? 'w:' + wire.code : node ? 'n:' + node.code : '';
    const id = e.id ?? `${e.circuitId}:${e.endpointId}:${e.cavity ?? ''}:${i}`;
    const cells: ScheduleRow['cells'] = { wire: wire?.code ?? null, node: node?.code ?? null, cavity: engineeringText(e.cavity),
      terminal: engineeringText(e.terminal), seal: engineeringText(e.seal), tool: engineeringText(e.tool), design: word(wire?.designStatus),
      id, circuitId: e.circuitId, endpointId: e.endpointId, record: selection ? record(selection) : null };
    if (isOwner) cells.source = e.source;
    return { id, selection, cells };
  }).sort((a, b) => compare(String(a.cells.node ?? ''), String(b.cells.node ?? '')) || compare(String(a.cells.cavity ?? ''), String(b.cells.cavity ?? '')) || compare(String(a.cells.wire ?? ''), String(b.cells.wire ?? '')));
  const nodeColumns: ScheduleColumn[] = [col('code', 'Connection point', 26), col('name', 'Description', 46), col('part', 'Part number', 38),
    col('type', 'Type', 20), col('section', 'Section', 24), col('design', 'Design state', 18), col('work', 'Work state', 18)];
  if (isOwner) nodeColumns.push(col('source', 'Source', 65), col('trust', 'Source trust', 16));
  nodeColumns.push(col('id', 'Endpoint record ID', 38), recordColumn);
  const nodeRows: ScheduleRow[] = map.nodes.slice().sort((a, b) => compare(a.code, b.code)).map(n => {
    const selection = 'n:' + n.code;
    const cells: ScheduleRow['cells'] = { code: n.code, name: publicName(n.name), part: engineeringText(n.partNumber), type: word(n.type),
      section: section(n.section), design: word(n.designStatus), work: word(n.workStatus), id: n.id, record: record(selection) };
    if (isOwner) Object.assign(cells, { source: n.source, trust: n.trust });
    return { id: n.id, selection, cells };
  });
  return { vehicleId, readAt: map.readAt ?? null, isOwner, tables: [
    { id: 'wires', title: 'Wire schedule', columns: wireColumns, rows: wireRows },
    { id: 'pins', title: 'Terminations', columns: endColumns, rows: endRows },
    { id: 'conns', title: 'Connection points', columns: nodeColumns, rows: nodeRows },
  ] };
}

/** Real XLSX; the heavy existing library loads only after Download is clicked. */
export async function wiringWorkbookBytes(schedule: WiringSchedule): Promise<Uint8Array> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Nuke';
  workbook.title = 'Wiring schedule';
  for (const table of schedule.tables) {
    const sheet = workbook.addWorksheet(table.title, { views: [{ state: 'frozen', xSplit: 1, ySplit: 5 }],
      pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:5' } });
    sheet.columns = table.columns.map(c => ({ key: c.key, width: c.width ?? 22 }));
    sheet.getCell('A1').value = table.title;
    sheet.getCell('A1').font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FF213548' } };
    sheet.getCell('A2').value = `Vehicle ${schedule.vehicleId} · Read ${schedule.readAt ?? 'time not recorded'} · All loaded records`;
    sheet.getCell('A3').value = 'Design state is not construction approval. Planned/modelled lengths require physical verification; blank means not recorded.';
    sheet.mergeCells(2, 1, 2, table.columns.length);
    sheet.mergeCells(3, 1, 3, table.columns.length);
    sheet.getRow(2).height = 24; sheet.getRow(3).height = 30;
    sheet.getRow(3).alignment = { wrapText: true, vertical: 'middle' };
    sheet.addTable({ name: `Wiring_${table.id}`, ref: 'A5', headerRow: true, totalsRow: false,
      style: { theme: 'TableStyleMedium2', showRowStripes: true },
      columns: table.columns.map(c => ({ name: c.label, filterButton: true })),
      rows: table.rows.map(row => table.columns.map(c => scheduleCellValue(c, row.cells[c.key] ?? null))),
    });
    sheet.getRow(5).height = 32;
    sheet.getRow(5).font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF213548' } };
    sheet.getRow(5).alignment = { wrapText: true, vertical: 'middle' };
    table.rows.forEach((row, i) => {
      const excelRow = sheet.getRow(i + 6);
      excelRow.font = { name: 'Arial', size: 11, color: { argb: 'FF202B34' } };
      excelRow.alignment = { wrapText: true, vertical: 'top' };
      excelRow.height = Math.min(409, Math.max(28, ...table.columns.map(c => {
        const displayed = c.link ? 'Open record' : String(row.cells[c.key] ?? '');
        const lines = displayed.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / (c.width ?? 22))), 0);
        return lines * 15 + 8;
      })));
      table.columns.forEach((c, j) => {
        const cell = excelRow.getCell(j + 1), value = row.cells[c.key];
        if (c.numeric) cell.numFmt = c.key === 'gauge' ? typeof cell.value === 'string' ? '@' : '0' : '0.###';
        if (c.link && typeof value === 'string' && value.startsWith('https://nuke.ag/')) {
          cell.value = { text: 'Open record', hyperlink: value };
          cell.font = { name: 'Arial', size: 11, color: { argb: 'FF1764A0' }, underline: true };
        }
      });
    });
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
