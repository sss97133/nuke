import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { storageService } from '../services/supabase/storageService';
import '../design-system.css';

interface OwnershipVerificationWizardProps {
  vehicleId: string;
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
}

type UserTier = 'verified_owner' | 'responsible_party' | 'professional' | 'contributor' | 'consigner' | 'public';
type WizardStep = 'select_relationship' | 'upload_documents' | 'sign_contract' | 'review_submit';

interface VerificationData {
  relationship: UserTier;
  documents: {
    title?: File;
    driversLicense?: File;
    insurance?: File;
    contract?: File;
    dealerLicense?: File;
    photoEvidence?: File;
  };
  contractSigned: boolean;
  additionalInfo: string;
}

const OwnershipVerificationWizard: React.FC<OwnershipVerificationWizardProps> = ({
  vehicleId,
  isOpen,
  onClose,
  onComplete
}) => {
  const [currentStep, setCurrentStep] = useState<WizardStep>('select_relationship');
  const [verificationData, setVerificationData] = useState<VerificationData>({
    relationship: 'public',
    documents: {},
    contractSigned: false,
    additionalInfo: ''
  });
  const [loading, setLoading] = useState(false);
  const [vehicle, setVehicle] = useState<any>(null);

  useEffect(() => {
    if (vehicleId && isOpen) {
      loadVehicle();
    }
  }, [vehicleId, isOpen]);

  const loadVehicle = async () => {
    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .eq('id', vehicleId)
        .single();
      
      if (data) setVehicle(data);
    } catch (error) {
      console.error('Failed to load vehicle:', error);
    }
  };

  if (!isOpen) return null;

  const relationships = [
    {
      id: 'verified_owner',
      title: 'I Own This Vehicle',
      description: 'You are the legal owner with title in your name',
      requirements: ['Vehicle Title', 'Driver\'s License', 'Insurance (optional)'],
      icon: 'O'
    },
    {
      id: 'responsible_party',
      title: 'I Manage This Vehicle',
      description: 'You manage but don\'t legally own (e.g., family member\'s car)',
      requirements: ['Written permission from owner', 'Your ID'],
      icon: 'M'
    },
    {
      id: 'consigner',
      title: 'Dealer / Consigner',
      description: 'You are selling this vehicle on behalf of the owner',
      requirements: ['Dealer License / Business Credential', 'Consignment Contract'],
      icon: 'D'
    },
    {
      id: 'professional',
      title: 'Service Provider',
      description: 'Mechanic, detailer, or shop performing work',
      requirements: ['Business license', 'Service Order'],
      icon: 'P'
    },
    {
      id: 'contributor',
      title: 'Inspector / Contributor',
      description: 'You have physical access and original photos',
      requirements: ['Original photos with metadata (GPS/EXIF)'],
      icon: 'C'
    }
  ];

  const handleFileUpload = (documentType: keyof VerificationData['documents'], file: File) => {
    try {
      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
      if (!allowedTypes.includes(file.type.toLowerCase())) {
        alert('Please upload a valid image (JPEG, PNG, WebP) or PDF file.');
        return;
      }

      // Validate file size (10MB max)
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (file.size > maxSize) {
        alert('File size must be less than 10MB. Please choose a smaller file.');
        return;
      }

      setVerificationData(prev => ({
        ...prev,
        documents: {
          ...prev.documents,
          [documentType]: file
        }
      }));

      // Show success feedback
      console.log(`File uploaded successfully: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);

      // Optional: You could add a toast notification here instead of console.log
    } catch (error) {
      console.error('Error processing file upload:', error);
      alert('Failed to process the file. Please try again.');
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData?.user?.id;

      if (!userId) {
        alert('Please log in to verify ownership');
        return;
      }

      // Upload documents using the existing document upload system
      const documentPaths: Record<string, string> = {};

      for (const [key, file] of Object.entries(verificationData.documents)) {
        if (file) {
          try {
            const publicUrl = await storageService.uploadDocument(vehicleId, file, userId, key);
            if (publicUrl) {
              documentPaths[key] = publicUrl;
            }
          } catch (uploadError) {
            console.error(`Error uploading ${key} document:`, uploadError);
            // Continue with other uploads even if one fails
          }
        }
      }

      // Validate required documents
      if (!documentPaths.title || !documentPaths.driversLicense) {
        alert('Title document and driver\'s license are required for verification.');
        return;
      }

      // Create verification record using correct database schema
      const { error: verificationError } = await supabase
        .from('ownership_verifications')
        .insert({
          vehicle_id: vehicleId,
          user_id: userId,
          status: 'pending',
          title_document_url: documentPaths.title,
          drivers_license_url: documentPaths.driversLicense,
          insurance_document_url: documentPaths.insurance || null,
          extracted_data: {
            relationship: verificationData.relationship,
            additional_info: verificationData.additionalInfo,
            contract_signed: verificationData.contractSigned
          },
          submitted_at: new Date().toISOString()
        });

      if (verificationError) {
        console.error('Failed to submit verification:', verificationError);
        alert('Failed to submit verification. Please try again.');
        return;
      }

      // Best-effort: update user's relationship to vehicle (optional table)
      try {
        await supabase
          .from('vehicle_user_permissions')
          .upsert({
            vehicle_id: vehicleId,
            user_id: userId,
            role: verificationData.relationship === 'verified_owner' ? 'owner' : verificationData.relationship,
            granted_at: new Date().toISOString()
          });
      } catch {}

      onComplete();
    } catch (error) {
      console.error('Verification submission failed:', error);
      alert('Failed to submit verification. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 'select_relationship':
        return (
          <div>
            <h3 className="text font-bold mb-4">Select Your Relationship</h3>
            <p className="text-small text-muted mb-4">
              Choose how you're connected to this {vehicle?.year} {vehicle?.make} {vehicle?.model}
            </p>
            <div style={{ display: 'grid', gap: '12px' }}>
              {relationships.map(rel => (
                <div
                  key={rel.id}
                  className={`card ${verificationData.relationship === rel.id ? 'selected' : ''}`}
                  style={{
                    cursor: 'pointer',
                    padding: '16px',
                    border: verificationData.relationship === rel.id 
                      ? '2px solid var(--color-primary)' 
                      : '1px solid var(--color-border)',
                    background: verificationData.relationship === rel.id
                      ? 'var(--color-primary-light)'
                      : 'white'
                  }}
                  onClick={() => setVerificationData(prev => ({ ...prev, relationship: rel.id as UserTier }))}
                >
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <span style={{ fontSize: '24px' }}>{rel.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div className="text font-bold">{rel.title}</div>
                      <div className="text-small text-muted" style={{ marginTop: '4px' }}>
                        {rel.description}
                      </div>
                      <div className="text-small" style={{ marginTop: '8px' }}>
                        <strong>Requirements:</strong>
                        <ul style={{ margin: '4px 0 0 20px' }}>
                          {rel.requirements.map((req, idx) => (
                            <li key={idx}>{req}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4">
              <button
                className="button button-primary"
                onClick={() => setCurrentStep('upload_documents')}
                disabled={verificationData.relationship === 'public'}
              >
                Next: Upload Documents
              </button>
            </div>
          </div>
        );

      case 'upload_documents':
        const selectedRel = relationships.find(r => r.id === verificationData.relationship);
        return (
          <div>
            <h3 className="text font-bold mb-4">Upload Required Documents</h3>
            <p className="text-small text-muted mb-4">
              Upload the required documents for {selectedRel?.title.toLowerCase()}
            </p>

            {verificationData.relationship === 'verified_owner' && (
              <>
                <div className="mb-4">
                  <label className="text-small font-bold">
                    Vehicle Title (Required)
                  </label>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    className="input"
                    onChange={(e) => e.target.files?.[0] && handleFileUpload('title', e.target.files[0])}
                    style={{ width: '100%', marginTop: '4px' }}
                  />
                  {verificationData.documents.title && (
                    <div className="text-small text-green-600 mt-1">
                      ✓ Selected: {verificationData.documents.title.name}
                    </div>
                  )}
                </div>
                <div className="mb-4">
                  <label className="text-small font-bold">
                    Driver's License (Required)
                  </label>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    className="input"
                    onChange={(e) => e.target.files?.[0] && handleFileUpload('driversLicense', e.target.files[0])}
                    style={{ width: '100%', marginTop: '4px' }}
                  />
                  {verificationData.documents.driversLicense && (
                    <div className="text-small text-green-600 mt-1">
                      ✓ Selected: {verificationData.documents.driversLicense.name}
                    </div>
                  )}
                </div>
                <div className="mb-4">
                  <label className="text-small font-bold">
                    Insurance (Optional)
                  </label>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    className="input"
                    onChange={(e) => e.target.files?.[0] && handleFileUpload('insurance', e.target.files[0])}
                    style={{ width: '100%', marginTop: '4px' }}
                  />
                  {verificationData.documents.insurance && (
                    <div className="text-small text-green-600 mt-1">
                      ✓ Selected: {verificationData.documents.insurance.name}
                    </div>
                  )}
                </div>
              </>
            )}

            {verificationData.relationship === 'consigner' && (
              <>
                <div className="mb-4">
                  <label className="text-small font-bold">
                    Dealer License / Business Credential
                  </label>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    className="input"
                    onChange={(e) => e.target.files?.[0] && handleFileUpload('dealerLicense', e.target.files[0])}
                    style={{ width: '100%', marginTop: '4px' }}
                  />
                  {verificationData.documents.dealerLicense && (
                    <div className="text-small text-green-600 mt-1">
                      ✓ Selected: {verificationData.documents.dealerLicense.name}
                    </div>
                  )}
                </div>
                <div className="mb-4">
                  <label className="text-small font-bold">
                    Consignment Contract
                  </label>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    className="input"
                    onChange={(e) => e.target.files?.[0] && handleFileUpload('contract', e.target.files[0])}
                    style={{ width: '100%', marginTop: '4px' }}
                  />
                  {verificationData.documents.contract && (
                    <div className="text-small text-green-600 mt-1">
                      ✓ Selected: {verificationData.documents.contract.name}
                    </div>
                  )}
                </div>
              </>
            )}

            {verificationData.relationship === 'contributor' && (
              <>
                <div className="mb-4">
                  <label className="text-small font-bold">
                    Proof of Access (Original Photo)
                  </label>
                  <p className="text-xs text-muted mb-2">
                    Upload an original photo you took of the vehicle. We analyze the metadata (EXIF/GPS) to verify you had physical access.
                  </p>
                  <input
                    type="file"
                    accept="image/*"
                    className="input"
                    onChange={(e) => e.target.files?.[0] && handleFileUpload('photoEvidence', e.target.files[0])}
                    style={{ width: '100%', marginTop: '4px' }}
                  />
                  {verificationData.documents.photoEvidence && (
                    <div className="text-small text-green-600 mt-1">
                      ✓ Selected: {verificationData.documents.photoEvidence.name}
                    </div>
                  )}
                </div>
              </>
            )}

            {verificationData.relationship === 'professional' && (
              <>
                <div className="mb-4">
                  <label className="text-small font-bold">
                    Business License or Professional Credentials
                  </label>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    className="input"
                    onChange={(e) => e.target.files?.[0] && handleFileUpload('contract', e.target.files[0])}
                    style={{ width: '100%', marginTop: '4px' }}
                  />
                  {verificationData.documents.contract && (
                    <div className="text-small text-green-600 mt-1">
                      ✓ Selected: {verificationData.documents.contract.name}
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="mb-4">
              <label className="text-small font-bold">
                Additional Information
              </label>
              <textarea
                className="input"
                rows={3}
                placeholder="Any additional context about your relationship to this vehicle..."
                value={verificationData.additionalInfo}
                onChange={(e) => setVerificationData(prev => ({ ...prev, additionalInfo: e.target.value }))}
                style={{ width: '100%', marginTop: '4px' }}
              />
            </div>

            <div className="mt-4" style={{ display: 'flex', gap: '8px' }}>
              <button
                className="button button-secondary"
                onClick={() => setCurrentStep('select_relationship')}
              >
                Back
              </button>
              <button
                className="button button-primary"
                onClick={() => {
                  // Validate required documents before proceeding
                  if (verificationData.relationship === 'verified_owner') {
                    if (!verificationData.documents.title) {
                      alert('Please upload your vehicle title before proceeding.');
                      return;
                    }
                    if (!verificationData.documents.driversLicense) {
                      alert('Please upload your driver\'s license before proceeding.');
                      return;
                    }
                  } else if (verificationData.relationship === 'consigner') {
                    if (!verificationData.documents.dealerLicense || !verificationData.documents.contract) {
                      alert('Please upload your dealer license and consignment contract.');
                      return;
                    }
                  } else if (verificationData.relationship === 'contributor') {
                    if (!verificationData.documents.photoEvidence) {
                      alert('Please upload a photo to verify your access.');
                      return;
                    }
                  } else if (verificationData.relationship === 'professional') {
                    if (!verificationData.documents.contract) {
                      alert('Please upload your business license or professional credentials before proceeding.');
                      return;
                    }
                  }

                  // Navigate to next step
                  if (['professional', 'consigner'].includes(verificationData.relationship)) {
                    setCurrentStep('sign_contract');
                  } else {
                    setCurrentStep('review_submit');
                  }
                }}
              >
                Next
              </button>
            </div>
          </div>
        );

      case 'sign_contract':
        return (
          <div>
            <h3 className="text font-bold mb-4">Professional Service Agreement</h3>
            <div className="card" style={{ padding: '16px', marginBottom: '16px', background: '#f9fafb' }}>
              <h4 className="text-small font-bold mb-2">Terms of Service</h4>
              <div className="text-small" style={{ lineHeight: '1.6' }}>
                <p>By signing this agreement, you confirm that:</p>
                <ul style={{ margin: '8px 0 8px 20px' }}>
                  <li>You have a legitimate professional relationship with this vehicle</li>
                  <li>You will only add accurate, truthful information</li>
                  <li>You understand that false information may result in account suspension</li>
                  <li>You agree to maintain confidentiality of any sensitive vehicle information</li>
                  <li>You will not use this access for competitive or malicious purposes</li>
                </ul>
              </div>
            </div>
            
            <label className="flex items-center gap-2 mb-4">
              <input
                type="checkbox"
                checked={verificationData.contractSigned}
                onChange={(e) => setVerificationData(prev => ({ ...prev, contractSigned: e.target.checked }))}
              />
              <span className="text-small">
                I agree to the terms and conditions above
              </span>
            </label>

            <div className="mt-4" style={{ display: 'flex', gap: '8px' }}>
              <button
                className="button button-secondary"
                onClick={() => setCurrentStep('upload_documents')}
              >
                Back
              </button>
              <button
                className="button button-primary"
                onClick={() => setCurrentStep('review_submit')}
                disabled={!verificationData.contractSigned}
              >
                Next: Review & Submit
              </button>
            </div>
          </div>
        );

      case 'review_submit':
        const relationship = relationships.find(r => r.id === verificationData.relationship);
        return (
          <div>
            <h3 className="text font-bold mb-4">Review Your Submission</h3>
            
            <div className="card mb-3" style={{ padding: '12px' }}>
              <div className="text-small font-bold mb-2">Relationship Type</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '20px' }}>{relationship?.icon}</span>
                <span>{relationship?.title}</span>
              </div>
            </div>

            <div className="card mb-3" style={{ padding: '12px' }}>
              <div className="text-small font-bold mb-2">Documents Uploaded</div>
              <ul className="text-small">
                {Object.entries(verificationData.documents).map(([key, file]) => 
                  file ? <li key={key}>{key}: {file.name}</li> : null
                )}
              </ul>
            </div>

            {verificationData.additionalInfo && (
              <div className="card mb-3" style={{ padding: '12px' }}>
                <div className="text-small font-bold mb-2">Additional Information</div>
                <div className="text-small">{verificationData.additionalInfo}</div>
              </div>
            )}

            <div className="alert alert-info mb-4">
              <strong>What happens next?</strong>
              <p className="text-small mt-2">
                Your verification will be reviewed within 24-48 hours. You'll receive an email 
                when your status is approved. Once approved, you'll have enhanced access to 
                manage this vehicle's profile.
              </p>
            </div>

            <div className="mt-4" style={{ display: 'flex', gap: '8px' }}>
              <button
                className="button button-secondary"
                onClick={() => setCurrentStep(['professional', 'consigner'].includes(verificationData.relationship) ? 'sign_contract' : 'upload_documents')}
              >
                Back
              </button>
              <button
                className="button button-primary"
                onClick={handleSubmit}
                disabled={loading}
              >
                {loading ? 'Submitting...' : 'Submit Verification'}
              </button>
            </div>
          </div>
        );
    }
  };

  return (
    <div 
      className="modal-overlay"
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
        zIndex: 1000
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        className="card"
        style={{
          width: '90%',
          maxWidth: '700px',
          maxHeight: '85vh',
          overflow: 'auto',
          background: 'white'
        }}
      >
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Verify Your Relationship</span>
          <button className="button button-small" onClick={onClose}>×</button>
        </div>
        <div className="card-body">
          {loading && !currentStep ? (
            <div className="text-center">
              <div className="loading-spinner"></div>
              <p className="text-small text-muted mt-2">Loading...</p>
            </div>
          ) : (
            renderStep()
          )}
        </div>
      </div>
    </div>
  );
};

export default OwnershipVerificationWizard;
