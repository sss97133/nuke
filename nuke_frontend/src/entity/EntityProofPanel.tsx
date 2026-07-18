/**
 * EntityProofPanel — makes the entity → proof → projection chain visible.
 *
 * Shows how "built out" an entity is from real proof signals (entityProof.ts),
 * and states the gate plainly: a mode/mech-suit is a PROJECTION of a proof-built
 * profile, not a costume. Until an entity has a formation artifact (a GATE
 * signal), wearing it as your app is decoration over an empty framework — the
 * the-illegible-asset.md gate, rendered.
 *
 * Design system: Arial, zero radius, 2px borders, 8-9px caps labels, var() only.
 * Logic-driven (no decorative layout) so it reads correctly without pixel tuning.
 */

import React, { useEffect, useState } from 'react';
import { entityProof, type EntityProof, type EntityType } from './entityProof';

const label: React.CSSProperties = {
  fontSize: 8,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--text-disabled)',
  display: 'block',
  marginBottom: 6,
};

export default function EntityProofPanel({
  entityType,
  entityId,
  entityName,
}: {
  entityType: EntityType;
  entityId: string;
  entityName?: string;
}) {
  const [proof, setProof] = useState<EntityProof | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    entityProof(entityType, entityId)
      .then((p) => !cancelled && setProof(p))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [entityType, entityId]);

  if (loading) return <p style={{ fontSize: 11, color: 'var(--text-disabled)' }}>reading proof…</p>;
  if (!proof) return <p style={{ fontSize: 11, color: 'var(--text-disabled)' }}>no entity.</p>;

  const gated = !proof.hasFormationProof;

  return (
    <div style={{ border: '2px solid var(--border)', padding: 12 }}>
      <span style={label}>Build-out · {entityName ?? proof.entityType}</span>

      {/* Score bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ flex: 1, height: 10, border: '2px solid var(--border)', position: 'relative' }}>
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${proof.proofScore}%`,
              background: 'var(--text)',
            }}
          />
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'Courier New, monospace' }}>
          {proof.proofScore}%
        </span>
      </div>

      {/* Signals */}
      <div style={{ marginBottom: 10 }}>
        {proof.signals.map((s) => (
          <div
            key={s.key}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              padding: '3px 0',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 12,
                fontFamily: 'Courier New, monospace',
                fontSize: 12,
                color: s.present ? 'var(--text)' : 'var(--text-disabled)',
              }}
            >
              {s.present ? '■' : '□'}
            </span>
            <span style={{ fontSize: 11, color: s.present ? 'var(--text)' : 'var(--text-disabled)' }}>
              {s.label}
              {s.gate && (
                <span
                  title="Un-fakeable formation artifact"
                  style={{ fontSize: 8, letterSpacing: '0.08em', color: 'var(--text-disabled)', marginLeft: 6 }}
                >
                  GATE
                </span>
              )}
            </span>
            {s.detail && (
              <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--text-disabled)' }}>{s.detail}</span>
            )}
          </div>
        ))}
      </div>

      {/* The gate, stated */}
      <div
        style={{
          fontSize: 10,
          lineHeight: 1.5,
          color: gated ? 'var(--text)' : 'var(--text-disabled)',
          borderTop: '2px solid var(--border)',
          paddingTop: 8,
        }}
      >
        {gated ? (
          <>
            <strong>Not yet wearable.</strong> No formation artifact (a GATE signal) is present —
            projecting this entity as an app would be a costume over an empty framework. Build the
            proof first.
          </>
        ) : (
          <>
            <strong>Wearable.</strong> This entity has real formation proof, so a mode is a true
            projection of a built profile — not a costume.
          </>
        )}
      </div>
    </div>
  );
}
