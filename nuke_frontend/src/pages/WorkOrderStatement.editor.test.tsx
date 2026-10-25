// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({user:null,loading:false}) }));
vi.mock('./vehicle-profile/hooks/useWorkOrderStatement', () => ({ useWorkOrderStatement: vi.fn() }));
import { CellEditor, EditView, StatusSelect } from './WorkOrderStatement';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const render = async (element: React.ReactNode) => { await act(async () => root.render(element)); };
const click = async (element: HTMLElement) => { await act(async () => element.click()); };
const type = async (value: string) => {
  const input = host.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', {bubbles:true}));
  });
};
const key = async (value: string) => { await act(async () => host.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', {key:value,bubbles:true}))); };

it('Escape cancels the pending autosave, including a later blur; another edit can still save', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  await render(<CellEditor value="Original" onSave={save} />); await click(host.querySelector('button')!);
  await type('Cancelled draft'); const oldInput = host.querySelector('input')!; await key('Escape');
  await act(async () => { oldInput.dispatchEvent(new FocusEvent('focusout', {bubbles:true})); vi.advanceTimersByTime(2000); });
  expect(save).not.toHaveBeenCalled(); expect(host.textContent).toContain('Original');
  await click(host.querySelector('button')!); await type('Next draft'); await key('Enter');
  expect(save).toHaveBeenCalledExactlyOnceWith('Next draft');
});

it('unmounting a pending draft cancels its autosave', async () => {
  const save = vi.fn(); await render(<CellEditor value="Original" onSave={save} />);
  await click(host.querySelector('button')!); await type('Unsent'); await render(<p>Another viewer</p>);
  await act(async () => vi.advanceTimersByTime(2000)); expect(save).not.toHaveBeenCalled();
});

it('a timer and blur cannot dispatch duplicate saves, and failure retains the draft for retry', async () => {
  let reject!: (error: Error) => void;
  const save = vi.fn().mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValue(undefined);
  await render(<CellEditor value={10} type="number" onSave={save} />); await click(host.querySelector('button')!); await type('12.34');
  await act(async () => vi.advanceTimersByTime(1500));
  await act(async () => host.querySelector('input')!.dispatchEvent(new FocusEvent('focusout', {bubbles:true})));
  await key('Enter'); expect(save).toHaveBeenCalledExactlyOnceWith(12.34);
  await act(async () => reject(new Error('Writer refused the change')));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Writer refused');
  expect(host.querySelector('input')?.value).toBe('12.34'); expect(host.textContent).not.toContain('Saved');
  await click(host.querySelector('button')!); expect(save).toHaveBeenCalledTimes(2); expect(host.textContent).toContain('Saved');
});

it('status changes show failures and block repeat submission while pending', async () => {
  let reject!: (error: Error) => void;
  const save = vi.fn(() => new Promise((_, fail) => { reject = fail; }));
  await render(<StatusSelect value="ordered" options={[{value:'ordered',label:'Ordered',color:'black'},{value:'received',label:'Received',color:'black'}]} onSave={save} />);
  const select = host.querySelector('select')!;
  await act(async () => { select.value = 'received'; select.dispatchEvent(new Event('change', {bubbles:true})); });
  expect(select.disabled).toBe(true);
  await act(async () => { select.dispatchEvent(new Event('change', {bubbles:true})); reject(new Error('Status could not be saved')); });
  expect(save).toHaveBeenCalledTimes(1); expect(select.value).toBe('ordered');
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Status could not be saved');
});

it.each(['add', 'delete', 'comp'])('surfaces %s failures without an unhandled rejection or duplicate action', async (kind) => {
  let reject!: (error: Error) => void;
  const write = vi.fn(() => new Promise((_, fail) => { reject = fail; }));
  const data = {vehicle:{year:2000,make:'Example',model:'Car'},moneyVisible:true,totals:{balance:10},workOrders:[{id:'wo',title:'Example job'}],parts:{wo:[{id:'part',part_name:'Part',is_comped:false,status:'ordered'}]},labor:{wo:[]},payments:{wo:[{id:'payment',amount:10,memo:'Example payment'}]}};
  await render(<EditView data={data} updateField={vi.fn()} addRow={write} deleteRow={write} toggleComp={write} onInvoice={vi.fn()} />);
  const button = kind === 'add' ? Array.from(host.querySelectorAll('button')).find(b => b.textContent === '+ ADD PART')! : host.querySelector<HTMLButtonElement>(kind === 'delete' ? '[aria-label="Delete payment"]' : '[aria-label="Comp Part"]')!;
  await click(button); await click(button); expect(button.disabled).toBe(true); expect(write).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error('Existing writer refused the request')));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Existing writer refused the request');
  expect(host.textContent).toContain('Example payment'); expect(button.disabled).toBe(false);
});
