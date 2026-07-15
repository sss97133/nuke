/**
 * UserConnectionStateStrip — first-screen data-source connection surface.
 *
 * Per frontend-doctrine §2a + IA assessment Step B, now wired to the unified
 * connections read model `v_user_connections` (CONNECTION_COCKPIT T1-7):
 * api keys, agents, external accounts, organizations, vehicle grants, sites,
 * platform logins — one row per grant edge, RLS-scoped to the signed-in user.
 *
 * Rows are grouped by kind into pills (count + status summary). Pills navigate
 * to the /settings hub where every connection surface is indexed. When the
 * user has no connections at all, the original connect-CTA pills render so a
 * fresh profile still surfaces the IA primitive (click → settings drawer).
 *
 * Visual register matches user-profile.css tokens (Arial, ALL CAPS labels,
 * 2px borders, no shadows/radius/gradients).
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useUserProfile } from './UserProfileContext';

interface ConnectionRow {
  kind: string;
  counterparty_name: string | null;
  status: string | null;
  health: string | null;
}

interface KindGroup {
  kind: string;
  label: string;
  count: number;
  /** rows whose health is not 'ok' (expired / stale / dead / unverified ...) */
  attention: number;
}

const KIND_LABELS: Record<string, string> = {
  api_key: 'API Keys',
  agent: 'Agents',
  external_account: 'External Accounts',
  organization: 'Organizations',
  vehicle: 'Vehicle Grants',
  site: 'Sites',
  platform_login: 'Platform Logins',
};

const KIND_ORDER = ['external_account', 'vehicle', 'organization', 'agent', 'api_key', 'site', 'platform_login'];

// Connect-CTA fallback for users with zero connections (original seed pills).
const EMPTY_CONNECTORS = [
  { id: 'auctions', label: 'Auction Platforms' },
  { id: 'social', label: 'X / Social' },
  { id: 'manual', label: 'Manual Upload' },
];

const openSettings = () => {
  window.dispatchEvent(new Event('up:open-settings'));
};

const pillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 8px',
  border: '2px solid var(--up-ink, #1a1a1a)',
  background: 'var(--up-paper, #fff)',
  color: 'var(--up-ink, #1a1a1a)',
  fontFamily: 'Arial, sans-serif',
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  borderRadius: 0,
  cursor: 'pointer',
  transition: 'background 180ms cubic-bezier(0.16, 1, 0.3, 1)',
};

const pillStatusStyle: React.CSSProperties = {
  fontSize: 7,
  fontWeight: 700,
  color: 'var(--up-pencil, #888)',
  letterSpacing: '0.1em',
};

const UserConnectionStateStrip: React.FC = () => {
  const { isOwnProfile, userId } = useUserProfile();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<KindGroup[] | null>(null);

  useEffect(() => {
    if (!isOwnProfile || !userId) return;
    let cancelled = false;
    supabase
      .from('v_user_connections')
      .select('kind, counterparty_name, status, health')
      .then(({ data, error }) => {
        if (cancelled || error || !data) {
          if (!cancelled) setGroups([]);
          return;
        }
        const byKind = new Map<string, KindGroup>();
        (data as ConnectionRow[]).forEach((row) => {
          const g = byKind.get(row.kind) || {
            kind: row.kind,
            label: KIND_LABELS[row.kind] || row.kind.replace(/_/g, ' '),
            count: 0,
            attention: 0,
          };
          g.count += 1;
          if (row.health && row.health !== 'ok') g.attention += 1;
          byKind.set(row.kind, g);
        });
        setGroups(
          Array.from(byKind.values()).sort(
            (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
          ),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [isOwnProfile, userId]);

  // Strip is owner-only; visitors don't need a CTA to connect another user's data.
  if (!isOwnProfile || !userId) return null;
  if (groups === null) return null; // loading — render nothing rather than flash

  const hover = {
    onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
      e.currentTarget.style.background = 'var(--up-ghost, #f0f0f0)';
    },
    onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
      e.currentTarget.style.background = 'var(--up-paper, #fff)';
    },
  };

  return (
    <div
      className="up-connection-strip"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        padding: '8px 0',
        marginBottom: 8,
        borderBottom: '2px solid var(--up-ink, #1a1a1a)',
        fontFamily: 'Arial, sans-serif',
      }}
    >
      <div
        style={{
          fontSize: 8,
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--up-pencil, #888)',
          alignSelf: 'center',
          marginRight: 6,
        }}
      >
        Connections
      </div>
      {groups.length === 0
        ? EMPTY_CONNECTORS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={openSettings}
              title={`Connect ${c.label}`}
              style={pillStyle}
              {...hover}
            >
              <span>{c.label}</span>
              <span style={pillStatusStyle}>NOT CONNECTED</span>
            </button>
          ))
        : groups.map((g) => (
            <button
              key={g.kind}
              type="button"
              onClick={() => navigate('/settings')}
              title={`${g.label}: ${g.count} connection${g.count === 1 ? '' : 's'}${g.attention ? `, ${g.attention} need attention` : ''}`}
              style={pillStyle}
              {...hover}
            >
              <span>{g.label}</span>
              <span style={pillStatusStyle}>
                {g.count}
                {g.attention > 0 ? ` · ${g.attention}!` : ''}
              </span>
            </button>
          ))}
    </div>
  );
};

export default UserConnectionStateStrip;
