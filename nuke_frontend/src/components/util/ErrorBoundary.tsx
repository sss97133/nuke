import React from 'react';

interface ErrorBoundaryState { hasError: boolean; message?: string }

export default class ErrorBoundary extends React.Component<React.PropsWithChildren<{}>, ErrorBoundaryState> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  private static readonly CHUNK_LOAD_ERROR_RE =
    /(Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk .* failed)/i;

  private static maybeReloadForChunkError(error: any) {
    const msg =
      typeof error === 'string'
        ? error
        : error?.message ?? String(error);

    if (!ErrorBoundary.CHUNK_LOAD_ERROR_RE.test(msg)) return;

    const key = '__nzero_chunk_reload__';
    try {
      if (sessionStorage.getItem(key) === '1') return;
      sessionStorage.setItem(key, '1');
    } catch {
      // If sessionStorage is unavailable, still try a single reload.
    }

    // Give the browser a tick to flush logs/network before reloading.
    setTimeout(() => window.location.reload(), 50);
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, message: error?.message || 'Something went wrong' };
  }

  componentDidCatch(error: any, info: any) {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught:', error, info);

    // React catches dynamic import failures inside Suspense/routes before they reach `window`,
    // so recover here as well (one-time reload) to break out of deploy drift.
    ErrorBoundary.maybeReloadForChunkError(error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="container compact">
          <div className="main">
            <div className="card"><div className="card-body">
              <div className="text">An error occurred rendering this section.</div>
              {this.state.message && <div className="text text-small text-muted" style={{ marginTop: 6 }}>{this.state.message}</div>}
            </div></div>
          </div>
        </div>
      );
    }
    return this.props.children as any;
  }
}


