/**
 * Settings Hub — index of every settings surface.
 *
 * Link to registered settings destinations. A profile-local drawer event cannot
 * open a drawer from this page; its explicit profile URL carries that intent.
 *
 * Route: /settings
 */

import { Link } from 'react-router-dom';
import { usePageTitle } from '../../hooks/usePageTitle';

interface SettingsSurface {
  path: string;
  label: string;
  description: string;
  group: 'Your account' | 'Agents & compute' | 'Developer & business';
  preload: () => Promise<unknown>;
}

const SURFACES: SettingsSurface[] = [
  {
    path: '/capsule?tab=settings',
    label: 'Account',
    description: 'Profile, verification and account preferences.',
    group: 'Your account',
    preload: () => import('../Capsule'),
  },
  {
    path: '/capsule?tab=appearance',
    label: 'Appearance',
    description: 'Theme, contrast and text size.',
    group: 'Your account',
    preload: () => import('../Capsule'),
  },
  {
    path: '/profile?settings=connections',
    label: 'Profile & connections',
    description: 'Open your profile settings, auction platforms and social connections.',
    group: 'Your account',
    preload: () => import('../UserProfile'),
  },
  {
    path: '/claim-identity',
    label: 'Claim an external identity',
    description: 'Link your platform handle to its recorded history.',
    group: 'Your account',
    preload: () => import('../ClaimExternalIdentity'),
  },
  {
    path: '/settings/ai',
    label: 'AI access',
    description: 'Connect the compute used by your in-app agent.',
    group: 'Agents & compute',
    preload: () => import('./AIAccessPage'),
  },
  {
    path: '/settings/analysis',
    label: 'Vehicle analysis',
    description: 'Choose how analysis runs on your vehicles.',
    group: 'Agents & compute',
    preload: () => import('./AnalysisSettingsPage'),
  },
  {
    path: '/settings/connected-agents',
    label: 'Connected agents',
    description: 'Issue, scope, and revoke per-vehicle API keys for external agents.',
    group: 'Agents & compute',
    preload: () => import('./ConnectedAgentsPage'),
  },
  {
    path: '/settings/api-keys',
    label: 'API keys',
    description: 'Developer keys for the public API.',
    group: 'Developer & business',
    preload: () => import('./ApiKeysPage'),
  },
  {
    path: '/settings/usage',
    label: 'Usage',
    description: 'API usage and rate-limit dashboard.',
    group: 'Developer & business',
    preload: () => import('./UsageDashboardPage'),
  },
  {
    path: '/business/settings',
    label: 'Business settings',
    description: 'Organization profile and business configuration.',
    group: 'Developer & business',
    preload: () => import('../BusinessSettings'),
  },
];

const SettingsHubPage = () => {
  usePageTitle('Settings');
  const warm = (surface: SettingsSurface) => { void surface.preload().catch(() => {}); };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 16px 56px', fontFamily: 'var(--font-family)' }}>
      <h1 style={{ fontSize: 'var(--text-title, 28px)', fontWeight: 700, letterSpacing: '-0.03em', marginBottom: 8 }}>
        Settings
      </h1>
      <p style={{ fontSize: 'var(--text-body, 15px)', color: 'var(--text-secondary)', marginBottom: 28 }}>
        Your account, connected agents and working preferences.
      </p>
      {(['Your account', 'Agents & compute', 'Developer & business'] as const).map(group => <section key={group} aria-label={group} style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 'var(--text-callout, 14px)', color: 'var(--text-secondary)', fontWeight: 600, margin: '0 16px 8px' }}>{group}</h2>
        <ul className="card" style={{ listStyle: 'none', margin: 0, padding: '0 16px', background: 'var(--surface)', border: '1px solid var(--border)' }}>
        {SURFACES.filter(surface => surface.group === group).map((s, index) => (
          <li key={s.label} style={{ borderTop: index ? '1px solid var(--border)' : undefined }}>
            <Link
              to={s.path}
              onMouseEnter={() => warm(s)}
              onFocus={() => warm(s)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                width: '100%',
                textAlign: 'left',
                padding: '16px 0',
                minHeight: 'var(--control-height, 44px)',
                textDecoration: 'none',
                color: 'var(--text)',
              }}
            >
              <span style={{ flex: 1 }}><span style={{ display: 'block', fontSize: 'var(--text-body, 15px)', fontWeight: 600 }}>
                {s.label}
              </span>
              <span style={{ display: 'block', fontSize: 'var(--text-callout, 14px)', color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.45 }}>
                {s.description}
              </span></span><span aria-hidden="true" style={{ color: 'var(--text-secondary)', fontSize: 22 }}>›</span>
            </Link>
          </li>
        ))}
      </ul></section>)}
    </div>
  );
};

export default SettingsHubPage;
