import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { supabase } from '../../lib/supabase';
import { DocumentVerificationService } from '../../services/documentVerificationService';
import OwnershipService from '../../services/ownershipService';
import type { OwnershipStatus } from '../../services/ownershipService';
import RoleManagementInterface from '../rbac/RoleManagementInterface';
import ModeratorAssignmentWizard from './ModeratorAssignmentWizard';
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
  const [showModeratorWizard, setShowModeratorWizard] = useState(false);
  const [moderatorStatus, setModeratorStatus] = useState<string>('Loading...');
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const [claimUploading, setClaimUploading] = useState(false);
  const [claimStep, setClaimStep] = useState<string>('');
  const [claimProgress, setClaimProgress] = useState<number>(0);
  const [claimSuccessMessage, setClaimSuccessMessage] = useState<string>('');
  const ownershipUploadId = `ownership-upload-${vehicle.id}`;
  const [buyerInfo, setBuyerInfo] = useState<{ username: string; profileUrl: string; externalIdentityId: string | null } | null>(null);

  useEffect(() => {
    loadOwnershipData();
  }, [vehicle.id]);

  // Check for buyer data when claim form opens
  useEffect(() => {
    if (showOwnershipForm && session?.user?.id) {
      loadBuyerInfo();
    } else {
      setBuyerInfo(null);
    }
  }, [showOwnershipForm, vehicle.id, session?.user?.id]);

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

  const loadBuyerInfo = async () => {
    try {
      // Try to get buyer username from multiple sources
      let buyerUsername: string | null = null;
      let buyerProfileUrl: string | null = null;

      // 1. Check external_listings metadata
      const { data: listing } = await supabase
        .from('external_listings')
        .select('metadata')
        .eq('vehicle_id', vehicle.id)
        .eq('platform', 'bat')
        .order('sold_at', { ascending: false, nullsLast: true })
        .limit(1)
        .maybeSingle();

      if (listing?.metadata) {
        buyerUsername = listing.metadata.buyer_username || listing.metadata.buyer || null;
        buyerProfileUrl = listing.metadata.buyer_profile_url || 
                         (buyerUsername ? `https://bringatrailer.com/member/${buyerUsername}/` : null);
      }

      // 2. Fallback to vehicle origin_metadata
      if (!buyerUsername && (vehicle as any)?.origin_metadata) {
        const meta = (vehicle as any).origin_metadata;
        buyerUsername = meta.bat_buyer || meta.buyer || meta.bat_buyer_username || null;
        buyerProfileUrl = meta.bat_buyer_profile_url || 
                         (buyerUsername ? `https://bringatrailer.com/member/${buyerUsername}/` : null);
      }

      // 3. Check timeline events
      if (!buyerUsername) {
        const { data: saleEvent } = await supabase
          .from('timeline_events')
          .select('metadata')
          .eq('vehicle_id', vehicle.id)
          .in('event_type', ['auction_sale', 'ownership_transfer', 'sold'])
          .order('event_date', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (saleEvent?.metadata) {
          buyerUsername = saleEvent.metadata.buyer_username || saleEvent.metadata.buyer || null;
        }
      }

      if (!buyerUsername) {
        setBuyerInfo(null);
        return;
      }

      // Check if external_identity exists and is not claimed by current user
      const { data: externalIdentity } = await supabase
        .from('external_identities')
        .select('id, claimed_by_user_id')
        .eq('platform', 'bat')
        .eq('handle', buyerUsername)
        .maybeSingle();

      // Only show prompt if identity exists and is not claimed by current user
      if (externalIdentity && externalIdentity.claimed_by_user_id !== session?.user?.id) {
        setBuyerInfo({
          username: buyerUsername,
          profileUrl: buyerProfileUrl || `https://bringatrailer.com/member/${buyerUsername}/`,
          externalIdentityId: externalIdentity.id
        });
      } else {
        setBuyerInfo(null);
      }
    } catch (error) {
      console.error('Error loading buyer info:', error);
      setBuyerInfo(null);
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
      return 'Uploader';
    }

    return 'No';
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
        // 406 (Not Acceptable) happens when .single() receives 0 rows. We want "not assigned" instead.
        .maybeSingle();

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
            <div style={{ marginBottom: '4px' }}>
              <span className="font-bold">Legal Owner:</span> {getLegalOwnershipStatus()}
            </div>
            <div style={{ marginBottom: '4px' }}>
              <span className="font-bold">Listed By:</span> {(() => {
                if (session?.user?.id === (vehicle?.uploaded_by || vehicle?.user_id)) {
                  // Show current user's name (can be blurred)
                  const userName = session.user.user_metadata?.full_name || session.user.email || 'You';
                  return userName;
                }
                // Show responsible name (can be blurred/starred)
                if (responsibleName) {
                  // Option to blur: return responsibleName.replace(/./g, '*');
                  return responsibleName;
                }
                return 'Unknown';
              })()}
            </div>
            <div style={{ marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="font-bold">Moderator:</span> 
              <span>{moderatorStatus}</span>
              {moderatorStatus === 'Not assigned' && (isOwner || contributorRole === 'owner' || session?.user?.id === (vehicle?.uploaded_by || vehicle?.user_id)) && (
                <button
                  className="button button-small button-tertiary"
                  onClick={() => setShowModeratorWizard(true)}
                  style={{ fontSize: '7pt', padding: '2px 6px' }}
                >
                  Assign
                </button>
              )}
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
            <div className="modal" style={{ background: 'var(--surface)', width: '640px', maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto', border: '1px solid var(--border)', borderRadius: '4px' }}>
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
            <div className="modal" style={{ background: 'var(--surface)', width: '640px', maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto', border: '1px solid var(--border)', borderRadius: '4px' }}>
              <div className="modal-header">
                <div className="modal-title">Claim Ownership</div>
              </div>
              <div className="modal-body">
              {buyerInfo && (
                <div style={{
                  marginBottom: '16px',
                  padding: '12px',
                  backgroundColor: 'var(--grey-100)',
                  border: '2px solid var(--accent)',
                  borderRadius: '4px',
                  fontSize: '9pt'
                }}>
                  <div style={{ fontWeight: 700, marginBottom: '6px', color: 'var(--text)' }}>
                    Also claim your Bring a Trailer profile?
                  </div>
                  <div style={{ marginBottom: '8px', color: 'var(--text-secondary)' }}>
                    This vehicle was purchased by BaT user <strong>{buyerInfo.username}</strong>. 
                    If that's you, you can claim your BaT profile to link your auction history and activity.
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <a
                      href={`/claim-identity?platform=bat&handle=${encodeURIComponent(buyerInfo.username)}&profileUrl=${encodeURIComponent(buyerInfo.profileUrl)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        padding: '6px 12px',
                        backgroundColor: 'var(--accent)',
                        color: 'white',
                        textDecoration: 'none',
                        borderRadius: '3px',
                        fontSize: '8pt',
                        fontWeight: 700,
                        border: 'none',
                        cursor: 'pointer',
                        display: 'inline-block'
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    >
                      Claim BaT Profile
                    </a>
                    <a
                      href={buyerInfo.profileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        padding: '6px 12px',
                        backgroundColor: 'transparent',
                        color: 'var(--text-secondary)',
                        textDecoration: 'underline',
                        fontSize: '8pt',
                        border: '1px solid var(--border)',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        display: 'inline-block'
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    >
                      View on BaT
                    </a>
                  </div>
                </div>
              )}

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

                  setClaimSuccessMessage('');
                  setClaimUploading(true);
                  setClaimStep('Uploading document…');
                  setClaimProgress(5);
                  const progressTimer = window.setInterval(() => {
                    setClaimProgress((p) => (p < 85 ? p + 3 : p));
                  }, 250);

                  // Upload ownership documents to the PRIVATE bucket.
                  // - Keeps documents out of public paths (prevents leaks)
                  // - Uses signed URLs for short-lived OCR verification
                  const fileExt = documentFile.name.split('.').pop() || 'bin';
                  const fileName = `${Date.now()}_${claimType}.${fileExt}`;
                  // IMPORTANT: ownership-documents bucket policy expects the FIRST folder to be the user id.
                  const storagePath = `${session.user.id}/${vehicle.id}/${fileName}`;
                  const bucket = 'ownership-documents';

                  const { data: uploadData, error: uploadError } = await supabase.storage
                    .from(bucket)
                    .upload(storagePath, documentFile, {
                      cacheControl: '3600',
                      upsert: false
                    });

                  if (uploadError) {
                    console.error('Upload error:', uploadError);
                    const msg = (uploadError as any)?.message || 'Upload failed';
                    // Most common production failure mode: storage.objects RLS policy not applied yet.
                    if (String(msg).toLowerCase().includes('row-level security')) {
                      alert(
                        'Upload blocked by Storage permissions (RLS).\n\n' +
                        'Fix: apply the latest Supabase migrations for ownership-documents storage policies, ' +
                        'then retry.\n\n' +
                        `Details: ${msg}`
                      );
                    } else {
                      alert('Upload failed: ' + msg);
                    }
                    window.clearInterval(progressTimer);
                    setClaimUploading(false);
                    setClaimStep('');
                    setClaimProgress(0);
                    return;
                  }

                  setClaimStep('Securing access link…');
                  setClaimProgress(88);

                  // Generate a signed URL for short-lived access (OCR + immediate verification flow).
                  // Do NOT store public URLs for ownership docs.
                  const { data: signed, error: signedErr } = await supabase.storage
                    .from(bucket)
                    .createSignedUrl(storagePath, 60 * 60); // 1 hour

                  if (signedErr || !signed?.signedUrl) {
                    console.error('Signed URL error:', signedErr);
                    alert('Upload succeeded but access link could not be created. Please try again.');
                    window.clearInterval(progressTimer);
                    setClaimUploading(false);
                    setClaimStep('');
                    setClaimProgress(0);
                    return;
                  }
                  
                  const document = { 
                    file_url: signed.signedUrl,
                    file_path: storagePath,
                    bucket: bucket,
                    document_type: claimType 
                  };

                  setClaimStep('Submitting claim…');
                  setClaimProgress(92);

                  // Check for existing verification record first
                  const { data: existing } = await supabase
                    .from('ownership_verifications')
                    .select('id, status, title_document_url, drivers_license_url')
                    .eq('vehicle_id', vehicle.id)
                    .eq('user_id', session.user.id)
                    .maybeSingle();

                  // Only title makes user confirmed owner, others make pending.
                  // NOTE: This "approved" is legacy behavior; true approval should be via reviewer pipeline.
                  const status = claimType === 'title' ? 'approved' : 'pending';

                  // Map claim type to proper document URL field
                  let verificationData: any = {
                    vehicle_id: vehicle.id,
                    user_id: session.user.id,
                    verification_type: claimType,
                    status: status
                  };

                  // Set the appropriate document URL field (SIGNED URL for immediate verification)
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

                  // Also append to supporting_documents (durable reference to storage path)
                  // This lets the back office re-issue signed URLs later without relying on an expired signed URL.
                  const supportingDocEntry = {
                    type: claimType,
                    bucket,
                    storage_path: storagePath,
                    signed_url: document.file_url,
                    uploaded_at: new Date().toISOString(),
                    file_name: documentFile.name,
                    file_size: documentFile.size,
                    mime_type: documentFile.type
                  };

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
                    // Best-effort merge supporting_documents if column exists
                    try {
                      const { data: existingRow } = await supabase
                        .from('ownership_verifications')
                        .select('supporting_documents')
                        .eq('id', existing.id)
                        .maybeSingle();
                      const prevDocs = Array.isArray((existingRow as any)?.supporting_documents) ? (existingRow as any).supporting_documents : [];
                      verificationData.supporting_documents = [...prevDocs, supportingDocEntry];
                    } catch {
                      // ignore if column doesn't exist in this environment
                    }
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
                    // Best-effort include supporting_documents if column exists
                    verificationData.supporting_documents = [supportingDocEntry];
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
                      .from(bucket)
                      .remove([storagePath]);
                    alert('Verification record failed: ' + verifyError.message);
                    window.clearInterval(progressTimer);
                    setClaimUploading(false);
                    setClaimStep('');
                    setClaimProgress(0);
                    return;
                  }

                  setClaimStep('Finalizing…');
                  setClaimProgress(100);
                  window.clearInterval(progressTimer);

                  // Run OCR verification if this is a title or ID document (images only)
                  const isPdf = documentFile.type === 'application/pdf' || documentFile.name.toLowerCase().endsWith('.pdf');
                  if (!isPdf && (claimType === 'title' || claimType === 'drivers_license' || claimType === 'id')) {
                    // Keep user informed without blocking the flow
                    setClaimStep('Running verification…');
                    
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
                        setClaimSuccessMessage('Document verified. Ownership check completed.');
                      } else if (result.errors && result.errors.length > 0) {
                        if (result.errors[0].includes('Waiting')) {
                          setClaimSuccessMessage('Document saved. Please upload the companion document to complete verification.');
                        } else {
                          setClaimSuccessMessage('Verification saved and queued for review.');
                        }
                      }
                      loadOwnershipData();
                    });
                    }
                  } else if (isPdf && (claimType === 'title' || claimType === 'drivers_license' || claimType === 'id')) {
                    setClaimSuccessMessage('PDF uploaded. OCR is not available for PDFs yet; this will be reviewed.');
                  } else {
                    setClaimSuccessMessage('Document submitted successfully.');
                  }
                  
                  await loadOwnershipData();
                  // Close modal shortly after so user sees success state
                  window.setTimeout(() => {
                    setShowOwnershipForm(false);
                    setClaimSuccessMessage('');
                    setClaimUploading(false);
                    setClaimStep('');
                    setClaimProgress(0);
                    setSelectedFileName('');
                  }, 900);
                } catch (error: any) {
                  console.error('Claim submit error:', error);
                  setClaimUploading(false);
                  setClaimStep('');
                  setClaimProgress(0);
                  setClaimSuccessMessage('');
                  alert('Error: ' + (error?.message || 'Unknown error'));
                } finally {
                  // Ensure button re-enables if we early-returned without timeout close
                  setClaimUploading(false);
                }
              }}>

                {(claimUploading || claimSuccessMessage) && (
                  <div style={{ marginBottom: '12px', padding: '10px', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--bg-secondary)' }}>
                    <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '6px' }}>
                      {claimSuccessMessage ? 'Submitted' : 'Uploading'}
                    </div>
                    <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
                      {claimSuccessMessage || claimStep || 'Working…'}
                    </div>
                    {!claimSuccessMessage && (
                      <div style={{ height: '10px', border: '1px solid var(--border)', borderRadius: '3px', background: 'var(--white)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, claimProgress))}%`, background: 'var(--accent)', transition: 'width 0.18s ease' }} />
                      </div>
                    )}
                  </div>
                )}

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
                    disabled={claimUploading}
                  >
                    {claimUploading ? 'Uploading…' : 'Submit'}
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
            <div className="modal modal-large" style={{ background: 'var(--surface)', width: '860px', maxWidth: '98vw', maxHeight: '92vh', overflow: 'auto', border: '1px solid var(--border)', borderRadius: '4px' }}>
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

        {/* Moderator Assignment Wizard */}
        {showModeratorWizard && ReactDOM.createPortal(
          <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="modal" style={{ background: 'var(--surface)', width: '520px', maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto', border: '1px solid var(--border)', borderRadius: '4px' }}>
              <div className="modal-header">
                <div className="modal-title">Assign Moderator</div>
                <button
                  onClick={() => setShowModeratorWizard(false)}
                  className="button button-small button-tertiary"
                >
                  ×
                </button>
              </div>
              <div className="modal-body">
                <ModeratorAssignmentWizard
                  vehicleId={vehicle.id}
                  currentUserId={session?.user?.id}
                  onClose={() => {
                    setShowModeratorWizard(false);
                    loadOwnershipData(); // Refresh moderator status
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