// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./GlobalUploadIndicator', () => ({ default: () => <div data-testid="indicator">uploading</div> }));
import UploadIndicatorLauncher, { UPLOAD_QUEUE_EVENT, hasPersistedUploads } from './UploadIndicatorLauncher';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ''; delete (window as { __nukeUploadQueue?: boolean }).__nukeUploadQueue; });
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

async function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(<UploadIndicatorLauncher />); });
  await settle();
  return el;
}

describe('UploadIndicatorLauncher', () => {
  it('loads nothing when no upload exists', async () => {
    expect(await hasPersistedUploads()).toBe(false);
    const el = await mount();
    expect(el.textContent).toBe('');
  });

  it('mounts the indicator when a page loads the upload queue', async () => {
    const el = await mount();
    await act(async () => { window.dispatchEvent(new Event(UPLOAD_QUEUE_EVENT)); });
    await settle();
    expect(el.querySelector('[data-testid="indicator"]')).not.toBeNull();
  });

  it('mounts at once when the queue was loaded before the header', async () => {
    (window as { __nukeUploadQueue?: boolean }).__nukeUploadQueue = true;
    const el = await mount();
    expect(el.querySelector('[data-testid="indicator"]')).not.toBeNull();
  });
});
