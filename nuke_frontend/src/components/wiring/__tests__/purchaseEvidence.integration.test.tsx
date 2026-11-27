// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { computeOverlay, type ManifestDevice } from '../overlayCompute';
import { generateBOM, bomToText } from '../generateBOM';
import { generateBOMCSV } from '../generateEZWireCSV';
import { useDRC } from '../useDRC';
import { useOverlayCompute } from '../useOverlayCompute';
import { DataView } from '../DataView';

vi.mock('../WireMaterialPopup', () => ({ WireMaterialPopup: () => null }));
vi.mock('../ComponentCard', () => ({ ComponentCard: () => null }));
import { WiringDetailPanel } from '../WiringDetailPanel';

// The nullable public state emitted by test_build_manifest_purchase_review.sql,
// transported as JSON rather than normalized through a boolean client cast.
const devices = JSON.parse(JSON.stringify([
  { id: 'withdrawn', device_name: 'Withdrawn sensor', device_category: 'sensors', purchased: null, status: 'identified', evidence_level: 'assumed', signal_type: 'analog_temp', pin_count: 2 },
  { id: 'not-purchased', device_name: 'Unpurchased sensor', device_category: 'sensors', purchased: false, signal_type: 'analog_temp', pin_count: 2 },
  { id: 'purchased', device_name: 'Purchased sensor', device_category: 'sensors', purchased: true, signal_type: 'analog_temp', pin_count: 2 },
])) as ManifestDevice[];
const overlay = computeOverlay(devices);
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('adding a local device without acquisition testimony stays unknown while explicit inputs are retained', async () => {
  const empty: ManifestDevice[] = [];
  let state!: ReturnType<typeof useOverlayCompute>;
  function Probe() { state = useOverlayCompute(empty); return null; }
  await act(async () => root.render(<Probe />));
  await act(async () => { state.addDevice({ device_name: 'Unqualified planned sensor', device_category: 'sensors' }); });
  expect(state.devices[0].purchased).toBeNull();
  expect(state.result.devicesUnpurchased).toBe(0);
  await act(async () => {
    state.addDevice({ device_name: 'Explicit true', device_category: 'sensors', purchased: true });
    state.addDevice({ device_name: 'Explicit false', device_category: 'sensors', purchased: false });
    state.addDevice({ device_name: 'Explicit unknown', device_category: 'sensors', purchased: null });
    state.addDevice({ device_name: 'Undefined input', device_category: 'sensors', purchased: undefined });
  });
  expect(state.devices.map(d => d.purchased)).toEqual([null, true, false, null, null]);
  expect(state.result.devicesUnpurchased).toBe(1);
});

it('retains withdrawal as unknown through BOM and text/CSV exports without putting it in the not-purchased count', () => {
  const doc = generateBOM(overlay, devices);
  const items = doc.sections.flatMap(section => section.items);
  expect(items.find(item => item.partName === 'Withdrawn sensor')?.purchased).toBeNull();
  expect(items.find(item => item.partName === 'Unpurchased sensor')?.purchased).toBe(false);
  expect(items.find(item => item.partName === 'Purchased sensor')?.purchased).toBe(true);
  expect(doc.purchasedItems).toBe(1); expect(doc.unpurchasedItems).toBe(1);
  expect(doc.unknownPurchaseItems).toBe(doc.totalParts - 2);
  expect(doc.purchasedItems + doc.unpurchasedItems + doc.unknownPurchaseItems).toBe(items.length);
  expect(items.find(item => item.partName.includes('Complete Connector Kit'))?.purchased).toBeNull();
  expect(items.find(item => item.partName.includes('TXL Wire'))?.purchased).toBeNull();
  expect(overlay.devicesUnpurchased).toBe(1);
  expect(bomToText(doc).split('\n').find(line => line.includes('Withdrawn sensor'))).toContain('PURCHASE UNKNOWN');
  expect(generateBOMCSV(overlay, devices).split('\n').find(line => line.includes('Withdrawn sensor'))).toContain('UNKNOWN');
});

it('never transfers a source device purchase to a differently recommended model by display name', () => {
  const source = [...devices, { id: 'owned-ecu', device_name: 'ECU', device_category: 'engine_mgmt', model_number: 'M130', purchased: true }];
  const changedRecommendation = { ...overlay, recommendedConfig: { ...overlay.recommendedConfig,
    ecu: { ...overlay.recommendedConfig.ecu, model: 'M150' } } };
  const line = generateBOM(changedRecommendation, source).sections[0].items.find(item => item.partName === 'M150 ECU');
  expect(line?.purchased).toBeNull();
});

it('shows unknown in the selected device detail instead of an affirmative NO', async () => {
  await act(async () => root.render(<WiringDetailPanel device={devices[0]} ecuModel="M130"
    positionDirty={false} onClose={() => {}} onSavePosition={() => {}} />));
  const purchaseRow = [...host.querySelectorAll('div')].find(node =>
    node.children.length === 2 && node.firstElementChild?.textContent === 'PURCHASED');
  expect(purchaseRow?.textContent).toContain('UNKNOWN — VERIFY');
  expect(purchaseRow?.lastElementChild?.textContent).not.toBe('NO');
});

it('renders the unknown BOM row as a verification hold, while explicit false remains not purchased', async () => {
  await act(async () => root.render(<DataView devices={devices} result={overlay} selectedDeviceId={null}
    selectedDeviceIds={new Set()} selectedWireId={null} onDeviceClick={() => {}} onWireClick={() => {}}
    onDeselect={() => {}} fitRequested={0} zoneColors={{}}
    overlay={{ devices, result: overlay, terminations: [], terminationSummary: { total: 0, ready: 0, notReady: 0, readyPct: 0 } }} />));
  const tab = [...host.querySelectorAll('button')].find(button => button.textContent === 'BOM');
  expect(tab).toBeDefined();
  await act(async () => tab!.click());
  const rows = [...host.querySelectorAll('tr')];
  expect(rows.find(row => row.textContent?.includes('Withdrawn sensor'))?.textContent).toContain('PURCHASE UNKNOWN — VERIFY');
  expect(rows.find(row => row.textContent?.includes('Unpurchased sensor'))?.textContent).toContain('NOT PURCHASED');
});

it('keeps acquisition uncertainty distinct from the DRC not-purchased conclusion', async () => {
  function Check() {
    const { drcMap } = useDRC(devices, overlay);
    return <pre>{JSON.stringify(devices.map(device => drcMap.get(device.id)?.rules.find(rule => rule.ruleId === 'unpurchased-critical')))}</pre>;
  }
  await act(async () => root.render(<Check />));
  const [unknown, absent, bought] = JSON.parse(host.textContent!);
  expect(unknown.message).toContain('Purchase status unknown'); expect(unknown.severity).toBe('warn');
  expect(absent.message).toContain('not purchased'); expect(absent.severity).toBe('fail');
  expect(bought.message).toBe('Purchased');
});
