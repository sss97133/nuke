import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';

interface BulkGPSAssignmentProps {
  selectedVehicleIds: string[];
  userId: string;
  onComplete?: () => void;
  onDeselectAll: () => void;
}

interface AssignmentResult {
  vehicle_id: string;
  organization_id: string | null;
  business_name: string | null;
  assigned: boolean;
  reason: string;
}

const BulkGPSAssignment: React.FC<BulkGPSAssignmentProps> = ({
  selectedVehicleIds,
  userId,
  onComplete,
  onDeselectAll
}) => {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<AssignmentResult[]>([]);
  const [maxDistance, setMaxDistance] = useState(500);
  const [minConfidence, setMinConfidence] = useState(50);

  if (selectedVehicleIds.length === 0) {
    return null;
  }

  const handleBulkAssign = async () => {
    setLoading(true);
    setResults([]);

    try {
      const { data, error } = await supabase
        .rpc('bulk_assign_vehicles_to_orgs_by_gps', {
          p_vehicle_ids: selectedVehicleIds,
          p_user_id: userId,
          p_max_distance_meters: maxDistance,
          p_min_confidence: minConfidence
        });

      if (error) {
        // Function might not exist yet
        if (error.code === '42883') {
          alert('GPS assignment function not available. Please apply the migration first.');
          return;
        }
        throw error;
      }

      setResults(data || []);
      
      if (onComplete) onComplete();
    } catch (error) {
      console.error('Error bulk assigning:', error);
      alert('Failed to assign vehicles. Make sure vehicles have GPS coordinates in their images.');
    } finally {
      setLoading(false);
    }
  };

  const assignedCount = results.filter(r => r.assigned).length;
  const failedCount = results.filter(r => !r.assigned).length;

  return (
    <div style={{
      position: 'sticky',
      top: 0,
      zIndex: 100,
      background: 'var(--surface)',
      border: '2px solid #1e40af',
      borderRadius: '4px',
      padding: '12px',
      marginBottom: '16px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
    }}>
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '9pt', fontWeight: 700, color: '#1e40af', marginBottom: '8px' }}>
          Auto-Assign {selectedVehicleIds.length} Vehicle{selectedVehicleIds.length !== 1 ? 's' : ''} to Organizations (GPS-based)
        </div>
        <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '12px' }}>
          Scans vehicle image GPS coordinates and assigns to nearby organizations
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '12px' }}>
          <label style={{ fontSize: '8pt', fontWeight: 600 }}>
            Max Distance:
            <input
              type="number"
              value={maxDistance}
              onChange={(e) => setMaxDistance(parseInt(e.target.value) || 500)}
              min="100"
              max="5000"
              step="100"
              style={{
                marginLeft: '4px',
                padding: '4px 8px',
                fontSize: '8pt',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                width: '80px'
              }}
            />
            <span style={{ marginLeft: '4px', fontSize: '7pt', color: 'var(--text-muted)' }}>meters</span>
          </label>

          <label style={{ fontSize: '8pt', fontWeight: 600 }}>
            Min Confidence:
            <input
              type="number"
              value={minConfidence}
              onChange={(e) => setMinConfidence(parseInt(e.target.value) || 50)}
              min="0"
              max="100"
              step="5"
              style={{
                marginLeft: '4px',
                padding: '4px 8px',
                fontSize: '8pt',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                width: '60px'
              }}
            />
            <span style={{ marginLeft: '4px', fontSize: '7pt', color: 'var(--text-muted)' }}>%</span>
          </label>
        </div>
      </div>

      {results.length === 0 ? (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            onClick={handleBulkAssign}
            disabled={loading}
            style={{
              padding: '8px 16px',
              fontSize: '9pt',
              fontWeight: 600,
              border: '1px solid #1e40af',
              background: '#1e40af',
              color: 'white',
              cursor: loading ? 'wait' : 'pointer',
              borderRadius: '4px',
              opacity: loading ? 0.5 : 1
            }}
          >
            {loading ? 'Scanning GPS...' : 'AUTO-ASSIGN BY GPS'}
          </button>
          <button
            onClick={onDeselectAll}
            style={{
              padding: '8px 16px',
              fontSize: '9pt',
              fontWeight: 600,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              borderRadius: '4px'
            }}
          >
            CANCEL
          </button>
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: '12px', fontSize: '8pt' }}>
            <span style={{ color: '#166534', fontWeight: 600 }}>✓ {assignedCount} assigned</span>
            {failedCount > 0 && (
              <span style={{ color: '#991b1b', marginLeft: '12px', fontWeight: 600 }}>
                ✗ {failedCount} failed
              </span>
            )}
          </div>

          <div style={{
            maxHeight: '200px',
            overflowY: 'auto',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            padding: '8px',
            background: '#f9fafb'
          }}>
            {results.map((result) => (
              <div
                key={result.vehicle_id}
                style={{
                  padding: '6px',
                  fontSize: '7pt',
                  marginBottom: '4px',
                  background: result.assigned ? '#dcfce7' : '#fee2e2',
                  border: `1px solid ${result.assigned ? '#166534' : '#991b1b'}`,
                  borderRadius: '3px'
                }}
              >
                {result.assigned ? (
                  <span style={{ color: '#166534' }}>
                    ✓ Assigned to <strong>{result.business_name}</strong>
                  </span>
                ) : (
                  <span style={{ color: '#991b1b' }}>
                    ✗ {result.reason}
                  </span>
                )}
              </div>
            ))}
          </div>

          <button
            onClick={() => {
              setResults([]);
              onDeselectAll();
            }}
            style={{
              marginTop: '12px',
              padding: '8px 16px',
              fontSize: '9pt',
              fontWeight: 600,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              borderRadius: '4px'
            }}
          >
            DONE
          </button>
        </div>
      )}
    </div>
  );
};

export default BulkGPSAssignment;

