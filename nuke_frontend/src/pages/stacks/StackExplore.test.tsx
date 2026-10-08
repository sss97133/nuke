// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { makeStudy, type BidLot, type StudyBid, type StudyDataset } from './bidMeasurements';
const fixture = vi.hoisted(() => ({study:{} as Record<string,unknown>,read:{} as Record<string,unknown>,requests:[] as unknown[]}));
vi.mock('./bidPopulationReader', () => ({useBidStudy:() => fixture.study,useBidPopulation:(request:unknown) => {fixture.requests.push(request);return fixture.read;}}));
vi.mock('../../components/PrefetchLink', () => ({PrefetchLink:({to,...p}:{to:string} & Record<string,unknown>) => <a href={to} {...p} />}));
import StacksIndex from './StacksIndex';

function data(): StudyDataset {
  const lots: BidLot[] = [], bids: StudyBid[] = [];
  for (let i = 0; i < 12; i++) {
    const id = `lot-${i}`, make = i < 10 ? 'Chevrolet' : 'Ford';
    const lot: BidLot = {id,vehicle_id:`vehicle-${i}`,source:'bat',source_url:`https://bringatrailer.com/listing/test-${i}/`,auction_end_date:'2026-10-01T20:00:00Z',total_bids:3,winning_bid:300 + i * 100,winning_bidder_external_identity_id:'a',vehicles:{id:`vehicle-${i}`,year:i % 2 ? 2002 : 2003,make,model:i < 10 ? 'Corvette Z06' : 'Mustang',normalized_model:i < 10 ? 'Corvette' : 'Mustang'}};
    lots.push(lot);
    [100,200 + i * 100,300 + i * 100].forEach((amount,j) => bids.push({id:`${id}-${j}`,auction_event_id:id,vehicle_id:lot.vehicle_id,source_url:lot.source_url,posted_at:`2026-10-01T19:${j * 10}:00Z`.replace('19:0:','19:00:'),created_at:'2026-10-02T00:00:00Z',bid_amount:amount,external_identity_id:j % 2 ? 'b' : 'a',author_username:j % 2 ? 'B' : 'A',bat_comment_id:j + 1}));
  }
  return makeStudy(lots,bids,'2026-10-08T05:29:00Z','Synthetic test population',false);
}
let root: Root, container: HTMLDivElement;
async function render(path='/stacks') {await act(async () => root.render(<MemoryRouter initialEntries={[path]}><StacksIndex /></MemoryRouter>));}
async function click(element: Element | undefined | null) {expect(element).toBeTruthy();await act(async () => element!.dispatchEvent(new MouseEvent('click',{bubbles:true})));}
function button(text:string,selector='button') {return [...container.querySelectorAll(selector)].find(e => e.textContent?.includes(text));}
async function select(label:string,value:string) {
  const el = [...container.querySelectorAll('label')].find(e => e.childNodes[0]?.textContent === label)?.querySelector('select');
  expect(el).toBeTruthy();await act(async () => {el!.value=value;el!.dispatchEvent(new Event('change',{bubbles:true}));});
}
beforeEach(() => {
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});
  vi.stubGlobal('scrollTo',vi.fn());
  fixture.study={data:data(),isPending:false,isError:false};fixture.read={data:undefined,isPending:false,isError:false,isFetching:false,refetch:vi.fn()};fixture.requests=[];
  container=document.createElement('div');document.body.append(container);root=createRoot(container);
});
afterEach(async () => {await act(async () => root.unmount());container.remove();vi.unstubAllGlobals();});

