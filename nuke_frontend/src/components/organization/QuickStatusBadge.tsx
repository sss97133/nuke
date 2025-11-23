import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface Props {
  orgVehicleId: string;
  currentStatus: string;
  currentRelationship: string;
  onUpdate: () => void;
  isSelected?: boolean;
  selectedVehicleIds?: string[];
}

const STATUS_BADGES = [
  { value: 'active', label: 'FOR SALE', color: '#10b981' },
  { value: 'sold', label: 'SOLD', color: '#6b7280' },
  { value: 'service', label: 'SERVICE', color: '#f59e0b' },
  { value: 'archived', label: 'ARCHIVED', color: '#9ca3af' },
];

const QuickStatusBadge: React.FC<Props> = ({
  orgVehicleId,
  currentStatus,
  currentRelationship,
  onUpdate,
  isSelected,
  selectedVehicleIds = []
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const [updating, setUpdating] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const currentBadge = STATUS_BADGES.find(b => b.value === currentStatus) || STATUS_BADGES[0];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };

    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showMenu]);

  const handleStatusChange = async (newStatus: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setUpdating(true);
    setShowMenu(false);

    try {
      // If this vehicle is selected AND other vehicles are also selected, bulk update
      const idsToUpdate = isSelected && selectedVehicleIds.length > 1
        ? selectedVehicleIds
        : [orgVehicleId];

      console.log('Updating status:', { idsToUpdate, newStatus, isSelected, selectedCount: selectedVehicleIds.length });

      const { error } = await supabase
        .from('organization_vehicles')
        .update({
          status: newStatus,
          updated_at: new Date().toISOString()
        })
        .in('id', idsToUpdate);

      if (error) throw error;

      onUpdate();
    } catch (err) {
      console.error('Error updating status:', err);
      alert('Failed to update status: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div
      ref={menuRef}
      style={{ position: 'relative', display: 'inline-block' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        onClick={(e) => {
          e.stopPropagation();
          if (!updating) setShowMenu(!showMenu);
        }}
        style={{
          padding: '4px 10px',
          background: currentBadge.color,
          color: 'white',
          fontSize: '7pt',
          fontWeight: 700,
          borderRadius: '3px',
          cursor: updating ? 'wait' : 'pointer',
          userSelect: 'none',
          opacity: updating ? 0.6 : 1,
          transition: 'all 0.12s ease'
        }}
      >
        {updating ? 'UPDATING...' : currentBadge.label}
        {isSelected && selectedVehicleIds.length > 1 && (
          <span style={{ marginLeft: '4px', opacity: 0.8 }}>
            ({selectedVehicleIds.length})
          </span>
        )}
      </div>

      {showMenu && !updating && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '4px',
            background: 'white',
            border: '2px solid var(--border)',
            borderRadius: '4px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 1000,
            minWidth: '120px'
          }}
        >
          {STATUS_BADGES.map(badge => (
            <div
              key={badge.value}
              onClick={(e) => handleStatusChange(badge.value, e)}
              style={{
                padding: '8px 12px',
                fontSize: '8pt',
                fontWeight: 600,
                cursor: 'pointer',
                background: currentStatus === badge.value ? 'var(--accent-dim)' : 'transparent',
                borderBottom: '1px solid var(--border-light)',
                transition: 'background 0.12s ease'
              }}
              onMouseEnter={(e) => {
                if (currentStatus !== badge.value) {
                  e.currentTarget.style.background = 'var(--bg-secondary)';
                }
              }}
              onMouseLeave={(e) => {
                if (currentStatus !== badge.value) {
                  e.currentTarget.style.background = 'transparent';
                }
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div
                  style={{
                    width: '12px',
                    height: '12px',
                    background: badge.color,
                    borderRadius: '2px'
                  }}
                />
                {badge.label}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default QuickStatusBadge;

