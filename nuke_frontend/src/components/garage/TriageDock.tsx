/**
 * TriageDock.tsx
 * Fixed bottom bar that slides up when a vehicle card is being dragged.
 * Drop targets: user's orgs (reassign vehicle) + DUPLICATE bin + WRONG INFO bin.
 *
 * Design system: 0px border-radius, 2px borders, ALL CAPS 8px labels,
 * 180ms cubic-bezier transitions, no shadows/gradients/blur.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { MyOrganizationsService } from '../../services/myOrganizationsService';
import type { MyOrganization } from '../../services/myOrganizationsService';
import type { GarageVehicle } from '../../hooks/useVehiclesDashboard';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TriageAction =
  | { type: 'assign_org'; orgId: string; orgName: string }
  | { type: 'duplicate' }
  | { type: 'wrong_info' };

interface TriageDockProps {
  vehicle: GarageVehicle;
  userId: string;
  onComplete: (action: TriageAction) => void;
  onDragEnd: () => void;
}

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const FONT_BODY = 'Arial, sans-serif';
const FONT_MONO = "'Courier New', Courier, monospace";
const TRANSITION = 'all 180ms cubic-bezier(0.16, 1, 0.3, 1)';

const LABEL: React.CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  fontSize: '8px',
  fontWeight: 700,
  fontFamily: FONT_BODY,
  color: 'var(--text-secondary, #666666)',
};

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

function TriageToast({ message, variant }: { message: string; variant: 'success' | 'warning' }) {
  const [opacity, setOpacity] = useState(0);

  useEffect(() => {
    requestAnimationFrame(() => setOpacity(1));
    const t = setTimeout(() => setOpacity(0), 1800);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 140,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10001,
        padding: '6px 16px',
        fontFamily: FONT_BODY,
        fontSize: '9px',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        color: variant === 'success' ? 'var(--success, #16825d)' : 'var(--warning, #b05a00)',
        backgroundColor: 'var(--surface, #ebebeb)',
        border: `2px solid ${variant === 'success' ? 'var(--success, #16825d)' : 'var(--warning, #b05a00)'}`, opacity,
        transition: 'opacity 180ms ease',
        pointerEvents: 'none',
      }}
    >
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drop Target
// ---------------------------------------------------------------------------

function DropTarget({
  id,
  label,
  sublabel,
  hoveredTarget,
  onDragOver,
  onDragLeave,
  onDrop,
  variant = 'default',
}: {
  id: string;
  label: string;
  sublabel?: string;
  hoveredTarget: string | null;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, id: string) => void;
  variant?: 'default' | 'warning' | 'error';
}) {
  const isHovered = hoveredTarget === id;
  const borderColor = isHovered
    ? 'var(--text, #2a2a2a)'
    : variant === 'warning'
    ? 'var(--warning, #b05a00)'
    : variant === 'error'
    ? 'var(--error, #d13438)'
    : 'var(--border, #bdbdbd)';

  const bgColor = isHovered
    ? 'var(--bg, #f5f5f5)'
    : 'transparent';

  return (
    <div
      onDragOver={(e) => onDragOver(e, id)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, id)}
      style={{
        width: 100,
        height: 72,
        border: `2px solid ${borderColor}`, backgroundColor: bgColor,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        padding: '4px 6px',
        transition: TRANSITION,
        flexShrink: 0,
        cursor: 'default',
      }}
    >
      <span style={{
        ...LABEL,
        fontSize: '8px',
        color: variant === 'warning' ? 'var(--warning, #b05a00)'
             : variant === 'error' ? 'var(--error, #d13438)'
             : 'var(--text, #2a2a2a)',
        textAlign: 'center',
        lineHeight: 1.2,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        maxWidth: '100%',
      }}>
        {label}
      </span>
      {sublabel && (
        <span style={{
          fontFamily: FONT_MONO,
          fontSize: '8px',
          color: 'var(--text-secondary, #666666)',
        }}>
          {sublabel}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main TriageDock
// ---------------------------------------------------------------------------

export default function TriageDock({ vehicle, userId, onComplete, onDragEnd }: TriageDockProps) {
  const [orgs, setOrgs] = useState<MyOrganization[]>([]);
  const [hoveredTarget, setHoveredTarget] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'warning' } | null>(null);
  const [visible, setVisible] = useState(false);
  const mountedRef = useRef(true);

  // Slide in on mount
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    return () => { mountedRef.current = false; };
  }, []);

  // Fetch user's organizations
  useEffect(() => {
    MyOrganizationsService.getMyOrganizations({ status: 'active' })
      .then((data) => {
        if (mountedRef.current) setOrgs(data);
      })
      .catch(console.error);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setHoveredTarget(id);
  }, []);

  const handleDragLeave = useCallback(() => {
    setHoveredTarget(null);
  }, []);

  const showToast = useCallback((message: string, variant: 'success' | 'warning') => {
    setToast({ message, variant });
    setTimeout(() => {
      if (mountedRef.current) setToast(null);
    }, 2200);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    setHoveredTarget(null);

    if (targetId === 'duplicate') {
      // Flag as duplicate
      const { error } = await supabase.from('vehicle_merge_proposals').insert({
        primary_vehicle_id: vehicle.id,
        duplicate_vehicle_id: vehicle.id,
        recommended_primary: vehicle.id,
        confidence_score: 0,
        match_type: 'manual',
        status: 'pending',
        match_reasoning: { source: 'profile_triage', user_flagged: true },
        detected_by: 'profile_triage',
        detected_at: new Date().toISOString(),
      });
      if (error) {
        console.error('Failed to flag duplicate:', error);
        showToast('FAILED TO FLAG', 'warning');
        return;
      }
      showToast('FLAGGED AS DUPLICATE', 'warning');
      onComplete({ type: 'duplicate' });
    } else if (targetId === 'wrong_info') {
      // Deactivate contributor link
      const { error } = await supabase.from('vehicle_user_permissions')
        .update({ is_active: false })
        .eq('vehicle_id', vehicle.id)
        .eq('user_id', userId);
      if (error) {
        console.error('Failed to flag wrong info:', error);
        showToast('FAILED TO FLAG', 'warning');
        return;
      }
      showToast('FLAGGED WRONG INFO — REMOVED', 'warning');
      onComplete({ type: 'wrong_info' });
    } else {
      // Assign to org
      const org = orgs.find(o => o.organization_id === targetId);
      const { error } = await supabase.from('organization_vehicles').upsert({
        vehicle_id: vehicle.id,
        organization_id: targetId,
        relationship_type: 'inventory',
        linked_by_user_id: userId,
      }, { onConflict: 'vehicle_id,organization_id' });
      if (error) {
        console.error('Failed to assign to org:', error);
        showToast('FAILED TO ASSIGN', 'warning');
        return;
      }
      showToast(`MOVED TO ${org?.organization?.business_name?.toUpperCase() || 'ORG'}`, 'success');
      onComplete({ type: 'assign_org', orgId: targetId, orgName: org?.organization?.business_name || '' });
    }
  }, [vehicle, userId, orgs, onComplete, showToast]);

  return (
    <>
      {toast && <TriageToast message={toast.message} variant={toast.variant} />}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: 120,
          zIndex: 10000,
          backgroundColor: 'var(--surface, #ebebeb)',
          borderTop: '2px solid var(--border, #bdbdbd)',
          transform: visible ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 180ms cubic-bezier(0.16, 1, 0.3, 1)',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: FONT_BODY,
        }}
      >
        {/* Header */}
        <div style={{
          padding: '8px 16px 0',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <span style={{ ...LABEL, fontSize: '9px', color: 'var(--text, #2a2a2a)' }}>TRIAGE</span>
          <div style={{ flex: 1, height: 1, backgroundColor: 'var(--border, #bdbdbd)' }} />
        </div>

        {/* Drop targets */}
        <div style={{
          flex: 1,
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          overflowX: 'auto',
        }}>
          {/* Org targets */}
          {orgs.map((org) => (
            <DropTarget
              key={org.organization_id}
              id={org.organization_id}
              label={org.organization?.business_name?.toUpperCase() || 'ORG'}
              sublabel={org.stats?.vehicle_count != null ? `${org.stats.vehicle_count} VEH` : undefined}
              hoveredTarget={hoveredTarget}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            />
          ))}

          {orgs.length > 0 && (
            <div style={{ width: 1, height: 48, backgroundColor: 'var(--border, #bdbdbd)', flexShrink: 0 }} />
          )}

          {/* Action bins */}
          <DropTarget
            id="duplicate"
            label="DUPLICATE"
            hoveredTarget={hoveredTarget}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            variant="warning"
          />
          <DropTarget
            id="wrong_info"
            label="WRONG INFO"
            hoveredTarget={hoveredTarget}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            variant="error"
          />
        </div>
      </div>
    </>
  );
}
