import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { secureDocumentService } from '../services/secureDocumentService';

interface VerificationStatus {
  phoneVerified: boolean;
  phoneNumber: string | null;
  idVerified: boolean;
  idDocumentType: string | null;
  idDocumentUrl: string | null;
  verificationLevel: string;
  verifiedAt: string | null;
  verificationNotes: string | null;
  paymentVerified?: boolean;
}

export const ProfileVerification: React.FC = () => {
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus | null>(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [idFile, setIdFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState<string>('drivers_license');
  const [loading, setLoading] = useState(false); // legacy, used by other sections
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [message, setMessage] = useState('');
  const [showPhoneForm, setShowPhoneForm] = useState(false);
  const [showIdForm, setShowIdForm] = useState(false);
  const [isModerator, setIsModerator] = useState(false);
  const [pendingDocs, setPendingDocs] = useState<any[]>([]);

  useEffect(() => {
    // Check for payment completion
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('payment') === 'success') {
        setMessage('Payment method added successfully.');
        url.searchParams.delete('payment');
        window.history.replaceState({}, '', url.toString());
      }
    } catch {}
    loadVerificationStatus();
  }, []);

  const isE164 = (value: string) => /^\+[1-9]\d{6,14}$/.test(value.trim());

  const loadVerificationStatus = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setVerificationStatus({
          phoneVerified: false,
          phoneNumber: null,
          idVerified: false,
          idDocumentType: null,
          idDocumentUrl: null,
          verificationLevel: 'unverified',
          verifiedAt: null,
          verificationNotes: null,
          paymentVerified: false,
        });
        return;
      }

      const { data: profile, error } = await supabase
        .from('profiles')
        .select(`
          phone_verified,
          phone_number,
          id_verification_status,
          id_document_type,
          id_document_url,
          verification_level,
          verified_at,
          verification_notes,
          user_type,
          payment_verified
        `)
        .eq('id', user.id)
        .single();

      if (error) {
        console.warn('profiles fetch error:', error.message);
      }

      const p: any = profile || {};
      setVerificationStatus({
        phoneVerified: !!p.phone_verified,
        phoneNumber: p.phone_number || null,
        idVerified: p.id_verification_status === 'approved',
        idDocumentType: p.id_document_type || null,
        idDocumentUrl: p.id_document_url || null,
        verificationLevel: p.verification_level || 'unverified',
        verifiedAt: p.verified_at || null,
        verificationNotes: p.verification_notes || null,
        paymentVerified: !!p.payment_verified,
      });

      const mod = ['moderator','admin'].includes((p.user_type || '').toLowerCase());
      setIsModerator(mod);
      if (mod) {
        try {
          const docs = await secureDocumentService.getUserDocuments();
          setPendingDocs((docs || []).filter(d => d.verification_status === 'pending'));
        } catch (e) {
          console.warn('load docs error', e);
        }
      }
    } catch (error) {
      console.error('Error loading verification status:', error);
      setVerificationStatus({
        phoneVerified: false,
        phoneNumber: null,
        idVerified: false,
        idDocumentType: null,
        idDocumentUrl: null,
        verificationLevel: 'unverified',
        verifiedAt: null,
        verificationNotes: null,
        paymentVerified: false,
      });
      setMessage('');
    }
  };

  // Admin override — approve phone without code
  const adminApprovePhone = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      // Verify moderator/admin via profile (defense in depth; RLS enforces as well)
      const { data: me } = await supabase
        .from('profiles')
        .select('user_type')
        .eq('id', user.id)
        .single();
      if (!me || !['moderator','admin'].includes(me.user_type)) throw new Error('Insufficient permissions');

      await supabase
        .from('profiles')
        .update({
          phone_verified: true,
          phone_verification_code: null,
          phone_verification_expires_at: null
        })
        .eq('id', user.id);

      setMessage('✓ Phone approved by admin');
      await loadVerificationStatus();
    } catch (e: any) {
      setMessage(e?.message || 'Failed to approve phone');
    } finally {
      setLoading(false);
    }
  };

  // Moderator actions
  const approveDocument = async (docId: string) => {
    try {
      setLoading(true);
      const ok = await secureDocumentService.updateVerificationStatus(docId, 'approved', 'Approved by moderator');
      if (!ok) throw new Error('Update failed');
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from('profiles')
          .update({ id_verification_status: 'approved', verified_at: new Date().toISOString(), verification_level: (verificationStatus?.phoneVerified ? 'fully_verified' : 'id_only') })
          .eq('id', user.id);
      }
      setMessage('✓ ID document approved');
      await loadVerificationStatus();
    } catch (e) {
      console.error(e);
      setMessage('Failed to approve document');
    } finally {
      setLoading(false);
    }
  };

  const rejectDocument = async (docId: string) => {
    try {
      setLoading(true);
      const ok = await secureDocumentService.updateVerificationStatus(docId, 'rejected', 'Rejected by moderator');
      if (!ok) throw new Error('Update failed');
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from('profiles')
          .update({ id_verification_status: 'rejected' })
          .eq('id', user.id);
      }
      setMessage('ID document rejected');
      await loadVerificationStatus();
    } catch (e) {
      console.error(e);
      setMessage('Failed to reject document');
    } finally {
      setLoading(false);
    }
  };

  const sendPhoneVerification = async () => {
    if (sending || verifying) return; // prevent overlap
    if (!phoneNumber) {
      setMessage('Please enter a phone number');
      return;
    }
    if (!isE164(phoneNumber)) {
      setMessage('Enter phone in E.164 format (include country code), e.g. +17025551234');
      return;
    }

    setSending(true);
    try {
      // Call production-ready edge function to send SMS OTP
      const { data, error } = await supabase.functions.invoke('phone-verify', {
        body: { action: 'send', phone: phoneNumber }
      });
      if (error) throw error;
      if ((data as any)?.ok === false) {
        setMessage((data as any)?.error || 'Failed to send verification code');
        return;
      }
      if ((data as any)?.note) {
        setMessage(`Sent via ${data.channel}. Note: ${(data as any).note}`);
      } else {
        setMessage(`Verification code sent via ${data.channel || 'sms'} to ${phoneNumber}`);
      }
    } catch (error) {
      const msg = (error as any)?.message || 'Failed to send verification code';
      setMessage(msg);
      console.error('Phone verification error:', error);
    } finally {
      setSending(false);
    }
  };

  const sendPhoneVerificationVoice = async () => {
    if (!phoneNumber) {
      setMessage('Please enter a phone number');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('phone-verify', {
        body: { action: 'send', phone: phoneNumber, channel: 'call' }
      });
      if (error) throw error;
      if ((data as any)?.ok === false) {
        setMessage((data as any)?.error || 'Failed to send verification code via call');
        return;
      }
      setMessage(`Verification code sent via call to ${phoneNumber}`);
    } catch (error) {
      const msg = (error as any)?.message || 'Failed to send verification code via call';
      setMessage(msg);
      console.error('Phone verification error (call):', error);
    } finally {
      setSending(false);
    }
  };

  const verifyPhoneCode = async () => {
    if (!verificationCode) {
      setMessage('Please enter the verification code');
      return;
    }

    setLoading(true);
    try {
      // Call production-ready edge function to verify OTP
      const { data, error } = await supabase.functions.invoke('phone-verify', {
        body: { action: 'verify', code: verificationCode, phone: phoneNumber }
      });
      if (error) throw error;
      if ((data as any)?.ok === false) {
        setMessage((data as any)?.error || 'Phone verification failed');
        return;
      }

      setMessage('Phone verified successfully!');
      setShowPhoneForm(false);
      await loadVerificationStatus();
    } catch (error) {
      const msg = (error as any)?.message || 'Phone verification failed';
      setMessage(msg);
      console.error('Phone verification error:', error);
    } finally {
      setVerifying(false);
    }
  };

  const uploadIDDocument = async () => {
    if (!idFile) {
      setMessage('Please select an ID document');
      return;
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
    if (!allowedTypes.includes(idFile.type)) {
      setMessage('Invalid file type. Please upload JPG, PNG, or PDF files only.');
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Use secure document service for upload
      const { document, error: uploadError } = await secureDocumentService.uploadSecureDocument(
        idFile,
        documentType,
        {
          ip_address: await getUserIP(),
          user_agent: navigator.userAgent,
          verification_purpose: 'user_identity_verification'
        }
      );

      if (uploadError || !document) {
        throw new Error(uploadError || 'Upload failed');
      }

      // Update profile with secure document reference
      await supabase
        .from('profiles')
        .update({ 
          primary_id_document_id: document.id,
          id_verification_status: 'pending'
        })
        .eq('id', user.id);

      // Create verification record
      await supabase.from('user_verifications').insert({
        user_id: user.id,
        verification_type: 'id_document',
        document_type: documentType,
        document_id: document.id,
        document_metadata: {
          filename: idFile.name,
          size: idFile.size,
          type: idFile.type,
          file_hash: document.file_hash
        },
        ip_address: await getUserIP(),
        user_agent: navigator.userAgent
      });

      setMessage('ID document uploaded successfully! Pending moderator review.');
      setShowIdForm(false);
      await loadVerificationStatus();
    } catch (error) {
      setMessage('Failed to upload ID document');
      console.error('ID upload error:', error);
    } finally {
      setLoading(false);
    }
  };

  const getUserIP = async (): Promise<string> => {
    try {
      const response = await fetch('https://api.ipify.org?format=json');
      const data = await response.json();
      return data.ip;
    } catch {
      return '0.0.0.0';
    }
  };

  const getVerificationBadge = (level: string) => {
    switch (level) {
      case 'fully_verified':
        return <span className="badge badge-success">✓ Fully Verified</span>;
      case 'id_only':
        return <span className="badge badge-warning">ID Only</span>;
      case 'phone_only':
        return <span className="badge badge-warning">Phone Only</span>;
      default:
        return <span className="badge badge-secondary">Unverified</span>;
    }
  };

  const startAddCard = async () => {
    try {
      setMessage('');
      const success_url = `${window.location.origin}/profile?payment=success`;
      const cancel_url = `${window.location.origin}/profile`;
      const { data, error } = await supabase.functions.invoke('create-setup-session', {
        body: { success_url, cancel_url }
      });
      if (error) throw error;
      if ((data as any)?.ok === false) {
        setMessage((data as any)?.error || 'Failed to start payment setup');
        return;
      }
      if ((data as any)?.url) {
        window.location.href = (data as any).url as string;
        return;
      }
      setMessage('Unexpected response from payment setup');
    } catch (e: any) {
      setMessage(e?.message || 'Failed to start payment setup');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved': return 'text-green-600';
      case 'pending': return 'text-yellow-600';
      case 'rejected': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  if (!verificationStatus) {
    return <div className="p-4">Loading verification status...</div>;
  }

  return (
    <div>
      {/* Overall Status */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-body">
          <div className="vehicle-details">
            <div className="vehicle-detail">
              <span>Verification Level:</span>
              {getVerificationBadge(verificationStatus.verificationLevel)}
            </div>
            {verificationStatus.verifiedAt && (
              <div className="vehicle-detail">
                <span>Verified Date:</span>
                <span className="text-small">{new Date(verificationStatus.verifiedAt).toLocaleDateString()}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Moderator Review (founder/admin) */}
      {isModerator && pendingDocs.length > 0 && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <div className="card-body">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text font-bold">Moderator Review</h3>
              <span className="badge badge-warning">Pending: {pendingDocs.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {pendingDocs.map((d) => (
                <div key={d.id} className="vehicle-details">
                  <div className="vehicle-detail"><span>Document:</span><span className="text-small">{d.document_type}</span></div>
                  <div className="vehicle-detail"><span>Uploaded:</span><span className="text-small">{new Date(d.created_at).toLocaleString()}</span></div>
                  <div className="vehicle-detail"><span>Status:</span><span className="badge badge-warning">Pending</span></div>
                  <div className="vehicle-detail" style={{ gap: 8 }}>
                    <button className="button button-small" disabled={loading} onClick={() => approveDocument(d.id)}>Approve</button>
                    <button className="button button-small button-secondary" disabled={loading} onClick={() => rejectDocument(d.id)}>Reject</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Phone Verification Section */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-body">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h3 className="text font-bold">Phone Verification</h3>
            <span className={`badge ${verificationStatus.phoneVerified ? 'badge-success' : 'badge-secondary'}`}>
              {verificationStatus.phoneVerified ? '✓ Verified' : 'Not Verified'}
            </span>
          </div>
          
          {verificationStatus.phoneVerified ? (
            <div className="vehicle-details">
              <div className="vehicle-detail">
                <span>Verified Phone:</span>
                <span className="text-small">{verificationStatus.phoneNumber}</span>
              </div>
            </div>
          ) : (
            <div>
              {!showPhoneForm ? (
                <button
                  onClick={() => setShowPhoneForm(true)}
                  className="button button-primary"
                >
                  Verify Phone Number
                </button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <input
                    type="tel"
                    placeholder="+1XXXXXXXXXX"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="input"
                  />
                  {!isE164(phoneNumber) && phoneNumber && (
                    <div className="text-small" style={{ color: '#b91c1c' }}>
                      Include country code. Example: +17025551234
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      onClick={sendPhoneVerification}
                      disabled={sending || verifying || !isE164(phoneNumber)}
                      className="button button-primary"
                    >
                      {sending ? 'Sending…' : 'Send Verification Code'}
                    </button>
                    <button
                      onClick={sendPhoneVerificationVoice}
                      disabled={sending || verifying || !isE164(phoneNumber)}
                      className="button button-secondary"
                    >
                      Try Voice Call
                    </button>
                  </div>
                  
                  <input
                    type="text"
                    placeholder="Enter 6-digit code"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value)}
                    className="input"
                    maxLength={6}
                  />
                  <button
                    onClick={verifyPhoneCode}
                    disabled={verifying || sending || !verificationCode}
                    className="button button-success"
                  >
                    {verifying ? 'Verifying…' : 'Verify Code'}
                  </button>
                  
                  <button
                    onClick={() => setShowPhoneForm(false)}
                    className="button button-secondary"
                  >
                    Cancel
                  </button>
                  {isModerator && (
                    <button
                      onClick={adminApprovePhone}
                      disabled={loading}
                      className="button"
                    >
                      Approve Phone (Admin)
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ID Document Verification Section */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-body">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h3 className="text font-bold">ID Document Verification</h3>
            <span className={`badge ${verificationStatus.idVerified ? 'badge-success' : verificationStatus.idDocumentUrl ? 'badge-warning' : 'badge-secondary'}`}>
              {verificationStatus.idVerified ? '✓ Approved' : 
               verificationStatus.idDocumentUrl ? 'Pending Review' : 'Not Submitted'}
            </span>
          </div>
          
          {verificationStatus.idVerified ? (
            <div className="vehicle-details">
              <div className="vehicle-detail">
                <span>Document Type:</span>
                <span className="text-small">{verificationStatus.idDocumentType?.replace('_', ' ')}</span>
              </div>
              {verificationStatus.verificationNotes && (
                <div className="vehicle-detail">
                  <span>Notes:</span>
                  <span className="text-small">{verificationStatus.verificationNotes}</span>
                </div>
              )}
            </div>
          ) : verificationStatus.idDocumentUrl ? (
            <div className="vehicle-details">
              <div className="vehicle-detail">
                <span>Status:</span>
                <span className="text-small">Document submitted and pending moderator review</span>
              </div>
              <div className="vehicle-detail">
                <span>Document Type:</span>
                <span className="text-small">{verificationStatus.idDocumentType?.replace('_', ' ')}</span>
              </div>
            </div>
          ) : (
            <div>
              {!showIdForm ? (
                <button
                  onClick={() => setShowIdForm(true)}
                  className="button button-primary"
                >
                  Upload ID Document
                </button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <select
                    value={documentType}
                    onChange={(e) => setDocumentType(e.target.value)}
                    className="input"
                  >
                    <option value="drivers_license">Driver's License</option>
                    <option value="passport">Passport</option>
                    <option value="state_id">State ID</option>
                    <option value="other">Other Government ID</option>
                  </select>
                  
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => setIdFile(e.target.files?.[0] || null)}
                    className="input"
                  />
                  
                  <div className="text-small text-muted">
                    <p>• Accepted formats: JPG, PNG, PDF</p>
                    <p>• Maximum file size: 10MB</p>
                    <p>• Ensure document is clear and readable</p>
                  </div>
                  
                  <button
                    onClick={uploadIDDocument}
                    disabled={loading || !idFile}
                    className="button button-primary"
                  >
                    {loading ? 'Uploading...' : 'Upload Document'}
                  </button>
                  
                  <button
                    onClick={() => setShowIdForm(false)}
                    className="button button-secondary"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* VIN Tool Access Status */}
      <div className="card">
        <div className="card-body">
          <h3 className="text font-bold" style={{ marginBottom: '12px' }}>VIN Validation Tool Access</h3>
          {verificationStatus.verificationLevel === 'fully_verified' ? (
            <div className="vehicle-details">
              <div className="vehicle-detail">
                <span>Status:</span>
                <span className="badge badge-success">✓ Access Granted</span>
              </div>
            </div>
          ) : (
            <div className="vehicle-details">
              <div className="vehicle-detail">
                <span>Status:</span>
                <span className="badge badge-warning">Access Restricted</span>
              </div>
              <div className="vehicle-detail">
                <span>Requirement:</span>
                <span className="text-small">Complete both phone and ID verification to access VIN validation tools</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {message && (
        <div className="card" style={{ marginTop: '24px' }}>
          <div className="card-body">
            <div className={`text-small ${
              message.includes('success') || message.includes('✓') 
                ? 'text-success' 
                : 'text-danger'
            }`}>
              {message}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
