import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface PendingAssignment {
  id: string;
  vehicle_id: string;
  organization_id: string;
  business_name?: string;
  suggested_relationship_type: string;
  overall_confidence: number;
  confidence_breakdown: {
    gps?: number;
    receipt?: number;
    user_org_membership?: number;
    vin_match?: number;
    historical_pattern?: number;
    image_count_boost?: number;
  };
  evidence_sources: string[];
  evidence_count: number;
  status: string;
  created_at: string;
}

interface PendingAssignmentsProps {
  vehicleId: string;
  userId: string;
  onAssignmentChange?: () => void;
}

const PendingAssignments: React.FC<PendingAssignmentsProps> = ({
  vehicleId,
  userId,
  onAssignmentChange
}) => {
  const [assignments, setAssignments] = useState<PendingAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => {
    loadPendingAssignments();
  }, [vehicleId]);

  const loadPendingAssignments = async () => {
    try {
      setLoading(true);
      
      // Get pending assignments for this vehicle
      const { data, error } = await supabase
        .from('pending_vehicle_assignments')
        .select(`
          *,
          businesses!inner(business_name)
        `)
        .eq('vehicle_id', vehicleId)
        .eq('status', 'pending')
        .order('overall_confidence', { ascending: false });

      if (error) throw error;

      // Transform data to include business_name
      const transformed = (data || []).map((item: any) => ({
        ...item,
        business_name: item.businesses?.business_name || 'Unknown Organization'
      }));

      setAssignments(transformed);
    } catch (error) {
      console.error('Error loading pending assignments:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (assignmentId: string) => {
    setProcessing(assignmentId);
    try {
      const { error } = await supabase
        .rpc('approve_pending_assignment', {
          p_assignment_id: assignmentId,
          p_user_id: userId,
          p_notes: 'Approved via UI'
        });

      if (error) throw error;

      await loadPendingAssignments();
      if (onAssignmentChange) onAssignmentChange();
    } catch (error) {
      console.error('Error approving assignment:', error);
      alert('Failed to approve assignment');
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (assignmentId: string) => {
    setProcessing(assignmentId);
    try {
      const { error } = await supabase
        .rpc('reject_pending_assignment', {
          p_assignment_id: assignmentId,
          p_user_id: userId,
          p_notes: 'Rejected via UI'
        });

      if (error) throw error;

      await loadPendingAssignments();
    } catch (error) {
      console.error('Error rejecting assignment:', error);
      alert('Failed to reject assignment');
    } finally {
      setProcessing(null);
    }
  };

  const getConfidenceColor = (confidence: number): string => {
    if (confidence >= 80) return '#10b981'; // green
    if (confidence >= 60) return '#f59e0b'; // yellow
    return '#ef4444'; // red
  };

  const formatEvidenceSource = (source: string): string => {
    const mapping: Record<string, string> = {
      'gps': 'GPS Location',
      'receipt': 'Receipt Match',
      'user_org_membership': 'Your Organization',
      'vin_match': 'VIN Match',
      'historical_pattern': 'Historical Pattern',
      'image_count_boost': 'Image Count'
    };
    return mapping[source] || source;
  };

  if (loading) {
    return (
      <div style={{ padding: '8px', fontSize: '7pt', color: 'var(--text-muted)' }}>
        Loading suggestions...
      </div>
    );
  }

  if (assignments.length === 0) {
    return null; // Don't show anything if no pending assignments
  }

  return (
    <div style={{
      padding: '12px',
      background: '#fef3c7',
      border: '1px solid #fbbf24',
      borderRadius: '4px',
      fontSize: '8pt',
      marginTop: '8px'
    }}>
      <div style={{ marginBottom: '8px', fontWeight: 600, color: '#92400e' }}>
        Pending Organization Assignments ({assignments.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {assignments.map((assignment) => (
          <div
            key={assignment.id}
            style={{
              padding: '8px',
              background: 'white',
              border: '1px solid #fbbf24',
              borderRadius: '3px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, marginBottom: '2px' }}>
                  {assignment.business_name}
                </div>
                <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
                  Relationship: {assignment.suggested_relationship_type.replace('_', ' ')}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>Confidence:</span>
                  <span style={{
                    fontSize: '8pt',
                    fontWeight: 600,
                    color: getConfidenceColor(assignment.overall_confidence)
                  }}>
                    {Math.round(assignment.overall_confidence)}%
                  </span>
                </div>
                {assignment.evidence_sources.length > 0 && (
                  <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Evidence: {assignment.evidence_sources.map(formatEvidenceSource).join(', ')}
                  </div>
                )}
                {assignment.confidence_breakdown && Object.keys(assignment.confidence_breakdown).length > 0 && (
                  <details style={{ marginTop: '4px', fontSize: '7pt' }}>
                    <summary style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>Confidence Breakdown</summary>
                    <div style={{ marginTop: '4px', paddingLeft: '8px' }}>
                      {Object.entries(assignment.confidence_breakdown).map(([key, value]) => (
                        <div key={key} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                          <span>{formatEvidenceSource(key)}:</span>
                          <span style={{ fontWeight: 600 }}>{Math.round(value as number)}%</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
              <div style={{ display: 'flex', gap: '4px', marginLeft: '8px' }}>
                <button
                  onClick={() => handleApprove(assignment.id)}
                  disabled={processing === assignment.id}
                  style={{
                    padding: '4px 8px',
                    fontSize: '7pt',
                    fontWeight: 600,
                    border: '1px solid #10b981',
                    background: '#10b981',
                    color: 'white',
                    cursor: processing === assignment.id ? 'wait' : 'pointer',
                    borderRadius: '3px',
                    opacity: processing === assignment.id ? 0.5 : 1
                  }}
                >
                  {processing === assignment.id ? '...' : 'APPROVE'}
                </button>
                <button
                  onClick={() => handleReject(assignment.id)}
                  disabled={processing === assignment.id}
                  style={{
                    padding: '4px 8px',
                    fontSize: '7pt',
                    fontWeight: 600,
                    border: '1px solid #ef4444',
                    background: '#ef4444',
                    color: 'white',
                    cursor: processing === assignment.id ? 'wait' : 'pointer',
                    borderRadius: '3px',
                    opacity: processing === assignment.id ? 0.5 : 1
                  }}
                >
                  {processing === assignment.id ? '...' : 'REJECT'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PendingAssignments;

