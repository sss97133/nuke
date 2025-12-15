import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { DashboardService } from '../services/dashboardService';
import type { DashboardNotification, PendingWorkApproval, PendingVehicleAssignment } from '../services/dashboardService';
import { MessageCard } from '../components/dashboard/MessageCard';
import '../design-system.css';

interface PendingCounts {
  work_approvals: number;
  vehicle_assignments: number;
  photo_reviews: number;
  document_reviews: number;
  user_requests: number;
  interaction_requests: number;
  ownership_verifications: number;
  unread_notifications: number;
}


export default function Dashboard() {
  const [session, setSession] = useState<any>(null);
  const [initialLoad, setInitialLoad] = useState(true);
  const [pendingCounts, setPendingCounts] = useState<PendingCounts | null>(null);
  const [notifications, setNotifications] = useState<DashboardNotification[]>([]);
  const [pendingWorkApprovals, setPendingWorkApprovals] = useState<PendingWorkApproval[]>([]);
  const [pendingVehicleAssignments, setPendingVehicleAssignments] = useState<PendingVehicleAssignment[]>([]);
  const [loadingSections, setLoadingSections] = useState<Set<string>>(new Set());
  const navigate = useNavigate();

  useEffect(() => {
    // Get session first
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        loadCriticalData(session.user.id);
      }
    });

  }, []);

  useEffect(() => {
    if (!session?.user) return;

    // Real-time subscription for notifications
    const notificationChannel = supabase
      .channel(`user_notifications_${session.user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'user_notifications',
          filter: `user_id=eq.${session.user.id}`
        },
        (payload) => {
          const newNotification = payload.new as DashboardNotification;
          setNotifications((prev) => [newNotification, ...prev]);
          setPendingCounts((prev) =>
            prev
              ? { ...prev, unread_notifications: prev.unread_notifications + 1 }
              : null
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(notificationChannel);
    };
  }, [session]);


  // Load critical data first (counts + notifications)
  const loadCriticalData = async (userId: string) => {
    try {
      setLoadingSections(new Set(['counts', 'notifications']));
      
      // Load counts and notifications in parallel (fast)
      const [counts, recentNotifs] = await Promise.all([
        DashboardService.getPendingCounts(userId).catch(() => null),
        DashboardService.getRecentNotifications(userId, 10).catch(() => [])
      ]);

      setPendingCounts(counts);
      setNotifications(recentNotifs as DashboardNotification[]);
      setLoadingSections(new Set());
      setInitialLoad(false);

      // Load detailed data in background (lazy)
      loadDetailedData(userId);
    } catch (error: any) {
      console.error('Error loading critical data:', error);
      setLoadingSections(new Set());
      setInitialLoad(false);
    }
  };

  // Load detailed data after critical data is shown
  const loadDetailedData = async (userId: string) => {
    try {
      setLoadingSections(new Set(['work', 'assignments', 'profiles']));
      
      const [workApprovals, vehicleAssignments] = await Promise.all([
        DashboardService.getPendingWorkApprovals(userId).catch(() => []),
        DashboardService.getPendingVehicleAssignments(userId).catch(() => [])
      ]);

      setPendingWorkApprovals(workApprovals);
      setPendingVehicleAssignments(vehicleAssignments);
      setLoadingSections(new Set());
    } catch (error: any) {
      console.error('Error loading detailed data:', error);
      setLoadingSections(new Set());
    }
  };

  const handleMarkRead = async (notificationId: string) => {
    if (!session?.user) return;

    try {
      await DashboardService.markNotificationRead(session.user.id, notificationId);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n))
      );
      setPendingCounts((prev) =>
        prev
          ? {
              ...prev,
              unread_notifications: Math.max(0, prev.unread_notifications - 1)
            }
          : null
      );
    } catch (error: any) {
      console.error('Error marking notification as read:', error);
    }
  };

  const handleMarkAllRead = async () => {
    if (!session?.user) return;

    try {
      const count = await DashboardService.markAllNotificationsRead(session.user.id);
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setPendingCounts((prev) =>
        prev ? { ...prev, unread_notifications: 0 } : null
      );
    } catch (error: any) {
      console.error('Error marking all as read:', error);
    }
  };

  const handleApproveWork = async (notificationId: string) => {
    try {
      await DashboardService.approveWorkNotification(notificationId);
      setPendingWorkApprovals((prev) => prev.filter((w) => w.id !== notificationId));
      setPendingCounts((prev) =>
        prev
          ? { ...prev, work_approvals: Math.max(0, prev.work_approvals - 1) }
          : null
      );
    } catch (error: any) {
      console.error('Error approving work:', error);
    }
  };

  const handleRejectWork = async (notificationId: string, notes?: string) => {
    try {
      await DashboardService.rejectWorkNotification(notificationId, notes);
      setPendingWorkApprovals((prev) => prev.filter((w) => w.id !== notificationId));
      setPendingCounts((prev) =>
        prev
          ? { ...prev, work_approvals: Math.max(0, prev.work_approvals - 1) }
          : null
      );
      setRejectionModal(null);
    } catch (error: any) {
      console.error('Error rejecting work:', error);
      alert(`Error: ${error.message}`);
    }
  };

  const handleApproveAssignment = async (assignmentId: string) => {
    try {
      await DashboardService.approveVehicleAssignment(assignmentId);
      setPendingVehicleAssignments((prev) => prev.filter((v) => v.id !== assignmentId));
      setPendingCounts((prev) =>
        prev
          ? {
              ...prev,
              vehicle_assignments: Math.max(0, prev.vehicle_assignments - 1)
            }
          : null
      );
    } catch (error: any) {
      console.error('Error approving assignment:', error);
    }
  };

  const [rejectionModal, setRejectionModal] = useState<{
    open: boolean;
    id: string | null;
    title: string;
    type: 'assignment' | 'work' | null;
  } | null>(null);

  const handleRejectAssignment = async (assignmentId: string, notes?: string) => {
    try {
      await DashboardService.rejectVehicleAssignment(assignmentId, notes);
      setPendingVehicleAssignments((prev) => prev.filter((v) => v.id !== assignmentId));
      setPendingCounts((prev) =>
        prev
          ? {
              ...prev,
              vehicle_assignments: Math.max(0, prev.vehicle_assignments - 1)
            }
          : null
      );
      setRejectionModal(null);
    } catch (error: any) {
      console.error('Error rejecting assignment:', error);
      alert(`Error: ${error.message}`);
    }
  };

  const handleRejectClick = (id: string, title: string, type: 'assignment' | 'work' = 'assignment') => {
    setRejectionModal({
      open: true,
      id,
      title,
      type
    });
  };


  const formatNotificationForCard = (notification: DashboardNotification) => {
    const metadata = notification.metadata || {};
    const vehicleName = metadata.vehicle_name || 
      (notification.vehicle_id ? 'Vehicle' : null);
    const orgName = metadata.organization_name || 
      (notification.organization_id ? 'Organization' : null);

    return {
      id: notification.id,
      type: notification.type,
      priority: notification.priority || 3,
      title: notification.title,
      message: notification.message,
      metadata: {
        ...metadata,
        vehicle_id: notification.vehicle_id,
        vehicle_name: vehicleName,
        organization_id: notification.organization_id,
        organization_name: orgName,
        action_url: metadata.action_url || metadata.link_url
      },
      is_read: notification.is_read,
      created_at: notification.created_at,
      actions: getNotificationActions(notification)
    };
  };

  const getNotificationActions = (notification: DashboardNotification) => {
    const actions: Array<{
      id: string;
      label: string;
      type: 'primary' | 'secondary' | 'danger' | 'link';
      handler: () => void;
    }> = [];

    if (notification.vehicle_id) {
      actions.push({
        id: 'view_vehicle',
        label: 'View Vehicle',
        type: 'link',
        handler: () => navigate(`/vehicle/${notification.vehicle_id}`)
      });
    }

    const metadata = notification.metadata || {};
    if (metadata.action_url) {
      actions.push({
        id: 'view',
        label: 'View',
        type: 'link',
        handler: () => navigate(metadata.action_url)
      });
    }

    return actions;
  };


  if (!session?.user) {
    return (
      <div
        style={{
          padding: '16px',
          textAlign: 'center',
          fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
          fontSize: '8pt'
        }}
      >
        <div style={{ marginBottom: '16px', color: '#424242' }}>
          Please log in to view your dashboard
        </div>
        <button
          onClick={() => navigate('/auth')}
          style={{
            fontSize: '8pt',
            fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
            padding: '8px 16px',
            border: '1px solid #bdbdbd',
            background: 'var(--surface)',
            cursor: 'pointer',
            color: '#000000'
          }}
        >
          [Log In]
        </button>
      </div>
    );
  }

  // Simplified: Just show all notifications/items in one list
  const allItems = [
    ...notifications.map(formatNotificationForCard),
    ...pendingWorkApprovals.map(wa => ({
      id: wa.id,
      type: 'work_approval_request' as const,
      priority: 1 as const,
      title: `Work Approval: ${wa.work_type || 'Work'}`,
      message: `${wa.work_type || 'Work'} detected on ${wa.vehicle_name}`,
      is_read: false,
      created_at: wa.created_at,
      actions: [
        { id: 'approve', label: 'Approve', type: 'primary' as const, handler: () => handleApproveWork(wa.id) },
        { id: 'reject', label: 'Reject', type: 'danger' as const, handler: () => handleRejectClick(wa.id, `Work Approval: ${wa.work_type || 'Work'} on ${wa.vehicle_name}`, 'work') },
        { id: 'view', label: 'View Vehicle', type: 'link' as const, handler: () => window.open(`/vehicle/${wa.vehicle_id}`, '_blank', 'noopener,noreferrer') }
      ]
    })),
    ...pendingVehicleAssignments.map(va => {
      // Format relationship type for display (e.g., 'service_provider' -> 'Service Provider')
      const relationshipDisplay = va.relationship_type
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      
      // Format evidence sources for display
      const evidenceDisplay = va.evidence_sources && va.evidence_sources.length > 0
        ? `Based on: ${va.evidence_sources.join(', ')}`
        : '';
      
      return {
        id: va.id,
        type: 'pending_vehicle_assignment' as const,
        priority: 1 as const,
        title: `Link ${va.vehicle_name} to ${va.organization_name}`,
        message: `Suggested as ${relationshipDisplay} (${Math.round(va.confidence)}% confidence)${evidenceDisplay ? `. ${evidenceDisplay}` : ''}`,
        is_read: false,
        created_at: va.created_at,
        metadata: {
          vehicle_id: va.vehicle_id,
          vehicle_name: va.vehicle_name,
          organization_name: va.organization_name
        },
        actions: [
          { id: 'approve', label: 'Approve', type: 'primary' as const, handler: () => handleApproveAssignment(va.id) },
          { id: 'reject', label: 'Reject', type: 'danger' as const, handler: () => handleRejectClick(va.id, `Link ${va.vehicle_name} to ${va.organization_name}`, 'assignment') },
          { id: 'view', label: 'View Vehicle', type: 'link' as const, handler: () => window.open(`/vehicle/${va.vehicle_id}`, '_blank') }
        ]
      };
    })
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const isLoading = initialLoad || loadingSections.has('counts') || loadingSections.has('notifications');

  // Simplified Dashboard - just show a simple list, no categories
  const totalPending = pendingCounts 
    ? pendingCounts.work_approvals + pendingCounts.vehicle_assignments + pendingCounts.unread_notifications
    : 0;

  return (
    <div
      style={{
        padding: '16px',
        fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
        fontSize: '8pt',
        background: 'var(--surface)',
        maxWidth: '800px',
        margin: '0 auto'
      }}
    >
      {/* Simple Header */}
      <div
        style={{
          marginBottom: '16px',
          paddingBottom: '8px',
          borderBottom: '1px solid #bdbdbd'
        }}
      >
        <h1 style={{ fontSize: '10pt', fontWeight: '600', margin: 0 }}>Dashboard</h1>
        {totalPending > 0 && (
          <div style={{ fontSize: '7pt', color: '#757575', marginTop: '4px' }}>
            {totalPending} item{totalPending !== 1 ? 's' : ''} need attention
          </div>
        )}
      </div>

      {/* Simple List - No Categories */}
      {isLoading ? (
        <div
          style={{
            padding: '32px',
            textAlign: 'center',
            color: '#757575',
            fontSize: '8pt'
          }}
        >
          Loading...
        </div>
      ) : allItems.length === 0 ? (
        <div
          style={{
            padding: '32px',
            textAlign: 'center',
            color: '#757575',
            fontSize: '8pt'
          }}
        >
          All caught up! No pending items.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {allItems.map((item) => (
            <MessageCard
              key={item.id}
              {...item}
              onMarkRead={handleMarkRead}
            />
          ))}
        </div>
      )}

      {/* Rejection Feedback Modal */}
      {rejectionModal && rejectionModal.open && (
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
            zIndex: 2000
          }}
          onClick={() => setRejectionModal(null)}
        >
          <div
            style={{
              background: 'var(--surface)',
              padding: '20px',
              border: '2px solid #bdbdbd',
              maxWidth: '500px',
              width: '90%',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '10pt', fontWeight: '600', marginBottom: '4px' }}>
                Rejection Reason
              </div>
              <div style={{ fontSize: '8pt', color: '#757575', marginBottom: '12px' }}>
                {rejectionModal.title}
              </div>
              <div style={{ fontSize: '8pt', color: '#757575', marginBottom: '8px' }}>
                Why are you rejecting this? (Optional)
              </div>
              <textarea
                id="rejection-notes"
                placeholder="e.g., Vehicle is in storage, not actively serviced"
                style={{
                  width: '100%',
                  minHeight: '80px',
                  padding: '8px',
                  border: '1px solid #bdbdbd',
                  fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
                  fontSize: '8pt',
                  resize: 'vertical'
                }}
                autoFocus
              />
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setRejectionModal(null)}
                style={{
                  padding: '6px 16px',
                  border: '1px solid #bdbdbd',
                  background: 'var(--surface)',
                  cursor: 'pointer',
                  fontSize: '8pt'
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const notes = (document.getElementById('rejection-notes') as HTMLTextAreaElement)?.value || undefined;
                  if (rejectionModal.id) {
                    if (rejectionModal.type === 'work') {
                      handleRejectWork(rejectionModal.id, notes);
                    } else {
                      handleRejectAssignment(rejectionModal.id, notes);
                    }
                  }
                }}
                style={{
                  padding: '6px 16px',
                  border: '1px solid #dc2626',
                  background: '#dc2626',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: '8pt',
                  fontWeight: '600'
                }}
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