it('opens on four measured corpus views and never auto-loads or displays a demonstration auction', async () => {
  await render();
  expect(container.querySelectorAll('.sx-preview')).toHaveLength(4);
  expect(container.querySelector('.sx-corpus')?.textContent).toContain('12 auctions');
  expect(container.querySelector('.stack-card')).toBeNull();
  expect(container.querySelector('.sx-expression')).toBeNull();
});
it('carries make→model→auction comparison into its contributing source drill', async () => {
  await render();await click(button('Raise size by make','.sx-preview-title'));
  await click(button('Chevrolet','.sx-distribution-row'));
  expect(container.querySelector('.sx-measure-heading')?.textContent).toContain('10 auctions');
  await click(button('Corvette','.sx-distribution-row'));
  expect(container.querySelector('.sx-measure-heading')?.textContent).toContain('by auction');
  expect(container.querySelector('.sx-reference-inspector summary')?.textContent).toContain('10 auction records');
  await click(container.querySelector('.sx-distribution-row'));
  const href = container.querySelector('.sx-contributors a')?.getAttribute('href') ?? '';
  expect(href).toContain('/stacks/order-book/vehicle-');expect(href).toContain('lot=lot-');
  const back = new URL(href,'https://nuke.ag').searchParams.get('back');
  expect(new URLSearchParams(back!).get('make')).toBe('Chevrolet');
  expect(new URLSearchParams(back!).get('model')).toBe('Corvette');
});
it('changes measurement contributors by vehicle year independently of the bid calendar year', async () => {
  await render('/stacks?stack=SA&by=auction&measure=amount&make=Chevrolet&model=Corvette&from=2026&to=2026');
  await select('Vehicle model year','2002');
  expect(container.querySelector('.sx-measure-heading')?.textContent).toContain('5 auctions');
  await select('Measure','increment');
  expect(container.querySelector('.sx-measure-heading')?.textContent).toContain('Mean raise');
  expect(container.querySelectorAll('.sx-distribution-row')).toHaveLength(5);
});
it('preserves scope when model and grouping controls change before navigation commits', async () => {
  await render('/stacks?stack=SA&make=Chevrolet&by=make&from=2026&to=2026');
  const selects = [...container.querySelectorAll('label')];
  const model = selects.find(e => e.childNodes[0]?.textContent === 'Model label')!.querySelector('select')!;
  const grouping = selects.find(e => e.childNodes[0]?.textContent === 'Group by')!.querySelector('select')!;
  await act(async () => {
    model.value = 'Corvette'; model.dispatchEvent(new Event('change',{bubbles:true}));
    grouping.value = 'auction'; grouping.dispatchEvent(new Event('change',{bubbles:true}));
  });
  expect(container.querySelector('.sx-breadcrumb')?.textContent).toContain('Corvette');
  expect(container.querySelector('.sx-measure-heading')?.textContent).toContain('by auction');
  await click(container.querySelector('.sx-distribution-row'));
  const href = container.querySelector('.sx-contributors a')!.getAttribute('href')!;
  const back = new URLSearchParams(new URL(href,'https://nuke.ag').searchParams.get('back')!);
  expect(back.get('make')).toBe('Chevrolet'); expect(back.get('model')).toBe('Corvette'); expect(back.get('by')).toBe('auction');
});
it('restores selected contributors from a shared URL and labels a participant record as captured outcomes', async () => {
  await render('/stacks?stack=S03&by=participant&measure=typical&from=2026&to=2026&group=a');
  expect(container.querySelector('.sx-contributors')?.textContent).toContain('12 recorded wins / 12 known winner records in this sample');
  expect(container.querySelector('.sx-distribution-row')?.getAttribute('aria-label')).toContain('12 auctions');
});
it('selects a new bounded reader and shows no retained measurement as a substitute while it loads or fails', async () => {
  fixture.read={isPending:true,isFetching:true};
  await render('/stacks?stack=SA&source=read&make=Chevrolet&by=auction&from=2026&to=2026');
  expect(fixture.requests[fixture.requests.length-1]).toEqual({make:'Chevrolet',model:null,year:2026});
  expect(container.querySelector('.sx-measure-heading')).toBeNull();
  expect(container.querySelector('.sx-loading')?.textContent).toContain('Reading');
});
it('shows the actual definition for an unsupported question without fabricating a result or readiness', async () => {
  await render('/stacks?stack=S61');
  expect(container.querySelector('.sx-definition')?.textContent).toContain('Funding opportunity fit');
  expect(container.querySelector('.sx-definition')?.textContent).toContain('not connected');
  expect(container.querySelector('.sx-expression')).toBeNull();
});

