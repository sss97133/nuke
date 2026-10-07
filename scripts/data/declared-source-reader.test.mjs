// Mapping test for scripts/data/declared-source-reader.mjs: five public-shaped rows, no network, no env.
//   node --test scripts/data/declared-source-reader.test.mjs   (run by scripts/ci/verify.sh)
// Rows: an NSF STTR Phase I award with every column (quoted commas, an escaped quote and a line break in the abstract),
// an NSF award without an award date, another agency's award (both from the SBIR.gov bulk file shape); an NSF API SBIR
// Phase I award and an API award whose fundProgramName joins STTR Phase I with outreach. Values are invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvRecords, mapAll, mapNsfAward, mapSbirRow, nsfPrograms, usDate } from './declared-source-reader.mjs';

const SBIR_CONFIG = {
  mapping: 'sbir_gov_award_csv_v0', format: 'csv', kind: 'activity',
  url: 'https://data.www.sbir.gov/awarddatapublic/award_data.csv',
  identifier_column: 'Agency Tracking Number', date_column: 'Proposal Award Date',
  row_url: 'https://www.sbir.gov/awards?keywords={Agency Tracking Number}',
  filter: { Agency: 'National Science Foundation' },
};
const NSF_CONFIG = {
  mapping: 'nsf_awards_api_v0', format: 'json', kind: 'activity', url: 'https://api.nsf.gov/services/v1/awards.json',
  award_page: 'https://www.nsf.gov/awardsearch/showAward?AWD_ID={id}', identifier_field: 'id', date_field: 'startDate',
};
const ORG = '00000000-0000-4000-8000-0000000000f1', EXTRACTOR = '00000000-0000-4000-8000-0000000000e1';
const ctx = (config, extra = {}) => ({ slug: config.mapping.startsWith('sbir') ? 'sbir-gov-awards' : 'nsf-awards-api',
  config, subjectOrgId: ORG, extractorId: EXTRACTOR, fileUrl: { url: config.url, local_copy: 'fixture' }, ...extra });

const HEADER = ['Company', 'Award Title', 'Agency', 'Branch', 'Phase', 'Program', 'Agency Tracking Number', 'Contract',
  'Proposal Award Date', 'Contract End Date', 'Solicitation Number', 'Solicitation Year', 'Solicitation Close Date',
  'Proposal Receipt Date', 'Date of Notification', 'Topic Code', 'Award Year', 'Award Amount', 'Duns', 'HUBZone Owned',
  'Socially and Economically Disadvantaged', 'Women Owned', 'Number Employees', 'Company Website', 'Address1', 'Address2',
  'City', 'State', 'Zip', 'Abstract', 'Contact Name', 'Contact Title', 'Contact Phone', 'Contact Email', 'PI Name',
  'PI Title', 'PI Phone', 'PI Email', 'RI Name', 'RI POC Name', 'RI POC Phone'];
const CSV = [
  HEADER.join(','),
  // 1. NSF STTR Phase I, every column; the abstract holds a comma, an escaped quote and a line break.
  'Example Ledger Labs LLC,"STTR Phase I: Graded estimators, with outcomes",National Science Foundation,,Phase I,STTR,'
    + '2401234,2401234,07/01/2024,06/30/2025,NSF 23-516,2023,,,06/20/2024,DL,2024,"305,000",\'123456789\',N,Y,N,3,'
    + 'https://example.org,1 Main St,,Las Vegas,NV,89101,"A ""graded"" estimator,\r\nreplayed point in time.",'
    + 'Contact Person,CEO,555-0100,contact@example.org,Pat Investigator,CTO,555-0101,pi@example.org,'
    + 'Example State University,RI Contact,555-0102',
  // 2. NSF, no award date (older rows carry none): counted, never mapped.
  'Old Co,SBIR Phase I: Old,National Science Foundation,,Phase I,SBIR,9311111,,,,,,,,,,2015,"50,000",,N,N,N,,,,,'
    + 'Boston,MA,02110,Old abstract,,,,,,,,,,,',
  // 3. Another agency: out of scope.
  'Navy Co,Topic N1,Department of Defense,Navy,Phase I,SBIR,N24A-001,N68335-24-C-0001,03/01/2024,09/01/2024,,,,,,,2024,'
    + '"140,000",,N,N,N,12,,,,San Diego,CA,92101,Navy abstract,,,,,,,,,,,',
].join('\r\n') + '\r\n';

