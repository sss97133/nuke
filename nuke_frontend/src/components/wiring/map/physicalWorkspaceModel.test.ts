import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../lib/supabase', () => ({ supabase: {} }));
import { matchesWorkspaceSearch, physicalSchedule, readPhysicalWorkspace, workspaceIndex } from './physicalWorkspaceModel';
import { diagramPieces } from './PhysicalDiagram';
import { physicalWorkspaceFixture } from './physicalWorkspace.fixture';
import { wiringWorkbookBytes } from './wiringSchedule';

describe('physical harness schedule', () => {
  it('keeps two actual pieces, their IDs, uncertainty and measurements separate', () => {
    const data = physicalWorkspaceFixture();
    data.segments[0].source = 'PRIVATE source that must not leak into an export';
    const table = physicalSchedule(data).tables[0];
    expect(table.rows).toHaveLength(2);
    expect(table.rows.map(r => r.id)).toEqual(data.segments.map(s => s.id));
    expect(table.rows.map(r => r.cells.planned)).toEqual([1.09, 3.54]);
    expect(table.rows.every(r => r.cells.measured === null)).toBe(true);
    expect(table.rows[1].cells.to).toContain('pin letter unknown until drawing is read');
    expect(table.rows[0].cells.name).toContain('proposed placement');
    expect(table.rows[0].cells.checks).toBe('unbound');
    expect(table.rows[0].cells.plan).toBe('Current plan');
    expect(table.columns[1].key).toBe('design');
    expect(JSON.stringify(physicalSchedule(data))).not.toContain('PRIVATE');
    expect(matchesWorkspaceSearch(physicalSchedule(data, true).tables[0].rows[0], 'segments', 'private', false)).toBe(false);
  });
  it('exports clocks and trust consistently without unavailable source prose columns', () => {
    const data = physicalWorkspaceFixture();
    for (const owner of [true, false]) {
      const schedule = physicalSchedule(data, owner);
      for (const table of schedule.tables) {
        expect(table.columns.some(column => column.key === 'source' || column.key === 'method')).toBe(false);
        expect(table.rows[0].cells).toMatchObject({ observed: '2026-11-25T00:00:00Z', trust: 'T3' });
      }
    }
  });
  it('retains held pieces and unresolved circuits without inventing a material or length', () => {
    const data = physicalWorkspaceFixture();
    data.segments[0] = { ...data.segments[0], current_circuit_id: null, planned_length_ft: null, wire_part_id: null, part_number: null,
      blockers: ['physical_revision_hold'], physical_progress: true, build_state: 'cut' };
    data.circuits.push({ ...data.circuits[0], id: 'unmodeled', circuit_code: '112', design_status: 'concept' });
    const schedule = physicalSchedule(data);
    expect(schedule.tables[0].rows[0].cells).toMatchObject({ planned: null, part: null, expectedPart: 'M22759/16-22-42', specification: 'M22759/16', build: 'cut', issues: 'physical revision hold' });
    expect(schedule.tables[3].rows.find(r => r.id === 'unmodeled')?.cells).toMatchObject({ pieces: 0, design: 'concept' });
  });
  it('refuses wrong subjects and unsupported payloads', () => {
    expect(() => readPhysicalWorkspace(physicalWorkspaceFixture(), 'vehicle-b')).toThrow();
    expect(() => readPhysicalWorkspace({ ...physicalWorkspaceFixture(), schema_version: 2 }, 'vehicle-a')).toThrow();
    expect(() => readPhysicalWorkspace(null, 'vehicle-a')).toThrow();
  });
  it('counts physical pieces against their recorded circuit, never a proposed successor', () => {
    const data = physicalWorkspaceFixture(), source = data.circuits[0];
    data.circuits.push({ ...source, id: 'successor' });
    data.segments.forEach(s => { s.current_circuit_id = 'successor'; });
    const rows = physicalSchedule(data).tables[3].rows;
    expect(rows.find(r => r.id === source.id)?.cells.pieces).toBe(2);
    expect(rows.find(r => r.id === 'successor')?.cells.pieces).toBe(0);
  });
  it('keeps wrong-circuit or unbound ends out of diagram connections', () => {
    const data = physicalWorkspaceFixture();
    data.ends[0].circuit_id = 'other-circuit'; data.ends[1].circuit_id = null;
    const pieces = diagramPieces(data.segments, workspaceIndex(data));
    expect(pieces[0].from).toBeNull(); expect(pieces[0].to).toBeNull();
    expect(pieces[1].from?.id).toBe('end-2'); expect(pieces[1].to?.id).toBe('end-3');
    data.segments[1].circuit_id = null;
    expect(diagramPieces(data.segments, workspaceIndex(data))[1]).toMatchObject({ from: null, to: null });
  });
  it('round-trips all physical records and snapshot in real Excel tables', async () => {
    const data = physicalWorkspaceFixture(), schedule = physicalSchedule(data);
    const ExcelJS = (await import('exceljs')).default, book = new ExcelJS.Workbook();
    await book.xlsx.load(await wiringWorkbookBytes(schedule) as unknown as Parameters<typeof book.xlsx.load>[0]);
    expect(book.worksheets.map(s => s.name)).toEqual(['Wire pieces', 'Terminations', 'Connection points', 'Circuits']);
    for (const table of schedule.tables) {
      const sheet = book.getWorksheet(table.title)!;
      expect(sheet.getCell('A2').text).toContain(data.snapshot_key);
      expect(sheet.views[0]).toMatchObject({ state: 'frozen', xSplit: 1, ySplit: 5 });
      expect(sheet.getTable(`Wiring_${table.id}`)).toBeDefined();
      for (const [i, row] of table.rows.entries()) for (const [j, column] of table.columns.entries()) {
        const actual = sheet.getRow(i + 6).getCell(j + 1).value;
        if (column.link) expect(actual).toMatchObject({ hyperlink: row.cells[column.key] });
        else expect(actual).toBe(row.cells[column.key] ?? null);
      }
    }
  });
});
