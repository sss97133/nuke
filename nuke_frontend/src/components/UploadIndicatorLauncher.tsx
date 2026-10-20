/**
 * UploadIndicatorLauncher — mounts the global upload indicator only when there is an upload to show.
 *
 * The indicator imports the upload queue, which brings the image upload service and its EXIF parser; every route
 * paid for that before first paint. The queue persists items (with their File blobs) in IndexedDB and resumes them
 * when it is constructed, so this keeps that behavior by loading the indicator when (a) the queue's store holds
 * anything from an earlier session, or (b) a page has loaded the queue to start an upload (the queue announces itself).
 */
import React, { useEffect, useState } from 'react';

export const UPLOAD_QUEUE_EVENT = 'nuke:upload-queue';
const Indicator = React.lazy(() => import('./GlobalUploadIndicator'));

/** True when the upload queue's IndexedDB store has at least one item. Opens it with the queue's own schema. */
export function hasPersistedUploads(): Promise<boolean> {
  return new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(false); return; }
      const req = indexedDB.open('nuke_global_uploads', 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('queue')) req.result.createObjectStore('queue', { keyPath: 'id' });
      };
      req.onerror = () => resolve(false);
      req.onsuccess = () => {
        const db = req.result;
        try {
          const count = db.transaction(['queue'], 'readonly').objectStore('queue').count();
          count.onsuccess = () => { resolve(count.result > 0); db.close(); };
          count.onerror = () => { resolve(false); db.close(); };
        } catch {
          resolve(false);
          db.close();
        }
      };
    } catch {
      resolve(false);
    }
  });
}

export default function UploadIndicatorLauncher() {
  const [show, setShow] = useState(() => typeof window !== 'undefined' && Boolean((window as Window & { __nukeUploadQueue?: boolean }).__nukeUploadQueue));
  useEffect(() => {
    if (show) return;
    let cancelled = false;
    const on = () => setShow(true);
    window.addEventListener(UPLOAD_QUEUE_EVENT, on);
    void hasPersistedUploads().then(any => { if (any && !cancelled) setShow(true); });
    return () => { cancelled = true; window.removeEventListener(UPLOAD_QUEUE_EVENT, on); };
  }, [show]);
  return show ? <React.Suspense fallback={null}><Indicator /></React.Suspense> : null;
}
