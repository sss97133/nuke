import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase, getCurrentUserId } from '../../lib/supabase';
import { useToast } from '../../hooks/useToast';
import '../../design-system.css';

const CATEGORY_SUBCATEGORIES: Record<
  'categorization' | 'business_impact' | 'data_correction' | 'operational_note',
  string[]
> = {
  categorization: ['incorrect_classification', 'missing_category', 'wrong_status', 'mismatched_specs'],
  business_impact: ['financial_loss', 'storage_cost', 'time_waste', 'reputation_risk', 'opportunity_cost'],
  data_correction: ['wrong_specs', 'missing_data', 'outdated_info', 'duplicate_entry'],
  operational_note: ['maintenance_history', 'storage_location', 'handling_notes', 'partner_feedback'],
};

interface CritiqueFormData {
  vehicleId: string;
  category: 'categorization' | 'business_impact' | 'data_correction' | 'operational_note';
  subcategory: string;
  description: string;
  businessImpact?: {
    financialImpact: 'positive' | 'negative' | 'neutral';
    timeImpact: 'low' | 'medium' | 'high';
    spaceImpact: 'none' | 'warehouse' | 'lot' | 'office';
    reputationImpact: 'none' | 'low' | 'medium' | 'high';
  };
  suggestedActions?: string[];
  priority: 'low' | 'medium' | 'high' | 'urgent';
}

interface VehicleCritiqueModeProps {
  isVisible: boolean;
  onClose: () => void;
  vehicleId?: string;
  variant?: 'dropdown' | 'modal';
  vehicleData?: {
    year?: number;
    make?: string;
    model?: string;
    status?: string;
  };
}

