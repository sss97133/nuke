import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import rbacService from '../../services/rbacService';
import type { UserRole, ExperienceLevel, VerificationLevel } from '../../services/rbacService';
import {
  Shield, User, Users, Crown, Key, AlertTriangle, CheckCircle,
  XCircle, Clock, FileText, Eye, Star, Award, Camera, Wrench,
  TrendingUp, Building, Gavel
} from 'lucide-react';

interface RoleRequestWorkflowProps {
  vehicleId: string;
  userId: string;
  currentRole?: UserRole;
  onClose: () => void;
  onSuccess: () => void;
}

interface RoleOption {
  role: UserRole;
  title: string;
  description: string;
  icon: React.ComponentType<any>;
  requirements: string[];
  benefits: string[];
  verificationLevel: VerificationLevel;
  trustScoreRequired: number;
}

const ROLE_OPTIONS: RoleOption[] = [
  {
    role: 'contributor',
    title: 'Contributor',
    description: 'Help maintain basic vehicle data and photos',
    icon: Users,
    requirements: ['Email verification', 'Basic platform knowledge'],
    benefits: ['Add photos', 'Add notes', 'Edit basic info'],
    verificationLevel: 'email_verified',
    trustScoreRequired: 10
  },
  {
    role: 'photographer',
    title: 'Photographer',
    description: 'Specialize in visual documentation',
    icon: Camera,
    requirements: ['Portfolio examples', 'Photo quality standards'],
    benefits: ['Advanced photo tools', 'Manage photo collections', 'Photo verification'],
    verificationLevel: 'email_verified',
    trustScoreRequired: 20
  },
  {
    role: 'previous_owner',
    title: 'Previous Owner',
    description: 'You previously owned this vehicle',
    icon: Key,
    requirements: ['Proof of previous ownership', 'Documentation'],
    benefits: ['Share ownership history', 'Access maintenance records', 'Add historical context'],
    verificationLevel: 'id_verified',
    trustScoreRequired: 25
  },
  {
    role: 'mechanic',
    title: 'Mechanic / Technician',
    description: 'Professional automotive technical expertise',
    icon: Wrench,
    requirements: ['Professional certification', 'Verifiable experience'],
    benefits: ['Technical editing', 'Maintenance records', 'Professional tools', 'Diagnostic data'],
    verificationLevel: 'expert_verified',
    trustScoreRequired: 40
  },
  {
    role: 'restorer',
    title: 'Restorer',
    description: 'Experienced in vehicle restoration projects',
    icon: Star,
    requirements: ['Restoration portfolio', 'Technical knowledge'],
    benefits: ['Full editing access', 'Build management', 'Parts database', 'Project tracking'],
    verificationLevel: 'phone_verified',
    trustScoreRequired: 35
  },
  {
    role: 'appraiser',
    title: 'Appraiser',
    description: 'Professional vehicle valuation expertise',
    icon: TrendingUp,
    requirements: ['Appraisal certification', 'Market analysis experience'],
    benefits: ['Valuation tools', 'Market data access', 'Condition assessment', 'Value tracking'],
    verificationLevel: 'expert_verified',
    trustScoreRequired: 50
  },
  {
    role: 'dealer',
    title: 'Dealer',
    description: 'Licensed automotive dealer',
    icon: Building,
    requirements: ['Dealer license', 'Business verification'],
    benefits: ['Commercial tools', 'Sales management', 'Market insights', 'Lead generation'],
    verificationLevel: 'background_checked',
    trustScoreRequired: 45
  },
  {
    role: 'moderator',
    title: 'Moderator',
    description: 'Help maintain platform quality and resolve disputes',
    icon: Gavel,
    requirements: ['Proven track record', 'Community standing', 'Platform expertise'],
    benefits: ['Content moderation', 'Dispute resolution', 'Data verification', 'Quality control'],
    verificationLevel: 'background_checked',
    trustScoreRequired: 70
  }
];

