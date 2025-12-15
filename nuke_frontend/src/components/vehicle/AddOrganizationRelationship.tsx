import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface AddOrganizationRelationshipProps {
  vehicleId: string;
  vehicleName: string;
  userId: string;
  onSuccess?: () => void;
  onClose: () => void;
}

interface Organization {
  id: string;
  business_name: string;
  business_type?: string;
  city?: string;
  state?: string;
  logo_url?: string;
}

const RELATIONSHIP_TYPES = [
  { value: 'owner', label: 'Owner', description: 'This organization owns the vehicle' },
  { value: 'service_provider', label: 'In for Service', description: 'Vehicle is in for service/repair here' },
  { value: 'work_location', label: 'Work Location', description: 'Work is being done at this location' },
  { value: 'storage', label: 'Storage', description: 'Vehicle is stored at this location' },
  { value: 'consigner', label: 'Consignment', description: 'Selling on consignment' },
  { value: 'collaborator', label: 'Collaborator', description: 'Working together on this vehicle' },
  { value: 'fabricator', label: 'Fabricator', description: 'Fabrication work being done' },
  { value: 'painter', label: 'Paint Shop', description: 'Paint work being done' },
  { value: 'upholstery', label: 'Upholstery', description: 'Upholstery work being done' },
  { value: 'parts_supplier', label: 'Parts Supplier', description: 'Getting parts from here' },
  { value: 'transport', label: 'Transport', description: 'Transporting the vehicle' },
];

