import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import {
  FileText,
  Upload,
  Shield,
  AlertCircle,
  CheckCircle,
  X
} from 'lucide-react';

interface OwnershipClaimFormProps {
  vehicleId: string;
  onClose: () => void;
  onSubmit: (claimData: any) => void;
}

interface UserProfile {
  id: string;
  is_verified?: boolean;
  verification_level?: string;
}

interface SubmissionState {
  status: 'idle' | 'submitting' | 'success' | 'error';
  message?: string;
}

const OwnershipClaimForm: React.FC<OwnershipClaimFormProps> = ({
  vehicleId,
  onClose,
  onSubmit
}) => {
  const [claimType, setClaimType] = useState<string>('');
  const [documents, setDocuments] = useState<File[]>([]);
  const [description, setDescription] = useState('');
  const [submissionState, setSubmissionState] = useState<SubmissionState>({ status: 'idle' });
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkUserVerification();
  }, []);

  const checkUserVerification = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setSubmissionState({
          status: 'error',
          message: 'You must be logged in to claim vehicle ownership'
        });
        return;
      }

      // Check user's verification status from profiles table
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('id, is_verified, verification_level')
        .eq('id', user.id)
        .single();

      if (error) {
        console.error('Error fetching user profile:', error);
        setSubmissionState({
          status: 'error',
          message: 'Unable to verify account status'
        });
        return;
      }

      setUserProfile(profile);

      // Check if user is verified
      if (!profile?.is_verified) {
        setSubmissionState({
          status: 'error',
          message: 'Your account must be verified before claiming vehicle ownership. Please complete identity verification first.'
        });
        return;
      }
    } catch (error) {
      console.error('Error checking user verification:', error);
      setSubmissionState({
        status: 'error',
        message: 'Error checking account status'
      });
    } finally {
      setLoading(false);
    }
  };

  const claimTypes = [
    {
      id: 'title',
      name: 'Vehicle Title',
      description: 'Legal ownership document',
      required: ['title_document'],
      icon: <FileText className="w-4 h-4" />
    },
    {
      id: 'registration',
      name: 'Registration Document',
      description: 'Current vehicle registration',
      required: ['registration_document'],
      icon: <FileText className="w-4 h-4" />
    },
    {
      id: 'bill_of_sale',
      name: 'Bill of Sale',
      description: 'Purchase agreement or receipt',
      required: ['bill_of_sale'],
      icon: <FileText className="w-4 h-4" />
    },
    {
      id: 'insurance',
      name: 'Insurance Policy',
      description: 'Current insurance naming you as owner',
      required: ['insurance_document'],
      icon: <Shield className="w-4 h-4" />
    },
    {
      id: 'previous_owner',
      name: 'Previous Owner',
      description: 'You previously owned this vehicle',
      required: ['supporting_evidence'],
      icon: <FileText className="w-4 h-4" />
    }
  ];

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      setDocuments([...documents, ...Array.from(event.target.files)]);
    }
  };

  const removeDocument = (index: number) => {
    setDocuments(documents.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!claimType || !userProfile) return;

    setSubmissionState({ status: 'submitting' });
    try {
      const claimData = {
        userId: userProfile.id,
        vehicleId,
        claimType,
        description,
        documents,
        submittedAt: new Date().toISOString()
      };

      await onSubmit(claimData);
      setSubmissionState({
        status: 'success',
        message: 'Ownership claim submitted successfully. You will be notified when reviewed.'
      });

      // Close after showing success briefly
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (error) {
      console.error('Error submitting ownership claim:', error);
      setSubmissionState({
        status: 'error',
        message: 'Failed to submit ownership claim. Please try again.'
      });
    }
  };

  const selectedClaimType = claimTypes.find(type => type.id === claimType);

  if (loading) {
    return (
      <div className="fixed inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999 }}>
        <div className="modal" style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          backgroundColor: 'var(--white)',
          border: '2px solid var(--border-dark)',
          maxWidth: '500px',
          width: '90%',
          padding: 'var(--space-4)'
        }}>
          <div className="text">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999 }}>
      <div className="modal" style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        backgroundColor: 'var(--white)',
        border: '2px solid var(--border-dark)',
        maxWidth: '600px',
        width: '90%',
        maxHeight: '80vh',
        overflow: 'auto'
      }}>
        {/* Header */}
        <div className="modal-header" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-3)',
          borderBottom: '1px solid var(--border-light)',
          backgroundColor: 'var(--grey-200)'
        }}>
          <div className="text font-bold" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Shield style={{ width: '12px', height: '12px' }} />
            Claim Vehicle Ownership
          </div>
          <button
            onClick={onClose}
            className="button-close"
            style={{
              border: '1px solid var(--border-medium)',
              backgroundColor: 'var(--grey-100)',
              padding: 'var(--space-1)',
              cursor: 'pointer',
              fontSize: 'var(--font-size-small)'
            }}
          >
            <X style={{ width: '10px', height: '10px' }} />
          </button>
        </div>

        {/* Content */}
        <div className="modal-content" style={{ padding: 'var(--space-4)' }}>
          {/* Status Message */}
          {submissionState.status === 'error' && (
            <div className="status-message" style={{
              backgroundColor: 'var(--upload-red-light)',
              border: '1px solid var(--upload-red)',
              padding: 'var(--space-3)',
              marginBottom: 'var(--space-4)'
            }}>
              <div className="text" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <AlertCircle style={{ width: '12px', height: '12px' }} />
                {submissionState.message}
              </div>
            </div>
          )}

          {submissionState.status === 'success' && (
            <div className="status-message" style={{
              backgroundColor: 'var(--upload-green-light)',
              border: '1px solid var(--upload-green)',
              padding: 'var(--space-3)',
              marginBottom: 'var(--space-4)'
            }}>
              <div className="text" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <CheckCircle style={{ width: '12px', height: '12px' }} />
                {submissionState.message}
              </div>
            </div>
          )}

          {/* Info Box */}
          {submissionState.status !== 'error' && (
            <div className="info-box" style={{
              backgroundColor: 'var(--upload-blue-light)',
              border: '1px solid var(--upload-blue)',
              padding: 'var(--space-3)',
              marginBottom: 'var(--space-4)'
            }}>
              <div className="text-small font-bold">Ownership Verification Process</div>
              <div className="text-small" style={{ marginTop: 'var(--space-2)' }}>
                Submit documentation proving your ownership of this vehicle. All submissions are reviewed manually and may take 1-3 business days to process.
              </div>
            </div>
          )}

          {/* Form */}
          {submissionState.status !== 'error' && submissionState.status !== 'success' && (
            <form onSubmit={handleSubmit}>
              {/* Claim Type Selection */}
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <div className="text font-bold" style={{ marginBottom: 'var(--space-2)' }}>
                  Select Your Claim Type
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {claimTypes.map((type) => (
                    <div
                      key={type.id}
                      className="claim-type-option"
                      style={{
                        border: `1px solid ${claimType === type.id ? 'var(--upload-blue)' : 'var(--border-light)'}`,
                        backgroundColor: claimType === type.id ? 'var(--upload-blue-light)' : 'var(--white)',
                        padding: 'var(--space-3)',
                        cursor: 'pointer'
                      }}
                      onClick={() => setClaimType(type.id)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <input
                          type="radio"
                          name="claimType"
                          value={type.id}
                          checked={claimType === type.id}
                          onChange={() => setClaimType(type.id)}
                          style={{ margin: 0 }}
                        />
                        {React.cloneElement(type.icon as React.ReactElement, { style: { width: '10px', height: '10px' } })}
                        <div>
                          <div className="text font-bold">{type.name}</div>
                          <div className="text-small">{type.description}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Document Upload */}
              {claimType && (
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <div className="text font-bold" style={{ marginBottom: 'var(--space-2)' }}>
                    Upload Supporting Documents *
                  </div>

                  <div className="upload-zone" style={{
                    border: '2px dashed var(--border-medium)',
                    padding: 'var(--space-5)',
                    backgroundColor: 'var(--grey-50)',
                    textAlign: 'center'
                  }}>
                    <div style={{ marginBottom: 'var(--space-3)' }}>
                      <Upload style={{ width: '16px', height: '16px', margin: '0 auto var(--space-2)', display: 'block' }} />
                      <div className="text-small" style={{ marginBottom: 'var(--space-2)' }}>
                        Drag and drop files here, or click to select
                      </div>
                      <input
                        type="file"
                        multiple
                        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                        onChange={handleFileUpload}
                        style={{ display: 'none' }}
                        id="file-upload"
                      />
                      <button
                        type="button"
                        onClick={() => document.getElementById('file-upload')?.click()}
                        style={{
                          border: '1px solid var(--border-medium)',
                          backgroundColor: 'var(--grey-100)',
                          padding: 'var(--space-2) var(--space-3)',
                          cursor: 'pointer',
                          fontSize: 'var(--font-size-small)'
                        }}
                      >
                        Select Files
                      </button>
                    </div>

                    <div className="text-small" style={{ color: 'var(--text-muted)' }}>
                      Accepted formats: PDF, JPG, PNG, DOC, DOCX (max 10MB each)
                    </div>
                  </div>

                  {/* Uploaded Files */}
                  {documents.length > 0 && (
                    <div style={{ marginTop: 'var(--space-3)' }}>
                      <div className="text font-bold" style={{ marginBottom: 'var(--space-2)' }}>Uploaded Files:</div>
                      {documents.map((file, index) => (
                        <div
                          key={index}
                          className="file-item"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            backgroundColor: 'var(--grey-100)',
                            padding: 'var(--space-2)',
                            border: '1px solid var(--border-light)',
                            marginBottom: 'var(--space-1)'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                            <FileText style={{ width: '10px', height: '10px' }} />
                            <span className="text-small">{file.name}</span>
                            <span className="text-small" style={{
                              backgroundColor: 'var(--white)',
                              border: '1px solid var(--border-light)',
                              padding: '0 var(--space-2)'
                            }}>
                              {(file.size / 1024 / 1024).toFixed(1)}MB
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeDocument(index)}
                            style={{
                              border: '1px solid var(--border-medium)',
                              backgroundColor: 'var(--grey-200)',
                              padding: 'var(--space-1)',
                              cursor: 'pointer',
                              fontSize: 'var(--font-size-small)'
                            }}
                          >
                            <X style={{ width: '8px', height: '8px' }} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Additional Information */}
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <div className="text font-bold" style={{ marginBottom: 'var(--space-2)' }}>
                  Additional Information
                </div>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Provide any additional context about your ownership claim..."
                  rows={4}
                  style={{
                    width: '100%',
                    border: '1px solid var(--border-medium)',
                    padding: 'var(--space-2)',
                    fontSize: 'var(--font-size-small)',
                    fontFamily: 'var(--font-family)',
                    resize: 'vertical',
                    minHeight: '60px'
                  }}
                />
                <div className="text-small" style={{ color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
                  Include details like purchase date, previous owner information, or any special circumstances.
                </div>
              </div>

              {/* Requirements for Selected Claim Type */}
              {selectedClaimType && (
                <div className="requirements-box" style={{
                  backgroundColor: 'var(--upload-green-light)',
                  border: '1px solid var(--upload-green)',
                  padding: 'var(--space-3)',
                  marginBottom: 'var(--space-4)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
                    <CheckCircle style={{ width: '12px', height: '12px', marginTop: '2px' }} />
                    <div>
                      <div className="text font-bold">Required for {selectedClaimType.name}:</div>
                      <ul style={{ marginTop: 'var(--space-1)', marginLeft: 'var(--space-3)' }}>
                        {selectedClaimType.required.map((req, index) => (
                          <li key={index} className="text-small" style={{ listStyle: 'disc', marginBottom: 'var(--space-1)' }}>
                            {req.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                          </li>
                        ))}
                        <li className="text-small" style={{ listStyle: 'disc', marginBottom: 'var(--space-1)' }}>Clear, readable images or scans</li>
                        <li className="text-small" style={{ listStyle: 'disc' }}>Document must show your name and vehicle information</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* Submit Buttons */}
              <div style={{ display: 'flex', gap: 'var(--space-3)', paddingTop: 'var(--space-4)' }}>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submissionState.status === 'submitting'}
                  className="button-cancel"
                  style={{
                    flex: 1,
                    border: '1px solid var(--border-medium)',
                    backgroundColor: 'var(--grey-100)',
                    padding: 'var(--space-2) var(--space-3)',
                    cursor: submissionState.status === 'submitting' ? 'not-allowed' : 'pointer',
                    fontSize: 'var(--font-size-small)'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!claimType || documents.length === 0 || submissionState.status === 'submitting'}
                  className="button-submit"
                  style={{
                    flex: 1,
                    border: '1px solid var(--upload-blue)',
                    backgroundColor: (!claimType || documents.length === 0 || submissionState.status === 'submitting')
                      ? 'var(--grey-200)'
                      : 'var(--upload-blue-light)',
                    padding: 'var(--space-2) var(--space-3)',
                    cursor: (!claimType || documents.length === 0 || submissionState.status === 'submitting')
                      ? 'not-allowed'
                      : 'pointer',
                    fontSize: 'var(--font-size-small)'
                  }}
                >
                  {submissionState.status === 'submitting' ? 'Submitting...' : 'Submit Ownership Claim'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default OwnershipClaimForm;