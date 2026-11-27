import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../lib/supabase', () => ({ supabase: {} }));
import { buildWiringSchedule, scheduleCellValue, scheduleLength, wiringWorkbookBytes } from './wiringSchedule';
import type { MapNode, MapWire, WiringMapData } from './useWiringMap';
import type { SiteFiles, SiteSeg } from './useWorkspaceSelection';

const vehicleId = 'vehicle-a';
const node = (id: string, code: string): MapNode => ({ id, code, name: code, type: 'connector', family: null,
  section: 'engine', designStatus: 'decided', workStatus: 'open', assignee: null, x: null, y: null, posSource: null,
  partNumber: 'A-1', notes: 'PRIVATE note', source: 'PRIVATE source', trust: 'T1' });
const wire = (changes: Partial<MapWire> = {}): MapWire => ({ id: 'wire-112', code: '112', name: 'Pressure signal',
  section: 'engine', designStatus: 'decided', derivation: null, gauge: 22, color: 'white', spec: 'M22759/16',
  fromId: 'ecu', toId: 'sensor', fromCavity: 'A16', toCavity: 'signal (AEM pin letter unknown until drawing is read)',
  fromText: 'old source text', toText: 'old destination text', buildState: null, checks: null,
  plannedLengthFt: 4.6, plannedLengthKind: 'estimate', plannedLengthBasis: 'PRIVATE length source', measuredLengthFt: null,
  observedAt: '2026-10-16', checkedAt: null, checksVersion: null, source: 'PRIVATE wire source', trust: 'T3', ...changes });
const map: WiringMapData = { loaded: true, error: null, readAt: '2026-11-25T21:11:05Z',
  nodes: [node('ecu', 'M130'), node('sensor', 'SENSOR')], wires: [wire(), wire({ id: 'wire-concept', code: 'C1', designStatus: 'concept', plannedLengthFt: null })],
  ends: [{ id: 'end-1', circuitId: 'wire-112', endpointId: 'sensor', cavity: 'signal (pin letter unknown)', terminal: null, seal: null, tool: null, source: 'PRIVATE end source' },
    { id: 'end-2', circuitId: 'missing-wire', endpointId: 'missing-endpoint', cavity: 'A', terminal: 'terminal-2', seal: null, tool: null, source: null }], calls: [] };
const segment = (id: string, len: number | null): SiteSeg => ({ id, b: null, od: null, par: 1, len, mar: null, cov: null, f: '', t: '', w: ['112'], clips: 0, pts: [] });
const site: SiteFiles = { loaded: true, sourceVehicleId: vehicleId, ends: {}, segs: [segment('s1', 1)], models: null, routesOn: '2026-09-29' };

