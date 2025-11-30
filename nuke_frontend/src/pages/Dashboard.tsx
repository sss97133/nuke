import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { DashboardService, DashboardNotification, PendingWorkApproval, PendingVehicleAssignment, ConnectedProfilesSummary } from '../services/dashboardService';
import { MessageCard } from '../components/dashboard/MessageCard';
import { Sidebar } from '../components/dashboard/Sidebar';
import { CommandPalette } from '../components/dashboard/CommandPalette';
import { Terminal } from '../components/dashboard/Terminal';
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

interface TerminalLog {
  id: string;
  message: string;
  timestamp: string;
  type?: 'info' | 'success' | 'error' | 'warning';
}

export default function Dashboard() {
  const [session, setSession] = useState<any>(null);
  const [initialLoad, setInitialLoad] = useState(true);
  const [pendingCounts, setPendingCounts] = useState<PendingCounts | null>(null);
  const [notifications, setNotifications] = useState<DashboardNotification[]>([]);
  const [pendingWorkApprovals, setPendingWorkApprovals] = useState<PendingWorkApproval[]>([]);
  const [pendingVehicleAssignments, setPendingVehicleAssignments] = useState<PendingVehicleAssignment[]>([]);
  const [connectedProfiles, setConnectedProfiles] = useState<ConnectedProfilesSummary | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('actions');
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [terminalLogs, setTerminalLogs] = useState<TerminalLog[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['actions']));
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

    // Keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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
          addTerminalLog(`New notification: ${newNotification.title}`, 'info');
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(notificationChannel);
    };
  }, [session]);

  const addTerminalLog = (message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
    setTerminalLogs((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        message,
        timestamp: new Date().toISOString(),
        type
      }
    ]);
  };

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
      addTerminalLog('Dashboard ready', 'success');

      // Auto-select category with most items
      if (counts) {
        const totalActions = counts.work_approvals + counts.vehicle_assignments;
        if (totalActions > 0) {
          setSelectedCategory('actions');
        } else if (counts.unread_notifications > 0) {
          setSelectedCategory('notifications');
        }
      }

      // Load detailed data in background (lazy)
      loadDetailedData(userId);
    } catch (error: any) {
      console.error('Error loading critical data:', error);
      addTerminalLog(`Error: ${error.message}`, 'error');
      setLoadingSections(new Set());
      setInitialLoad(false);
    }
  };

  // Load detailed data after critical data is shown
  const loadDetailedData = async (userId: string) => {
    try {
      setLoadingSections(new Set(['work', 'assignments', 'profiles']));
      
      const [workApprovals, vehicleAssignments, profiles] = await Promise.all([
        DashboardService.getPendingWorkApprovals(userId).catch(() => []),
        DashboardService.getPendingVehicleAssignments(userId).catch(() => []),
        DashboardService.getConnectedProfilesSummary(userId).catch(() => null)
      ]);

      setPendingWorkApprovals(workApprovals);
      setPendingVehicleAssignments(vehicleAssignments);
      setConnectedProfiles(profiles);
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
      addTerminalLog(`Error: ${error.message}`, 'error');
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
      addTerminalLog(`Marked ${count} notifications as read`, 'success');
    } catch (error: any) {
      console.error('Error marking all as read:', error);
      addTerminalLog(`Error: ${error.message}`, 'error');
    }
  };

  const handleApproveWork = async (notificationId: string) => {
    try {
      await DashboardService.approveWorkNotification(notificationId);
      addTerminalLog('Work approved', 'success');
      setPendingWorkApprovals((prev) => prev.filter((w) => w.id !== notificationId));
      setPendingCounts((prev) =>
        prev
          ? { ...prev, work_approvals: Math.max(0, prev.work_approvals - 1) }
          : null
      );
    } catch (error: any) {
      console.error('Error approving work:', error);
      addTerminalLog(`Error: ${error.message}`, 'error');
    }
  };

  const handleRejectWork = async (notificationId: string) => {
    try {
      await DashboardService.rejectWorkNotification(notificationId);
      addTerminalLog('Work rejected', 'info');
      setPendingWorkApprovals((prev) => prev.filter((w) => w.id !== notificationId));
      setPendingCounts((prev) =>
        prev
          ? { ...prev, work_approvals: Math.max(0, prev.work_approvals - 1) }
          : null
      );
    } catch (error: any) {
      console.error('Error rejecting work:', error);
      addTerminalLog(`Error: ${error.message}`, 'error');
    }
  };

  const handleApproveAssignment = async (assignmentId: string) => {
    try {
      await DashboardService.approveVehicleAssignment(assignmentId);
      addTerminalLog('Assignment approved', 'success');
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
      addTerminalLog(`Error: ${error.message}`, 'error');
    }
  };

  const handleRejectAssignment = async (assignmentId: string) => {
    try {
      await DashboardService.rejectVehicleAssignment(assignmentId);
      addTerminalLog('Assignment rejected', 'info');
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
      console.error('Error rejecting assignment:', error);
      addTerminalLog(`Error: ${error.message}`, 'error');
    }
  };

  const getCategories = () => {
    const counts = pendingCounts || {
      work_approvals: 0,
      vehicle_assignments: 0,
      photo_reviews: 0,
      document_reviews: 0,
      user_requests: 0,
      interaction_requests: 0,
      ownership_verifications: 0,
      unread_notifications: 0
    };

    const totalActions = counts.work_approvals + counts.vehicle_assignments + counts.photo_reviews + counts.document_reviews;

    return [
      {
        id: 'actions',
        label: 'Actions',
        count: totalActions,
        icon: '>',
        expanded: expandedCategories.has('actions'),
        children: [
          {
            id: 'work_approvals',
            label: 'work',
            count: counts.work_approvals,
            icon: 'WRENCH'
          },
          {
            id: 'vehicle_assignments',
            label: 'assignments',
            count: counts.vehicle_assignments,
            icon: 'LINK'
          },
          {
            id: 'photo_reviews',
            label: 'photos',
            count: counts.photo_reviews,
            icon: 'IMAGE'
          },
          {
            id: 'document_reviews',
            label: 'documents',
            count: counts.document_reviews,
            icon: 'DOCUMENT'
          }
        ]
      },
      {
        id: 'notifications',
        label: 'Notifications',
        count: counts.unread_notifications,
        icon: 'BELL',
        expanded: false
      },
      {
        id: 'connected',
        label: 'Connected',
        count: connectedProfiles ? connectedProfiles.vehicles + connectedProfiles.organizations : 0,
        icon: 'LINK',
        expanded: expandedCategories.has('connected'),
        children: [
          {
            id: 'vehicles',
            label: 'vehicles',
            count: connectedProfiles?.vehicles || 0,
            icon: 'CAR'
          },
          {
            id: 'organizations',
            label: 'organizations',
            count: connectedProfiles?.organizations || 0,
            icon: 'ORG'
          }
        ]
      }
    ];
  };

  const getCommands = () => {
    return [
      {
        id: 'mark_all_read',
        category: 'notification',
        label: 'Mark All Notifications Read',
        handler: handleMarkAllRead
      },
      {
        id: 'view_vehicles',
        category: 'navigate',
        label: 'View All Vehicles',
        handler: () => navigate('/vehicles')
      },
      {
        id: 'view_notifications',
        category: 'navigate',
        label: 'View All Notifications',
        handler: () => navigate('/notifications')
      },
      {
        id: 'add_vehicle',
        category: 'action',
        label: 'Add Vehicle',
        handler: () => navigate('/add-vehicle')
      }
    ];
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

  const getFilteredNotifications = () => {
    if (selectedCategory === 'notifications') {
      return notifications.map(formatNotificationForCard);
    } else if (selectedCategory === 'work_approvals') {
      if (loadingSections.has('work')) {
        return [{ id: 'loading', type: 'loading', priority: 3, title: 'Loading...', message: '', is_read: false, created_at: new Date().toISOString() }];
      }
      return pendingWorkApprovals.map((wa) => ({
        id: wa.id,
        type: 'work_approval_request',
        priority: 1 as const,
        title: 'Work Approval Required',
        message: `${wa.work_type || 'Work'} detected on ${wa.vehicle_name}. Match confidence: ${wa.match_confidence}%`,
        metadata: {
          vehicle_id: wa.vehicle_id,
          vehicle_name: wa.vehicle_name,
          organization_id: wa.organization_id,
          organization_name: wa.organization_name,
          confidence: wa.match_confidence
        },
        is_read: false,
        created_at: wa.created_at,
        actions: [
          {
            id: 'approve',
            label: 'Approve',
            type: 'primary' as const,
            handler: () => handleApproveWork(wa.id)
          },
          {
            id: 'reject',
            label: 'Reject',
            type: 'danger' as const,
            handler: () => handleRejectWork(wa.id)
          },
          {
            id: 'view',
            label: 'View Details',
            type: 'link' as const,
            handler: () => navigate(`/vehicle/${wa.vehicle_id}`)
          }
        ]
      }));
    } else if (selectedCategory === 'vehicle_assignments') {
      if (loadingSections.has('assignments')) {
        return [{ id: 'loading', type: 'loading', priority: 3, title: 'Loading...', message: '', is_read: false, created_at: new Date().toISOString() }];
      }
      return pendingVehicleAssignments.map((va) => ({
        id: va.id,
        type: 'pending_vehicle_assignment',
        priority: 2 as const,
        title: 'Vehicle Assignment Suggested',
        message: `${va.vehicle_name} suggested for ${va.organization_name}. Confidence: ${va.confidence}%`,
        metadata: {
          vehicle_id: va.vehicle_id,
          vehicle_name: va.vehicle_name,
          organization_id: va.organization_id,
          organization_name: va.organization_name,
          confidence: va.confidence,
          evidence_sources: va.evidence_sources
        },
        is_read: false,
        created_at: va.created_at,
        actions: [
          {
            id: 'approve',
            label: 'Approve',
            type: 'primary' as const,
            handler: () => handleApproveAssignment(va.id)
          },
          {
            id: 'reject',
            label: 'Reject',
            type: 'danger' as const,
            handler: () => handleRejectAssignment(va.id)
          },
          {
            id: 'view',
            label: 'View Evidence',
            type: 'link' as const,
            handler: () => navigate(`/vehicle/${va.vehicle_id}`)
          }
        ]
      }));
    }
    return [];
  };

  const handleToggleExpand = (categoryId: string) => {
    setExpandedCategories((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(categoryId)) {
        newSet.delete(categoryId);
      } else {
        newSet.add(categoryId);
      }
      return newSet;
    });
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
            background: '#ffffff',
            cursor: 'pointer',
            color: '#000000'
          }}
        >
          [Log In]
        </button>
      </div>
    );
  }

  const filteredNotifications = getFilteredNotifications();
  const categories = getCategories();
  const isLoading = initialLoad || loadingSections.has('counts') || loadingSections.has('notifications');

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
        fontSize: '8pt',
        background: '#ffffff'
      }}
    >
      {/* Sidebar */}
      <Sidebar
        categories={categories}
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
        onToggleExpand={handleToggleExpand}
      />

      {/* Main Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div
          style={{
            height: '32px',
            borderBottom: '1px solid #bdbdbd',
            padding: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#ffffff'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: '#000000', fontWeight: '600' }}>Dashboard</span>
            {pendingCounts && pendingCounts.unread_notifications > 0 && (
              <span
                style={{
                  fontSize: '7pt',
                  color: '#757575',
                  background: '#f5f5f5',
                  padding: '2px 6px',
                  border: '1px solid #bdbdbd'
                }}
              >
                {pendingCounts.unread_notifications} unread
              </span>
            )}
            {isLoading && (
              <span style={{ fontSize: '7pt', color: '#757575' }}>Loading...</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={() => setShowCommandPalette(true)}
              style={{
                fontSize: '8pt',
                fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
                padding: '4px 8px',
                border: '1px solid #bdbdbd',
                background: '#ffffff',
                cursor: 'pointer',
                color: '#757575'
              }}
            >
              [⌘K]
            </button>
            {pendingCounts && pendingCounts.unread_notifications > 0 && (
              <button
                onClick={handleMarkAllRead}
                style={{
                  fontSize: '8pt',
                  fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
                  padding: '4px 8px',
                  border: '1px solid #bdbdbd',
                  background: '#ffffff',
                  cursor: 'pointer',
                  color: '#000000'
                }}
              >
                [Mark All Read]
              </button>
            )}
          </div>
        </div>

        {/* Message List */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px',
            background: '#ffffff'
          }}
        >
          {isLoading ? (
            <div
              style={{
                padding: '32px',
                textAlign: 'center',
                color: '#757575',
                fontSize: '8pt'
              }}
            >
              Loading dashboard...
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div
              style={{
                padding: '32px',
                textAlign: 'center',
                color: '#757575',
                fontSize: '8pt'
              }}
            >
              {selectedCategory === 'notifications'
                ? 'No notifications'
                : 'No pending items'}
            </div>
          ) : (
            filteredNotifications.map((notification) => (
              <MessageCard
                key={notification.id}
                {...notification}
                onMarkRead={handleMarkRead}
              />
            ))
          )}
        </div>

        {/* Terminal */}
        <Terminal logs={terminalLogs} />
      </div>

      {/* Command Palette */}
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        commands={getCommands()}
      />
    </div>
  );
}
