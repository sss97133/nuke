import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { AlertCircle, Building, User, Calendar, Wrench } from 'lucide-react';

interface ContributionSubmissionModalProps {
  vehicleId: string;
  imageIds: string[];
  exifDate?: Date | null;
  onSubmit: (submissionId: string) => void;
  onCancel: () => void;
}

interface ResponsibleParty {
  type: 'organization' | 'vehicle_owner' | 'self' | 'contractor_to_org' | 'contractor_to_owner';
  orgId?: string;
  userId?: string;
  label: string;
}

const ContributionSubmissionModal: React.FC<ContributionSubmissionModalProps> = ({
  vehicleId,
  imageIds,
  exifDate,
  onSubmit,
  onCancel
}) => {
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  
  // Form state
  const [didWork, setDidWork] = useState(false);
  const [responsiblePartyType, setResponsiblePartyType] = useState<ResponsibleParty['type']>('organization');
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [workDate, setWorkDate] = useState<string>(
    exifDate ? exifDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
  );
  const [workCategory, setWorkCategory] = useState<string>('fabrication');
  const [workDescription, setWorkDescription] = useState<string>('');
  const [laborHours, setLaborHours] = useState<string>('');
  
  // Available organizations (user's orgs)
  const [userOrgs, setUserOrgs] = useState<Array<{ id: string; name: string }>>([]);
  const [vehicleInfo, setVehicleInfo] = useState<any>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    // Get vehicle info
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('year, make, model, title, user_id')
      .eq('id', vehicleId)
      .single();
    setVehicleInfo(vehicle);

    // Get user's organizations (where they're a contributor)
    const { data: orgs } = await supabase
      .from('organization_contributors')
      .select('organization_id, businesses(id, business_name)')
      .eq('user_id', user.id)
      .eq('status', 'active');
    
    if (orgs) {
      setUserOrgs(orgs.map(o => ({
        id: o.businesses.id,
        name: o.businesses.business_name
      })));
    }

    // Check if user owns vehicle
    if (vehicle?.user_id === user.id) {
      setResponsiblePartyType('self');
      setDidWork(true);
    }
  };

  const handleSubmit = async () => {
    if (!userId) return;
    
    setLoading(true);
    try {
      // Determine responsible party details
      let responsiblePartyOrgId: string | null = null;
      let responsiblePartyUserId: string | null = null;
      
      if (responsiblePartyType === 'organization' || responsiblePartyType === 'contractor_to_org') {
        responsiblePartyOrgId = selectedOrgId;
      } else if (responsiblePartyType === 'self') {
        responsiblePartyUserId = userId;
      }

      // Get approvers from function
      const { data: approvers } = await supabase.rpc('get_responsible_party_approvers', {
        p_vehicle_id: vehicleId,
        p_work_date: workDate,
        p_responsible_party_type: responsiblePartyType,
        p_responsible_party_org_id: responsiblePartyOrgId,
        p_responsible_party_user_id: responsiblePartyUserId
      });

      if (!approvers || approvers.length === 0) {
        alert('Could not determine who can verify this work. Please contact support.');
        setLoading(false);
        return;
      }

      // Create submission
      const { data: submission, error } = await supabase
        .from('contribution_submissions')
        .insert({
          contributor_id: userId,
          vehicle_id: vehicleId,
          contribution_type: 'work_images',
          image_ids: imageIds,
          work_date: workDate,
          work_date_source: exifDate ? 'exif' : 'user_input',
          responsible_party_type: responsiblePartyType,
          responsible_party_org_id: responsiblePartyOrgId,
          responsible_party_user_id: responsiblePartyUserId,
          work_category: workCategory,
          work_description: workDescription,
          labor_hours: laborHours ? parseFloat(laborHours) : null,
          requires_approval_from: approvers,
          status: responsiblePartyType === 'self' ? 'approved' : 'pending'
        })
        .select('id')
        .single();

      if (error) throw error;

      // Update images to pending verification (unless self-approved)
      if (responsiblePartyType !== 'self') {
        await supabase
          .from('vehicle_images')
          .update({ 
            verification_status: 'pending',
            pending_submission_id: submission.id
          })
          .in('id', imageIds);
      }

      // TODO: Send notifications to approvers

      onSubmit(submission.id);
    } catch (error) {
      console.error('Error submitting contribution:', error);
      alert('Failed to submit contribution');
    } finally {
      setLoading(false);
    }
  };

  const workCategories = [
    { value: 'fabrication', label: 'Fabrication' },
    { value: 'welding', label: 'Welding' },
    { value: 'paint', label: 'Paint & Bodywork' },
    { value: 'upholstery', label: 'Upholstery' },
    { value: 'mechanical', label: 'Mechanical Repair' },
    { value: 'electrical', label: 'Electrical' },
    { value: 'suspension', label: 'Suspension' },
    { value: 'engine_work', label: 'Engine Work' },
    { value: 'brake_system', label: 'Brake System' },
    { value: 'restoration', label: 'Restoration' },
    { value: 'detailing', label: 'Detailing' },
    { value: 'diagnostic', label: 'Diagnostic' },
    { value: 'inspection', label: 'Inspection' },
    { value: 'maintenance', label: 'Maintenance' },
    { value: 'modification', label: 'Modification' }
  ];

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: '20px'
      }}
      onClick={onCancel}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '600px',
          maxHeight: '90vh',
          overflow: 'auto'
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="card-header">
          <h3 style={{ margin: 0, fontSize: '14pt', fontWeight: 700 }}>
            Verify Your Contribution
          </h3>
        </div>

        <div className="card-body" style={{ fontSize: '9pt' }}>
          {/* Info box */}
          <div style={{
            background: '#FFF3CD',
            border: '1px solid #FFE69C',
            padding: '12px',
            borderRadius: '4px',
            marginBottom: '20px',
            display: 'flex',
            gap: '8px'
          }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
            <div style={{ fontSize: '8pt', lineHeight: '1.4' }}>
              <strong>About Verification:</strong> Your images will be reviewed by the responsible party 
              (shop owner, vehicle owner, or supervisor). If not reviewed within 30 days, they'll be auto-approved.
            </div>
          </div>

          {/* Vehicle info */}
          {vehicleInfo && (
            <div style={{ marginBottom: '20px', padding: '12px', background: '#F8F9FA', borderRadius: '4px' }}>
              <div style={{ fontWeight: 700, marginBottom: '4px' }}>Vehicle:</div>
              <div>{vehicleInfo.year} {vehicleInfo.make} {vehicleInfo.model}</div>
            </div>
          )}

          {/* Did you work on this vehicle? */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={didWork}
                onChange={(e) => setDidWork(e.target.checked)}
              />
              <strong>I worked on this vehicle</strong>
            </label>
          </div>

          {didWork && (
            <>
              {/* Work Date */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 600 }}>
                  <Calendar size={14} style={{ display: 'inline', marginRight: '4px' }} />
                  When did you do this work?
                </label>
                <input
                  type="date"
                  value={workDate}
                  onChange={(e) => setWorkDate(e.target.value)}
                  className="form-input"
                  style={{ width: '100%' }}
                />
                {exifDate && (
                  <div style={{ fontSize: '7pt', color: '#6B7280', marginTop: '4px' }}>
                    Date from image metadata: {exifDate.toLocaleDateString()}
                  </div>
                )}
              </div>

              {/* Who did you work for? */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
                  <Building size={14} style={{ display: 'inline', marginRight: '4px' }} />
                  Who did you work for?
                </label>

                <select
                  value={responsiblePartyType}
                  onChange={(e) => setResponsiblePartyType(e.target.value as any)}
                  className="form-input"
                  style={{ width: '100%', marginBottom: '8px' }}
                >
                  <option value="organization">An organization/shop</option>
                  <option value="contractor_to_org">Independent contractor for an organization</option>
                  <option value="vehicle_owner">Directly for the vehicle owner</option>
                  <option value="self">My own vehicle</option>
                </select>

                {(responsiblePartyType === 'organization' || responsiblePartyType === 'contractor_to_org') && (
                  <select
                    value={selectedOrgId}
                    onChange={(e) => setSelectedOrgId(e.target.value)}
                    className="form-input"
                    style={{ width: '100%' }}
                  >
                    <option value="">Select organization...</option>
                    {userOrgs.map(org => (
                      <option key={org.id} value={org.id}>{org.name}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Work Category */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 600 }}>
                  <Wrench size={14} style={{ display: 'inline', marginRight: '4px' }} />
                  Type of work
                </label>
                <select
                  value={workCategory}
                  onChange={(e) => setWorkCategory(e.target.value)}
                  className="form-input"
                  style={{ width: '100%' }}
                >
                  {workCategories.map(cat => (
                    <option key={cat.value} value={cat.value}>{cat.label}</option>
                  ))}
                </select>
              </div>

              {/* Work Description */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 600 }}>
                  Work description
                </label>
                <textarea
                  value={workDescription}
                  onChange={(e) => setWorkDescription(e.target.value)}
                  placeholder="Describe the work you performed..."
                  className="form-input"
                  style={{ width: '100%', minHeight: '80px' }}
                />
              </div>

              {/* Labor Hours (optional) */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 600 }}>
                  Labor hours (optional)
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={laborHours}
                  onChange={(e) => setLaborHours(e.target.value)}
                  placeholder="e.g., 4.5"
                  className="form-input"
                  style={{ width: '100%' }}
                />
              </div>
            </>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '24px' }}>
            <button
              onClick={onCancel}
              className="button button-secondary"
              style={{ fontSize: '9pt' }}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              className="button button-primary"
              style={{ fontSize: '9pt' }}
              disabled={loading || !didWork || (responsiblePartyType === 'organization' && !selectedOrgId)}
            >
              {loading ? 'Submitting...' : responsiblePartyType === 'self' ? 'Submit' : 'Submit for Verification'}
            </button>
          </div>

          {responsiblePartyType !== 'self' && didWork && (
            <div style={{ 
              fontSize: '7pt', 
              color: '#6B7280', 
              marginTop: '12px',
              textAlign: 'center',
              fontStyle: 'italic'
            }}>
              Images will show as "Pending Verification" until approved by the responsible party
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ContributionSubmissionModal;

