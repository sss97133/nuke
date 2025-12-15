import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface ContributorOnboardingProps {
  vehicleId: string;
  onComplete?: () => void;
}

const ROLE_TYPES = [
  { value: 'consigner', label: 'Consigner', description: 'Authorized to sell/transport vehicle' },
  { value: 'mechanic', label: 'Mechanic', description: 'Performed work on vehicle' },
  { value: 'appraiser', label: 'Appraiser', description: 'Provided valuation' },
  { value: 'photographer', label: 'Photographer', description: 'Documented vehicle' },
  { value: 'transporter', label: 'Transporter', description: 'Transported vehicle' },
  { value: 'inspector', label: 'Inspector', description: 'Inspected vehicle' },
  { value: 'dealer', label: 'Dealer', description: 'Dealer/seller' },
];

const DOCUMENT_TYPES = [
  { value: 'email_correspondence', label: 'Email Correspondence' },
  { value: 'text_correspondence', label: 'Text Messages' },
  { value: 'contract', label: 'Contract' },
  { value: 'authorization_letter', label: 'Authorization Letter' },
  { value: 'bill_of_sale', label: 'Bill of Sale' },
  { value: 'receipt', label: 'Receipt' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'transport_documents', label: 'Transport Documents' },
  { value: 'inspection_report', label: 'Inspection Report' },
];

