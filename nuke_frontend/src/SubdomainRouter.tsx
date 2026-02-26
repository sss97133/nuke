import React, { useEffect, useState } from 'react';
import App from './App';
import ErrorBoundary from './components/util/ErrorBoundary';
import { supabase } from './lib/supabase';

const StorefrontApp = React.lazy(() => import('./storefront/StorefrontApp'));

interface OrgData {
  id: string;
  business_name: string;
  slug: string;
  logo_url: string | null;
  banner_url: string | null;
  ui_config: any;
  description: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  business_type: string | null;
  social_links: any;
}

type State =
  | { kind: 'loading' }
  | { kind: 'main-app' }
  | { kind: 'storefront'; org: OrgData };

const RESERVED_SUBDOMAINS = new Set(['www', 'app', 'admin', 'api', 'staging', 'dev']);

// Known production domains — everything before these is a subdomain
const ROOT_DOMAINS = ['nuke.ag', 'vercel.app'];

function extractSubdomain(hostname: string): string | null {
  // Local dev: support ?storefront=slug query param
  const params = new URLSearchParams(window.location.search);
  const override = params.get('storefront');
  if (override) return override;

  // localhost — no subdomains in dev (use ?storefront= param)
  if (hostname === 'localhost' || hostname === '127.0.0.1') return null;

  // Check against known root domains
  for (const root of ROOT_DOMAINS) {
    if (hostname === root) return null;
    if (hostname.endsWith('.' + root)) {
      const sub = hostname.slice(0, -(root.length + 1));
      // Could be multi-level like "preview.cool-cars" — take the first segment
      const first = sub.split('.')[0];
      if (first && !RESERVED_SUBDOMAINS.has(first)) return first;
      return null;
    }
  }

  return null;
}

// Compute initial state synchronously — avoids a "loading..." flash for the
// 99% case where the hostname has no subdomain (localhost, nuke.ag root, etc.)
function getInitialState(): State {
  const subdomain = extractSubdomain(window.location.hostname);
  if (!subdomain) return { kind: 'main-app' };
  return { kind: 'loading' };
}

export default function SubdomainRouter() {
  const [state, setState] = useState<State>(getInitialState);

  useEffect(() => {
    const subdomain = extractSubdomain(window.location.hostname);

    // Already resolved synchronously in getInitialState
    if (!subdomain) return;

    // Look up org by slug
    supabase
      .from('businesses')
      .select('id, business_name, slug, logo_url, banner_url, ui_config, description, website, email, phone, city, state, business_type, social_links')
      .eq('slug', subdomain)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error || !data) {
          // Slug not found — fall through to main app
          setState({ kind: 'main-app' });
          return;
        }

        const storefrontEnabled = data.ui_config?.storefront?.enabled;
        if (!storefrontEnabled) {
          // Org exists but storefront not enabled — show main app
          setState({ kind: 'main-app' });
          return;
        }

        setState({ kind: 'storefront', org: data as OrgData });
      });
  }, []);

  if (state.kind === 'loading') {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: 'Arial, sans-serif',
        fontSize: '9pt',
        color: '#888',
      }}>
        loading...
      </div>
    );
  }

  if (state.kind === 'storefront') {
    return (
      <ErrorBoundary>
        <React.Suspense fallback={
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            fontFamily: 'Arial, sans-serif',
            fontSize: '9pt',
            color: '#888',
          }}>
            loading storefront...
          </div>
        }>
          <StorefrontApp organization={state.org} />
        </React.Suspense>
      </ErrorBoundary>
    );
  }

  return <App />;
}
