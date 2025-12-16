import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import ErrorBoundary from './components/util/ErrorBoundary';

// Recover from deploy drift where a cached entry bundle tries to import a now-missing chunk.
// Without this, Vercel's SPA fallback can serve `index.html` for missing `/assets/*.js`, which
// triggers strict module MIME errors and crashes the app.
const CHUNK_LOAD_ERROR_RE =
  /(Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk .* failed)/i;

function maybeReloadForChunkError(reason: unknown) {
  const msg = typeof reason === 'string' ? reason : (reason as any)?.message ?? String(reason);
  if (!CHUNK_LOAD_ERROR_RE.test(msg)) return;

  const key = '__nzero_chunk_reload__';
  try {
    if (sessionStorage.getItem(key) === '1') return;
    sessionStorage.setItem(key, '1');
  } catch {
    // If sessionStorage is unavailable, still try a single reload.
  }

  // Give the browser a tick to flush logs/network before reloading.
  setTimeout(() => {
    window.location.reload();
  }, 50);
}

window.addEventListener('error', (e) => {
  maybeReloadForChunkError((e as ErrorEvent).error ?? (e as ErrorEvent).message);
});

window.addEventListener('unhandledrejection', (e) => {
  maybeReloadForChunkError((e as PromiseRejectionEvent).reason);
});

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