it('opens the clicked overview make directly, with recognizable local logos and no nested buttons', async () => {
  await render();
  const overview = container.querySelector('.sx-overview')!;
  expect(overview.querySelectorAll('button button')).toHaveLength(0);
  expect(overview.querySelector('img[src="/stacks/makes/chevrolet.svg"]')?.getAttribute('width')).toBe('24');
  await click(button('Chevrolet','.sx-preview[aria-label="Raise size by make"] .sx-distribution-row'));
  expect(container.querySelector('.sx-breadcrumb')?.textContent).toContain('Chevrolet');
  expect(container.querySelector('.sx-measure-heading')?.textContent).toContain('by model');
});
it('opens the exact reference contributors on demand and keeps selected auction evidence beside its row', async () => {
  await render('/stacks?stack=SA&by=auction&measure=amount&make=Chevrolet&model=Corvette&from=2026&to=2026');
  expect(container.querySelector('.sx-contributors')).toBeNull();
  const reference = container.querySelector('.sx-reference-inspector') as HTMLDetailsElement;
  await act(async () => {reference.open=true;reference.dispatchEvent(new Event('toggle'));});
  expect(reference.textContent).toContain('10 auction records');
  expect(reference.querySelectorAll('tbody tr')).toHaveLength(10);
  await act(async () => {reference.open=false;reference.dispatchEvent(new Event('toggle'));});
  await click(container.querySelector('.sx-distribution-row'));
  expect(container.querySelector('.sx-distribution-row')?.nextElementSibling?.className).toBe('sx-inspection-head');
  expect(container.querySelector('.sx-contributors tbody tr')).toBeTruthy();
  await click(button('Close inspection'));
  expect(container.querySelector('.sx-contributors')).toBeNull();
});
it('opens an annual overview mark with that year’s contributor context', async () => {
  await render();await click(button('2026','.sx-year-buttons button'));
  expect(container.querySelector('.sx-contributors')?.textContent).toContain('2026');
  expect(container.querySelector('.sx-contributors .sx-chart-note')?.textContent).toContain('12 auction-year records');
  expect(container.querySelector('.sx-contributors .sx-chart-note')?.textContent).toContain('not a rank among year averages');
  expect(container.querySelector('.sx-contributors tbody tr')).toBeTruthy();
});

it('keeps a shared auction selection beyond the default page immediately inspectable', async () => {
  await render('/stacks?stack=SA&by=auction&measure=amount&from=2026&to=2026&group=lot-0');
  expect(container.querySelector('.sx-distribution-row')?.getAttribute('aria-pressed')).toBe('true');
  expect(container.querySelector('.sx-contributors a')?.getAttribute('href')).toContain('lot=lot-0');
  expect(container.querySelector('.sx-comparison-axis')?.textContent).toContain('Percentile / 12 auctions');
});

it('keeps a scatter drill on its paired denominator until the user explicitly broadens it', async () => {
  const d = data(), lot = d.lots[0];
  const sums = {bids:1,bidSum:100,raises:0,raiseSum:0,relativeSum:0,gaps:[],relativeValues:[],identityIds:['a'],unresolvedBids:0};
  d.lots.push({...lot,id:'single-bid',vehicleId:'single-vehicle',hammer:100,sums,years:{'2026':sums},actors:[{identity:'a',handle:'A',entrySeconds:0,topBid:100,medianSpacing:null,medianRelative:null,bids:1,bidSum:100,raises:0,raiseSum:0,relativeSum:0,identityIds:['a'],unresolvedBids:0}]});
  fixture.study={...fixture.study,data:d};
  await render('/stacks?stack=S03&by=participant&measure=winRate&from=2026&to=2026&group=a&paired=entry-outcome');
  expect(container.querySelector('.sx-selection-note')?.textContent).toContain('paired entry/outcome records');
  expect(container.querySelector('.sx-contributors')?.textContent).toContain('12 recorded wins / 12 known winner records');
  const back = new URLSearchParams(new URL(container.querySelector('.sx-contributors a')!.getAttribute('href')!,'https://nuke.ag').searchParams.get('back')!);
  expect(back.get('paired')).toBe('entry-outcome');
  await click(button('All captured outcomes'));
  expect(container.querySelector('.sx-contributors')?.textContent).toContain('13 recorded wins / 13 known winner records');
});
