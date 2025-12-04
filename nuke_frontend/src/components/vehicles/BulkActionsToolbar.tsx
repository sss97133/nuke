import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { MyOrganizationsService } from '../../services/myOrganizationsService';
import type { MyOrganization } from '../../services/myOrganizationsService';

interface BulkActionsToolbarProps {
  selectedVehicleIds: string[];
  userId: string;
  onDeselectAll: () => void;
  onUpdate?: () => void;
}

const BulkActionsToolbar: React.FC<BulkActionsToolbarProps> = ({
  selectedVehicleIds,
  userId,
  onDeselectAll,
  onUpdate
}) => {
  const [action, setAction] = useState<string | null>(null);
  const [collectionName, setCollectionName] = useState('');
  const [showCollectionInput, setShowCollectionInput] = useState(false);
  const [showOrgAssignment, setShowOrgAssignment] = useState(false);
  const [organizations, setOrganizations] = useState<MyOrganization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [relationshipType, setRelationshipType] = useState<string>('work_location');
  const [loadingOrgs, setLoadingOrgs] = useState(false);

  useEffect(() => {
    if (showOrgAssignment && organizations.length === 0) {
      loadOrganizations();
    }
  }, [showOrgAssignment]);

  const loadOrganizations = async () => {
    setLoadingOrgs(true);
    try {
      const orgs = await MyOrganizationsService.getMyOrganizations({ status: 'active' });
      setOrganizations(orgs);
    } catch (error) {
      console.error('Error loading organizations:', error);
    } finally {
      setLoadingOrgs(false);
    }
  };

  if (selectedVehicleIds.length === 0) {
    return null;
  }

  const executeBulkAction = async (actionType: string, value?: string) => {
    try {
      setAction(actionType);

      if (actionType === 'favorite') {
        // Add to favorites
        const { error } = await supabase
          .from('user_vehicle_preferences')
          .upsert(
            selectedVehicleIds.map(vehicleId => ({
              user_id: userId,
              vehicle_id: vehicleId,
              is_favorite: true
            })),
            { onConflict: 'user_id,vehicle_id' }
          );
        if (error) {
          if (error.code === '42P01' || error.message?.includes('does not exist')) {
            alert('Please apply the database migration first. Run: supabase migration up');
            return;
          }
          throw error;
        }
      } else if (actionType === 'unfavorite') {
        // Remove from favorites
        const { error } = await supabase
          .from('user_vehicle_preferences')
          .update({ is_favorite: false })
          .eq('user_id', userId)
          .in('vehicle_id', selectedVehicleIds);
        if (error) {
          if (error.code === '42P01' || error.message?.includes('does not exist')) {
            // Table doesn't exist, nothing to unfavorite
            return;
          }
          throw error;
        }
      } else if (actionType === 'hide') {
        // Hide vehicles
        const { error } = await supabase
          .from('user_vehicle_preferences')
          .upsert(
            selectedVehicleIds.map(vehicleId => ({
              user_id: userId,
              vehicle_id: vehicleId,
              is_hidden: true
            })),
            { onConflict: 'user_id,vehicle_id' }
          );
        if (error) {
          if (error.code === '42P01' || error.message?.includes('does not exist')) {
            alert('Please apply the database migration first. Run: supabase migration up');
            return;
          }
          throw error;
        }
      } else if (actionType === 'unhide') {
        // Unhide vehicles
        const { error } = await supabase
          .from('user_vehicle_preferences')
          .update({ is_hidden: false })
          .eq('user_id', userId)
          .in('vehicle_id', selectedVehicleIds);
        if (error) {
          if (error.code === '42P01' || error.message?.includes('does not exist')) {
            // Table doesn't exist, nothing to unhide
            return;
          }
          throw error;
        }
      } else if (actionType === 'collection' && value) {
        // Add to collection
        const { error } = await supabase
          .from('user_vehicle_preferences')
          .upsert(
            selectedVehicleIds.map(vehicleId => ({
              user_id: userId,
              vehicle_id: vehicleId,
              collection_name: value
            })),
            { onConflict: 'user_id,vehicle_id' }
          );
        if (error) {
          if (error.code === '42P01' || error.message?.includes('does not exist')) {
            alert('Please apply the database migration first. Run: supabase migration up');
            return;
          }
          throw error;
        }
        setShowCollectionInput(false);
        setCollectionName('');
      } else if (actionType === 'remove_collection') {
        // Remove from collections
        const { error } = await supabase
          .from('user_vehicle_preferences')
          .update({ collection_name: null })
          .eq('user_id', userId)
          .in('vehicle_id', selectedVehicleIds);
        if (error) {
          if (error.code === '42P01' || error.message?.includes('does not exist')) {
            // Table doesn't exist, nothing to remove
            return;
          }
          throw error;
        }
      } else if (actionType === 'assign_org' && value) {
        // Assign to organization
        const [orgId, relType] = value.split('|');
        if (!orgId || !relType) throw new Error('Invalid organization assignment');

        const org = organizations.find(o => o.organization_id === orgId);
        const orgName = org?.organization.business_name || 'organization';

        const { error } = await supabase
          .from('organization_vehicles')
          .upsert(
            selectedVehicleIds.map(vehicleId => ({
              organization_id: orgId,
              vehicle_id: vehicleId,
              relationship_type: relType,
              auto_tagged: false,
              linked_by_user_id: userId
            })),
            { onConflict: 'organization_id,vehicle_id,relationship_type' }
          );
        if (error) throw error;
        
        alert(`Successfully assigned ${selectedVehicleIds.length} vehicle${selectedVehicleIds.length !== 1 ? 's' : ''} to ${orgName}`);
        setShowOrgAssignment(false);
        setSelectedOrgId(null);
        onDeselectAll();
      }

      if (onUpdate) onUpdate();
      if (actionType !== 'assign_org') {
        onDeselectAll();
      }
    } catch (error) {
      console.error('Error executing bulk action:', error);
      alert('Failed to execute action');
    } finally {
      setAction(null);
    }
  };

  return (
    <div style={{
      position: 'sticky',
      top: 0,
      zIndex: 100,
      background: 'white',
      border: '2px solid var(--accent)',
      borderRadius: '4px',
      padding: '12px',
      marginBottom: '16px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '12px'
      }}>
        <div style={{ fontSize: '9pt', fontWeight: 700, color: 'var(--accent)' }}>
          {selectedVehicleIds.length} vehicle{selectedVehicleIds.length !== 1 ? 's' : ''} selected
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Favorite/Unfavorite */}
          <button
            onClick={() => executeBulkAction('favorite')}
            disabled={action === 'favorite'}
            style={{
              padding: '6px 12px',
              fontSize: '8pt',
              fontWeight: 600,
              border: '1px solid var(--border)',
              background: 'white',
              color: 'var(--text-muted)',
              cursor: action === 'favorite' ? 'wait' : 'pointer',
              borderRadius: '4px',
              opacity: action === 'favorite' ? 0.5 : 1
            }}
          >
            {action === 'favorite' ? 'Adding...' : 'FAVORITE'}
          </button>

          <button
            onClick={() => executeBulkAction('unfavorite')}
            disabled={action === 'unfavorite'}
            style={{
              padding: '6px 12px',
              fontSize: '8pt',
              fontWeight: 600,
              border: '1px solid var(--border)',
              background: 'white',
              color: 'var(--text-muted)',
              cursor: action === 'unfavorite' ? 'wait' : 'pointer',
              borderRadius: '4px',
              opacity: action === 'unfavorite' ? 0.5 : 1
            }}
          >
            {action === 'unfavorite' ? 'Removing...' : 'UNFAVORITE'}
          </button>

          {/* Hide/Unhide */}
          <button
            onClick={() => executeBulkAction('hide')}
            disabled={action === 'hide'}
            style={{
              padding: '6px 12px',
              fontSize: '8pt',
              fontWeight: 600,
              border: '1px solid var(--border)',
              background: 'white',
              color: 'var(--text-muted)',
              cursor: action === 'hide' ? 'wait' : 'pointer',
              borderRadius: '4px',
              opacity: action === 'hide' ? 0.5 : 1
            }}
          >
            {action === 'hide' ? 'Hiding...' : 'HIDE'}
          </button>

          <button
            onClick={() => executeBulkAction('unhide')}
            disabled={action === 'unhide'}
            style={{
              padding: '6px 12px',
              fontSize: '8pt',
              fontWeight: 600,
              border: '1px solid var(--border)',
              background: 'white',
              color: 'var(--text-muted)',
              cursor: action === 'unhide' ? 'wait' : 'pointer',
              borderRadius: '4px',
              opacity: action === 'unhide' ? 0.5 : 1
            }}
          >
            {action === 'unhide' ? 'Unhiding...' : 'UNHIDE'}
          </button>

          {/* Collection */}
          {showCollectionInput ? (
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <input
                type="text"
                value={collectionName}
                onChange={(e) => setCollectionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && collectionName.trim()) {
                    executeBulkAction('collection', collectionName.trim());
                  } else if (e.key === 'Escape') {
                    setShowCollectionInput(false);
                    setCollectionName('');
                  }
                }}
                placeholder="Collection name"
                style={{
                  padding: '6px 12px',
                  fontSize: '8pt',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  width: '150px'
                }}
                autoFocus
              />
              <button
                onClick={() => {
                  if (collectionName.trim()) {
                    executeBulkAction('collection', collectionName.trim());
                  }
                }}
                disabled={action === 'collection'}
                style={{
                  padding: '6px 12px',
                  fontSize: '8pt',
                  border: '1px solid var(--accent)',
                  background: 'var(--accent)',
                  color: 'white',
                  cursor: action === 'collection' ? 'wait' : 'pointer',
                  borderRadius: '4px',
                  opacity: action === 'collection' ? 0.5 : 1
                }}
              >
                {action === 'collection' ? 'Adding...' : 'ADD'}
              </button>
              <button
                onClick={() => {
                  setShowCollectionInput(false);
                  setCollectionName('');
                }}
                style={{
                  padding: '6px 12px',
                  fontSize: '8pt',
                  border: '1px solid var(--border)',
                  background: 'white',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  borderRadius: '4px'
                }}
              >
                CANCEL
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={() => setShowCollectionInput(true)}
                style={{
                  padding: '6px 12px',
                  fontSize: '8pt',
                  fontWeight: 600,
                  border: '1px solid var(--border)',
                  background: 'white',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  borderRadius: '4px'
                }}
              >
                ADD TO COLLECTION
              </button>
              <button
                onClick={() => executeBulkAction('remove_collection')}
                disabled={action === 'remove_collection'}
                style={{
                  padding: '6px 12px',
                  fontSize: '8pt',
                  fontWeight: 600,
                  border: '1px solid var(--border)',
                  background: 'white',
                  color: 'var(--text-muted)',
                  cursor: action === 'remove_collection' ? 'wait' : 'pointer',
                  borderRadius: '4px',
                  opacity: action === 'remove_collection' ? 0.5 : 1
                }}
              >
                {action === 'remove_collection' ? 'Removing...' : 'REMOVE FROM COLLECTION'}
              </button>
            </>
          )}

          {/* Assign to Organization */}
          {showOrgAssignment ? (
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
              {loadingOrgs ? (
                <div style={{ padding: '6px 12px', fontSize: '8pt', color: 'var(--text-muted)' }}>
                  Loading organizations...
                </div>
              ) : (
                <>
                  <select
                    value={selectedOrgId || ''}
                    onChange={(e) => setSelectedOrgId(e.target.value || null)}
                    style={{
                      padding: '6px 12px',
                      fontSize: '8pt',
                      border: '1px solid var(--border)',
                      borderRadius: '4px',
                      minWidth: '200px'
                    }}
                  >
                    <option value="">Select organization...</option>
                    {organizations.map((org) => (
                      <option key={org.organization_id} value={org.organization_id}>
                        {org.organization.business_name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={relationshipType}
                    onChange={(e) => setRelationshipType(e.target.value)}
                    style={{
                      padding: '6px 12px',
                      fontSize: '8pt',
                      border: '1px solid var(--border)',
                      borderRadius: '4px'
                    }}
                  >
                    <option value="work_location">Work Location</option>
                    <option value="service_provider">Service Provider</option>
                    <option value="owner">Owner</option>
                    <option value="consigner">Consignment</option>
                    <option value="in_stock">In Stock</option>
                    <option value="collaborator">Collaborator</option>
                  </select>
                  <button
                    onClick={() => {
                      if (selectedOrgId) {
                        executeBulkAction('assign_org', `${selectedOrgId}|${relationshipType}`);
                      }
                    }}
                    disabled={action === 'assign_org' || !selectedOrgId}
                    style={{
                      padding: '6px 12px',
                      fontSize: '8pt',
                      border: '1px solid var(--accent)',
                      background: 'var(--accent)',
                      color: 'white',
                      cursor: action === 'assign_org' || !selectedOrgId ? 'wait' : 'pointer',
                      borderRadius: '4px',
                      opacity: action === 'assign_org' || !selectedOrgId ? 0.5 : 1
                    }}
                  >
                    {action === 'assign_org' ? 'Assigning...' : 'ASSIGN'}
                  </button>
                  <button
                    onClick={() => {
                      setShowOrgAssignment(false);
                      setSelectedOrgId(null);
                    }}
                    style={{
                      padding: '6px 12px',
                      fontSize: '8pt',
                      border: '1px solid var(--border)',
                      background: 'white',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      borderRadius: '4px'
                    }}
                  >
                    CANCEL
                  </button>
                </>
              )}
            </div>
          ) : (
            <button
              onClick={() => setShowOrgAssignment(true)}
              style={{
                padding: '6px 12px',
                fontSize: '8pt',
                fontWeight: 600,
                border: '1px solid #1e40af',
                background: '#1e40af',
                color: 'white',
                cursor: 'pointer',
                borderRadius: '4px'
              }}
            >
              ASSIGN TO ORGANIZATION
            </button>
          )}

          {/* Deselect All */}
          <button
            onClick={onDeselectAll}
            style={{
              padding: '6px 12px',
              fontSize: '8pt',
              fontWeight: 600,
              border: '1px solid var(--border)',
              background: 'white',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              borderRadius: '4px'
            }}
          >
            DESELECT ALL
          </button>
        </div>
      </div>
    </div>
  );
};

export default BulkActionsToolbar;