export default function VehicleCritiqueMode({
  isVisible,
  onClose,
  vehicleId: propVehicleId,
  vehicleData,
  variant = 'dropdown'
}: VehicleCritiqueModeProps) {
  const location = useLocation();
  const { showToast } = useToast();

  // Auto-detect vehicle ID from URL if not provided
  const detectedVehicleId = React.useMemo(() => {
    if (propVehicleId) return propVehicleId;

    const path = location.pathname;
    const vehicleMatch = path.match(/\/vehicle\/([a-f0-9-]{36})/);
    return vehicleMatch ? vehicleMatch[1] : null;
  }, [location.pathname, propVehicleId]);

  const [formData, setFormData] = useState<CritiqueFormData>({
    vehicleId: detectedVehicleId || '',
    category: 'categorization',
    subcategory: CATEGORY_SUBCATEGORIES.categorization[0] || '',
    description: '',
    priority: 'medium'
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [userPermissions, setUserPermissions] = useState<{
    isAuthorized: boolean;
    role?: string;
    organizationId?: string;
  }>({ isAuthorized: false });

  // Check user permissions
  useEffect(() => {
    checkUserPermissions();
  }, [detectedVehicleId]);

  // Keep vehicleId synced when opening the critique from non-vehicle pages (feed, admin tools, etc.)
  useEffect(() => {
    setFormData((prev) => {
      const nextVehicleId = detectedVehicleId || '';
      if (prev.vehicleId === nextVehicleId) return prev;
      return { ...prev, vehicleId: nextVehicleId };
    });
  }, [detectedVehicleId]);

  const checkUserPermissions = async () => {
    try {
      const userId = await getCurrentUserId();
      if (!userId) {
        setUserPermissions({ isAuthorized: false });
        return;
      }

      // Check if user has high-level business access
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, role, organization_id')
        .eq('id', userId)
        .single();

      // Check if user is owner/contributor to this vehicle
      let vehicleAccess = false;
      if (detectedVehicleId) {
        const { data: ownership } = await supabase
          .rpc('get_vehicle_claim_status', {
            p_vehicle_id: detectedVehicleId,
            p_user_id: userId
          });
        vehicleAccess = ownership?.user_has_claim === true;
      }

      // Authorized if: admin, manager, business owner, or vehicle owner/contributor
      const isAuthorized = profile?.role === 'admin' ||
                          profile?.role === 'manager' ||
                          profile?.role === 'business_owner' ||
                          vehicleAccess;

      setUserPermissions({
        isAuthorized,
        role: profile?.role,
        organizationId: profile?.organization_id
      });
    } catch (error) {
      console.error('Error checking permissions:', error);
      setUserPermissions({ isAuthorized: false });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!userPermissions.isAuthorized) {
      showToast('You are not authorized to submit critiques', 'error');
      return;
    }

    if (!formData.vehicleId || !formData.subcategory || !formData.description.trim()) {
      showToast('Please fill in all required fields', 'error');
      return;
    }

    setIsSubmitting(true);

    try {
      const userId = await getCurrentUserId();

      // Store critique in database
      const { error } = await supabase
        .from('vehicle_critiques')
        .insert({
          vehicle_id: formData.vehicleId,
          user_id: userId,
          category: formData.category,
          subcategory: formData.subcategory,
          description: formData.description,
          business_impact: formData.businessImpact,
          suggested_actions: formData.suggestedActions,
          priority: formData.priority,
          organization_id: userPermissions.organizationId,
          status: 'pending',
          created_at: new Date().toISOString()
        });

      if (error) throw error;

      showToast('Critique submitted successfully', 'success');

      // Reset form
      setFormData({
        vehicleId: detectedVehicleId || '',
        category: 'categorization',
        subcategory: CATEGORY_SUBCATEGORIES.categorization[0] || '',
        description: '',
        priority: 'medium'
      });

      onClose();
    } catch (error: any) {
      console.error('Error submitting critique:', error);
      showToast(error.message || 'Failed to submit critique', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getCategorySubcategories = (category: CritiqueFormData['category']) => {
    return CATEGORY_SUBCATEGORIES[category] || [];
  };

  if (!isVisible) return null;

  const inner = !userPermissions.isAuthorized ? (
    <div style={{
      background: 'var(--white)',
      border: '2px solid var(--border)',
      padding: '12px',
      zIndex: 1000,
      fontSize: '8pt'
    }}>
      <div style={{ color: '#c00', marginBottom: '8px' }}>
        Access Restricted
      </div>
      <div style={{ marginBottom: '8px' }}>
        You need business-level access to submit critiques.
      </div>
      <button
        type="button"
        onClick={onClose}
        className="button button-secondary"
        style={{ fontSize: '8pt', padding: '2px 8px' }}
      >
        Close
      </button>
    </div>
  ) : (
    <div style={{
      background: 'var(--white)',
      border: '2px solid var(--border)',
      padding: '12px',
      zIndex: 1000,
      maxHeight: '400px',
      overflowY: 'auto',
      boxShadow: '2px 2px 8px rgba(0,0,0,0.2)'
    }}>
      <form onSubmit={handleSubmit}>
        <div style={{ fontSize: '9pt', fontWeight: 'bold', marginBottom: '8px' }}>
          Vehicle Critique & Business Impact
          {vehicleData && (
            <span style={{ fontSize: '8pt', fontWeight: 'normal', color: '#666', marginLeft: '8px' }}>
              {vehicleData.year} {vehicleData.make} {vehicleData.model}
            </span>
          )}
        </div>

        {/* Category Selection */}
        <div style={{ marginBottom: '8px' }}>
          <label style={{ display: 'block', fontSize: '8pt', fontWeight: 'bold', marginBottom: '2px' }}>
            Category
          </label>
          <select
            value={formData.category}
            onChange={(e) => setFormData(prev => ({
              ...prev,
              category: e.target.value as any,
              subcategory: (CATEGORY_SUBCATEGORIES as any)[e.target.value]?.[0] || '' // Reset to default subcategory
            }))}
            style={{
              width: '100%',
              fontSize: '8pt',
              fontFamily: '"MS Sans Serif", sans-serif',
              border: '1px solid var(--border)',
              padding: '2px'
            }}
          >
            <option value="categorization">Vehicle Categorization</option>
            <option value="business_impact">Business Impact Assessment</option>
            <option value="data_correction">Data Correction</option>
            <option value="operational_note">Operational Note</option>
          </select>
        </div>

        {/* Subcategory Selection */}
        <div style={{ marginBottom: '8px' }}>
          <label style={{ display: 'block', fontSize: '8pt', fontWeight: 'bold', marginBottom: '2px' }}>
            Subcategory *
          </label>
          <select
            value={formData.subcategory}
            onChange={(e) => setFormData(prev => ({ ...prev, subcategory: e.target.value }))}
            style={{
              width: '100%',
              fontSize: '8pt',
              fontFamily: '"MS Sans Serif", sans-serif',
              border: '1px solid var(--border)',
              padding: '2px'
            }}
          >
            {getCategorySubcategories(formData.category).map(sub => (
              <option key={sub} value={sub}>
                {sub.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
              </option>
            ))}
          </select>
        </div>

        {/* Priority */}
        <div style={{ marginBottom: '8px' }}>
          <label style={{ display: 'block', fontSize: '8pt', fontWeight: 'bold', marginBottom: '2px' }}>
            Priority
          </label>
          <select
            value={formData.priority}
            onChange={(e) => setFormData(prev => ({ ...prev, priority: e.target.value as any }))}
            style={{
              width: '100%',
              fontSize: '8pt',
              fontFamily: '"MS Sans Serif", sans-serif',
              border: '1px solid var(--border)',
              padding: '2px'
            }}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>

        {/* Business Impact (if category is business_impact) */}
        {formData.category === 'business_impact' && (
          <div style={{ marginBottom: '8px', padding: '6px', background: '#f8f9fa', border: '1px solid #dee2e6' }}>
            <div style={{ fontSize: '8pt', fontWeight: 'bold', marginBottom: '4px' }}>
              Business Impact Assessment
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '7pt' }}>
              <div>
                <label>Financial:</label>
                <select
                  value={formData.businessImpact?.financialImpact || 'neutral'}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    businessImpact: {
                      ...prev.businessImpact,
                      financialImpact: e.target.value as any
                    }
                  }))}
                  style={{ width: '100%', fontSize: '7pt' }}
                >
                  <option value="neutral">Neutral</option>
                  <option value="negative">Loss</option>
                  <option value="positive">Gain</option>
                </select>
              </div>
              <div>
                <label>Time Impact:</label>
                <select
                  value={formData.businessImpact?.timeImpact || 'low'}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    businessImpact: {
                      ...prev.businessImpact,
                      timeImpact: e.target.value as any
                    }
                  }))}
                  style={{ width: '100%', fontSize: '7pt' }}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Description */}
        <div style={{ marginBottom: '8px' }}>
          <label style={{ display: 'block', fontSize: '8pt', fontWeight: 'bold', marginBottom: '2px' }}>
            Description & Context *
          </label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
            placeholder="Describe the issue, impact, and any suggested corrections..."
            rows={3}
            style={{
              width: '100%',
              fontSize: '8pt',
              fontFamily: '"MS Sans Serif", sans-serif',
              border: '1px solid var(--border)',
              padding: '4px',
              resize: 'vertical'
            }}
          />
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            className="button button-secondary"
            style={{ fontSize: '8pt', padding: '2px 8px' }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !formData.description.trim() || !formData.subcategory}
            className="button button-primary"
            style={{
              fontSize: '8pt',
              padding: '2px 8px',
              opacity: (isSubmitting || !formData.description.trim() || !formData.subcategory) ? 0.5 : 1
            }}
          >
            {isSubmitting ? 'Submitting...' : 'Submit Critique'}
          </button>
        </div>
      </form>
    </div>
  );

  if (variant === 'modal') {
    return (
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.4)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px'
        }}
        onClick={onClose}
      >
        <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(720px, 100%)' }}>
          {inner}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: 'absolute',
      top: '100%',
      left: 0,
      right: 0,
      marginTop: '4px',
    }}>
      {inner}
    </div>
  );
}