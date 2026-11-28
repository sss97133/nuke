import { expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildPhysicalPieceSchedule } from './physicalPieceSchedule';
import { wiringWorkbookBytes } from './wiringSchedule';
import type { PhysicalHarnessModel, PhysicalSegment } from './physicalHarnessModel';

function fixture(): PhysicalHarnessModel {
  const piece = (id: string, circuit_id: string, from: string | null, to: string | null, length: number | null): PhysicalSegment => ({
    id, circuit_id, net_id: `net-${circuit_id}`, from_termination_id: from, to_termination_id: to,
    design_status: 'decided', gauge_awg: 22, circuit_gauge_awg: 22, colour: 'yellow/red', keyed_part_number: null,
    planned_length_ft: length, planned_length_method: length == null ? null : 'recorded plan', measured_length_ft: null,
    link_state: 'linked', specification_state: 'incomplete', legacy_check_state: 'unversioned', build_state: null,
  });
  return { contract_version: 1, vehicle_id: 'vehicle', snapshot_hash: 'source-content', read_at: '2026-11-28T00:00:00Z',
    snapshot_kind: 'current_read_not_published_revision', nets: [], connector_matings: [],
    design_selection: { owner: 'harness_model_inputs', contract_version: 2, kind: 'decided_design',
      circuit_ids: ['c110', 'c23', 'empty'], segment_ids: ['cabin-piece', 'engine-piece', 'conflict-piece'] },
    circuits: [
      { id: 'c110', code: '110', name: 'Coolant temperature', section: 'engine', design_status: 'decided', gauge_awg: 22 },
      { id: 'c23', code: '23', name: 'Conflicting source', section: 'engine', design_status: 'decided', gauge_awg: 18 },
      { id: 'empty', code: 'EMPTY', name: 'No piece record', section: 'engine', design_status: 'decided' },
    ],
    segments: [piece('cabin-piece', 'c110', 't1', 't2', 1.09), piece('engine-piece', 'c110', 't3', 't4', 3.54),
      { ...piece('conflict-piece', 'c23', 't5', 't6', null), gauge_awg: 20, circuit_gauge_awg: 18,
        keyed_part_number: 'M22759/32-18-2', specification_state: 'conflict' },
      piece('excluded-piece', 'c110', 't1', 't2', 99)],
    endpoints: ['ECU', 'CAB', 'BAY', 'SENSOR', 'LOAD', 'EMPTY-END'].map(code => ({ id: code, code, name: code, node_kind: 'terminals' })),
    terminations: [
      ['t1', 'c110', 'ECU', 'B04'], ['t2', 'c110', 'CAB', 'w'], ['t3', 'c110', 'BAY', 'w'], ['t4', 'c110', 'SENSOR', '1'],
      ['t5', 'c23', 'ECU', 'B05'], ['t6', 'c23', 'LOAD', 'A'],
    ].map(([id, circuit_id, endpoint_id, cavity]) => ({ id, circuit_id, endpoint_id, cavity, cavity_layout_id: null,
      terminal_contact_pn: '=HYPERLINK("https://example.invalid")', pin_seal_pn: null, crimp_tool_pn: null })),
    unsegmented_end_records: [{ id: 'unsegmented-end', circuit_id: 'empty', endpoint_id: 'EMPTY-END', endpoint_node_kind: 'terminals' }],
  };
}

it('uses only canonical piece membership and keeps zero-piece circuits and unsegmented ends as context', () => {
  const schedule = buildPhysicalPieceSchedule(fixture(), { query: '' }, false);
  expect(schedule.tables[0].rows.map(r => r.id)).toEqual(['conflict-piece', 'cabin-piece', 'engine-piece']);
  expect(schedule.tables[3].rows.find(r => r.id === 'empty')?.cells.pieces).toBe(0);
  const end = schedule.tables[1].rows.find(r => r.id === 'unsegmented-end')!;
  expect(end.cells.role).toContain('metadata not included');
  expect(end.cells).not.toHaveProperty('terminal');
  expect(schedule.manifest?.some(r => r.id === 'excluded-piece')).toBe(false);
});

