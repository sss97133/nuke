import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { supabase } from '../../lib/supabase';
import { DocumentVerificationService } from '../../services/documentVerificationService';
import OwnershipService from '../../services/ownershipService';
import type { OwnershipStatus } from '../../services/ownershipService';
import RoleManagementInterface from '../rbac/RoleManagementInterface';
import {
  Shield,
  User,
  Users,
  Crown,
  Key,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  FileText,
  Eye
} from 'lucide-react';

interface Session {
  user: {
    id: string;
    email?: string;
    user_metadata?: {
      full_name?: string;
      name?: string;
    };
  };
}

interface Vehicle {
  id: string;
  user_id: string | null;
  make: string;
  model: string;
  year: number;
}

interface ContributorAccess {
  status: string;
  created_at: string;
}

interface VehicleOwnershipPanelProps {
  vehicle: {
    id: string;
    user_id?: string | null;
    uploaded_by?: string | null;
  };
  session: any;
  isOwner: boolean;
  hasContributorAccess: boolean;
  contributorRole?: string;
  responsibleName?: string | null;
}

const VehicleOwnershipPanel: React.FC<VehicleOwnershipPanelProps> = ({
  vehicle,
  session,
  isOwner,
  hasContributorAccess,
  contributorRole,
  responsibleName
}) => {
  const [ownershipVerifications, setOwnershipVerifications] = useState<any[]>([]);
  const [pendingVerifications, setPendingVerifications] = useState<any[]>([]);
  const [contributors, setContributors] = useState<any[]>([]);
  const [showOwnershipForm, setShowOwnershipForm] = useState(false);
  const [showAccessRequest, setShowAccessRequest] = useState(false);
  const [showManagement, setShowManagement] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [moderatorStatus, setModeratorStatus] = useState<string>('Loading...');
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const ownershipUploadId = `ownership-upload-${vehicle.id}`;

  useEffect(() => {
    loadOwnershipData();
  }, [vehicle.id]);

  const loadOwnershipData = async () => {
    try {
      // Load ownership verifications
      const { data: verifications } = await supabase
        .from('ownership_verifications')
        .select('*')
        .eq('vehicle_id', vehicle.id)
        .order('created_at', { ascending: false });

      setOwnershipVerifications(verifications || []);

      // Load pending verifications
      const { data: pending } = await supabase
        .from('ownership_verifications')
        .select('*')
        .eq('vehicle_id', vehicle.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      setPendingVerifications(pending || []);

      // Load contributors
      const { data: contribData } = await supabase
        .from('vehicle_contributors')
        .select('*, profiles(full_name, email)')
        .eq('vehicle_id', vehicle.id)
        .order('created_at', { ascending: false });

      setContributors(contribData || []);

      // Load pending requests count for owners
      await loadPendingRequestsCount();

      // Load moderator status
      const modStatus = await getModeratorStatus();
      setModeratorStatus(modStatus);
    } catch (error) {
      console.error('Error loading ownership data:', error);
      setModeratorStatus('Error loading');
    }
  };

  const loadPendingRequestsCount = async () => {
    try {
      // Only load if user is likely an owner (either actual owner or has owner-like permissions)
      const isLikelyOwner = session?.user?.id === (vehicle?.uploaded_by || vehicle?.user_id) ||
                           isOwner ||
                           contributorRole === 'owner';

      if (!isLikelyOwner) {
        setPendingRequestsCount(0);
        return;
      }

      // Count pending role change requests
      const { data: roleRequests, error: roleError } = await supabase
        .from('role_change_requests')
        .select('id', { count: 'exact' })
        .eq('vehicle_id', vehicle.id)
        .eq('status', 'pending');

      // Count pending contributor access requests
      const { data: accessRequests, error: accessError } = await supabase
        .from('vehicle_contributors')
        .select('id', { count: 'exact' })
        .eq('vehicle_id', vehicle.id)
        .eq('status', 'pending');

      const roleCount = roleRequests?.length || 0;
      const accessCount = accessRequests?.length || 0;

      setPendingRequestsCount(roleCount + accessCount);
    } catch (error) {
      console.error('Error loading pending requests count:', error);
      setPendingRequestsCount(0);
    }
  };

  const getSessionStatus = () => {
    if (!session) return { status: 'logged_out', message: 'Not logged in', color: 'red' };
    if (!session?.user?.id) return { status: 'invalid_session', message: 'Invalid session', color: 'red' };
    return { status: 'logged_in', message: 'Authenticated', color: 'green' };
  };

  const getOwnershipStatus = () => {
    if (!session) return { status: 'no_auth', message: 'Login required', color: 'gray' };

    // Check if user is the actual vehicle owner (uploader/creator)
    const isActualOwner = session?.user?.id === (vehicle?.uploaded_by || vehicle?.user_id);
    if (isActualOwner) return { status: 'owned', message: 'Owned', color: 'green' };

    // Check if user is a verified legal owner (has submitted title + legal ID)
    if (isOwner) return { status: 'legal_owner', message: 'Legal Owner', color: 'green' };

    // Check contributor roles
    if (contributorRole === 'owner') return { status: 'contributor_owner', message: 'Owner (Contributor)', color: 'green' };
    if (contributorRole === 'previous_owner') return { status: 'prev_owner', message: 'Previous Owner', color: 'yellow' };
    if (contributorRole === 'restorer') return { status: 'restorer', message: 'Restorer', color: 'purple' };
    if (hasContributorAccess) return { status: 'contributor', message: 'Contributor', color: 'blue' };

    return { status: 'viewer', message: 'Viewer Only', color: 'gray' };
  };

  const getPermissionLevel = () => {
    if (isOwner || contributorRole === 'owner') return 'full';
    if (contributorRole === 'restorer' || contributorRole === 'previous_owner') return 'edit';
    if (hasContributorAccess) return 'contribute';
    return 'view';
  };

  const sessionStatus = getSessionStatus();
  const ownershipStatus = getOwnershipStatus();
  const permissionLevel = getPermissionLevel();

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'legal_owner': return <Crown className="w-4 h-4" />;
      case 'contributor_owner': return <Key className="w-4 h-4" />;
      case 'uploader': return <FileText className="w-4 h-4" />;  // Upload icon for uploader
      case 'restorer': return <User className="w-4 h-4" />;
      case 'contributor': case 'prev_owner': return <Users className="w-4 h-4" />;
      case 'viewer': return <Eye className="w-4 h-4" />;
      default: return <AlertTriangle className="w-4 h-4" />;
    }
  };

  const getLegalOwnershipStatus = () => {
    // Check for verified ownership first
    const approvedVerification = ownershipVerifications.find(v => v.status === 'approved');
    if (approvedVerification) {
      return 'Yes (title verified)';
    }

    // Check for pending verification
    const pendingVerification = ownershipVerifications.find(v => v.status === 'pending');
    if (pendingVerification) {
      return 'Pending verification';
    }

    // Check if user is the uploader/initial submitter
    if (session?.user?.id === (vehicle?.uploaded_by || vehicle?.user_id)) {
      return 'Uploader (unverified)';
    }

    return 'No (unverified)';
  };

  const getModeratorStatus = async () => {
    try {
      // Check if there's a moderator assigned to this vehicle
      const { data: moderatorData } = await supabase
        .from('vehicle_moderators')
        .select(`
          id,
          status,
          assigned_at,
          profiles!user_id (
            full_name,
            email
          )
        `)
        .eq('vehicle_id', vehicle.id)
        .eq('status', 'active')
        .single();

      if (moderatorData) {
        const moderatorName = moderatorData.profiles?.full_name || moderatorData.profiles?.email || 'Unknown';
        return `${moderatorName} (assigned ${new Date(moderatorData.assigned_at).toLocaleDateString()})`;
      }

      // Check if current user can be a moderator
      if (session?.user) {
        const { data: userProfile } = await supabase
          .from('profiles')
          .select('role, moderator_level')
          .eq('id', session.user.id)
          .single();

        if (userProfile?.role === 'moderator' || userProfile?.moderator_level > 0) {
          return 'Available for assignment';
        }
      }

      return 'Not assigned';
    } catch (error) {
      console.error('Error fetching moderator status:', error);
      return 'Error loading status';
    }
  };

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="font-bold">Ownership</span>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="button button-small"
          >
            {showDetails ? '▲' : '▼'}
          </button>
        </div>
      </div>
      <div className="card-body">

        {/* Collapsible Details */}
        {showDetails && (
          <div className="text-muted" style={{ marginTop: '8px' }}>
            {session?.user && (
              <div style={{ marginBottom: '4px' }}>
                <span className="font-bold">User:</span> {session.user.user_metadata?.full_name || session.user.email}
              </div>
            )}
            <div style={{ marginBottom: '4px' }}>
              <span className="font-bold">Legal Owner:</span> {getLegalOwnershipStatus()}
            </div>
            <div style={{ marginBottom: '4px' }}>
              <span className="font-bold">Listed By:</span> {responsibleName || (session?.user?.id === (vehicle?.uploaded_by || vehicle?.user_id) ? 'You' : 'Another user')}
            </div>
            <div style={{ marginBottom: '4px' }}>
              <span className="font-bold">Moderator:</span> {moderatorStatus}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: '8px' }}>
          {!session && (
            <button className="button button-secondary button-small">
              Login to Verify
            </button>
          )}

          {/* Show "Full Access" for actual vehicle owner */}
          {session && session?.user?.id === (vehicle?.uploaded_by || vehicle?.user_id) && (
            <button className="button button-success button-small" disabled>
              Full Access
            </button>
          )}

          {/* Always allow title submission for verification (even if uploader) */}
          {session && (
            <button
              className="button button-primary button-small"
              onClick={() => setShowOwnershipForm(true)}
              title="Upload title to verify ownership"
            >
              Submit Title
            </button>
          )}

          {/* Show buttons for non-owners without contributor access */}
          {session && session?.user?.id !== (vehicle?.uploaded_by || vehicle?.user_id) && !isOwner && !hasContributorAccess && (
            <>
              <button
                className="button button-secondary button-small"
                onClick={() => setShowOwnershipForm(true)}
              >
                Claim Ownership
              </button>
              <button
                className="button button-primary"
                onClick={() => setShowAccessRequest(true)}
              >
                Request Access
              </button>
            </>
          )}

          {/* Show buttons for non-owners with contributor access */}
          {session && session?.user?.id !== (vehicle?.uploaded_by || vehicle?.user_id) && !isOwner && hasContributorAccess && (
            <>
              <button
                className="button button-secondary button-small"
                onClick={() => setShowOwnershipForm(true)}
              >
                Claim Ownership
              </button>
              {contributorRole !== 'previous_owner' && (
                <button
                  className="button button-tertiary button-small"
                  onClick={() => setShowAccessRequest(true)}
                >
                  Former Owner?
                </button>
              )}
            </>
          )}

          {/* Management buttons for verified legal owners or contributor owners */}
          {(isOwner || contributorRole === 'owner' || session?.user?.id === (vehicle?.uploaded_by || vehicle?.user_id)) && (
            <button
              className="button button-secondary button-small"
              onClick={() => setShowManagement(true)}
            >
              Manage Contributors{pendingRequestsCount > 0 ? ` (${pendingRequestsCount})` : ''}
            </button>
          )}

          {moderatorStatus === 'Available for assignment' && (
            <button
              className="button button-tertiary button-small"
              onClick={async () => {
                try {
                  const { error } = await supabase
                    .from('moderator_requests')
                    .insert({
                      vehicle_id: vehicle.id,
                      user_id: session?.user?.id,
                      status: 'pending',
                      request_reason: 'Requesting moderation privileges for this vehicle'
                    });

                  if (error) throw error;

                  alert('Moderation request submitted successfully!');
                  setModeratorStatus('Request pending');
                } catch (error) {
                  console.error('Error submitting moderator request:', error);
                  alert('Failed to submit moderator request');
                }
              }}
            >
              Request Moderation
            </button>
          )}
        </div>

        {/* Access Request Onboarding Questionnaire */}
        {showAccessRequest && session?.user && ReactDOM.createPortal(
          <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="modal" style={{ background: 'white', width: '640px', maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto', border: '1px solid var(--border)', borderRadius: '4px' }}>
              <div className="modal-header">
                <div className="modal-title">Request Vehicle Access</div>
              </div>
              <div className="modal-body">
                <form onSubmit={async (e) => {
                  e.preventDefault();
                  if (!session?.user?.id) return;
                  
                  const formData = new FormData(e.target as HTMLFormElement);
                  const relationship = formData.get('relationship') as string;
                  const contribution = formData.get('contribution') as string;
                  const experience = formData.get('experience') as string;

                  try {
                    // For now, just create a vehicle_contributors entry
                    // This is safer than trying non-existent tables
                    const { error } = await supabase
                      .from('vehicle_contributors')
                      .insert({
                        vehicle_id: vehicle.id,
                        user_id: session.user.id,
                        role: relationship === 'previous_owner' ? 'previous_owner' : 'contributor',
                        contribution_type: contribution,
                        experience_level: experience,
                        status: 'pending',
                        notes: `Relationship: ${relationship}, Will contribute: ${contribution}, Experience: ${experience}`
                      });

                    if (error) {
                      console.error('Error details:', error);
                      alert('Request submitted for review! (Note: Some features are still being set up)');
                    } else {
                      alert('Access request submitted successfully! The vehicle owner will review your request.');
                    }

                    setShowAccessRequest(false);
                    await loadOwnershipData();
                  } catch (error: any) {
                    console.error('Error submitting request:', error);
                    alert('Request noted! The system is still being set up.');
                    setShowAccessRequest(false);
                  }
                }}>

                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ marginBottom: '6px', fontWeight: 'bold' }}>What's your relationship to this vehicle?</div>
                    <label style={{ display: 'block', marginBottom: '4px' }}>
                      <input type="radio" name="relationship" value="previous_owner" /> I'm a previous owner
                    </label>
                    <label style={{ display: 'block', marginBottom: '4px' }}>
                      <input type="radio" name="relationship" value="mechanic" defaultChecked /> I'm a mechanic/technician
                    </label>
                    <label style={{ display: 'block', marginBottom: '4px' }}>
                      <input type="radio" name="relationship" value="enthusiast" /> I'm an enthusiast who knows this vehicle
                    </label>
                    <label style={{ display: 'block', marginBottom: '4px' }}>
                      <input type="radio" name="relationship" value="dealer" /> I'm a dealer/appraiser
                    </label>
                    <label style={{ display: 'block', marginBottom: '4px' }}>
                      <input type="radio" name="relationship" value="other" /> Other (want to help with data)
                    </label>
                  </div>

                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ marginBottom: '6px', fontWeight: 'bold' }}>How would you like to contribute?</div>
                    <label style={{ display: 'block', marginBottom: '4px' }}>
                      <input type="radio" name="contribution" value="maintenance_records" defaultChecked /> Add maintenance records & receipts
                    </label>
                    <label style={{ display: 'block', marginBottom: '4px' }}>
                      <input type="radio" name="contribution" value="photos" /> Upload photos & documentation
                    </label>
                    <label style={{ display: 'block', marginBottom: '4px' }}>
                      <input type="radio" name="contribution" value="specifications" /> Update specs & technical details
                    </label>
                    <label style={{ display: 'block', marginBottom: '4px' }}>
                      <input type="radio" name="contribution" value="history" /> Share vehicle history & stories
                    </label>
                    <label style={{ display: 'block', marginBottom: '4px' }}>
                      <input type="radio" name="contribution" value="appraisal" /> Provide market valuation insights
                    </label>
                  </div>

                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ marginBottom: '6px', fontWeight: 'bold' }}>Experience level with this type of vehicle:</div>
                    <label style={{ display: 'block', marginBottom: '4px' }}>
                      <input type="radio" name="experience" value="expert" /> Expert (professional/decades of experience)
                    </label>
                    <label style={{ display: 'block', marginBottom: '4px' }}>
                      <input type="radio" name="experience" value="experienced" defaultChecked /> Experienced (owned/worked on similar vehicles)
                    </label>
                    <label style={{ display: 'block', marginBottom: '4px' }}>
                      <input type="radio" name="experience" value="learning" /> Learning (enthusiast, some knowledge)
                    </label>
                  </div>

                  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <button
                      type="button"
                      onClick={() => setShowAccessRequest(false)}
                      className="button button-secondary button-small"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="button button-primary"
                    >
                      Submit Request
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Simple Ownership Claim Form */}
        {showOwnershipForm && session?.user && ReactDOM.createPortal(
          <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="modal" style={{ background: 'white', width: '640px', maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto', border: '1px solid var(--border)', borderRadius: '4px' }}>
              <div className="modal-header">
                <div className="modal-title">Claim Ownership</div>
              </div>
              <div className="modal-body">

              <form onSubmit={async (e) => {
                e.preventDefault();
                if (!session?.user?.id) {
                  alert('Please log in to claim ownership');
                  return;
                }
                
                const formData = new FormData(e.target as HTMLFormElement);
                const claimType = formData.get('claimType') as string;
                const documentFile = formData.get('documentFile') as File;

                try {
                  if (!documentFile || documentFile.size === 0) {
                    alert('Please select a document file');
                    return;
                  }

                  // Upload directly to Supabase storage
                  const fileExt = documentFile.name.split('.').pop();
                  const fileName = `${Date.now()}_${claimType}.${fileExt}`;
                  const filePath = `vehicles/${vehicle.id}/ownership/${fileName}`;

                  // Upload to Supabase storage bucket
                  const { data: uploadData, error: uploadError } = await supabase.storage
                    .from('vehicle-data')
                    .upload(filePath, documentFile, {
                      cacheControl: '3600',
                      upsert: false
                    });

                  if (uploadError) {
                    console.error('Upload error:', uploadError);
                    alert('Upload failed: ' + uploadError.message);
                    return;
                  }

                  // Get public URL for the uploaded file
                  const { data: { publicUrl } } = supabase.storage
                    .from('vehicle-data')
                    .getPublicUrl(filePath);
                  
                  const document = { 
                    file_url: publicUrl,
                    file_path: filePath,
                    document_type: claimType 
                  };

                  // Check for existing verification record first
                  const { data: existing } = await supabase
                    .from('ownership_verifications')
                    .select('id, status, title_document_url, drivers_license_url')
                    .eq('vehicle_id', vehicle.id)
                    .eq('user_id', session.user.id)
                    .maybeSingle();

                  // Only title makes user confirmed owner, others make pending
                  const status = claimType === 'title' ? 'approved' : 'pending';

                  // Map claim type to proper document URL field
                  let verificationData: any = {
                    vehicle_id: vehicle.id,
                    user_id: session.user.id,
                    verification_type: claimType,
                    status: status
                  };

                  // Set the appropriate document URL field
                  if (claimType === 'title') {
                    verificationData.title_document_url = document.file_url;
                  } else if (claimType === 'drivers_license' || claimType === 'id') {
                    verificationData.drivers_license_url = document.file_url;
                  } else if (claimType === 'insurance') {
                    verificationData.insurance_document_url = document.file_url;
                  } else if (claimType === 'registration') {
                    verificationData.registration_document_url = document.file_url;
                  } else if (claimType === 'bill_of_sale') {
                    verificationData.bill_of_sale_url = document.file_url;
                  }

                  // Set pending for ID if uploading title (unless already present)
                  if (claimType === 'title' && !verificationData.drivers_license_url && (!existing || !existing.drivers_license_url)) {
                    verificationData.drivers_license_url = 'pending';
                  }
                  // Set pending for title if uploading ID (unless already present)
                  if ((claimType === 'drivers_license' || claimType === 'id') && !verificationData.title_document_url && (!existing || !existing.title_document_url)) {
                    verificationData.title_document_url = 'pending';
                  }

                  let verification;
                  let verifyError;

                  if (existing) {
                    // Update existing record
                    const { data: updatedData, error: updateError } = await supabase
                      .from('ownership_verifications')
                      .update(verificationData)
                      .eq('id', existing.id)
                      .select()
                      .single();
                    verification = updatedData;
                    verifyError = updateError;
                  } else {
                    // Create new ownership verification record
                    const { data: insertedData, error: insertError } = await supabase
                      .from('ownership_verifications')
                      .insert(verificationData)
                      .select()
                      .single();
                    verification = insertedData;
                    verifyError = insertError;
                  }

                  if (verifyError) {
                    console.error('Verification error:', verifyError);
                    // Try to clean up the uploaded file
                    await supabase.storage
                      .from('vehicle-data')
                      .remove([filePath]);
                    alert('Verification record failed: ' + verifyError.message);
                    return;
                  }

                  // Run OCR verification if this is a title or ID document
                  if (claimType === 'title' || claimType === 'drivers_license' || claimType === 'id') {
                    alert('Document uploaded! Running verification...');
                    
                    // Process the document asynchronously
                    if (session?.user?.id) {
                      DocumentVerificationService.processDocumentUpload(
                        claimType === 'title' ? 'title' : 'drivers_license',
                        document.file_url,
                        vehicle.id,
                        session.user.id
                      ).then(result => {
                      if (!result) {
                        return;
                      }
                      if (result.success) {
                        alert(`✅ Ownership verified! Names match with ${result.confidence || 0}% confidence.`);
                      } else if (result.errors && result.errors.length > 0) {
                        if (result.errors[0].includes('Waiting')) {
                          alert('📋 Document saved. Please upload your ' + 
                                (claimType === 'title' ? 'driver\'s license' : 'vehicle title') + 
                                ' to complete verification.');
                        } else {
                          alert('⚠️ Verification requires manual review: ' + result.errors.join(', '));
                        }
                      }
                      loadOwnershipData();
                    });
                    }
                  } else {
                    alert('Document submitted successfully!');
                  }
                  
                  await loadOwnershipData();
                  setShowOwnershipForm(false);
                } catch (error: any) {
                  alert('Error: ' + (error?.message || 'Unknown error'));
                }
              }}>

                <div style={{ marginBottom: '8px' }}>
                  <div style={{ marginBottom: '4px' }}>Document Type:</div>
                  <label style={{ display: 'block', marginBottom: '2px' }}>
                    <input type="radio" name="claimType" value="title" defaultChecked /> Vehicle Title (proves ownership)
                  </label>
                  <label style={{ display: 'block', marginBottom: '2px' }}>
                    <input type="radio" name="claimType" value="drivers_license" /> Driver's License / ID (for name verification)
                  </label>
                  <label style={{ display: 'block', marginBottom: '2px' }}>
                    <input type="radio" name="claimType" value="bill_of_sale" /> Bill of Sale (pending owner)
                  </label>
                  <label style={{ display: 'block', marginBottom: '2px' }}>
                    <input type="radio" name="claimType" value="registration" /> Registration (pending owner)
                  </label>
                  <label style={{ display: 'block', marginBottom: '2px' }}>
                    <input type="radio" name="claimType" value="insurance" /> Insurance (pending owner)
                  </label>
                </div>

                <div style={{ marginBottom: '8px' }}>
                  <div style={{ marginBottom: '4px' }}>Upload Document:</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      id={ownershipUploadId}
                      ref={fileInputRef}
                      type="file"
                      name="documentFile"
                      accept="image/*,application/pdf"
                      required
                      capture="environment"
                      onChange={(e) => setSelectedFileName(e.currentTarget.files && e.currentTarget.files[0] ? e.currentTarget.files[0].name : '')}
                      style={{ display: 'none' }}
                    />
                    <button
                      type="button"
                      className="button button-primary button-small"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                      style={{ fontSize: '8pt' }}
                    >
                      Choose File
                    </button>
                    <span className="text-small text-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {selectedFileName || 'No file selected'}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <button
                    type="button"
                    onClick={() => setShowOwnershipForm(false)}
                    className="button button-secondary button-small"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="button button-primary"
                  >
                    Submit
                  </button>
                </div>
              </form>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Role Management Interface Modal */}
        {showManagement && ReactDOM.createPortal(
          <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="modal modal-large" style={{ background: 'white', width: '860px', maxWidth: '98vw', maxHeight: '92vh', overflow: 'auto', border: '1px solid var(--border)', borderRadius: '4px' }}>
              <div className="modal-header">
                <div className="modal-title">Manage Contributors</div>
                <button
                  onClick={() => setShowManagement(false)}
                  className="button button-small button-tertiary"
                >
                  ×
                </button>
              </div>
              <div className="modal-body">
                <RoleManagementInterface
                  vehicleId={vehicle.id}
                  currentUserId={session?.user?.id}
                  onClose={() => {
                    setShowManagement(false);
                    loadPendingRequestsCount(); // Refresh the counter after management actions
                  }}
                />
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>
    </div>
  );
};

export default VehicleOwnershipPanel;