const AddOrganizationRelationship: React.FC<AddOrganizationRelationshipProps> = ({
  vehicleId,
  vehicleName,
  userId,
  onSuccess,
  onClose
}) => {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [relationshipType, setRelationshipType] = useState<string>('service_provider');
  const [notes, setNotes] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingRelationships, setExistingRelationships] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadOrganizations();
    loadExistingRelationships();
  }, [vehicleId]);

  const loadOrganizations = async () => {
    try {
      setLoading(true);
      
      // Load user's organizations
      const { data: orgContributors, error: ocError } = await supabase
        .from('organization_contributors')
        .select(`
          organization_id,
          businesses!inner (
            id,
            business_name,
            business_type,
            city,
            state,
            logo_url
          )
        `)
        .eq('user_id', userId)
        .eq('status', 'active');

      if (ocError) throw ocError;

      // Also load all organizations (for cases where user needs to add to orgs they're not part of)
      const { data: allOrgs, error: allOrgsError } = await supabase
        .from('businesses')
        .select('id, business_name, business_type, city, state, logo_url')
        .order('business_name');

      if (allOrgsError) throw allOrgsError;

      // Combine and deduplicate
      const userOrgIds = new Set((orgContributors || []).map((oc: any) => oc.organization_id));
      const userOrgs = (orgContributors || []).map((oc: any) => ({
        id: oc.organization_id,
        ...oc.businesses
      }));
      
      const otherOrgs = (allOrgs || []).filter((org: any) => !userOrgIds.has(org.id));
      
      setOrganizations([...userOrgs, ...otherOrgs]);
    } catch (err) {
      console.error('Error loading organizations:', err);
      setError('Failed to load organizations');
    } finally {
      setLoading(false);
    }
  };

  const loadExistingRelationships = async () => {
    try {
      const { data, error } = await supabase
        .from('organization_vehicles')
        .select('organization_id, relationship_type')
        .eq('vehicle_id', vehicleId)
        .eq('status', 'active');

      if (error) throw error;

      // Create a set of "orgId:relationshipType" strings
      const existing = new Set<string>();
      (data || []).forEach((ov: any) => {
        existing.add(`${ov.organization_id}:${ov.relationship_type}`);
      });
      setExistingRelationships(existing);
    } catch (err) {
      console.error('Error loading existing relationships:', err);
    }
  };

  const handleSave = async () => {
    if (!selectedOrgId) {
      setError('Please select an organization');
      return;
    }

    // Check if this relationship already exists
    const relationshipKey = `${selectedOrgId}:${relationshipType}`;
    if (existingRelationships.has(relationshipKey)) {
      setError('This relationship already exists for this vehicle');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const { data, error: insertError } = await supabase
        .from('organization_vehicles')
        .insert({
          organization_id: selectedOrgId,
          vehicle_id: vehicleId,
          relationship_type: relationshipType,
          status: 'active',
          notes: notes.trim() || null,
          linked_by_user_id: userId,
          auto_tagged: false
        })
        .select()
        .single();

      if (insertError) {
        if (insertError.code === '23505') {
          // Unique constraint violation
          setError('This relationship already exists for this vehicle');
        } else {
          throw insertError;
        }
        return;
      }

      // Success!
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Error adding relationship:', err);
      setError(err.message || 'Failed to add relationship');
    } finally {
      setSaving(false);
    }
  };

  const selectedOrg = organizations.find(org => org.id === selectedOrgId);
  const relationshipKey = selectedOrgId ? `${selectedOrgId}:${relationshipType}` : '';
  const alreadyExists = relationshipKey && existingRelationships.has(relationshipKey);

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '16px'
      }}
      onClick={onClose}
    >
      <div 
        className="card"
        style={{
          maxWidth: '600px',
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-header" style={{ 
          fontSize: '11pt', 
          fontWeight: 700,
          borderBottom: '2px solid var(--border-medium)'
        }}>
          Add Organization Relationship
        </div>
        
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
            Associate <strong>{vehicleName}</strong> with an organization
          </div>

          {error && (
            <div style={{
              padding: '12px',
              background: 'var(--error-dim)',
              border: '1px solid var(--error)',
              borderRadius: '4px',
              fontSize: '9pt',
              color: 'var(--error)'
            }}>
              {error}
            </div>
          )}

          {alreadyExists && (
            <div style={{
              padding: '12px',
              background: '#fef3c7',
              border: '1px solid #f59e0b',
              borderRadius: '4px',
              fontSize: '9pt',
              color: '#92400e'
            }}>
              This relationship already exists. Please select a different organization or relationship type.
            </div>
          )}

          <div>
            <label style={{ 
              display: 'block', 
              fontSize: '9pt', 
              fontWeight: 600, 
              marginBottom: '8px',
              color: 'var(--text-primary)'
            }}>
              Organization
            </label>
            {loading ? (
              <div style={{ padding: '12px', fontSize: '9pt', color: 'var(--text-muted)' }}>
                Loading organizations...
              </div>
            ) : (
              <select
                value={selectedOrgId}
                onChange={(e) => setSelectedOrgId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  fontSize: '9pt',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  background: 'var(--surface)'
                }}
              >
                <option value="">Select an organization...</option>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.business_name}
                    {org.city && org.state && ` (${org.city}, ${org.state})`}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label style={{ 
              display: 'block', 
              fontSize: '9pt', 
              fontWeight: 600, 
              marginBottom: '8px',
              color: 'var(--text-primary)'
            }}>
              Relationship Type
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {RELATIONSHIP_TYPES.map(type => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setRelationshipType(type.value)}
                  style={{
                    padding: '12px',
                    border: '2px solid',
                    borderColor: relationshipType === type.value ? 'var(--accent)' : 'var(--border-light)',
                    background: relationshipType === type.value ? 'var(--accent-dim)' : 'transparent',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    transition: 'all 0.12s ease',
                    textAlign: 'left'
                  }}
                >
                  <div style={{ fontSize: '8pt', fontWeight: 700 }}>
                    {type.label}
                  </div>
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                    {type.description}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ 
              display: 'block', 
              fontSize: '9pt', 
              fontWeight: 600, 
              marginBottom: '8px',
              color: 'var(--text-primary)'
            }}>
              Notes (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="E.g., 'In for engine rebuild', 'Waiting on parts', 'Scheduled pickup next week'..."
              style={{
                width: '100%',
                minHeight: '80px',
                padding: '8px',
                fontSize: '9pt',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                fontFamily: 'inherit',
                resize: 'vertical'
              }}
            />
          </div>

          <div style={{ 
            display: 'flex', 
            gap: '8px', 
            marginTop: '8px',
            paddingTop: '16px',
            borderTop: '1px solid var(--border-light)'
          }}>
            <button
              onClick={onClose}
              className="button button-secondary"
              style={{ flex: 1, fontSize: '9pt' }}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="button button-primary"
              style={{ flex: 1, fontSize: '9pt' }}
              disabled={saving || !selectedOrgId || alreadyExists}
            >
              {saving ? 'Adding...' : 'Add Relationship'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddOrganizationRelationship;



