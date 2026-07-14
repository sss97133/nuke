/**
 * ModeAutoController — the always-on auto-switch engine.
 *
 * Mounted app-wide. Reads the user's scheduled modes and, at each schedule
 * boundary, either PROPOSES a switch (default) or applies it (opt-in 'auto').
 * Renders nothing except the proposal banner — which is deliberately legible
 * ("you're scheduled for X right now") and one-tap dismissible, so automation
 * never silently edits what the user sees without a visible, reversible trace.
 *
 * This is the schedule trigger. Location + iOS Focus Filters plug into the same
 * suggestedSubjectId() seam later — only the signal source changes.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useBranding } from './BrandingContext';
import { deriveModes, fetchModeCoords, type Mode } from './deriveModes';
import {
  getAutoMode,
  msUntilNextBoundary,
  suggestedSubjectId,
} from './modeSchedule';
import { hasGeofences, nearestSubjectId, seedGeofences } from './modeLocation';

const LOCATION_POLL_MS = 5 * 60 * 1000;

export const MODE_AUTO_EVENT = 'nuke:modeAutoChanged';

export default function ModeAutoController() {
  const { user } = useAuth();
  const { brand, activateBrand, resetBrand } = useBranding();
  const [modeIndex, setModeIndex] = useState<Map<string, Mode> | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [proposal, setProposal] = useState<Mode | null>(null);
  const dismissedRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);

  // Load the user's modes once.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    deriveModes(user.id).then((m) => {
      if (cancelled) return;
      const all = [...m.work, ...m.personal];
      setModeIndex(new Map(all.map((x) => [String(x.subjectId), x])));
      setOrder(all.map((x) => String(x.subjectId)));
    });
    // Seed geofences from real substrate coords (no-op if none exist yet).
    fetchModeCoords(user.id).then((coords) => {
      if (!cancelled && Object.keys(coords).length) seedGeofences(coords);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const evaluate = useCallback(async () => {
    if (!modeIndex || order.length === 0) return;
    const auto = getAutoMode();
    if (auto === 'off') {
      setProposal(null);
      return;
    }
    // Location beats schedule — your body beats your calendar.
    const located = hasGeofences() ? await nearestSubjectId(order) : null;
    const suggested = located ?? suggestedSubjectId(order);
    const activeId = brand?.subjectId ?? null;

    if (!suggested) {
      // Window ended. In full-auto, fall back to Nuke; in suggest, just clear.
      if (auto === 'auto' && activeId && order.includes(activeId)) resetBrand();
      setProposal(null);
      return;
    }
    if (suggested === activeId) {
      setProposal(null);
      return;
    }
    const mode = modeIndex.get(suggested);
    if (!mode) return;

    if (auto === 'auto') {
      activateBrand(mode);
      setProposal(null);
    } else {
      // suggest: propose unless already dismissed for this exact suggestion
      if (dismissedRef.current === suggested) return;
      setProposal(mode);
    }
  }, [modeIndex, order, brand?.subjectId, activateBrand, resetBrand]);

  // Re-evaluate on load, on settings change, and at each schedule boundary.
  useEffect(() => {
    evaluate();
    const onChange = () => {
      dismissedRef.current = null;
      evaluate();
    };
    window.addEventListener(MODE_AUTO_EVENT, onChange);

    const schedule = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        evaluate();
        schedule();
      }, msUntilNextBoundary());
    };
    schedule();

    // Location moves between schedule boundaries — poll it on its own cadence.
    const locPoll = window.setInterval(() => {
      if (getAutoMode() !== 'off' && hasGeofences()) evaluate();
    }, LOCATION_POLL_MS);

    return () => {
      window.removeEventListener(MODE_AUTO_EVENT, onChange);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      window.clearInterval(locPoll);
    };
  }, [evaluate]);

  if (!proposal) return null;

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 20,
        transform: 'translateX(-50%)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        background: 'var(--surface)',
        border: '2px solid var(--text)',
        fontSize: 12,
        color: 'var(--text)',
        maxWidth: 'calc(100vw - 24px)',
      }}
    >
      <span>
        Scheduled now: <strong>{proposal.name}</strong>{' '}
        <span style={{ color: 'var(--text-disabled)' }}>({proposal.role})</span>
      </span>
      <button
        onClick={() => {
          activateBrand(proposal);
          setProposal(null);
        }}
        style={{
          padding: '6px 12px',
          border: '2px solid var(--text)',
          background: 'var(--text)',
          color: 'var(--bg)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          cursor: 'pointer',
        }}
      >
        Switch
      </button>
      <button
        onClick={() => {
          dismissedRef.current = String(proposal.subjectId);
          setProposal(null);
        }}
        style={{
          padding: '6px 12px',
          border: '2px solid var(--border)',
          background: 'transparent',
          color: 'var(--text-disabled)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          cursor: 'pointer',
        }}
      >
        Not now
      </button>
    </div>
  );
}
