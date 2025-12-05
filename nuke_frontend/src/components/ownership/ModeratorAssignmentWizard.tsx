import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface ModeratorAssignmentWizardProps {
  vehicleId: string;
  currentUserId?: string;
  onClose: () => void;
}

const ModeratorAssignmentWizard: React.FC<ModeratorAssignmentWizardProps> = ({
  vehicleId,
  currentUserId,
  onClose
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);
  const [searching, setSearching] = useState(false);

  const searchUsers = async (query: string) => {
    if (!query || query.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      // Search for users with moderator role or moderator_level
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, moderator_level')
        .or(`full_name.ilike.%${query}%,email.ilike.%${query}%`)
        .or('role.eq.moderator,moderator_level.gt.0')
        .limit(10);

      if (error) throw error;
      setSearchResults(data || []);
    } catch (error) {
      console.error('Error searching users:', error);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      searchUsers(searchQuery);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  const handleAssign = async () => {
    if (!selectedUserId || !currentUserId) return;

    setIsAssigning(true);
    try {
      // Check if vehicle_moderators table exists, if not create assignment via vehicle_contributors
      const { data: existingModerator } = await supabase
        .from('vehicle_moderators')
        .select('id')
        .eq('vehicle_id', vehicleId)
        .eq('status', 'active')
        .maybeSingle();

      if (existingModerator) {
        // Update existing moderator
        const { error: updateError } = await supabase
          .from('vehicle_moderators')
          .update({
            user_id: selectedUserId,
            assigned_by_user_id: currentUserId,
            assigned_at: new Date().toISOString(),
            status: 'active'
          })
          .eq('id', existingModerator.id);

        if (updateError) throw updateError;
      } else {
        // Create new moderator assignment
        const { error: insertError } = await supabase
          .from('vehicle_moderators')
          .insert({
            vehicle_id: vehicleId,
            user_id: selectedUserId,
            assigned_by_user_id: currentUserId,
            assigned_at: new Date().toISOString(),
            status: 'active'
          });

        if (insertError) {
          // Fallback: use vehicle_contributors if vehicle_moderators doesn't exist
          const { error: contribError } = await supabase
            .from('vehicle_contributors')
            .upsert({
              vehicle_id: vehicleId,
              user_id: selectedUserId,
              role: 'moderator',
              status: 'active'
            }, {
              onConflict: 'vehicle_id,user_id'
            });

          if (contribError) throw contribError;
        }
      }

      alert('Moderator assigned successfully!');
      onClose();
    } catch (error: any) {
      console.error('Error assigning moderator:', error);
      alert('Failed to assign moderator: ' + (error.message || 'Unknown error'));
    } finally {
      setIsAssigning(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold' }}>
          Search for Moderator:
        </label>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by name or email..."
          className="form-input"
          style={{ width: '100%', padding: '8px' }}
        />
        {searching && (
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>
            Searching...
          </div>
        )}
      </div>

      {searchResults.length > 0 && (
        <div style={{ marginBottom: '16px', maxHeight: '200px', overflow: 'auto', border: '1px solid var(--border)', borderRadius: '4px', padding: '8px' }}>
          {searchResults.map((user) => (
            <div
              key={user.id}
              onClick={() => {
                setSelectedUserId(user.id);
                setSelectedUser(user);
              }}
              style={{
                padding: '8px',
                cursor: 'pointer',
                background: selectedUserId === user.id ? 'var(--primary-light)' : 'transparent',
                borderRadius: '4px',
                marginBottom: '4px',
                border: selectedUserId === user.id ? '2px solid var(--primary)' : '1px solid transparent'
              }}
            >
              <div style={{ fontWeight: 600 }}>
                {user.full_name || user.email || 'Unknown User'}
              </div>
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                {user.email}
                {user.role === 'moderator' && ' • Moderator'}
                {user.moderator_level > 0 && ` • Level ${user.moderator_level}`}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedUser && (
        <div style={{ marginBottom: '16px', padding: '12px', background: 'var(--grey-50)', borderRadius: '4px' }}>
          <div style={{ fontWeight: 600, marginBottom: '4px' }}>Selected Moderator:</div>
          <div>{selectedUser.full_name || selectedUser.email}</div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>{selectedUser.email}</div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button
          onClick={onClose}
          className="button button-secondary button-small"
        >
          Cancel
        </button>
        <button
          onClick={handleAssign}
          disabled={!selectedUserId || isAssigning}
          className="button button-primary"
        >
          {isAssigning ? 'Assigning...' : 'Assign Moderator'}
        </button>
      </div>
    </div>
  );
};

export default ModeratorAssignmentWizard;

