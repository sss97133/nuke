// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('./OneMap', () => ({ default: () => <div>ZIP outline map</div> }));
import { ZipOutlineDialog } from './ZipOutlineDialog';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

it('uses the native modal and returns focus to its opener', async () => {
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  const show = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  const close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: show });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: close });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const onClose = vi.fn();
  const location = { key: 'location.map', status: 'reading', value: { zcta: '89005',
    bounds: { county_fips: '32003', geojson: 'map-data/geo/v1/county/32003.geojson' } } };
  await act(async () => { root.render(<ZipOutlineDialog location={location} onClose={onClose} />); });
  expect(show).toHaveBeenCalledOnce();
  const dialog = document.querySelector('dialog');
  expect(dialog?.open).toBe(true);
  await act(async () => { dialog?.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true })); });
  expect(onClose).toHaveBeenCalledOnce();
  await act(async () => { root.unmount(); });
  expect(close).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(opener);
  delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
  delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
});