const RoleRequestWorkflow: React.FC<RoleRequestWorkflowProps> = ({
  vehicleId,
  userId,
  currentRole = 'viewer',
  onClose,
  onSuccess
}) => {
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);
  const [step, setStep] = useState<'select' | 'qualify' | 'evidence' | 'submit'>('select');
  const [qualificationData, setQualificationData] = useState<any>({});
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [userProfile, setUserProfile] = useState<any>(null);

  useEffect(() => {
    loadUserProfile();
  }, [userId]);

  const loadUserProfile = async () => {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      setUserProfile(data);
    } catch (error) {
      console.error('Error loading user profile:', error);
    }
  };

  const getRoleIcon = (role: UserRole) => {
    const option = ROLE_OPTIONS.find(r => r.role === role);
    return option?.icon || User;
  };

  const canRequestRole = (roleOption: RoleOption): boolean => {
    if (!userProfile) return false;

    // Check if user meets basic requirements
    const meetsVerification = true; // Would check actual verification level
    const meetsTrustScore = (userProfile.trust_score || 0) >= roleOption.trustScoreRequired;

    return meetsVerification && meetsTrustScore;
  };

  const handleRoleSelection = (role: UserRole) => {
    setSelectedRole(role);
    setStep('qualify');
  };

  const handleQualificationSubmit = (data: any) => {
    setQualificationData(data);
    setStep('evidence');
  };

  const handleEvidenceSubmit = () => {
    setStep('submit');
  };

  const handleFinalSubmit = async () => {
    if (!selectedRole) return;

    setSubmitting(true);
    try {
      // Upload evidence files if any
      const evidenceUrls = [];
      for (const file of evidenceFiles) {
        const fileName = `${Date.now()}_${file.name}`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('role-evidence')
          .upload(`${userId}/${vehicleId}/${fileName}`, file);

        if (!uploadError) {
          const { data: { publicUrl } } = supabase.storage
            .from('role-evidence')
            .getPublicUrl(uploadData.path);
          evidenceUrls.push(publicUrl);
        }
      }

      // Submit role request
      const success = await rbacService.requestRoleChange(
        vehicleId,
        userId,
        selectedRole,
        qualificationData.reason || 'Role upgrade request',
        {
          qualifications: qualificationData,
          evidence: evidenceUrls,
          submittedAt: new Date().toISOString()
        }
      );

      if (success) {
        onSuccess();
      } else {
        alert('Failed to submit role request');
      }
    } catch (error) {
      console.error('Error submitting role request:', error);
      alert('Error submitting request');
    } finally {
      setSubmitting(false);
    }
  };

  const renderRoleSelection = () => (
    <div>
      <h3 className="heading-3" style={{ marginBottom: '16px' }}>Request Vehicle Access</h3>
      <p className="text text-muted" style={{ marginBottom: '24px' }}>
        Choose the role that best describes your relationship to this vehicle:
      </p>

      <div className="grid" style={{ gap: '16px', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        {ROLE_OPTIONS.map((roleOption) => {
          const Icon = roleOption.icon;
          const canRequest = canRequestRole(roleOption);

          return (
            <div
              key={roleOption.role}
              className={`card ${canRequest ? 'cursor-pointer' : 'opacity-60'}`}
              onClick={() => canRequest && handleRoleSelection(roleOption.role)}
              style={{
                border: selectedRole === roleOption.role ? '2px solid var(--color-primary)' : undefined,
                cursor: canRequest ? 'pointer' : 'not-allowed'
              }}
            >
              <div className="card-body">
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
                  <Icon className="w-6 h-6" style={{ marginRight: '12px', color: 'var(--color-primary)' }} />
                  <div>
                    <div className="text font-bold">{roleOption.title}</div>
                    {!canRequest && (
                      <div className="text text-xs text-error">Trust score {roleOption.trustScoreRequired}+ required</div>
                    )}
                  </div>
                </div>

                <p className="text text-sm text-muted" style={{ marginBottom: '12px' }}>
                  {roleOption.description}
                </p>

                <div style={{ marginBottom: '12px' }}>
                  <div className="text text-xs font-bold text-muted">REQUIREMENTS:</div>
                  <ul style={{ margin: '4px 0 0 16px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                    {roleOption.requirements.map((req, i) => (
                      <li key={i}>{req}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <div className="text text-xs font-bold text-muted">PERMISSIONS:</div>
                  <ul style={{ margin: '4px 0 0 16px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                    {roleOption.benefits.slice(0, 3).map((benefit, i) => (
                      <li key={i}>{benefit}</li>
                    ))}
                    {roleOption.benefits.length > 3 && (
                      <li>...and {roleOption.benefits.length - 3} more</li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderQualificationForm = () => {
    const roleOption = ROLE_OPTIONS.find(r => r.role === selectedRole);
    if (!roleOption) return null;

    return (
      <div>
        <h3 className="heading-3" style={{ marginBottom: '16px' }}>
          Qualify for {roleOption.title}
        </h3>

        <form onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.target as HTMLFormElement);
          const data = Object.fromEntries(formData.entries());
          handleQualificationSubmit(data);
        }}>

          <div className="form-group">
            <label className="form-label">Years of Experience</label>
            <select name="experience_years" className="form-input" required>
              <option value="">Select...</option>
              <option value="0-1">0-1 years</option>
              <option value="2-5">2-5 years</option>
              <option value="6-10">6-10 years</option>
              <option value="11-20">11-20 years</option>
              <option value="20+">20+ years</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Experience Level</label>
            <select name="experience_level" className="form-input" required>
              <option value="">Select...</option>
              <option value="learning">Learning (hobbyist, some knowledge)</option>
              <option value="experienced">Experienced (owned/worked on similar vehicles)</option>
              <option value="expert">Expert (professional experience)</option>
              <option value="professional">Professional (certified/licensed)</option>
            </select>
          </div>

          {selectedRole === 'previous_owner' && (
            <div className="form-group">
              <label className="form-label">Years You Owned This Vehicle</label>
              <input
                type="text"
                name="ownership_period"
                className="form-input"
                placeholder="e.g., 2018-2022"
                required
              />
            </div>
          )}

          {['mechanic', 'appraiser', 'dealer'].includes(selectedRole!) && (
            <div className="form-group">
              <label className="form-label">Professional Certifications</label>
              <textarea
                name="certifications"
                className="form-input"
                rows={3}
                placeholder="List any relevant certifications, licenses, or professional credentials"
                required
              />
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Why do you want this role?</label>
            <textarea
              name="reason"
              className="form-input"
              rows={3}
              placeholder="Explain your motivation and what you plan to contribute"
              required
            />
          </div>

          <div className="form-actions">
            <button type="button" onClick={() => setStep('select')} className="button button-secondary">
              Back
            </button>
            <button type="submit" className="button button-primary">
              Continue
            </button>
          </div>
        </form>
      </div>
    );
  };

  const renderEvidenceUpload = () => (
    <div>
      <h3 className="heading-3" style={{ marginBottom: '16px' }}>
        Upload Supporting Evidence
      </h3>
      <p className="text text-muted" style={{ marginBottom: '16px' }}>
        Upload documents that support your qualification for this role:
      </p>

      <div className="form-group">
        <label className="form-label">Supporting Documents</label>
        <input
          type="file"
          multiple
          accept="image/*,.pdf,.doc,.docx"
          onChange={(e) => setEvidenceFiles(Array.from(e.target.files || []))}
          className="form-input"
        />
        <div className="form-help">
          Upload certificates, licenses, work samples, or other relevant documentation
        </div>
      </div>

      {evidenceFiles.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <div className="text font-bold" style={{ marginBottom: '8px' }}>Selected Files:</div>
          {evidenceFiles.map((file, i) => (
            <div key={i} className="text text-sm">• {file.name}</div>
          ))}
        </div>
      )}

      <div className="form-actions">
        <button onClick={() => setStep('qualify')} className="button button-secondary">
          Back
        </button>
        <button onClick={handleEvidenceSubmit} className="button button-primary">
          Continue
        </button>
      </div>
    </div>
  );

  const renderSubmitConfirmation = () => {
    const roleOption = ROLE_OPTIONS.find(r => r.role === selectedRole);

    return (
      <div>
        <h3 className="heading-3" style={{ marginBottom: '16px' }}>
          Confirm Role Request
        </h3>

        <div className="card" style={{ marginBottom: '16px' }}>
          <div className="card-body">
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
              {roleOption && <roleOption.icon className="w-6 h-6" style={{ marginRight: '12px' }} />}
              <div className="text font-bold">{roleOption?.title}</div>
            </div>

            <div className="text text-sm" style={{ marginBottom: '12px' }}>
              <strong>Experience:</strong> {qualificationData.experience_level} ({qualificationData.experience_years})
            </div>

            {qualificationData.reason && (
              <div className="text text-sm" style={{ marginBottom: '12px' }}>
                <strong>Reason:</strong> {qualificationData.reason}
              </div>
            )}

            {evidenceFiles.length > 0 && (
              <div className="text text-sm">
                <strong>Evidence:</strong> {evidenceFiles.length} file(s) attached
              </div>
            )}
          </div>
        </div>

        <div className="alert alert-info" style={{ marginBottom: '16px' }}>
          Your request will be reviewed by the vehicle owner. You'll be notified once a decision is made.
        </div>

        <div className="form-actions">
          <button onClick={() => setStep('evidence')} className="button button-secondary">
            Back
          </button>
          <button
            onClick={handleFinalSubmit}
            disabled={submitting}
            className="button button-primary"
          >
            {submitting ? 'Submitting...' : 'Submit Request'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="modal-overlay">
      <div className="modal modal-large">
        <div className="modal-header">
          <div className="modal-title">Request Vehicle Access</div>
          <button onClick={onClose} className="modal-close">×</button>
        </div>

        <div className="modal-body">
          {step === 'select' && renderRoleSelection()}
          {step === 'qualify' && renderQualificationForm()}
          {step === 'evidence' && renderEvidenceUpload()}
          {step === 'submit' && renderSubmitConfirmation()}
        </div>
      </div>
    </div>
  );
};

export default RoleRequestWorkflow;