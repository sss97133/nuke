import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import type { Vehicle } from './types';
import type { VehiclePermissions } from './types';
import VehicleDescriptionTab from './VehicleDescriptionTab';
import VehicleMediaTab from './VehicleMediaTab';
import VehicleSpecsTab from './VehicleSpecsTab';
import VehicleComparablesTab from './VehicleComparablesTab';
import VehicleTaxonomyTab from './VehicleTaxonomyTab';
import VehicleBidCard from '../../components/vehicle/VehicleBidCard';
import BidderProfileCard from '../../components/bidder/BidderProfileCard';

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

type TabId = 'description' | 'media' | 'specs' | 'comps' | 'taxonomy' | 'bids';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'description', label: 'Overview' },
  { id: 'media', label: 'Media' },
  { id: 'specs', label: 'Specs' },
  { id: 'comps', label: 'Comps' },
  { id: 'taxonomy', label: 'Taxonomy' },
  { id: 'bids', label: 'Bids' },
];

const VALID_TAB_IDS = new Set(TABS.map(t => t.id));

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
  const location = useLocation();
  const navigate = useNavigate();

  // Deep-link support: ?tab=comps
  const getTabFromUrl = (): TabId => {
    try {
      const params = new URLSearchParams(location.search);
      const t = params.get('tab');
      if (t && VALID_TAB_IDS.has(t as TabId)) return t as TabId;
    } catch { /* ignore */ }
    return 'description';
  };

  const [activeTab, setActiveTab] = useState<TabId>(getTabFromUrl);
  const [compsCount, setCompsCount] = useState<number | null>(null);
  const [selectedBidder, setSelectedBidder] = useState<string | null>(null);

  // Sync tab from URL on navigation
  useEffect(() => {
    const tabFromUrl = getTabFromUrl();
    setActiveTab(tabFromUrl);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  useEffect(() => {
    loadComparablesCount();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Update URL for deep-linking
    try {
      const params = new URLSearchParams(location.search);
      if (tabId === 'description') {
        params.delete('tab');
      } else {
        params.set('tab', tabId);
      }
      const newSearch = params.toString();
      navigate(
        { pathname: location.pathname, search: newSearch ? `?${newSearch}` : '' },
        { replace: true }
      );
    } catch { /* ignore */ }
  };

  return (
    <div style={{ marginTop: 'var(--space-4)' }}>
      {/* Tab Navigation */}
      <div style={{
        borderBottom: '1px solid var(--border-light)',
        marginBottom: '20px',
      }}>
        <div style={{
          display: 'flex',
          overflowX: 'auto',
          gap: '0',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
        }}>
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            const count = tab.id === 'comps' ? compsCount : null;

            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                style={{
                  padding: '10px 18px',
                  fontSize: '13px',
                  fontWeight: isActive ? 600 : 400,
                  cursor: 'pointer',
                  border: 'none',
                  borderBottom: isActive ? '2px solid var(--text)' : '2px solid transparent',
                  background: 'transparent',
                  color: isActive ? 'var(--text)' : 'var(--text-muted)',
                  transition: 'color 0.1s ease, border-color 0.1s ease',
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                  marginBottom: '-1px',
                  letterSpacing: '0.01em',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.color = 'var(--text)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)';
                  }
                }}
              >
                {tab.label}
                {count !== null && count !== undefined && count > 0 && (
                  <span style={{
                    marginLeft: '6px',
                    fontSize: '11px',
                    fontWeight: 500,
                    color: isActive ? 'var(--text)' : 'var(--text-muted)',
                    background: 'var(--surface)',
                    borderRadius: '10px',
                    padding: '1px 6px',
                    border: '1px solid var(--border-light)',
                  }}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
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

        {activeTab === 'bids' && (
          <VehicleBidCard
            vehicleId={vehicle.id}
            make={(vehicle as any).make}
            model={(vehicle as any).model}
            onBidderClick={(username) => setSelectedBidder(username)}
          />
        )}
      </div>

      {selectedBidder && (
        <BidderProfileCard
          username={selectedBidder}
          isOpen={true}
          onClose={() => setSelectedBidder(null)}
        />
      )}
    </div>
  );
};

export default VehicleProfileTabs;