export const ContributorOnboarding: React.FC<ContributorOnboardingProps> = ({ vehicleId, onComplete }) => {
  const [step, setStep] = useState<'role' | 'justification' | 'shop' | 'documents' | 'review'>('role');
  const [selectedRole, setSelectedRole] = useState('');
  const [justification, setJustification] = useState('');
  const [submittedBy, setSubmittedBy] = useState<'individual' | 'shop'>('individual');
  const [selectedShopId, setSelectedShopId] = useState<string | null>(null);
  const [userShops, setUserShops] = useState<any[]>([]);
  const [uploadedDocs, setUploadedDocs] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    loadUserShops();
  }, []);

  const loadUserShops = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      setUserId(user.id);

      // Load shops where user is an active member
      const { data: memberShips, error: memberError } = await supabase
        .from('shop_members')
        .select('shop_id, shops(id, name, display_name, verification_status)')
        .eq('user_id', user.id)
        .eq('status', 'active');

      if (memberError) {
        console.error('Error loading shops:', memberError);
        return;
      }

      const shops = memberShips?.map(m => (m as any).shops).filter(Boolean) || [];
      setUserShops(shops);
    } catch (error) {
      console.error('Error in loadUserShops:', error);
    }
  };

  const handleDocumentUpload = async (files: FileList, docType: string) => {
    if (!userId) {
      alert('Please log in to upload documents');
      return;
    }

    setUploading(true);
    const newDocs = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const timestamp = Date.now();
        const ext = file.name.split('.').pop();
        const fileName = `${timestamp}_${Math.random().toString(36).substring(7)}.${ext}`;
        const filePath = `vehicles/${vehicleId}/contributor-docs/${fileName}`;

        // Upload to Supabase storage
        const { error: uploadError } = await supabase.storage
          .from('vehicle-data')
          .upload(filePath, file);

        if (uploadError) {
          console.error('Upload error:', uploadError);
          throw uploadError;
        }

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
          .from('vehicle-data')
          .getPublicUrl(filePath);

        // Create document record in contributor_documentation table
        const { data: docData, error: docError } = await supabase
          .from('contributor_documentation')
          .insert({
            vehicle_id: vehicleId,
            uploaded_by: userId,
            document_type: docType,
            title: file.name,
            storage_path: filePath,
            file_url: publicUrl,
            mime_type: file.type,
            file_size: file.size,
            visibility_level: 'owner_only',
            is_verified: false
          })
          .select()
          .single();

        if (docError) {
          console.error('Document record error:', docError);
          throw docError;
        }

        newDocs.push(docData);
      }

      setUploadedDocs([...uploadedDocs, ...newDocs]);
      alert(`✅ ${files.length} document(s) uploaded successfully`);
    } catch (error) {
      console.error('Error uploading documents:', error);
      alert('Error uploading documents. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!userId) {
      alert('Please log in to submit');
      return;
    }

    if (!selectedRole || !justification.trim()) {
      alert('Please complete all required fields');
      return;
    }

    // Validate shop submission
    if (submittedBy === 'shop' && !selectedShopId) {
      alert('Please select a shop');
      return;
    }

    setSubmitting(true);

    try {
      const { data, error } = await supabase
        .from('contributor_onboarding')
        .insert({
          vehicle_id: vehicleId,
          user_id: userId,
          requested_role: selectedRole,
          role_justification: justification,
          submitted_by: submittedBy,
          shop_id: submittedBy === 'shop' ? selectedShopId : null,
          uploaded_document_ids: uploadedDocs.map(d => d.id),
          status: 'pending'
        })
        .select()
        .single();

      if (error) {
        console.error('Submission error:', error);
        throw error;
      }

      alert('✅ Contributor request submitted!\n\nYour request is under review. You\'ll be notified once it\'s processed.');
      onComplete?.();
    } catch (error: any) {
      console.error('Error submitting request:', error);
      alert(`Error submitting request: ${error.message || 'Unknown error'}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4">
      <h2 className="heading-2" style={{ marginBottom: 'var(--space-2)' }}>
        Request Contributor Role
      </h2>
      <p className="text-muted" style={{ marginBottom: 'var(--space-8)' }}>
        Submit your request to become a verified contributor for this vehicle
      </p>

      {/* Progress */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '32px' }}>
        {['role', 'justification', 'shop', 'documents', 'review'].map((s, i) => (
          <div
            key={s}
            style={{
              flex: 1,
              height: '4px',
              backgroundColor: 
                step === s ? '#3b82f6' : 
                ['role', 'justification', 'shop', 'documents', 'review'].indexOf(step) > i ? '#10b981' : '#e5e7eb',
              borderRadius: '2px'
            }}
          />
        ))}
      </div>

      {/* Step 1: Select Role */}
      {step === 'role' && (
        <div>
          <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: '600' }}>Select Your Role</h3>
          <div style={{ display: 'grid', gap: '12px', marginBottom: '24px' }}>
            {ROLE_TYPES.map(role => (
              <label
                key={role.value}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  padding: '16px',
                  border: `2px solid ${selectedRole === role.value ? '#3b82f6' : '#e5e7eb'}`,
                  borderRadius: '8px',
                  cursor: 'pointer',
                  backgroundColor: selectedRole === role.value ? '#eff6ff' : 'white'
                }}
              >
                <input
                  type="radio"
                  checked={selectedRole === role.value}
                  onChange={() => setSelectedRole(role.value)}
                  style={{ marginRight: '12px', marginTop: '2px' }}
                />
                <div>
                  <div style={{ fontWeight: '600', marginBottom: '4px' }}>{role.label}</div>
                  <div style={{ fontSize: '14px', color: '#6b7280' }}>{role.description}</div>
                </div>
              </label>
            ))}
          </div>
          <button
            onClick={() => setStep('justification')}
            disabled={!selectedRole}
            className="button button-primary"
            style={{ opacity: !selectedRole ? 0.5 : 1 }}
          >
            Continue
          </button>
        </div>
      )}

      {/* Step 2: Justification */}
      {step === 'justification' && (
        <div>
          <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: '600' }}>Explain Your Relationship</h3>
          <p style={{ marginBottom: '16px', fontSize: '14px', color: '#6b7280' }}>
            Describe your involvement with this vehicle. Include details like dates, locations, services provided, etc.
          </p>
          <textarea
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="Example: I transported this vehicle from Las Vegas (89005) to Medley, FL in March 2024. I have correspondence with the owner and transport documentation."
            style={{
              width: '100%',
              minHeight: '150px',
              padding: '12px',
              border: '1px solid #e5e7eb',
              borderRadius: '6px',
              marginBottom: '24px'
            }}
          />
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <button
              onClick={() => setStep('role')}
              className="button button-secondary"
            >
              Back
            </button>
            <button
              onClick={() => setStep('shop')}
              disabled={!justification.trim()}
              className="button button-primary"
              style={{ opacity: !justification.trim() ? 0.5 : 1 }}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Shop Selection */}
      {step === 'shop' && (
        <div>
          <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: '600' }}>Submit As</h3>
          
          <div style={{ marginBottom: '24px' }}>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              padding: '16px',
              border: `2px solid ${submittedBy === 'individual' ? '#3b82f6' : '#e5e7eb'}`,
              borderRadius: '8px',
              cursor: 'pointer',
              marginBottom: '12px',
              backgroundColor: submittedBy === 'individual' ? '#eff6ff' : 'white'
            }}>
              <input
                type="radio"
                checked={submittedBy === 'individual'}
                onChange={() => {
                  setSubmittedBy('individual');
                  setSelectedShopId(null);
                }}
                style={{ marginRight: '12px' }}
              />
              <div>
                <div style={{ fontWeight: '600' }}>Individual</div>
                <div style={{ fontSize: '14px', color: '#6b7280' }}>Submit as yourself</div>
              </div>
            </label>

            <label style={{
              display: 'flex',
              alignItems: 'center',
              padding: '16px',
              border: `2px solid ${submittedBy === 'shop' ? '#3b82f6' : '#e5e7eb'}`,
              borderRadius: '8px',
              cursor: 'pointer',
              backgroundColor: submittedBy === 'shop' ? '#eff6ff' : 'white'
            }}>
              <input
                type="radio"
                checked={submittedBy === 'shop'}
                onChange={() => setSubmittedBy('shop')}
                disabled={userShops.length === 0}
                style={{ marginRight: '12px' }}
              />
              <div>
                <div style={{ fontWeight: '600' }}>
                  Organization
                  {userShops.length === 0 && <span style={{ fontSize: '12px', color: '#6b7280', marginLeft: '8px' }}>(none available)</span>}
                </div>
                <div style={{ fontSize: '14px', color: '#6b7280' }}>Submit on behalf of your organization</div>
              </div>
            </label>
          </div>

          {submittedBy === 'shop' && userShops.length > 0 && (
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                Select Organization
              </label>
              <select
                value={selectedShopId || ''}
                onChange={(e) => setSelectedShopId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px'
                }}
              >
                <option value="">-- Select --</option>
                {userShops.map(shop => (
                  <option key={shop.id} value={shop.id}>
                    {shop.display_name || shop.name}
                    {shop.verification_status === 'verified' && ' ✓'}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={() => setStep('justification')}
              style={{
                padding: '10px 20px',
                backgroundColor: 'var(--surface)',
                color: '#374151',
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
            >
              Back
            </button>
            <button
              onClick={() => setStep('documents')}
              disabled={submittedBy === 'shop' && !selectedShopId}
              style={{
                padding: '10px 20px',
                backgroundColor: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                opacity: (submittedBy === 'shop' && !selectedShopId) ? 0.5 : 1
              }}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Upload Documents */}
      {step === 'documents' && (
        <div>
          <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: '600' }}>Upload Supporting Documents</h3>
          <p style={{ marginBottom: '16px', fontSize: '14px', color: '#6b7280' }}>
            Upload any documents that verify your role (emails, contracts, receipts, etc.)
          </p>

          <div style={{ marginBottom: '24px' }}>
            {DOCUMENT_TYPES.slice(0, 5).map(docType => (
              <div key={docType.value} style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                  {docType.label}
                </label>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  multiple
                  onChange={(e) => {
                    if (e.target.files) {
                      handleDocumentUpload(e.target.files, docType.value);
                    }
                  }}
                  disabled={uploading}
                  style={{
                    padding: '8px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    width: '100%'
                  }}
                />
              </div>
            ))}
          </div>

          {uploadedDocs.length > 0 && (
            <div style={{
              padding: '16px',
              backgroundColor: '#f0f9ff',
              border: '1px solid #bae6fd',
              borderRadius: '8px',
              marginBottom: '24px'
            }}>
              <h4 style={{ marginBottom: '8px', fontWeight: '600' }}>
                Uploaded Documents ({uploadedDocs.length})
              </h4>
              <ul style={{ paddingLeft: '20px', margin: 0 }}>
                {uploadedDocs.map(doc => (
                  <li key={doc.id} style={{ marginBottom: '4px', fontSize: '14px' }}>
                    {doc.title}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={() => setStep('shop')}
              style={{
                padding: '10px 20px',
                backgroundColor: 'var(--surface)',
                color: '#374151',
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
            >
              Back
            </button>
            <button
              onClick={() => setStep('review')}
              style={{
                padding: '10px 20px',
                backgroundColor: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
            >
              Review & Submit
            </button>
          </div>
        </div>
      )}

      {/* Step 5: Review */}
      {step === 'review' && (
        <div>
          <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: '600' }}>Review Your Request</h3>

          <div style={{ marginBottom: '16px', padding: '16px', backgroundColor: '#f9fafb', borderRadius: '6px' }}>
            <div style={{ marginBottom: '8px' }}>
              <strong>Role:</strong> {ROLE_TYPES.find(r => r.value === selectedRole)?.label}
            </div>
            <div style={{ marginBottom: '8px' }}>
              <strong>Submitted By:</strong> {submittedBy === 'individual' ? 'Individual' : userShops.find(s => s.id === selectedShopId)?.name || 'Organization'}
            </div>
            <div style={{ marginBottom: '8px' }}>
              <strong>Documents:</strong> {uploadedDocs.length}
            </div>
            <div>
              <strong>Justification:</strong>
              <div style={{ marginTop: '8px', whiteSpace: 'pre-wrap', fontSize: '14px', color: '#374151' }}>
                {justification}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <button
              onClick={() => setStep('documents')}
              className="button button-secondary"
            >
              Back
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="button button-success"
              style={{ opacity: submitting ? 0.5 : 1 }}
            >
              {submitting ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