const API = [
  // 4. NSF API, SBIR Phase I.
  { id: '2501111', title: 'SBIR Phase I: Point-in-time replay', abstractText: 'An API abstract.', fundsObligatedAmt: '305000',
    awardeeName: 'API ONE INC', awardeeCity: 'Reno', awardeeStateCode: 'NV', awardeeZipCode: '895011234',
    ueiNumber: 'ABCDEF123456', date: '06/20/2025', startDate: '07/01/2025', expDate: '06/30/2026',
    fundProgramName: 'SBIR Phase I', program: 'SBIR Phase I', progEleCode: '537100', piFirstName: 'Alex', piLastName: 'Rivera',
    pdPIName: 'Alex Rivera', piEmail: 'alex@example.org', poPhone: '5550199', fy: '2025' },
  // 5. NSF API, STTR Phase I joined with outreach; starts in October, so fiscal year 2025.
  { id: '2502222', title: 'STTR Phase I: Joint', abstractText: 'Second.', fundsObligatedAmt: '275000',
    awardeeName: 'API TWO LLC', awardeeCity: 'Austin', awardeeStateCode: 'TX', awardeeZipCode: '78701', ueiNumber: '',
    date: '09/25/2024', startDate: '10/01/2024', expDate: '09/30/2025',
    fundProgramName: 'STTR Phase I, SBIR Outreach & Tech. Assist', program: 'STTR Phase I', progEleCode: '150500',
    piFirstName: '', piLastName: '', pdPIName: 'Sam Lee', piEmail: 'sam@example.org' },
];

async function* chunks(text, size) { for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size); }
async function sbirPayloads(config, extra) {
  const out = [];
  let header = null, n = 0;
  const rows = [];
  for await (const fields of csvRecords(chunks(CSV, 7))) {
    if (!header) { header = fields; continue; }
    rows.push([Object.fromEntries(header.map((h, i) => [h, fields[i] ?? ''])), ++n]);
  }
  async function* it() { yield* rows; }
  const report = await mapAll(it(), mapSbirRow, ctx(config, extra), (p) => { out.push(p); });
  return { out, report, rows };
}

test('the CSV parser keeps quoted commas, escaped quotes and line breaks inside a field, across chunk edges', async () => {
  const { rows } = await sbirPayloads(SBIR_CONFIG);
  assert.equal(rows.length, 3);
  assert.equal(rows[0][0]['Award Title'], 'STTR Phase I: Graded estimators, with outcomes');
  assert.equal(rows[0][0].Abstract, 'A "graded" estimator,\r\nreplayed point in time.');
  assert.equal(rows[0][0]['RI POC Phone'], '555-0102');
});

test('SBIR.gov rows: one NSF award mapped, the dateless one counted, the other agency filtered', async () => {
  const { out, report } = await sbirPayloads(SBIR_CONFIG);
  assert.deepEqual([report.rows_read, report.rows_in_scope, report.rows_mapped, report.missing_date], [3, 2, 1, 1]);
  const [p] = out;
  assert.equal(p.source_slug, 'sbir-gov-awards');
  assert.equal(p.kind, 'activity');
  assert.equal(p.observed_at, '2024-07-01T00:00:00.000Z');
  assert.equal(p.source_identifier, '2401234');
  assert.equal(p.source_url, 'https://www.sbir.gov/awards?keywords=2401234');
  assert.deepEqual(p.subject, { type: 'organization', id: ORG });
  assert.equal(p.extractor_id, EXTRACTOR);
  assert.equal(p.extraction_method, 'declared_source_reader_v0');
  assert.equal(p.extraction_metadata.row_number, 1);
  assert.equal(p.content_text, 'A "graded" estimator,\r\nreplayed point in time.');
  const s = p.structured_data;
  assert.equal(s.kind_detail, 'funding_award');
  assert.equal(s.relation, 'awarded_to');
  assert.equal(s.funder, 'National Science Foundation');
  assert.deepEqual([s.program, s.phase, s.award_year, s.amount_usd], ['STTR', 'Phase I', 2024, 305000]);
  assert.deepEqual([s.start_date, s.end_date, s.notification_date], ['2024-07-01', '2025-06-30', '2024-06-20']);
  assert.deepEqual(s.awardee, { name: 'Example Ledger Labs LLC', city: 'Las Vegas', state: 'NV', zip: '89101',
    duns: '123456789', uei: null, website: 'https://example.org', employees_at_award: 3, hubzone_owned: false,
    women_owned: false, socially_economically_disadvantaged: true });
  assert.deepEqual(s.pi, { name: 'Pat Investigator' });
  assert.deepEqual(s.research_institution, { name: 'Example State University' });
  assert.equal(s.topic_code, 'DL');
  assert.match(s.source_row_hash, /^[0-9a-f]{64}$/);
});

