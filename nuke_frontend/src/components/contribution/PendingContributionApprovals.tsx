import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { CheckCircle, XCircle, Clock, Image as ImageIcon, Calendar, Building, User } from 'lucide-react';

interface PendingApproval {
  id: string;
  contributor_id: string;
  contributor_name: string;
  contributor_email: string;
  contributor_avatar: string | null;
  vehicle_id: string;
  year: number;
  make: string;
  model: string;
  vehicle_title: string | null;
  contribution_type: string;
  work_date: string;
  work_category: string;
  work_description: string;
  responsible_party_type: string;
  organization_name: string | null;
  image_count: number;
  created_at: string;
  auto_approve_at: string;
}

const PendingContributionApprovals: React.FC = () => {
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedImages, setSelectedImages] = useState<any[]>([]);
  const [showingImagesFor, setShowingImagesFor] = useState<string | null>(null);

  useEffect(() => {
    loadPendingApprovals();
  }, []);

  const loadPendingApprovals = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get pending approvals where this user is a responsible party
      const { data, error } = await supabase
        .from('pending_contribution_approvals')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setApprovals(data || []);
    } catch (error) {
      console.error('Error loading approvals:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadImages = async (submissionId: string) => {
    try {
      // Get the submission to get image IDs
      const { data: submission } = await supabase
        .from('contribution_submissions')
        .select('image_ids')
        .eq('id', submissionId)
        .single();

      if (!submission || !submission.image_ids) return;

      // Get the images
      const { data: images } = await supabase
        .from('vehicle_images')
        .select('*')
        .in('id', submission.image_ids);

      setSelectedImages(images || []);
      setShowingImagesFor(submissionId);
    } catch (error) {
      console.error('Error loading images:', error);
    }
  };

  const handleApprove = async (approvalId: string) => {
    if (!confirm('Approve this contribution? The images will become publicly visible.')) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from('contribution_submissions')
        .update({
          status: 'approved',
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
          review_notes: 'Approved by responsible party'
        })
        .eq('id', approvalId);

      if (error) throw error;

      alert('✅ Contribution approved!');
      loadPendingApprovals();
      setShowingImagesFor(null);
    } catch (error) {
      console.error('Error approving:', error);
      alert('Failed to approve contribution');
    }
  };

  const handleReject = async (approvalId: string) => {
    const reason = prompt('Why are you rejecting this contribution?');
    if (!reason) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from('contribution_submissions')
        .update({
          status: 'rejected',
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
          review_notes: reason
        })
        .eq('id', approvalId);

      if (error) throw error;

      alert('❌ Contribution rejected');
      loadPendingApprovals();
      setShowingImagesFor(null);
    } catch (error) {
      console.error('Error rejecting:', error);
      alert('Failed to reject contribution');
    }
  };

  const getDaysUntilAutoApprove = (autoApproveAt: string) => {
    const days = Math.ceil((new Date(autoApproveAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return days;
  };

  if (loading) {
    return (
      <div className="card">
        <div className="card-body">Loading pending approvals...</div>
      </div>
    );
  }

  if (approvals.length === 0) {
    return (
      <div className="card">
        <div className="card-header">
          <h3 style={{ margin: 0 }}>Pending Contribution Approvals</h3>
        </div>
        <div className="card-body" style={{ textAlign: 'center', padding: '40px', color: '#6B7280' }}>
          <CheckCircle size={48} style={{ margin: '0 auto 16px', opacity: 0.5 }} />
          <div>No pending approvals</div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <h3 style={{ margin: 0 }}>Pending Contribution Approvals ({approvals.length})</h3>
        <p style={{ margin: '4px 0 0', fontSize: '8pt', color: '#6B7280' }}>
          Review work contributions from technicians and contractors
        </p>
      </div>

      <div className="card-body" style={{ padding: 0 }}>
        {approvals.map((approval) => {
          const daysLeft = getDaysUntilAutoApprove(approval.auto_approve_at);
          
          return (
            <div
              key={approval.id}
              style={{
                padding: '16px',
                borderBottom: '1px solid var(--border)'
              }}
            >
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      background: approval.contributor_avatar 
                        ? `url(${approval.contributor_avatar}) center/cover` 
                        : '#E5E7EB',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#6B7280',
                      fontWeight: 700
                    }}
                  >
                    {!approval.contributor_avatar && approval.contributor_name?.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '10pt' }}>{approval.contributor_name}</div>
                    <div style={{ fontSize: '8pt', color: '#6B7280' }}>
                      {approval.year} {approval.make} {approval.model}
                    </div>
                  </div>
                </div>

                <div style={{
                  background: '#FFF3CD',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '7pt',
                  fontWeight: 700,
                  whiteSpace: 'nowrap'
                }}>
                  <Clock size={10} style={{ display: 'inline', marginRight: '4px' }} />
                  Auto-approves in {daysLeft}d
                </div>
              </div>

              {/* Work Details */}
              <div style={{ marginBottom: '12px', fontSize: '9pt' }}>
                <div style={{ display: 'flex', gap: '16px', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Calendar size={12} />
                    <span>{new Date(approval.work_date).toLocaleDateString()}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <ImageIcon size={12} />
                    <span>{approval.image_count} images</span>
                  </div>
                  {approval.organization_name && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Building size={12} />
                      <span>{approval.organization_name}</span>
                    </div>
                  )}
                </div>

                <div style={{ marginTop: '8px' }}>
                  <span style={{ 
                    background: '#E5E7EB',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontSize: '7pt',
                    fontWeight: 600,
                    textTransform: 'uppercase'
                  }}>
                    {approval.work_category}
                  </span>
                </div>

                {approval.work_description && (
                  <div style={{ marginTop: '8px', color: '#4B5563' }}>
                    {approval.work_description}
                  </div>
                )}
              </div>

              {/* Images Preview */}
              {showingImagesFor === approval.id && selectedImages.length > 0 && (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
                  gap: '8px',
                  marginBottom: '12px',
                  padding: '12px',
                  background: '#F9FAFB',
                  borderRadius: '4px'
                }}>
                  {selectedImages.map(img => (
                    <div
                      key={img.id}
                      style={{
                        aspectRatio: '1',
                        backgroundImage: `url(${img.thumbnail_url || img.image_url})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        borderRadius: '4px',
                        border: '1px solid var(--border)',
                        cursor: 'pointer'
                      }}
                      onClick={() => window.open(img.image_url, '_blank')}
                    />
                  ))}
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                {showingImagesFor !== approval.id ? (
                  <button
                    onClick={() => loadImages(approval.id)}
                    className="button button-secondary"
                    style={{ fontSize: '8pt' }}
                  >
                    <ImageIcon size={14} style={{ marginRight: '4px' }} />
                    View Images ({approval.image_count})
                  </button>
                ) : (
                  <button
                    onClick={() => setShowingImagesFor(null)}
                    className="button button-secondary"
                    style={{ fontSize: '8pt' }}
                  >
                    Hide Images
                  </button>
                )}
                
                <button
                  onClick={() => handleReject(approval.id)}
                  className="button button-secondary"
                  style={{ fontSize: '8pt', color: '#DC2626' }}
                >
                  <XCircle size={14} style={{ marginRight: '4px' }} />
                  Reject
                </button>
                
                <button
                  onClick={() => handleApprove(approval.id)}
                  className="button button-primary"
                  style={{ fontSize: '8pt' }}
                >
                  <CheckCircle size={14} style={{ marginRight: '4px' }} />
                  Approve
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Info footer */}
      <div style={{
        padding: '12px 16px',
        background: '#F9FAFB',
        borderTop: '1px solid var(--border)',
        fontSize: '7pt',
        color: '#6B7280'
      }}>
        💡 Contributions are auto-approved after 30 days if not reviewed. This gives you time to object to inaccurate submissions.
      </div>
    </div>
  );
};

export default PendingContributionApprovals;

