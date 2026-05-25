/**
 * UserConnectionStateStrip — first-screen data-source connection surface.
 *
 * Seed implementation per frontend-doctrine §2a + IA assessment Step B.
 * Renders a horizontal strip of connector pills on the user profile main surface,
 * exposing the connection IA primitive that currently lives only behind the
 * settings drawer (`ConnectedPlatforms`, `SocialConnections`).
 *
 * For new users this is the single most important first-screen surface: without it
 * the platform looks dead because nothing has been ingested yet. Click → dispatches
 * the existing `up:open-settings` event so the drawer takes over for the actual
 * connect flow (no duplicated auth logic).
 *
 * This is a SEED. Real per-connector status queries land in a follow-up; for now
 * every pill shows NOT CONNECTED. Visual register matches user-profile.css tokens
 * (Arial, ALL CAPS labels, 2px borders, no shadows/radius/gradients).
 */
import React from 'react';
import { useUserProfile } from './UserProfileContext';

interface Connector {
  id: string;
  label: string;
}

// Connector identities grounded in what actually exists per
// docs/library/working/field-notes/2026-05-24_safety-audit-completion.md §4:
// - 9 auction platforms (BaT, Cars & Bids, Mecum, etc.) — credential-based, real
// - X/Twitter — Supabase linkIdentity('twitter'), real
// - Manual upload — UniversalImageUpload, real
// - Social (Instagram/Threads/LinkedIn/YouTube/Facebook/Dropbox) — stubbed/partial
// iCloud Photos / Gmail / Bank (Plaid) / Snap-On do NOT exist as connectors.
// Showing only real surfaces; future connectors land here as they ship.
const CONNECTORS: Connector[] = [
  { id: 'auctions', label: 'Auction Platforms' },
  { id: 'social', label: 'X / Social' },
  { id: 'manual', label: 'Manual Upload' },
];

const openSettings = () => {
  window.dispatchEvent(new Event('up:open-settings'));
};

const UserConnectionStateStrip: React.FC = () => {
  const { isOwnProfile, userId } = useUserProfile();

  // Strip is owner-only; visitors don't need a CTA to connect another user's data.
  if (!isOwnProfile || !userId) return null;

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
        Data Sources
      </div>
      {CONNECTORS.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={openSettings}
          title={`Connect ${c.label}`}
          style={{
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
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--up-ghost, #f0f0f0)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--up-paper, #fff)';
          }}
        >
          <span>{c.label}</span>
          <span
            style={{
              fontSize: 7,
              fontWeight: 700,
              color: 'var(--up-pencil, #888)',
              letterSpacing: '0.1em',
            }}
          >
            NOT CONNECTED
          </span>
        </button>
      ))}
    </div>
  );
};

export default UserConnectionStateStrip;