test('NSF API awards: SBIR Phase I and a joined STTR Phase I map; fiscal year from the start date', async () => {
  const out = [];
  async function* it() { let n = 0; for (const a of API) yield [a, ++n]; }
  const report = await mapAll(it(), mapNsfAward, ctx(NSF_CONFIG, { phase: 'Phase I' }), (p) => { out.push(p); });
  assert.deepEqual([report.rows_read, report.rows_mapped], [2, 2]);
  const [a, b] = out;
  assert.equal(a.source_url, 'https://www.nsf.gov/awardsearch/showAward?AWD_ID=2501111');
  assert.equal(a.observed_at, '2025-07-01T00:00:00.000Z');
  assert.deepEqual([a.structured_data.program, a.structured_data.phase, a.structured_data.award_year], ['SBIR', 'Phase I', 2025]);
  assert.equal(a.structured_data.amount_basis, 'funds_obligated');
  assert.equal(a.structured_data.awardee.uei, 'ABCDEF123456');
  assert.deepEqual(a.structured_data.pi, { name: 'Alex Rivera' });
  assert.deepEqual(a.structured_data.program_element, { code: '537100', name: 'SBIR Phase I' });
  assert.deepEqual([b.structured_data.program, b.structured_data.phase, b.structured_data.award_year], ['STTR', 'Phase I', 2025]);
  assert.equal(b.structured_data.fund_program_name, 'STTR Phase I, SBIR Outreach & Tech. Assist');
  assert.equal(b.structured_data.awardee.uei, null);
  assert.deepEqual(b.structured_data.pi, { name: 'Sam Lee' });
});

test('no contact detail is copied into any payload', async () => {
  const { out } = await sbirPayloads(SBIR_CONFIG);
  const api = API.map((x, i) => mapNsfAward(x, i + 1, ctx(NSF_CONFIG)).payload);
  const text = JSON.stringify([...out, ...api]);
  for (const s of ['@example.org', '555-01', '5550199', 'Contact Person', 'RI Contact']) assert.ok(!text.includes(s), s);
});

test('mapping is deterministic, so a re-run is a duplicate at the writer; the pull-added fy key changes nothing', async () => {
  const first = (await sbirPayloads(SBIR_CONFIG)).out, second = (await sbirPayloads(SBIR_CONFIG)).out;
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  const withFy = mapNsfAward(API[0], 1, ctx(NSF_CONFIG)).payload;
  const { fy: _fy, ...rest } = API[0];
  assert.equal(mapNsfAward(rest, 1, ctx(NSF_CONFIG)).payload.structured_data.source_row_hash,
    withFy.structured_data.source_row_hash);
});

test('filters, unresolved subjects and helpers', async () => {
  const { report } = await sbirPayloads(SBIR_CONFIG, { sinceYear: 2025 });
  assert.equal(report.rows_mapped, 0);
  const unresolved = mapSbirRow(Object.fromEntries(HEADER.map((h) => [h, ''])), 9, ctx(SBIR_CONFIG));
  assert.equal(unresolved.skip, 'filtered');
  const noSubject = mapNsfAward(API[0], 1, ctx(NSF_CONFIG, { subjectOrgId: null })).payload;
  assert.deepEqual(noSubject.subject, { type: 'organization' });
  assert.deepEqual(nsfPrograms('Phase I Ctrs for Chem Innovati'), []);
  assert.equal(mapNsfAward({ ...API[0], fundProgramName: 'Phase I Ctrs for Chem Innovati' }, 1, ctx(NSF_CONFIG)).skip, 'filtered');
  assert.equal(usDate('02/30/2024'), null);
  assert.equal(usDate('2/3/2024'), '2024-02-03');
});
