// src/pages/intake/IntakePage.tsx
//
// Public intake surface (F3 + F6). Two variants:
//   - 'standalone' (default): full intake page at /intake (note event type form).
//   - 'homepage': slim Janitor-drain teaser used as the logged-out homepage.
//     Anonymous submission isn't supported by api-v1-events yet (paper §F8),
//     so the homepage variant routes the user to /login?returnUrl=/intake
//     instead of attempting an anonymous POST.
//
// Per paper §3.F6 + the unified design system: Arial, 8-9px caps, 2px borders,
// no radius, no animation, no icons.

import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { EventForm } from '../../components/intake/EventForm/EventForm';

export type IntakeVariant = 'standalone' | 'homepage';

export interface IntakePageProps {
  variant?: IntakeVariant;
}

const pageStyle: React.CSSProperties = {
  maxWidth: 720,
  margin: '0 auto',
  padding: '24px 12px 96px',
  fontFamily: 'Arial, sans-serif',
  color: 'var(--fg, #111)',
};

const h1Style: React.CSSProperties = {
  fontFamily: 'Arial, sans-serif',
  fontSize: 22,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  margin: '0 0 12px 0',
};

const leadStyle: React.CSSProperties = {
  fontFamily: 'Arial, sans-serif',
  fontSize: 13,
  color: 'var(--fg, #111)',
  margin: '0 0 24px 0',
  lineHeight: 1.5,
};

const successStyle: React.CSSProperties = {
  border: '2px solid var(--border, #111)',
  padding: 16,
  marginBottom: 16,
  fontFamily: 'Arial, sans-serif',
  fontSize: 12,
};

const errorStyle: React.CSSProperties = {
  border: '2px solid #a00',
  color: '#a00',
  padding: 12,
  marginBottom: 16,
  fontFamily: 'Arial, sans-serif',
  fontSize: 12,
};

// ──────────────────────────────────────────────────────────────────────
// Homepage variant — Janitor drain teaser for logged-out users.
// Mobile-first; renders cleanly at 375px.
// ──────────────────────────────────────────────────────────────────────

const homeWrapStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 'calc(100vh - 60px)',
  padding: '32px 16px 64px',
  fontFamily: 'Arial, sans-serif',
  color: 'var(--fg, #111)',
  background: 'var(--bg, #fff)',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
};

const homeInnerStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 640,
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
};

const homeKickerStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  color: 'var(--muted, #666)',
  margin: 0,
};

const homeH1Style: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  margin: 0,
  lineHeight: 1.1,
};

const homeLeadStyle: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.5,
  margin: 0,
  color: 'var(--fg, #111)',
};

const dropZoneStyle: React.CSSProperties = {
  border: '2px dashed var(--border, #111)',
  padding: '40px 20px',
  textAlign: 'center',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--muted, #666)',
  background: 'var(--surface, transparent)',
  boxSizing: 'border-box',
};

const ctaButtonStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  fontFamily: 'Arial, sans-serif',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  padding: '14px 16px',
  border: '2px solid var(--border, #111)',
  borderRadius: 0,
  background: 'var(--fg, #111)',
  color: 'var(--bg, #fff)',
  cursor: 'pointer',
  textAlign: 'center',
  textDecoration: 'none',
  boxSizing: 'border-box',
};

const secondaryLinkStyle: React.CSSProperties = {
  display: 'inline-block',
  fontFamily: 'Arial, sans-serif',
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  padding: '8px 0',
  color: 'var(--fg, #111)',
  textDecoration: 'underline',
};

const chipsRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
};

const chipStyle: React.CSSProperties = {
  border: '2px solid var(--border, #111)',
  padding: '6px 10px',
  fontSize: 9,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  background: 'var(--bg, #fff)',
  color: 'var(--fg, #111)',
};

const chipsLabelStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  color: 'var(--muted, #666)',
  marginBottom: 6,
};

function HomepageVariant() {
  const navigate = useNavigate();
  const goSignIn = () => navigate('/login?returnUrl=/intake');

  return (
    <div style={homeWrapStyle}>
      <div style={homeInnerStyle}>
        <div>
          <p style={homeKickerStyle}>Nuke / Intake</p>
          <h1 style={homeH1Style}>The form is the thing.</h1>
        </div>

        <p style={homeLeadStyle}>
          Drop a photo, paste a URL, or sign in to track your vehicle.
        </p>

        <div
          style={dropZoneStyle}
          role="button"
          tabIndex={0}
          onClick={goSignIn}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              goSignIn();
            }
          }}
          aria-label="Sign in to drop a photo or paste a URL"
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Drop a photo here</div>
          <div style={{ fontSize: 10, letterSpacing: '0.1em' }}>
            or paste a BaT / Cars &amp; Bids / Hagerty URL
          </div>
        </div>

        <button
          type="button"
          onClick={goSignIn}
          style={ctaButtonStyle}
        >
          Sign in to start
        </button>

        <div>
          <div style={chipsLabelStyle}>Examples</div>
          <div style={chipsRowStyle}>
            <span style={chipStyle}>Photo of a truck you saw</span>
            <span style={chipStyle}>BaT listing URL</span>
            <span style={chipStyle}>Tonight&apos;s wrench session</span>
          </div>
        </div>

        <div style={{ borderTop: '2px solid var(--border, #111)', paddingTop: 16, marginTop: 8 }}>
          <Link to="/explore" style={secondaryLinkStyle}>
            Explore the database &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Standalone variant — original /intake page.
// ──────────────────────────────────────────────────────────────────────

function StandaloneVariant() {
  const [outcome, setOutcome] = useState<
    | { kind: 'idle' }
    | { kind: 'success'; observation_id?: string }
    | { kind: 'error'; error: string }
  >({ kind: 'idle' });

  return (
    <div style={pageStyle}>
      <h1 style={h1Style}>Intake</h1>
      <p style={leadStyle}>
        Drop a note about a vehicle. Free-form remarks are fine — sightings, condition findings,
        ownership clues, anything that would otherwise evaporate. The form is the contract; the
        substrate routes it from here.
      </p>

      {outcome.kind === 'success' ? (
        <div style={successStyle}>
          <div style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 11, marginBottom: 6 }}>
            Submitted
          </div>
          <div>Note recorded against the vehicle.</div>
          {outcome.observation_id ? (
            <div style={{ fontFamily: 'Courier New, monospace', fontSize: 11, marginTop: 6 }}>
              observation_id: {outcome.observation_id}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setOutcome({ kind: 'idle' })}
            style={{
              marginTop: 12,
              fontFamily: 'Arial, sans-serif',
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              padding: '6px 12px',
              border: '2px solid var(--border, #111)',
              borderRadius: 0,
              background: 'var(--bg, #fff)',
              color: 'var(--fg, #111)',
              cursor: 'pointer',
            }}
          >
            Submit another
          </button>
        </div>
      ) : null}

      {outcome.kind === 'error' ? (
        <div style={errorStyle}>
          <div style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 11, marginBottom: 6 }}>
            Submission failed
          </div>
          <div>{outcome.error}</div>
        </div>
      ) : null}

      {outcome.kind !== 'success' ? (
        <EventForm
          event_type="note"
          onSubmitted={(r) => {
            if (r.ok) setOutcome({ kind: 'success', observation_id: r.observation_id });
            else setOutcome({ kind: 'error', error: r.error });
          }}
        />
      ) : null}
    </div>
  );
}

export default function IntakePage({ variant = 'standalone' }: IntakePageProps = {}) {
  if (variant === 'homepage') return <HomepageVariant />;
  return <StandaloneVariant />;
}
