import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';

interface Props {
  vehicleId: string;
  organizationId: string;
  currentUserId: string;
  canManage?: boolean;
}

interface OrgVehicle {
  id: string;
  responsible_party_user_id: string | null;
  responsibility_type: string | null;
  assigned_at: string | null;
  responsibility_notes: string | null;
}

interface OrganizationMember {
  user_id: string;
  full_name: string;
  email: string;
  role: string;
}

export default function VehicleResponsibilityManager({ 
  vehicleId, 
  organizationId, 
  currentUserId,
  canManage = false 
}: Props) {
  const [orgVehicle, setOrgVehicle] = useState<OrgVehicle | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAssigning, setIsAssigning] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [responsibilityType, setResponsibilityType] = useState<string>('manager');
  const [notes, setNotes] = useState<string>('');
  const [responsibleUserName, setResponsibleUserName] = useState<string>('');

  useEffect(() => {
    loadData();
  }, [vehicleId, organizationId]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load org-vehicle link
      const { data: ovData, error: ovError } = await supabase
        .from('organization_vehicles')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .eq('organization_id', organizationId)
        .single();

      if (ovError) throw ovError;
      setOrgVehicle(ovData);

      // If there's a responsible party, get their name
      if (ovData.responsible_party_user_id) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', ovData.responsible_party_user_id)
          .single();
        
        if (profileData) {
          setResponsibleUserName(profileData.full_name || 'Unknown');
        }
      }

      // Load org members
      const { data: membersData, error: membersError } = await supabase
        .from('organization_contributors')
        .select(`
          user_id,
          role,
          profiles!inner(
            full_name,
            email
          )
        `)
        .eq('organization_id', organizationId)
        .eq('status', 'active');

      if (membersError) throw membersError;

      const enriched = (membersData || []).map((m: any) => ({
        user_id: m.user_id,
        full_name: m.profiles.full_name || 'Unknown',
        email: m.profiles.email,
        role: m.role
      }));

      setMembers(enriched);
    } catch (error) {
      console.error('Failed to load responsibility data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAssign = async () => {
    if (!selectedUserId || !orgVehicle) return;

    setIsAssigning(true);
    try {
      // Call the assign_vehicle_responsibility function
      const { data, error } = await supabase.rpc('assign_vehicle_responsibility', {
        p_org_vehicle_id: orgVehicle.id,
        p_user_id: selectedUserId,
        p_responsibility_type: responsibilityType,
        p_assigned_by_user_id: currentUserId,
        p_notes: notes || null
      });

      if (error) throw error;

      alert('Responsibility assigned successfully!');
      setIsAssigning(false);
      setSelectedUserId('');
      setNotes('');
      loadData();
    } catch (error: any) {
      console.error('Failed to assign responsibility:', error);
      alert(`Failed to assign: ${error.message}`);
      setIsAssigning(false);
    }
  };

  const handleClaimResponsibility = async () => {
    if (!orgVehicle) return;

    setIsAssigning(true);
    try {
      const { error } = await supabase.rpc('assign_vehicle_responsibility', {
        p_org_vehicle_id: orgVehicle.id,
        p_user_id: currentUserId,
        p_responsibility_type: 'manager',
        p_assigned_by_user_id: currentUserId,
        p_notes: 'Self-assigned'
      });

      if (error) throw error;

      alert('You are now responsible for this vehicle!');
      setIsAssigning(false);
      loadData();
    } catch (error: any) {
      console.error('Failed to claim responsibility:', error);
      alert(`Failed to claim: ${error.message}`);
      setIsAssigning(false);
    }
  };

  if (loading) {
    return <div style={{ padding: '20px', color: 'var(--text-muted)' }}>Loading...</div>;
  }

  if (!orgVehicle) {
    return (
      <div style={{ padding: '20px', color: 'var(--text-muted)' }}>
        Vehicle not linked to organization
      </div>
    );
  }

  return (
    <div style={{
      padding: '20px',
      border: '2px solid var(--border-primary)',
      borderRadius: '6px',
      background: 'var(--surface-primary)'
    }}>
      <h3 style={{
        fontSize: '11pt',
        fontWeight: 700,
        marginBottom: '16px',
        color: 'var(--text-primary)'
      }}>
        Vehicle Responsibility
      </h3>

      {/* Current responsible party */}
      {orgVehicle.responsible_party_user_id ? (
        <div style={{
          padding: '12px',
          background: 'var(--surface-secondary)',
          borderRadius: '6px',
          marginBottom: '16px'
        }}>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
            CURRENT RESPONSIBLE PARTY
          </div>
          <div style={{ fontSize: '10pt', fontWeight: 600, color: 'var(--text-primary)' }}>
            {responsibleUserName}
          </div>
          <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Type: {orgVehicle.responsibility_type}
          </div>
          {orgVehicle.responsibility_notes && (
            <div style={{
              fontSize: '8pt',
              color: 'var(--text-muted)',
              marginTop: '8px',
              fontStyle: 'italic'
            }}>
              {orgVehicle.responsibility_notes}
            </div>
          )}
        </div>
      ) : (
        <div style={{
          padding: '12px',
          background: '#fef3c7',
          border: '2px solid #fbbf24',
          borderRadius: '6px',
          marginBottom: '16px'
        }}>
          <div style={{ fontSize: '9pt', fontWeight: 600, color: '#92400e' }}>
            ⚠️ No responsible party assigned
          </div>
          <div style={{ fontSize: '8pt', color: '#92400e', marginTop: '4px' }}>
            This vehicle needs someone to take responsibility for managing it.
          </div>
        </div>
      )}

      {/* Claim responsibility (if no one assigned) */}
      {!orgVehicle.responsible_party_user_id && (
        <div style={{ marginBottom: '16px' }}>
          <button
            onClick={handleClaimResponsibility}
            disabled={isAssigning}
            style={{
              width: '100%',
              padding: '12px',
              background: 'var(--primary)',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '10pt',
              fontWeight: 600
            }}
          >
            {isAssigning ? 'Assigning...' : 'I\'m Responsible for This Vehicle'}
          </button>
        </div>
      )}

      {/* Assignment form (if can manage) */}
      {canManage && (
        <div style={{
          borderTop: '2px solid var(--border-primary)',
          paddingTop: '16px'
        }}>
          <div style={{
            fontSize: '9pt',
            fontWeight: 600,
            marginBottom: '12px',
            color: 'var(--text-primary)'
          }}>
            Assign Responsibility
          </div>

          {/* User selector */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{
              display: 'block',
              fontSize: '8pt',
              fontWeight: 600,
              marginBottom: '4px',
              color: 'var(--text-secondary)'
            }}>
              Assign To:
            </label>
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                border: '2px solid var(--border-primary)',
                borderRadius: '3px',
                fontSize: '9pt',
                background: 'var(--surface-primary)',
                color: 'var(--text-primary)'
              }}
            >
              <option value="">Select a person...</option>
              {members.map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {member.full_name} ({member.role})
                </option>
              ))}
            </select>
          </div>

          {/* Responsibility type */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{
              display: 'block',
              fontSize: '8pt',
              fontWeight: 600,
              marginBottom: '4px',
              color: 'var(--text-secondary)'
            }}>
              Responsibility Type:
            </label>
            <select
              value={responsibilityType}
              onChange={(e) => setResponsibilityType(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                border: '2px solid var(--border-primary)',
                borderRadius: '3px',
                fontSize: '9pt',
                background: 'var(--surface-primary)',
                color: 'var(--text-primary)'
              }}
            >
              <option value="owner">Owner</option>
              <option value="manager">Manager</option>
              <option value="listing_agent">Listing Agent</option>
              <option value="custodian">Custodian</option>
              <option value="consignment_agent">Consignment Agent</option>
            </select>
          </div>

          {/* Notes */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{
              display: 'block',
              fontSize: '8pt',
              fontWeight: 600,
              marginBottom: '4px',
              color: 'var(--text-secondary)'
            }}>
              Notes (optional):
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any relevant notes..."
              style={{
                width: '100%',
                minHeight: '60px',
                padding: '8px',
                border: '2px solid var(--border-primary)',
                borderRadius: '3px',
                fontSize: '9pt',
                background: 'var(--surface-primary)',
                color: 'var(--text-primary)',
                fontFamily: 'inherit',
                resize: 'vertical'
              }}
            />
          </div>

          {/* Assign button */}
          <button
            onClick={handleAssign}
            disabled={!selectedUserId || isAssigning}
            style={{
              width: '100%',
              padding: '12px',
              background: selectedUserId && !isAssigning ? 'var(--primary)' : 'var(--surface-secondary)',
              color: selectedUserId && !isAssigning ? 'white' : 'var(--text-muted)',
              border: '2px solid var(--border-primary)',
              borderRadius: '6px',
              cursor: selectedUserId && !isAssigning ? 'pointer' : 'not-allowed',
              fontSize: '10pt',
              fontWeight: 600
            }}
          >
            {isAssigning ? 'Assigning...' : 'Assign Responsibility'}
          </button>
        </div>
      )}
    </div>
  );
}

