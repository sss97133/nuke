import React from 'react';

interface ErrorBoundaryState { hasError: boolean; message?: string }

export default class ErrorBoundary extends React.Component<React.PropsWithChildren<{}>, ErrorBoundaryState> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, message: error?.message || 'Something went wrong' };
  }

  componentDidCatch(error: any, info: any) {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 12 }}>
          <div className="card"><div className="card-body">
            <div className="text">An error occurred rendering this section.</div>
            {this.state.message && <div className="text text-small text-muted" style={{ marginTop: 6 }}>{this.state.message}</div>}
          </div></div>
        </div>
      );
    }
    return this.props.children as any;
  }
}


