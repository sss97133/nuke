// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./HeaderSearch', () => ({
  default: function RealSearch({initialQuery,pendingSubmitQuery}: {initialQuery?:string;pendingSubmitQuery?:string}) {
    const [value, setValue] = useState(initialQuery??'');
    return <div data-testid="real" data-pending-query={pendingSubmitQuery}><input type="text" aria-label="Magic Box — search, URL, VIN, or image" value={value} onChange={e => setValue(e.target.value)} /></div>;
  },
}));
import HeaderSearchLauncher from './HeaderSearchLauncher';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ''; });
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

async function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(<HeaderSearchLauncher />); });
  return el;
}

describe('HeaderSearchLauncher', () => {
  it('draws the same box without the real search, then swaps it in on typing and hands over the text and focus', async () => {
    const el = await mount();
    const placeholder = el.querySelector('input')!;
    expect(el.querySelector('[data-testid="real"]')).toBeNull();
    expect(placeholder.placeholder).toBe('SEARCH, PASTE URL, VIN, OR DROP IMAGE...');
    expect(placeholder.getAttribute('aria-label')).toBe('Magic Box — search, URL, VIN, or image');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(placeholder, 'k5 blazer');
      placeholder.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await tick(); await tick();
    const real = el.querySelector('[data-testid="real"] input') as HTMLInputElement;
    expect(real).not.toBeNull();
    expect(real.value).toBe('k5 blazer');
    expect(document.activeElement).toBe(real);
  });

  it('swaps on focus', async () => {
    const el = await mount();
    await act(async () => { el.querySelector('input')!.focus(); });
    await tick(); await tick();
    expect(document.activeElement).toBe(el.querySelector('[data-testid="real"] input'));
  });
});

it('carries an Enter pressed before activation without waiting for a second keypress',async()=>{
 const el=await mount(),input=el.querySelector('input')!;
 await act(async()=>{
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Chevrolet K5 Blazer');
  input.dispatchEvent(new Event('input',{bubbles:true}));
  input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
 });await tick();
 expect(el.querySelector('[data-testid="real"]')?.getAttribute('data-pending-query')).toBe('Chevrolet K5 Blazer');
 expect((el.querySelector('[data-testid="real"] input') as HTMLInputElement).value).toBe('Chevrolet K5 Blazer');
});
it.each(['edit','Escape','shift','composition'])('does not queue an unwanted submission for %s',async(reason)=>{
 const el=await mount(),input=el.querySelector('input')!;
 await act(async()=>{
  const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
  set.call(input,'Camaro');input.dispatchEvent(new Event('input',{bubbles:true}));
  input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,shiftKey:reason==='shift',isComposing:reason==='composition'}));
  if(reason==='edit'){set.call(input,'K5 Blazer');input.dispatchEvent(new Event('input',{bubbles:true}));}
  if(reason==='Escape')input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 });await tick();
 expect(el.querySelector('[data-testid="real"]')?.hasAttribute('data-pending-query')).toBe(false);
});
