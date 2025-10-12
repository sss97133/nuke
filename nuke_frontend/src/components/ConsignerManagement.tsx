import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface ConsignerManagementProps {
  vehicleId: string;
  isOwner: boolean;
  onConsignerUpdated?: () => void;
}

interface ConsignerRequest {
  id: string;
  user_id: string;
  vehicle_id: string;
  status: 'pending' | 'approved' | 'rejected';
  requested_at: string;
  user: {
    full_name: string;
    email: string;
  };
}

interface Consigner {
  id: string;
  user_id: string;
  role: string;
  start_date: string;
  notes: string;
  user: {
    full_name: string;
    email: string;
  };
}

export default function ConsignerManagement({
  vehicleId,
  isOwner,
  onConsignerUpdated
}: ConsignerManagementProps) {
  const [consigners, setConsigners] = useState<Consigner[]>([]);
  const [requests, setRequests] = useState<ConsignerRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [newConsignerEmail, setNewConsignerEmail] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (isOwner) {
      loadConsigners();
      loadRequests();
    }
  }, [vehicleId, isOwner]);

  const loadConsigners = async () => {
    try {
      const { data, error } = await supabase
        .from('vehicle_contributors')
        .select(`
          *,
          profiles!inner(full_name, email)
        `)
        .eq('vehicle_id', vehicleId)
        .eq('role', 'consigner');

      if (!error && data) {
        setConsigners(data.map(item => ({
          ...item,
          user: item.profiles
        })));
      }
    } catch (err) {
      console.error('Error loading consigners:', err);
    }
  };

  const loadRequests = async () => {
    try {
      // This would load from a consigner_requests table if it existed
      // For now, we'll show empty state
      setRequests([]);
    } catch (err) {
      console.error('Error loading requests:', err);
    } finally {
      setLoading(false);
    }
  };

  const addConsigner = async () => {
    if (!newConsignerEmail.trim()) return;

    setAdding(true);
    try {
      // First find the user by email
      const { data: userData, error: userError } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', newConsignerEmail.trim().toLowerCase())
        .maybeSingle();

      if (userError || !userData) {
        alert('User not found. Please check the email address.');
        return;
      }

      // Add as consigner
      const { error } = await supabase
        .from('vehicle_contributors')
        .insert({
          vehicle_id: vehicleId,
          user_id: userData.id,
          role: 'consigner',
          notes: 'Added by owner via management interface'
        });

      if (error) {
        if (error.code === '23505') {
          alert('This user is already a consigner for this vehicle.');
        } else {
          alert(`Failed to add consigner: ${error.message}`);
        }
      } else {
        setNewConsignerEmail('');
        await loadConsigners();
        onConsignerUpdated?.();
        alert('Consigner added successfully!');
      }
    } catch (err) {
      console.error('Error adding consigner:', err);
      alert('An unexpected error occurred.');
    } finally {
      setAdding(false);
    }
  };

  const removeConsigner = async (consignerId: string) => {
    if (!confirm('Are you sure you want to remove this consigner?')) return;

    try {
      const { error } = await supabase
        .from('vehicle_contributors')
        .delete()
        .eq('id', consignerId);

      if (!error) {
        await loadConsigners();
        onConsignerUpdated?.();
        alert('Consigner removed successfully.');
      } else {
        alert(`Failed to remove consigner: ${error.message}`);
      }
    } catch (err) {
      console.error('Error removing consigner:', err);
      alert('An unexpected error occurred.');
    }
  };

  if (!isOwner) {
    return null;
  }

  if (loading) {
    return (
      <div className="card">
        <div className="card-body text-center">Loading consigner management...</div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">Consigner Management</div>
      <div className="card-body">

        {/* Add New Consigner */}
        <div style={{ marginBottom: '24px' }}>
          <h4 className="text font-bold" style={{ marginBottom: '12px' }}>Add Consigner</h4>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="email"
              placeholder="Enter user's email address"
              value={newConsignerEmail}
              onChange={(e) => setNewConsignerEmail(e.target.value)}
              className="form-input"
              style={{ flex: 1 }}
            />
            <button
              onClick={addConsigner}
              disabled={adding || !newConsignerEmail.trim()}
              className="button button-primary"
            >
              {adding ? 'Adding...' : 'Add Consigner'}
            </button>
          </div>
          <p className="text-small text-muted" style={{ marginTop: '8px' }}>
            Consigners can create purchase agreements and manage sales for this vehicle.
          </p>
        </div>

        {/* Current Consigners */}
        <div style={{ marginBottom: '24px' }}>
          <h4 className="text font-bold" style={{ marginBottom: '12px' }}>Current Consigners</h4>
          {consigners.length === 0 ? (
            <p className="text-small text-muted">No consigners added yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {consigners.map((consigner) => (
                <div key={consigner.id} className="alert alert-info" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p className="text font-bold">{consigner.user.full_name}</p>
                    <p className="text-small text-muted">{consigner.user.email}</p>
                    <p className="text-small">Added: {new Date(consigner.start_date).toLocaleDateString()}</p>
                  </div>
                  <button
                    onClick={() => removeConsigner(consigner.id)}
                    className="button button-small"
                    style={{ background: '#dc3545', color: 'white' }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pending Requests */}
        {requests.length > 0 && (
          <div>
            <h4 className="text font-bold" style={{ marginBottom: '12px' }}>Pending Requests</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {requests.map((request) => (
                <div key={request.id} className="alert alert-warning" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p className="text font-bold">{request.user.full_name}</p>
                    <p className="text-small text-muted">{request.user.email}</p>
                    <p className="text-small">Requested: {new Date(request.requested_at).toLocaleDateString()}</p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="button button-small" style={{ background: '#28a745', color: 'white' }}>
                      Approve
                    </button>
                    <button className="button button-small" style={{ background: '#dc3545', color: 'white' }}>
                      Deny
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}