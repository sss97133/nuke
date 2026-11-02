// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ retry: vi.fn(), importListing: vi.fn(), extraction: null as any, error: null as string | null }));
vi.mock('../hooks/useSearchPage', () => ({ useSearchPage: () => ({ query:'volvo', displayResults:[], vehicleCount:0,
  loading:false, searchSummary:'', resultFilter:'all', filters:{}, searchError:fixture.error, retrySearch:fixture.retry, urlExtraction:fixture.extraction, startUrlImport:fixture.importListing }) }));
vi.mock('../hooks/useSearchEmptyState', () => ({ useSearchEmptyState: () => ({}) }));
vi.mock('../components/search/SearchResults', () => ({ default: () => <p>Result list</p> }));
vi.mock('../components/search/SearchEmptyState', () => ({ SearchEmptyState: () => null }));
import Search from './Search';
let host: HTMLDivElement, root: Root;
function Location() { return <output>{useLocation().search}</output>; }
const render = async () => act(async () => root.render(<MemoryRouter initialEntries={['/search?q=volvo']}><Search/><Location/></MemoryRouter>));
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true); fixture.error=null; fixture.extraction=null; fixture.retry.mockReset(); fixture.importListing.mockReset(); host=document.createElement('div'); document.body.append(host); root=createRoot(host); });
afterEach(async () => { await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals(); });
it('presents a failed read as unavailable with retry, without a zero-result conclusion', async () => {
  fixture.error='Search could not be completed. Try again.'; await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Search unavailable');
  expect(host.textContent).not.toContain('Result list');
  const retry=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Retry search')!;
  await act(async()=>retry.click()); expect(fixture.retry).toHaveBeenCalledOnce();
});
it('submits the labelled search field and clears the route explicitly', async () => {
  await render(); const input=host.querySelector<HTMLInputElement>('[aria-label="Search vehicles and records"]')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Saab 900');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(host.querySelector('output')?.textContent).toBe('?q=Saab+900');
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Clear search"]')!.click());
  expect(host.querySelector('output')?.textContent).toBe(''); expect(input.value).toBe('');
});

it('offers an explicit listing import and announces the pending state', async () => {
  fixture.extraction={status:'ready',url:'https://example.invalid/listing',platform:null};
  await render(); expect(fixture.importListing).not.toHaveBeenCalled();
  const button=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Import listing')!;
  expect(button).toBeDefined(); await act(async()=>button.click()); expect(fixture.importListing).toHaveBeenCalledOnce();
  fixture.extraction={...fixture.extraction,status:'extracting'};await render();
  expect(host.querySelector('[role="status"]')?.textContent).toContain('Importing');
  expect(Array.from(host.querySelectorAll('button')).some(b=>b.textContent==='Import listing')).toBe(false);
});

it('opens an ECR source URL as a profile without starting extraction or minting a physical vehicle', async () => {
  const url='https://exclusivecarregistry.com/details/pagani/zonda/123';
  fixture.extraction={status:'ready',url,platform:null};await render();
  const link=[...host.querySelectorAll('a')].find(a=>a.textContent==='Open source profile');
  expect(link?.getAttribute('href')).toBe('/vehicle/source?source_url='+encodeURIComponent(url));
  expect(fixture.importListing).not.toHaveBeenCalled();
  expect([...host.querySelectorAll('button')].some(b=>b.textContent==='Import listing')).toBe(false);
});
