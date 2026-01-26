import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { 
  BellIcon,
  EyeIcon,
  VideoCameraIcon,
  PhoneIcon,
  CurrencyDollarIcon,
  ClipboardDocumentCheckIcon,
  TruckIcon,
  UserGroupIcon,
  CheckIcon,
  XMarkIcon,
  ClockIcon,
  CalendarIcon,
  ChatBubbleLeftRightIcon,
  StarIcon
} from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import type { VehicleInteractionService } from '../services/vehicleInteractionService';
// AppLayout now provided globally by App.tsx
import type { 
  InteractionRequestWithUser, 
  VehicleInteractionSession,
  InteractionNotification 
} from '../types/vehicleInteractions';

const VehicleInteractionManager: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'requests' | 'sessions' | 'notifications'>('requests');
  
  // Data states
  const [requests, setRequests] = useState<InteractionRequestWithUser[]>([]);
  const [sessions, setSessions] = useState<VehicleInteractionSession[]>([]);
  const [notifications, setNotifications] = useState<InteractionNotification[]>([]);
  
  // UI states
  const [selectedRequests, setSelectedRequests] = useState<string[]>([]);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [responseText, setResponseText] = useState('');

  useEffect(() => {
    checkAuth();
    
    // Check URL params for tab selection
    const tabParam = searchParams.get('tab');
    if (tabParam && ['requests', 'sessions', 'notifications'].includes(tabParam)) {
      setActiveTab(tabParam as any);
    }
  }, [searchParams]);

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user, activeTab]);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      navigate(`/login?returnUrl=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`);
      return;
    }
    setUser(session.user);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'requests') {
        await loadRequests();
      } else if (activeTab === 'sessions') {
        await loadSessions();
      } else if (activeTab === 'notifications') {
        await loadNotifications();
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadRequests = async () => {
    try {
      // Get all vehicles owned by user
      const { data: vehicles } = await supabase
        .from('vehicles')
        .select('id')
        .eq('user_id', user.id);

      if (!vehicles?.length) {
        setRequests([]);
        return;
      }

      // Get all requests for user's vehicles
      const vehicleIds = vehicles.map(v => v.id);
      const allRequests: InteractionRequestWithUser[] = [];

      for (const vehicleId of vehicleIds) {
        const vehicleRequests = await VehicleInteractionService.getRequests(vehicleId, true);
        allRequests.push(...vehicleRequests);
      }

      // Sort by creation date
      allRequests.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      
      setRequests(allRequests);
    } catch (error) {
      console.error('Error loading requests:', error);
    }
  };

  const loadSessions = async () => {
    try {
      const userSessions = await VehicleInteractionService.getSessions(undefined, user.id);
      setSessions(userSessions);
    } catch (error) {
      console.error('Error loading sessions:', error);
    }
  };

  const loadNotifications = async () => {
    try {
      const userNotifications = await VehicleInteractionService.getNotifications(50);
      setNotifications(userNotifications);
    } catch (error) {
      console.error('Error loading notifications:', error);
    }
  };

  const handleRequestResponse = async (requestId: string, status: 'approved' | 'declined', response?: string) => {
    const success = await VehicleInteractionService.updateRequest(requestId, {
      status,
      owner_response: response,
      viewed_by_owner: true
    });

    if (success) {
      await loadRequests();
      setRespondingTo(null);
      setResponseText('');
    }
  };

  const handleBulkAction = async (action: 'approve' | 'decline') => {
    for (const requestId of selectedRequests) {
      await VehicleInteractionService.updateRequest(requestId, {
        status: action === 'approve' ? 'approved' : 'declined',
        viewed_by_owner: true
      });
    }
    
    setSelectedRequests([]);
    await loadRequests();
  };

  const markNotificationRead = async (notificationId: string) => {
    await VehicleInteractionService.markNotificationRead(notificationId);
    await loadNotifications();
  };

  const getInteractionIcon = (type: string) => {
    switch (type) {
      case 'viewing_request': return EyeIcon;
      case 'streaming_request': return VideoCameraIcon;
      case 'video_call_request': return PhoneIcon;
      case 'bidding_request': return CurrencyDollarIcon;
      case 'inspection_request': return ClipboardDocumentCheckIcon;
      case 'test_drive_request': return TruckIcon;
      default: return UserGroupIcon;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'yellow';
      case 'approved': return 'green';
      case 'declined': return 'red';
      case 'scheduled': return 'blue';
      case 'completed': return 'gray';
      default: return 'gray';
    }
  };

  if (loading) {
    return (
      
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-1/3 mb-6"></div>
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-24 bg-gray-200 rounded"></div>
              ))}
            </div>
          </div>
        </div>
      
    );
  }

  return (
    
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Interaction Manager</h1>
          <p className="text-gray-600">
            Manage requests, sessions, and notifications for your vehicles
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex space-x-8">
            {[
              { key: 'requests', label: 'Requests', count: requests.filter(r => r.status === 'pending').length },
              { key: 'sessions', label: 'Sessions', count: sessions.filter(s => s.status === 'scheduled' || s.status === 'live').length },
              { key: 'notifications', label: 'Notifications', count: notifications.filter(n => !n.read_at).length }
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab.key
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className={`ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    activeTab === tab.key ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Requests Tab */}
        {activeTab === 'requests' && (
          <div>
            {/* Bulk Actions */}
            {selectedRequests.length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-blue-900">
                    {selectedRequests.length} request{selectedRequests.length !== 1 ? 's' : ''} selected
                  </span>
                  <div className="space-x-2">
                    <button
                      onClick={() => handleBulkAction('approve')}
                      className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700"
                    >
                      Approve All
                    </button>
                    <button
                      onClick={() => handleBulkAction('decline')}
                      className="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700"
                    >
                      Decline All
                    </button>
                    <button
                      onClick={() => setSelectedRequests([])}
                      className="bg-gray-600 text-white px-3 py-1 rounded text-sm hover:bg-gray-700"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Requests List */}
            <div className="space-y-4">
              {requests.length === 0 ? (
                <div className="text-center py-12">
                  <UserGroupIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No interaction requests</h3>
                  <p className="text-gray-600">Requests for your vehicles will appear here</p>
                </div>
              ) : (
                requests.map((request) => (
                  <RequestCard
                    key={request.id}
                    request={request}
                    selected={selectedRequests.includes(request.id)}
                    onSelect={(selected) => {
                      if (selected) {
                        setSelectedRequests([...selectedRequests, request.id]);
                      } else {
                        setSelectedRequests(selectedRequests.filter(id => id !== request.id));
                      }
                    }}
                    onRespond={handleRequestResponse}
                    responding={respondingTo === request.id}
                    onStartResponding={(requestId) => setRespondingTo(requestId)}
                    responseText={responseText}
                    setResponseText={setResponseText}
                    getInteractionIcon={getInteractionIcon}
                    getStatusColor={getStatusColor}
                  />
                ))
              )}
            </div>
          </div>
        )}

        {/* Sessions Tab */}
        {activeTab === 'sessions' && (
          <div className="space-y-4">
            {sessions.length === 0 ? (
              <div className="text-center py-12">
                <VideoCameraIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No sessions</h3>
                <p className="text-gray-600">Your interaction sessions will appear here</p>
              </div>
            ) : (
              sessions.map((session) => (
                <SessionCard key={session.id} session={session} currentUserId={user.id} />
              ))
            )}
          </div>
        )}

        {/* Notifications Tab */}
        {activeTab === 'notifications' && (
          <div className="space-y-4">
            {notifications.length === 0 ? (
              <div className="text-center py-12">
                <BellIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No notifications</h3>
                <p className="text-gray-600">Your notifications will appear here</p>
              </div>
            ) : (
              notifications.map((notification) => (
                <NotificationCard
                  key={notification.id}
                  notification={notification}
                  onMarkRead={markNotificationRead}
                />
              ))
            )}
          </div>
        )}
      </div>
    
  );
};

// Request Card Component
const RequestCard: React.FC<{
  request: InteractionRequestWithUser;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  onRespond: (requestId: string, status: 'approved' | 'declined', response?: string) => void;
  responding: boolean;
  onStartResponding: (requestId: string) => void;
  responseText: string;
  setResponseText: (text: string) => void;
  getInteractionIcon: (type: string) => any;
  getStatusColor: (status: string) => string;
}> = ({ 
  request, 
  selected, 
  onSelect, 
  onRespond, 
  responding, 
  onStartResponding, 
  responseText, 
  setResponseText,
  getInteractionIcon,
  getStatusColor 
}) => {
  const InteractionIcon = getInteractionIcon(request.interaction_type);
  const statusColor = getStatusColor(request.status);

  return (
    <div className={`border rounded-lg p-6 ${selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-start space-x-4">
          {request.status === 'pending' && (
            <input
              type="checkbox"
              checked={selected}
              onChange={(e) => onSelect(e.target.checked)}
              className="mt-1"
            />
          )}
          
          <div className="flex-shrink-0">
            <InteractionIcon className="h-8 w-8 text-blue-600" />
          </div>
          
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900">{request.title}</h3>
            <div className="flex items-center space-x-4 text-sm text-gray-600 mt-1">
              <span>by {request.requester?.full_name || request.requester?.username || 'Anonymous'}</span>
              <span>•</span>
              <span>{new Date(request.created_at).toLocaleDateString()}</span>
              <span>•</span>
              <span>{request.duration_minutes} minutes</span>
            </div>
          </div>
        </div>
        
        <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-${statusColor}-100 text-${statusColor}-800`}>
          {request.status}
        </div>
      </div>

      {/* Message */}
      {request.message && (
        <div className="mb-4 p-3 bg-gray-50 rounded-lg">
          <p className="text-gray-700">{request.message}</p>
        </div>
      )}

      {/* Request Details */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 text-sm">
        <div>
          <span className="font-medium text-gray-900">Type:</span>
          <div className="text-gray-600">{request.interaction_type.replace('_', ' ')}</div>
        </div>
        {request.preferred_date && (
          <div>
            <span className="font-medium text-gray-900">Preferred Date:</span>
            <div className="text-gray-600">{new Date(request.preferred_date).toLocaleDateString()}</div>
          </div>
        )}
        {request.location_preference && (
          <div>
            <span className="font-medium text-gray-900">Location:</span>
            <div className="text-gray-600">{request.location_preference.replace('_', ' ')}</div>
          </div>
        )}
        {request.budget_range && (
          <div>
            <span className="font-medium text-gray-900">Budget:</span>
            <div className="text-gray-600">
              ${request.budget_range.min} - ${request.budget_range.max}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      {request.status === 'pending' && (
        <div className="border-t pt-4">
          {responding ? (
            <div className="space-y-3">
              <textarea
                value={responseText}
                onChange={(e) => setResponseText(e.target.value)}
                placeholder="Add a response message (optional)..."
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                rows={3}
              />
              <div className="flex space-x-2">
                <button
                  onClick={() => onRespond(request.id, 'approved', responseText)}
                  className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 flex items-center space-x-2"
                >
                  <CheckIcon className="h-4 w-4" />
                  <span>Approve</span>
                </button>
                <button
                  onClick={() => onRespond(request.id, 'declined', responseText)}
                  className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 flex items-center space-x-2"
                >
                  <XMarkIcon className="h-4 w-4" />
                  <span>Decline</span>
                </button>
                <button
                  onClick={() => onStartResponding('')}
                  className="bg-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-400"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex space-x-2">
              <button
                onClick={() => onRespond(request.id, 'approved')}
                className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700"
              >
                Quick Approve
              </button>
              <button
                onClick={() => onRespond(request.id, 'declined')}
                className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700"
              >
                Quick Decline
              </button>
              <button
                onClick={() => onStartResponding(request.id)}
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
              >
                Respond with Message
              </button>
            </div>
          )}
        </div>
      )}

      {/* Owner Response */}
      {request.owner_response && (
        <div className="border-t pt-4 mt-4">
          <div className="bg-blue-50 rounded-lg p-3">
            <div className="text-sm font-medium text-blue-900 mb-1">Your Response:</div>
            <div className="text-blue-800">{request.owner_response}</div>
          </div>
        </div>
      )}
    </div>
  );
};

// Session Card Component
const SessionCard: React.FC<{
  session: VehicleInteractionSession;
  currentUserId: string;
}> = ({ session, currentUserId }) => {
  const isHost = session.host_id === currentUserId;

  return (
    <div className="border border-gray-200 rounded-lg p-6 bg-white">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className={`h-3 w-3 rounded-full ${
            session.status === 'live' ? 'bg-red-500 animate-pulse' :
            session.status === 'completed' ? 'bg-green-500' : 'bg-gray-400'
          }`}></div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{session.title}</h3>
            <p className="text-sm text-gray-600">
              {isHost ? 'You hosted this session' : 'You participated in this session'}
            </p>
          </div>
        </div>
        
        <div className="text-right">
          <div className="text-sm font-medium text-gray-900">
            {new Date(session.start_time).toLocaleDateString()}
          </div>
          <div className="text-xs text-gray-500">
            {new Date(session.start_time).toLocaleTimeString()}
          </div>
        </div>
      </div>

      {session.description && (
        <p className="text-gray-700 mb-4">{session.description}</p>
      )}

      <div className="flex items-center justify-between text-sm text-gray-600">
        <div className="flex items-center space-x-4">
          <span>Type: {session.session_type.replace('_', ' ')}</span>
          {session.duration_minutes && <span>Duration: {session.duration_minutes}min</span>}
          {session.viewer_count > 0 && <span>Viewers: {session.viewer_count}</span>}
        </div>
        
        {session.status === 'live' && (
          <div className="flex items-center space-x-1 text-red-600 font-medium">
            <div className="h-2 w-2 bg-red-500 rounded-full animate-pulse"></div>
            <span>LIVE</span>
          </div>
        )}
      </div>
    </div>
  );
};

// Notification Card Component
const NotificationCard: React.FC<{
  notification: InteractionNotification;
  onMarkRead: (id: string) => void;
}> = ({ notification, onMarkRead }) => {
  const isUnread = !notification.read_at;

  return (
    <div className={`border rounded-lg p-4 ${isUnread ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-2 mb-1">
            <h4 className={`font-medium ${isUnread ? 'text-blue-900' : 'text-gray-900'}`}>
              {notification.title}
            </h4>
            {isUnread && <div className="h-2 w-2 bg-blue-500 rounded-full"></div>}
          </div>
          <p className={`text-sm ${isUnread ? 'text-blue-800' : 'text-gray-600'}`}>
            {notification.message}
          </p>
          <div className="text-xs text-gray-500 mt-2">
            {new Date(notification.created_at).toLocaleString()}
          </div>
        </div>
        
        {isUnread && (
          <button
            onClick={() => onMarkRead(notification.id)}
            className="text-blue-600 hover:text-blue-700 text-sm font-medium"
          >
            Mark Read
          </button>
        )}
      </div>
    </div>
  );
};

export default VehicleInteractionManager;
