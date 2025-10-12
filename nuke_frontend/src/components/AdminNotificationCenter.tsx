import React, { useState, useEffect } from 'react';
import { AdminNotificationService, type AdminNotification, type AdminDashboardStats, type OwnershipVerificationDetails } from '../services/adminNotificationService';
import '../design-system.css';

interface AdminNotificationCenterProps {
  onNotificationUpdate?: () => void;
}

const AdminNotificationCenter: React.FC<AdminNotificationCenterProps> = ({ onNotificationUpdate }) => {
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [stats, setStats] = useState<AdminDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedNotification, setSelectedNotification] = useState<AdminNotification | null>(null);
  const [verificationDetails, setVerificationDetails] = useState<OwnershipVerificationDetails | null>(null);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [showRejectionModal, setShowRejectionModal] = useState(false);
  const [adminNotes, setAdminNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    loadNotifications();
    loadStats();
    
    // Subscribe to new notifications
    const subscription = AdminNotificationService.subscribeToNotifications((newNotification) => {
      setNotifications(prev => [newNotification, ...prev]);
      loadStats(); // Refresh stats when new notification arrives
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const loadNotifications = async () => {
    try {
      const data = await AdminNotificationService.getPendingNotifications();
      setNotifications(data);
    } catch (error) {
      console.error('Error loading notifications:', error);
    }
  };

  const loadStats = async () => {
    try {
      const statsData = await AdminNotificationService.getDashboardStats();
      setStats(statsData);
    } catch (error) {
      console.error('Error loading stats:', error);
      // Provide fallback stats if RPC function doesn't exist
      setStats({
        pending_ownership_verifications: 0,
        pending_vehicle_verifications: 0,
        total_pending_notifications: 0,
        high_priority_notifications: 0,
        total_verifications_today: 0,
        approved_today: 0
      });
    } finally {
      setLoading(false);
    }
  };

  const handleNotificationClick = async (notification: AdminNotification) => {
    setSelectedNotification(notification);
    
    // Mark as in review
    try {
      await AdminNotificationService.markNotificationInReview(notification.id);
      // Update local state
      setNotifications(prev => 
        prev.map(n => n.id === notification.id ? { ...n, status: 'in_review' } : n)
      );
    } catch (error) {
      console.error('Error marking notification in review:', error);
    }

    // Load verification details if it's an ownership verification
    if (notification.ownership_verification_id) {
      try {
        const details = await AdminNotificationService.getOwnershipVerificationDetails(
          notification.ownership_verification_id
        );
        setVerificationDetails(details);
      } catch (error) {
        console.error('Error loading verification details:', error);
      }
    }
  };

  const handleApprove = async () => {
    if (!selectedNotification) return;
    
    setProcessing(true);
    try {
      await AdminNotificationService.approveOwnershipVerification(
        selectedNotification.id,
        adminNotes
      );
      
      // Remove from pending notifications
      setNotifications(prev => prev.filter(n => n.id !== selectedNotification.id));
      setShowApprovalModal(false);
      setSelectedNotification(null);
      setAdminNotes('');
      loadStats();
      onNotificationUpdate?.();
    } catch (error) {
      console.error('Error approving verification:', error);
      alert('Error approving verification. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!selectedNotification || !rejectionReason.trim()) return;
    
    setProcessing(true);
    try {
      await AdminNotificationService.rejectOwnershipVerification(
        selectedNotification.id,
        rejectionReason
      );
      
      // Remove from pending notifications
      setNotifications(prev => prev.filter(n => n.id !== selectedNotification.id));
      setShowRejectionModal(false);
      setSelectedNotification(null);
      setRejectionReason('');
      loadStats();
      onNotificationUpdate?.();
    } catch (error) {
      console.error('Error rejecting verification:', error);
      alert('Error rejecting verification. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  const handleDismiss = async (notification: AdminNotification) => {
    try {
      await AdminNotificationService.dismissNotification(notification.id, 'Dismissed by admin');
      setNotifications(prev => prev.filter(n => n.id !== notification.id));
      loadStats();
      onNotificationUpdate?.();
    } catch (error) {
      console.error('Error dismissing notification:', error);
    }
  };

  const getPriorityColor = (priority: number) => {
    if (priority >= 4) return '#ff4444'; // High priority - red
    if (priority >= 3) return '#ff8800'; // Medium-high - orange
    if (priority >= 2) return '#ffaa00'; // Medium - yellow
    return '#888888'; // Low priority - gray
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading admin notifications...</p>
      </div>
    );
  }

  return (
    <div className="admin-notification-center">
      {/* Stats Overview */}
      {stats && (
        <div className="admin-stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px', marginBottom: '24px' }}>
          <div className="stat-card">
            <div className="stat-value" style={{ color: stats.pending_ownership_verifications > 0 ? '#ff4444' : '#666' }}>
              {stats.pending_ownership_verifications}
            </div>
            <div className="stat-label">Pending Ownership</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: stats.pending_vehicle_verifications > 0 ? '#ff4444' : '#666' }}>
              {stats.pending_vehicle_verifications}
            </div>
            <div className="stat-label">Pending Vehicle</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: stats.high_priority_notifications > 0 ? '#ff4444' : '#666' }}>
              {stats.high_priority_notifications}
            </div>
            <div className="stat-label">High Priority</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.approved_today}</div>
            <div className="stat-label">Approved Today</div>
          </div>
        </div>
      )}

      {/* Notifications List */}
      <div className="notifications-list">
        {notifications.length === 0 ? (
          <div className="empty-state text-center" style={{ padding: '48px 24px' }}>
            <h3>No Pending Notifications</h3>
            <p className="text-muted">All verifications are up to date!</p>
          </div>
        ) : (
          notifications.map((notification) => (
            <div 
              key={notification.id} 
              className={`notification-item ${notification.status === 'in_review' ? 'in-review' : ''}`}
              style={{
                border: '1px solid #ddd',
                borderRadius: '4px',
                padding: '16px',
                marginBottom: '12px',
                backgroundColor: notification.status === 'in_review' ? '#f8f9fa' : 'white',
                cursor: 'pointer',
                borderLeft: `4px solid ${getPriorityColor(notification.priority)}`
              }}
              onClick={() => handleNotificationClick(notification)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <h4 style={{ margin: 0, fontSize: '16px' }}>{notification.title}</h4>
                    <span 
                      className="priority-badge"
                      style={{
                        backgroundColor: getPriorityColor(notification.priority),
                        color: 'white',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '12px',
                        fontWeight: 'bold'
                      }}
                    >
                      P{notification.priority}
                    </span>
                    {notification.status === 'in_review' && (
                      <span className="badge badge-info">In Review</span>
                    )}
                  </div>
                  <p style={{ margin: '0 0 8px 0', color: '#666' }}>{notification.message}</p>
                  <div className="notification-meta" style={{ fontSize: '12px', color: '#888' }}>
                    <span>Created: {formatDate(notification.created_at)}</span>
                    {notification.metadata?.user_email && (
                      <span style={{ marginLeft: '16px' }}>User: {notification.metadata.user_email}</span>
                    )}
                    {notification.metadata?.vehicle_info && (
                      <span style={{ marginLeft: '16px' }}>Vehicle: {notification.metadata.vehicle_info}</span>
                    )}
                  </div>
                </div>
                <button
                  className="button button-small button-secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDismiss(notification);
                  }}
                  style={{ marginLeft: '12px' }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Verification Details Modal */}
      {selectedNotification && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000 }}>
          <div className="modal-content" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', backgroundColor: 'white', padding: '24px', borderRadius: '8px', maxWidth: '600px', width: '90%', maxHeight: '80vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2>Verification Review</h2>
              <button 
                className="button button-small button-secondary"
                onClick={() => {
                  setSelectedNotification(null);
                  setVerificationDetails(null);
                }}
              >
                Close
              </button>
            </div>

            <div className="verification-details">
              <h3>{selectedNotification.title}</h3>
              <p>{selectedNotification.message}</p>

              {verificationDetails && (
                <div style={{ marginTop: '20px' }}>
                  <h4>Verification Details</h4>
                  <div className="details-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                    <div>
                      <strong>User Email:</strong> {verificationDetails.user_email}
                    </div>
                    <div>
                      <strong>Vehicle:</strong> {verificationDetails.vehicle_info}
                    </div>
                    <div>
                      <strong>Submitted:</strong> {formatDate(verificationDetails.submitted_at)}
                    </div>
                    <div>
                      <strong>AI Confidence:</strong> {verificationDetails.ai_confidence_score ? `${(verificationDetails.ai_confidence_score * 100).toFixed(1)}%` : 'N/A'}
                    </div>
                    {verificationDetails.title_owner_name && (
                      <div>
                        <strong>Title Owner:</strong> {verificationDetails.title_owner_name}
                      </div>
                    )}
                    {verificationDetails.license_holder_name && (
                      <div>
                        <strong>License Holder:</strong> {verificationDetails.license_holder_name}
                      </div>
                    )}
                  </div>

                  <div className="document-links" style={{ marginBottom: '20px' }}>
                    <h4>Documents</h4>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      <button className="button button-small button-secondary">
                        View Title Document
                      </button>
                      <button className="button button-small button-secondary">
                        View Driver's License
                      </button>
                      {verificationDetails.face_scan_url && (
                        <button className="button button-small button-secondary">
                          View Face Scan
                        </button>
                      )}
                      {verificationDetails.insurance_document_url && (
                        <button className="button button-small button-secondary">
                          View Insurance
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="action-buttons" style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button 
                  className="button button-danger"
                  onClick={() => setShowRejectionModal(true)}
                >
                  Reject
                </button>
                <button 
                  className="button button-primary"
                  onClick={() => setShowApprovalModal(true)}
                >
                  Approve
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Approval Modal */}
      {showApprovalModal && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1001 }}>
          <div className="modal-content" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', backgroundColor: 'white', padding: '24px', borderRadius: '8px', maxWidth: '400px', width: '90%' }}>
            <h3>Approve Verification</h3>
            <p>Are you sure you want to approve this ownership verification?</p>
            
            <div style={{ marginBottom: '20px' }}>
              <label className="form-label">Admin Notes (Optional)</label>
              <textarea
                className="form-input"
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                placeholder="Add any notes about this approval..."
                rows={3}
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button 
                className="button button-secondary"
                onClick={() => {
                  setShowApprovalModal(false);
                  setAdminNotes('');
                }}
                disabled={processing}
              >
                Cancel
              </button>
              <button 
                className="button button-primary"
                onClick={handleApprove}
                disabled={processing}
              >
                {processing ? 'Approving...' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rejection Modal */}
      {showRejectionModal && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1001 }}>
          <div className="modal-content" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', backgroundColor: 'white', padding: '24px', borderRadius: '8px', maxWidth: '400px', width: '90%' }}>
            <h3>Reject Verification</h3>
            <p>Please provide a reason for rejecting this verification:</p>
            
            <div style={{ marginBottom: '20px' }}>
              <label className="form-label">Rejection Reason *</label>
              <textarea
                className="form-input"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Explain why this verification is being rejected..."
                rows={4}
                required
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button 
                className="button button-secondary"
                onClick={() => {
                  setShowRejectionModal(false);
                  setRejectionReason('');
                }}
                disabled={processing}
              >
                Cancel
              </button>
              <button 
                className="button button-danger"
                onClick={handleReject}
                disabled={processing || !rejectionReason.trim()}
              >
                {processing ? 'Rejecting...' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminNotificationCenter;