it('makes one two-piece scope for the table, related records and exact record links', () => {
  const schedule = buildPhysicalPieceSchedule(fixture(), { query: '110' }, false);
  expect(schedule.tables.map(t => t.rows.length)).toEqual([2, 4, 4, 1]);
  expect(schedule.tables[0].rows.map(r => r.cells.planned)).toEqual([1.09, 3.54]);
  expect(schedule.manifest?.filter(r => r.kind === 'segments').map(r => r.id)).toEqual(['cabin-piece', 'engine-piece']);
  for (const table of schedule.tables) for (const row of table.rows) {
    const url = new URL(String(row.cells.record));
    expect(url.searchParams.get('record')).toBe(`${row.record!.kind}:${row.id}`);
  }
});

it('preserves separate piece and circuit gauges, unknown lengths and unknown piece state', () => {
  const schedule = buildPhysicalPieceSchedule(fixture(), { query: '23' }, false);
  expect(schedule.tables[0].rows[0].cells).toMatchObject({ gauge: 20, specification: 'conflict', planned: null, measured: null, build: null });
  expect(schedule.tables[3].rows[0].cells.gauge).toBe(18);
});

it('prefers an exact circuit code over similar codes and incidental UUID or text matches', () => {
  const model = fixture();
  model.circuits.push({ ...model.circuits[0], id: 'c110g', code: '110g' });
  model.segments.push({ ...model.segments[0], id: 'piece-110g', circuit_id: 'c110g', from_termination_id: null, to_termination_id: null });
  model.design_selection!.circuit_ids.push('c110g'); model.design_selection!.segment_ids.push('piece-110g');
  expect(buildPhysicalPieceSchedule(model, { query: '110' }, false).tables[0].rows.map(r => r.id)).toEqual(['cabin-piece', 'engine-piece']);
  expect(buildPhysicalPieceSchedule(model, { query: '110g' }, false).tables[0].rows.map(r => r.id)).toEqual(['piece-110g']);
});

it('can scope one exact piece or an unsegmented end without making a new piece', () => {
  expect(buildPhysicalPieceSchedule(fixture(), { query: '', linkedPieceIds: new Set(['engine-piece']) }, false).tables[0].rows.map(r => r.id)).toEqual(['engine-piece']);
  const end = buildPhysicalPieceSchedule(fixture(), { query: '', linkedEndIds: new Set(['unsegmented-end']) }, false);
  expect(end.tables[0].rows).toEqual([]);
  expect(end.tables[1].rows.map(r => r.id)).toEqual(['unsegmented-end']);
  expect(buildPhysicalPieceSchedule(fixture(), { query: 'unsegmented-end' }, false).tables[3].rows.map(r => r.id)).toEqual(['empty']);
});

it('retains unresolved typed references in the scope instead of silently repairing them', () => {
  const model = fixture(); model.terminations = model.terminations.filter(t => t.id !== 't2');
  const schedule = buildPhysicalPieceSchedule(model, { query: '110' }, false);
  expect(schedule.tables[0].rows[0].cells.to).toBe('[end record not returned]');
  expect(schedule.manifest).toContainEqual({ kind: 'ends', id: 't2', state: 'not returned by source reader' });
});

it('downloads exactly the scoped piece IDs with a manifest and real text cells', async () => {
  const schedule = buildPhysicalPieceSchedule(fixture(), { query: '110' }, false);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(await wiringWorkbookBytes(schedule) as never);
  expect(book.worksheets.map(s => s.name)).toEqual(['Physical wire pieces', 'Terminations', 'Connection points', 'Source circuits', 'Export scope']);
  const pieces = book.getWorksheet('Physical wire pieces')!;
  const idColumn = schedule.tables[0].columns.findIndex(c => c.key === 'id') + 1;
  expect([pieces.getRow(6).getCell(idColumn).value, pieces.getRow(7).getCell(idColumn).value]).toEqual(['cabin-piece', 'engine-piece']);
  expect(pieces.rowCount).toBe(7);
  const scope = book.getWorksheet('Export scope')!;
  expect(scope.getCell('A3').value).toBe('Source content source-content');
  const term = book.getWorksheet('Terminations')!, partColumn = schedule.tables[1].columns.findIndex(c => c.key === 'terminal') + 1;
  expect(term.getRow(6).getCell(partColumn).value).toBe('=HYPERLINK("https://example.invalid")');
  expect(term.getRow(6).getCell(partColumn).type).toBe(ExcelJS.ValueType.String);
});
