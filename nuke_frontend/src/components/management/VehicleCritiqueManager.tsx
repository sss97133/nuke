import React, { useState, useEffect } from 'react';
import { supabase, getCurrentUserId } from '../../lib/supabase';
import { useToast } from '../../hooks/useToast';
import '../../design-system.css';

interface Critique {
  id: string;
  vehicle_id: string;
  category: string;
  subcategory: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  description: string;
  business_impact?: any;
  status: 'pending' | 'reviewed' | 'implemented' | 'rejected';
  created_at: string;
  resolved_at?: string;
  resolution_notes?: string;
  critique_author?: string;
  author_role?: string;
  organization?: string;
  year?: number;
  make?: string;
  model?: string;
  vehicle_status?: string;
}

interface VehicleCritiqueManagerProps {
  vehicleId?: string; // If provided, show only critiques for this vehicle
  organizationId?: string; // If provided, show only critiques from this org
}

export default function VehicleCritiqueManager({
  vehicleId,
  organizationId
}: VehicleCritiqueManagerProps) {
  const [critiques, setCritiques] = useState<Critique[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<{
    status: string;
    category: string;
    priority: string;
  }>({
    status: 'all',
    category: 'all',
    priority: 'all'
  });
  const [selectedCritique, setSelectedCritique] = useState<Critique | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [isResolving, setIsResolving] = useState(false);

  const { showToast } = useToast();

  useEffect(() => {
    loadCritiques();
  }, [vehicleId, organizationId, filter]);

  const loadCritiques = async () => {
    try {
      setLoading(true);

      let query = supabase
        .from('vehicle_critique_analytics')
        .select('*');

      // Apply filters
      if (vehicleId) {
        query = query.eq('vehicle_id', vehicleId);
      }

      if (organizationId) {
        query = query.eq('organization_id', organizationId);
      }

      if (filter.status !== 'all') {
        query = query.eq('status', filter.status);
      }

      if (filter.category !== 'all') {
        query = query.eq('category', filter.category);
      }

      if (filter.priority !== 'all') {
        query = query.eq('priority', filter.priority);
      }

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      setCritiques(data || []);
    } catch (error: any) {
      console.error('Error loading critiques:', error);
      showToast(error.message || 'Failed to load critiques', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleStatusUpdate = async (
    critiqueId: string,
    newStatus: 'reviewed' | 'implemented' | 'rejected',
    notes: string
  ) => {
    setIsResolving(true);

    try {
      const userId = await getCurrentUserId();
      if (!userId) {
        throw new Error('Must be logged in to resolve critiques');
      }

      const { error } = await supabase
        .from('vehicle_critiques')
        .update({
          status: newStatus,
          resolution_notes: notes,
          resolved_by: userId,
          resolved_at: new Date().toISOString()
        })
        .eq('id', critiqueId);

      if (error) throw error;

      showToast(`Critique marked as ${newStatus}`, 'success');

      // Reload critiques
      await loadCritiques();

      // Clear selection
      setSelectedCritique(null);
      setResolutionNotes('');
    } catch (error: any) {
      console.error('Error updating critique:', error);
      showToast(error.message || 'Failed to update critique', 'error');
    } finally {
      setIsResolving(false);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return '#dc3545';
      case 'high': return '#fd7e14';
      case 'medium': return '#ffc107';
      case 'low': return '#6c757d';
      default: return '#6c757d';
    }
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      pending: { background: '#fff3cd', color: '#856404', border: '1px solid #ffeaa7' },
      reviewed: { background: '#cce5ff', color: '#004085', border: '1px solid #80bdff' },
      implemented: { background: '#d4edda', color: '#155724', border: '1px solid #7dd87f' },
      rejected: { background: '#f8d7da', color: '#721c24', border: '1px solid #f5c6cb' }
    };

    return (
      <span
        style={{
          ...styles[status as keyof typeof styles],
          padding: '2px 6px',
          fontSize: '7pt',
          borderRadius: '2px',
          textTransform: 'uppercase',
          fontWeight: 'bold'
        }}
      >
        {status}
      </span>
    );
  };

  const formatBusinessImpact = (impact: any) => {
    if (!impact || typeof impact !== 'object') return 'No impact data';

    const parts = [];
    if (impact.financialImpact && impact.financialImpact !== 'neutral') {
      parts.push(`💰 ${impact.financialImpact}`);
    }
    if (impact.timeImpact && impact.timeImpact !== 'low') {
      parts.push(`⏱️ ${impact.timeImpact} time`);
    }
    if (impact.spaceImpact && impact.spaceImpact !== 'none') {
      parts.push(`📦 ${impact.spaceImpact}`);
    }
    if (impact.reputationImpact && impact.reputationImpact !== 'none') {
      parts.push(`⭐ ${impact.reputationImpact} reputation`);
    }

    return parts.length > 0 ? parts.join(', ') : 'Minimal impact';
  };

  if (loading) {
    return (
      <div className="card">
        <div className="card-body">
          <div style={{ textAlign: 'center', padding: '20px' }}>
            Loading critiques...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '12px' }}>Vehicle Critiques & Business Feedback</h3>
          <p style={{ margin: 0, fontSize: '8pt', color: '#666' }}>
            {critiques.length} critique{critiques.length !== 1 ? 's' : ''} found
          </p>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: '8px', fontSize: '8pt' }}>
          <select
            value={filter.status}
            onChange={(e) => setFilter(prev => ({ ...prev, status: e.target.value }))}
            style={{ fontSize: '8pt', padding: '2px' }}
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="reviewed">Reviewed</option>
            <option value="implemented">Implemented</option>
            <option value="rejected">Rejected</option>
          </select>
          <select
            value={filter.category}
            onChange={(e) => setFilter(prev => ({ ...prev, category: e.target.value }))}
            style={{ fontSize: '8pt', padding: '2px' }}
          >
            <option value="all">All Categories</option>
            <option value="categorization">Categorization</option>
            <option value="business_impact">Business Impact</option>
            <option value="data_correction">Data Correction</option>
            <option value="operational_note">Operational Note</option>
          </select>
          <select
            value={filter.priority}
            onChange={(e) => setFilter(prev => ({ ...prev, priority: e.target.value }))}
            style={{ fontSize: '8pt', padding: '2px' }}
          >
            <option value="all">All Priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      <div className="card-body">
        {critiques.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '20px', color: '#666' }}>
            No critiques found matching your filters.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%', fontSize: '8pt' }}>
              <thead>
                <tr>
                  <th>Vehicle</th>
                  <th>Category</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Description</th>
                  <th>Business Impact</th>
                  <th>Author</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {critiques.map(critique => (
                  <tr key={critique.id}>
                    <td>
                      {critique.year} {critique.make} {critique.model}
                      <div style={{ fontSize: '7pt', color: '#666' }}>
                        {critique.vehicle_status}
                      </div>
                    </td>
                    <td style={{ textTransform: 'capitalize' }}>
                      {critique.category.replace('_', ' ')}
                      <div style={{ fontSize: '7pt', color: '#666' }}>
                        {critique.subcategory.replace('_', ' ')}
                      </div>
                    </td>
                    <td>
                      <span
                        style={{
                          color: getPriorityColor(critique.priority),
                          fontWeight: 'bold'
                        }}
                      >
                        {critique.priority.toUpperCase()}
                      </span>
                    </td>
                    <td>{getStatusBadge(critique.status)}</td>
                    <td style={{ maxWidth: '200px' }}>
                      {critique.description.length > 100
                        ? `${critique.description.substring(0, 100)}...`
                        : critique.description}
                    </td>
                    <td style={{ maxWidth: '150px' }}>
                      {formatBusinessImpact(critique.business_impact)}
                    </td>
                    <td>
                      {critique.critique_author}
                      <div style={{ fontSize: '7pt', color: '#666' }}>
                        {critique.author_role}
                      </div>
                    </td>
                    <td>
                      {new Date(critique.created_at).toLocaleDateString()}
                    </td>
                    <td>
                      {critique.status === 'pending' && (
                        <button
                          onClick={() => setSelectedCritique(critique)}
                          className="button button-primary"
                          style={{ fontSize: '7pt', padding: '2px 4px' }}
                        >
                          Resolve
                        </button>
                      )}
                      {critique.resolved_at && (
                        <div style={{ fontSize: '7pt', color: '#666' }}>
                          Resolved {new Date(critique.resolved_at).toLocaleDateString()}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Resolution Modal */}
      {selectedCritique && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px'
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            maxWidth: '600px',
            width: '100%',
            maxHeight: '90vh',
            overflow: 'auto',
            border: '2px solid var(--border)'
          }}>
            <div style={{
              padding: '16px',
              borderBottom: '1px solid #e5e5e5',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>
                Resolve Critique
              </h3>
              <button
                onClick={() => setSelectedCritique(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '20px',
                  cursor: 'pointer'
                }}
              >
                ×
              </button>
            </div>

            <div style={{ padding: '16px' }}>
              <div style={{ marginBottom: '12px' }}>
                <strong>Vehicle:</strong> {selectedCritique.year} {selectedCritique.make} {selectedCritique.model}
              </div>

              <div style={{ marginBottom: '12px' }}>
                <strong>Category:</strong> {selectedCritique.category} → {selectedCritique.subcategory}
              </div>

              <div style={{ marginBottom: '12px' }}>
                <strong>Priority:</strong> <span style={{ color: getPriorityColor(selectedCritique.priority) }}>
                  {selectedCritique.priority.toUpperCase()}
                </span>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <strong>Description:</strong>
                <div style={{
                  background: '#f8f9fa',
                  padding: '8px',
                  border: '1px solid #e9ecef',
                  fontSize: '9pt',
                  marginTop: '4px'
                }}>
                  {selectedCritique.description}
                </div>
              </div>

              {selectedCritique.business_impact && Object.keys(selectedCritique.business_impact).length > 0 && (
                <div style={{ marginBottom: '12px' }}>
                  <strong>Business Impact:</strong>
                  <div style={{ fontSize: '9pt', marginTop: '4px' }}>
                    {formatBusinessImpact(selectedCritique.business_impact)}
                  </div>
                </div>
              )}

              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>
                  Resolution Notes:
                </label>
                <textarea
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  placeholder="Explain how this critique was addressed..."
                  rows={3}
                  style={{
                    width: '100%',
                    fontSize: '9pt',
                    padding: '8px',
                    border: '1px solid #e9ecef',
                    borderRadius: '4px'
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => handleStatusUpdate(selectedCritique.id, 'rejected', resolutionNotes)}
                  disabled={isResolving}
                  className="button button-secondary"
                  style={{ fontSize: '9pt', padding: '4px 8px' }}
                >
                  Reject
                </button>
                <button
                  onClick={() => handleStatusUpdate(selectedCritique.id, 'reviewed', resolutionNotes)}
                  disabled={isResolving}
                  className="button button-warning"
                  style={{ fontSize: '9pt', padding: '4px 8px' }}
                >
                  Mark Reviewed
                </button>
                <button
                  onClick={() => handleStatusUpdate(selectedCritique.id, 'implemented', resolutionNotes)}
                  disabled={isResolving}
                  className="button button-success"
                  style={{ fontSize: '9pt', padding: '4px 8px' }}
                >
                  Mark Implemented
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}