describe('current wiring schedule', () => {
  it('keeps numeric aught keys and exports trade notation as literal XLSX text', async () => {
    const gauges = [0, -1, -2, -3, 1, 2, 3, null];
    const schedule = buildWiringSchedule({ ...map, wires: gauges.map((gauge, i) => wire({ id: `wire-${i}`, code: String(i), gauge })) }, site, vehicleId, false);
    const table = schedule.tables[0], column = table.columns.find(c => c.key === 'gauge')!;
    const expected = ['1/0', '2/0', '3/0', '4/0', 1, 2, 3, null];
    expect(table.rows.map(r => r.cells.gauge)).toEqual(gauges);
    expect(table.rows.map(r => scheduleCellValue(column, r.cells.gauge))).toEqual(expected);
    expect(scheduleCellValue({ key: 'planned' }, 0)).toBe(0);
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await wiringWorkbookBytes(schedule) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.getWorksheet(table.title)!, columnIndex = table.columns.indexOf(column) + 1;
    expect(table.rows.map((_, i) => sheet.getRow(i + 6).getCell(columnIndex).value)).toEqual(expected);
    for (let i = 0; i < 4; i++) {
      const cell = sheet.getRow(i + 6).getCell(columnIndex);
      expect(cell.numFmt).toBe('@');
      expect(cell.formula).toBeUndefined();
    }
  });
  it('keeps typed endpoints, pin uncertainty, design state and measured blanks', () => {
    const rows = buildWiringSchedule(map, site, vehicleId, false).tables[0].rows;
    expect(rows[0].cells).toMatchObject({ id: 'wire-112', from: 'M130', to: 'SENSOR',
      toCavity: 'signal (AEM pin letter unknown until drawing is read)', planned: 4.6, lengthKind: 'estimate', measured: null, design: 'decided', build: null });
    expect(rows[1].cells.design).toBe('concept');
    expect(rows[1].cells.planned).toBeNull();
    expect(rows[0].cells).not.toHaveProperty('checks');
  });

  it('does not export owner evidence or finance text to a visitor', () => {
    const publicMap = { ...map, wires: [wire({ name: 'Pressure signal — ordered $450 invoice 123456' })] };
    const visitor = buildWiringSchedule(publicMap, site, vehicleId, false);
    expect(JSON.stringify(visitor)).not.toMatch(/PRIVATE|\$450|123456/);
    expect(visitor.tables[0].rows[0].cells.name).toBe('Pressure signal');
    const owner = buildWiringSchedule(publicMap, site, vehicleId, true);
    expect(owner.tables[0].rows[0].cells.source).toBe('PRIVATE wire source');
    expect(owner.tables[0].rows[0].cells.checks).toBeNull(); // no results is not PASS
  });

  it('keeps every termination as its own record even when its relation is unresolved', () => {
    const ends = buildWiringSchedule(map, site, vehicleId, false).tables[1].rows;
    expect(ends.map(r => r.id).sort()).toEqual(['end-1', 'end-2']);
    expect(ends.find(r => r.id === 'end-1')!.cells.cavity).toContain('unknown');
    expect(ends.find(r => r.id === 'end-2')!.cells).toMatchObject({ wire: null, node: null, circuitId: 'missing-wire', endpointId: 'missing-endpoint' });
  });

  it('preserves the database planned value, including an explicit zero', () => {
    expect(scheduleLength(wire()).planned).toBe(4.6);
    expect(scheduleLength(wire({ plannedLengthFt: 0 })).planned).toBe(0);
  });

  it.each([null, NaN, Infinity, -Infinity])('keeps a missing or invalid database length unknown (%s)', plannedLengthFt => {
    expect(scheduleLength(wire({ plannedLengthFt }))).toEqual({ planned: null, kind: null, basis: null });
  });

  it('keeps a database-unknown length blank in the schedule and Excel despite a complete dated route model', async () => {
    const missing = wire({ code: 'ODY_NEG', plannedLengthFt: null, plannedLengthKind: null, plannedLengthBasis: null });
    const routedSite = { ...site, segs: [{ ...segment('route-only', 1), w: ['ODY_NEG'] }] };
    const schedule = buildWiringSchedule({ ...map, wires: [missing] }, routedSite, vehicleId, false);
    expect(schedule.tables[0].rows[0].cells).toMatchObject({ planned: null, lengthKind: null, measured: null });
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await wiringWorkbookBytes(schedule) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    for (const key of ['planned', 'lengthKind', 'measured']) {
      const column = schedule.tables[0].columns.findIndex(c => c.key === key) + 1;
      expect(workbook.worksheets[0].getRow(6).getCell(column).value).toBeNull();
    }
  });

  it('round-trips a genuine XLSX with the identical records, values, filters and frozen headers', async () => {
    const schedule = buildWiringSchedule(map, site, vehicleId, false);
    const bytes = await wiringWorkbookBytes(schedule);
    expect(Array.from(bytes.slice(0, 2))).toEqual([80, 75]); // OOXML ZIP, not HTML/CSV renamed
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    expect(workbook.worksheets.map(s => s.name)).toEqual(schedule.tables.map(t => t.title));
    for (const table of schedule.tables) {
      const sheet = workbook.getWorksheet(table.title)!;
      expect(sheet.views[0]).toMatchObject({ state: 'frozen', xSplit: 1, ySplit: 5 });
      expect(sheet.getTable(`Wiring_${table.id}`)).toBeDefined();
      expect(sheet.getRow(5).values).toEqual([, ...table.columns.map(c => c.label)]);
      expect(sheet.actualRowCount).toBe(table.rows.length + 4); // title, read time, qualifier, header + data
      table.rows.forEach((row, i) => table.columns.forEach((column, j) => {
        const value = sheet.getRow(i + 6).getCell(j + 1).value;
        if (column.link && row.cells[column.key]) expect(value).toMatchObject({ hyperlink: row.cells[column.key] });
        else expect(value).toBe(row.cells[column.key] ?? null);
      }));
    }
  });

  it('keeps formula-looking source strings as literal text', async () => {
    const schedule = buildWiringSchedule({ ...map, wires: [wire({ toCavity: '=HYPERLINK("https://example.invalid")' })] }, site, vehicleId, false);
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await wiringWorkbookBytes(schedule) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const column = schedule.tables[0].columns.findIndex(c => c.key === 'toCavity') + 1;
    const cell = workbook.worksheets[0].getRow(6).getCell(column);
    expect(typeof cell.value).toBe('string');
    expect(cell.formula).toBeUndefined();
  });
});
