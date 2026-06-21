/**
 * Settings Hub — index of every settings surface.
 *
 * CONNECTION_COCKPIT T1-8: the cockpit surfaces (connected agents, API keys,
 * webhooks, usage) existed with ZERO inbound links — reachable only by typed
 * URL. This page is the single index; UserDropdown links here.
 *
 * Deliberately a plain list: navigation, not a dashboard.
 *
 * Route: /settings
 */

import { useNavigate } from 'react-router-dom';

interface SettingsSurface {
  path?: string;
  label: string;
  description: string;
  /** dispatches the user-profile settings drawer instead of navigating */
  drawer?: boolean;
}

const SURFACES: SettingsSurface[] = [
  {
    path: '/settings/connected-agents',
    label: 'Connected Agents',
    description: 'Issue, scope, and revoke per-vehicle API keys for external agents.',
  },
  {
    path: '/settings/api-keys',
    label: 'API Keys',
    description: 'Developer keys for the public API.',
  },
  {
    path: '/settings/webhooks',
    label: 'Webhooks',
    description: 'Outbound event delivery endpoints.',
  },
  {
    path: '/settings/usage',
    label: 'Usage',
    description: 'API usage and rate-limit dashboard.',
  },
  {
    path: '/business/settings',
    label: 'Business Settings',
    description: 'Organization profile and business configuration.',
  },
  {
    path: '/claim-identity',
    label: 'Claim External Identity',
    description: 'Link your BaT or other platform handle and inherit its history.',
  },
  {
    path: '/capsule?tab=settings',
    label: 'Account & Appearance',
    description: 'Profile capsule, appearance, and account preferences.',
  },
  {
    label: 'Connections Drawer',
    description: 'Connect auction platforms, social accounts, and data sources.',
    drawer: true,
  },
];

const SettingsHubPage = () => {
  const navigate = useNavigate();

  const open = (s: SettingsSurface) => {
    if (s.drawer) {
      window.dispatchEvent(new Event('up:open-settings'));
      return;
    }
    if (s.path) navigate(s.path);
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px', fontFamily: 'Arial, sans-serif' }}>
      <h1 style={{ fontSize: 18, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
        Settings
      </h1>
      <p style={{ fontSize: 12, color: 'var(--up-pencil, #888)', marginBottom: 16 }}>
        Every settings surface in one place.
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {SURFACES.map((s) => (
          <li key={s.label} style={{ borderTop: '2px solid var(--up-ink, #1a1a1a)' }}>
            <button
              type="button"
              onClick={() => open(s)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '10px 4px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'Arial, sans-serif',
              }}
            >
              <span style={{ display: 'block', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--up-ink, #1a1a1a)' }}>
                {s.label}
              </span>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--up-pencil, #888)', marginTop: 2 }}>
                {s.description}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default SettingsHubPage;
