import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import type { Vehicle } from './types';
import type { VehiclePermissions } from './types';
import VehicleDescriptionTab from './VehicleDescriptionTab';
import VehicleMediaTab from './VehicleMediaTab';
import VehicleSpecsTab from './VehicleSpecsTab';
import VehicleComparablesTab from './VehicleComparablesTab';
import VehicleTaxonomyTab from './VehicleTaxonomyTab';

interface VehicleProfileTabsProps {
  vehicle: Vehicle;
  session: any;
  permissions: VehiclePermissions;
  vehicleImages: string[];
  fallbackListingImageUrls: string[];
  onImagesUpdated: () => void;
  onDataPointClick: (e: React.MouseEvent, fieldName: string, fieldValue: string, fieldLabel: string) => void;
  onEditClick: () => void;
  canEdit: boolean;
  referenceLibraryRefreshKey: number;
  onReferenceLibraryRefresh: () => void;
}

type TabId = 'description' | 'media' | 'specs' | 'comps' | 'taxonomy';

const TABS: Array<{ id: TabId; label: string; count?: number }> = [
  { id: 'description', label: 'DESCRIPTION' },
  { id: 'media', label: 'MEDIA' },
  { id: 'specs', label: 'SPECS' },
  { id: 'comps', label: 'COMPS' },
  { id: 'taxonomy', label: 'TAXONOMY' }
];

export const VehicleProfileTabs: React.FC<VehicleProfileTabsProps> = ({
  vehicle,
  session,
  permissions,
  vehicleImages,
  fallbackListingImageUrls,
  onImagesUpdated,
  onDataPointClick,
  onEditClick,
  canEdit,
  referenceLibraryRefreshKey,
  onReferenceLibraryRefresh
}) => {
  const [activeTab, setActiveTab] = useState<TabId>('description');
  const [compsCount, setCompsCount] = useState<number | null>(null);

  useEffect(() => {
    loadComparablesCount();
  }, [vehicle.id]);

  const loadComparablesCount = async () => {
    try {
      const { count, error } = await supabase
        .from('user_submitted_comparables')
        .select('*', { count: 'exact', head: true })
        .eq('vehicle_id', vehicle.id)
        .eq('status', 'approved');

      if (!error && count !== null) {
        setCompsCount(count);
      }
    } catch (error) {
      console.error('Error loading comparables count:', error);
    }
  };

  const handleTabChange = (tabId: TabId) => {
    setActiveTab(tabId);
  };

  return (
    <div style={{ marginTop: 'var(--space-4)' }}>
      {/* Tab Navigation */}
      <div style={{
        borderBottom: '2px solid var(--border-light)',
        marginBottom: '24px',
        position: 'relative'
      }}>
        <ul style={{
          display: 'flex',
          whiteSpace: 'nowrap',
          overflowX: 'auto',
          marginTop: '16px',
          padding: 0,
          listStyle: 'none',
          gap: '8px',
          fontSize: '14px',
          fontWeight: 500,
          color: 'var(--text-muted)'
        }}>
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            const count = tab.id === 'comps' ? compsCount : tab.count;
            const displayLabel = count !== undefined && count !== null && count > 0 
              ? `${tab.label} (${count})` 
              : tab.label;
            
            return (
              <li
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                style={{
                  padding: '8px 16px',
                  cursor: 'pointer',
                  borderBottom: isActive ? '4px solid var(--primary)' : '4px solid transparent',
                  color: isActive ? 'var(--primary)' : 'var(--text-muted)',
                  transition: 'all 0.12s ease',
                  userSelect: 'none'
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.color = 'var(--text)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.color = 'var(--text-muted)';
                  }
                }}
              >
                {displayLabel}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Tab Content */}
      <div style={{ minHeight: '400px' }}>
        {activeTab === 'description' && (
          <VehicleDescriptionTab
            vehicle={vehicle}
            session={session}
            permissions={permissions}
            canEdit={canEdit}
            onDataPointClick={onDataPointClick}
            onEditClick={onEditClick}
            referenceLibraryRefreshKey={referenceLibraryRefreshKey}
            onReferenceLibraryRefresh={onReferenceLibraryRefresh}
          />
        )}

        {activeTab === 'media' && (
          <VehicleMediaTab
            vehicle={vehicle}
            vehicleImages={vehicleImages}
            fallbackListingImageUrls={fallbackListingImageUrls}
            onImagesUpdated={onImagesUpdated}
            session={session}
            permissions={permissions}
          />
        )}

        {activeTab === 'specs' && (
          <VehicleSpecsTab
            vehicle={vehicle}
            session={session}
            permissions={permissions}
            onDataPointClick={onDataPointClick}
            onEditClick={onEditClick}
            canEdit={canEdit}
          />
        )}

        {activeTab === 'comps' && (
          <VehicleComparablesTab
            vehicle={vehicle}
            onCountChange={(count) => {
              setCompsCount(count);
              // Reload count when tab is viewed
              if (activeTab === 'comps') {
                loadComparablesCount();
              }
            }}
          />
        )}

        {activeTab === 'taxonomy' && (
          <VehicleTaxonomyTab
            vehicle={vehicle}
            session={session}
            permissions={permissions}
            canEdit={canEdit}
          />
        )}
      </div>
    </div>
  );
};

export default VehicleProfileTabs;

