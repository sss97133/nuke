import React, { useState, useEffect } from 'react';
import { 
  EyeIcon, 
  VideoCameraIcon, 
  PhoneIcon, 
  CurrencyDollarIcon,
  ClipboardDocumentCheckIcon,
  TruckIcon,
  HandRaisedIcon,
  UserGroupIcon,
  CalendarIcon,
  ClockIcon,
  StarIcon,
  ChatBubbleLeftRightIcon,
  PlayIcon,
  PauseIcon
} from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import type { 
  VehicleInteractionRequest, 
  VehicleInteractionSession, 
  CreateInteractionRequestData,
  ViewerReputation,
  InteractionRequestWithUser
} from '../../types/vehicleInteractions';

interface VehicleInteractionPanelProps {
  vehicleId: string;
  isOwner: boolean;
  currentUser: any;
  vehicle: {
    id: string;
    make: string;
    model: string;
    year: number;
    user_id: string;
  };
  onInteractionUpdate?: () => void;
}

const VehicleInteractionPanel: React.FC<VehicleInteractionPanelProps> = ({
  vehicleId,
  isOwner,
  currentUser,
  vehicle,
  onInteractionUpdate
}) => {
  const [requests, setRequests] = useState<InteractionRequestWithUser[]>([]);
  const [sessions, setSessions] = useState<VehicleInteractionSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [activeTab, setActiveTab] = useState<'interactions' | 'requests' | 'sessions'>('interactions');

  useEffect(() => {
    loadInteractionData();
  }, [vehicleId, currentUser]);

  const loadInteractionData = async () => {
    if (!currentUser) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // Load requests - owners see all requests, users see their own
      let requestsQuery = supabase
        .from('vehicle_interaction_requests')
        .select(`
          *,
          requester:requester_id (
            id,
            username,
            full_name,
            avatar_url
          )
        `)
        .eq('vehicle_id', vehicleId);

      if (!isOwner) {
        requestsQuery = requestsQuery.eq('requester_id', currentUser.id);
      }

      const { data: requestsData, error: requestsError } = await requestsQuery
        .order('created_at', { ascending: false });

      if (requestsError) {
        // Silently handle missing table - it will be created when migrations are applied
        if (requestsError.code !== 'PGRST200') {
          console.error('Error loading requests:', requestsError);
        }
        setRequests([]);
      } else {
        setRequests(requestsData || []);
      }

      // Load sessions - users involved in sessions can see them
      const { data: sessionsData, error: sessionsError } = await supabase
        .from('vehicle_interaction_sessions')
        .select(`
          *,
          host:host_id (id, username, full_name, avatar_url),
          participant:participant_id (id, username, full_name, avatar_url)
        `)
        .eq('vehicle_id', vehicleId)
        .or(`host_id.eq.${currentUser.id},participant_id.eq.${currentUser.id}`)
        .order('start_time', { ascending: false });

      if (sessionsError) {
        // Silently handle missing table - it will be created when migrations are applied
        if (sessionsError.code !== 'PGRST200') {
          console.error('Error loading sessions:', sessionsError);
        }
        setSessions([]);
      } else {
        setSessions(sessionsData || []);
      }

    } catch (error) {
      console.error('Error loading interaction data:', error);
      // Set empty arrays so the UI still shows
      setRequests([]);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  };

  const interactionTypes = [
    {
      type: 'viewing_request' as const,
      icon: EyeIcon,
      label: 'Request Viewing',
      description: 'Schedule an in-person viewing',
      color: 'blue'
    },
    {
      type: 'streaming_request' as const,
      icon: VideoCameraIcon,
      label: 'Request Live Stream',
      description: 'Ask for a live streaming session',
      color: 'red'
    },
    {
      type: 'video_call_request' as const,
      icon: PhoneIcon,
      label: 'Video Call Tour',
      description: 'Private video call walkthrough',
      color: 'green'
    },
    {
      type: 'bidding_request' as const,
      icon: CurrencyDollarIcon,
      label: 'Place Bid',
      description: 'Submit a purchase offer',
      color: 'yellow'
    },
    {
      type: 'inspection_request' as const,
      icon: ClipboardDocumentCheckIcon,
      label: 'Professional Inspection',
      description: 'Request detailed inspection',
      color: 'purple'
    },
    {
      type: 'test_drive_request' as const,
      icon: TruckIcon,
      label: 'Test Drive',
      description: 'Request to test drive',
      color: 'indigo'
    }
  ];

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

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending': return ClockIcon;
      case 'approved': return HandRaisedIcon;
      case 'scheduled': return CalendarIcon;
      case 'completed': return StarIcon;
      default: return ClockIcon;
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
          <div className="space-y-3">
            <div className="h-4 bg-gray-200 rounded"></div>
            <div className="h-4 bg-gray-200 rounded w-5/6"></div>
            <div className="h-4 bg-gray-200 rounded w-4/6"></div>
          </div>
        </div>
      </div>
    );
  }

  // Panel is now always shown

  return (
    <div>
      {!isOwner && (
        <div style={{ marginBottom: '8px' }}>
          <button
            onClick={() => setShowRequestForm(true)}
            className="button button-primary"
          >
            Make Request
          </button>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="tab-nav" style={{ marginBottom: '1rem' }}>
        {(['interactions', 'requests', 'sessions'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`tab-button ${activeTab === tab ? 'active' : ''}`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            {tab === 'requests' && requests.length > 0 && (
              <span className="badge">{requests.length}</span>
            )}
            {tab === 'sessions' && sessions.length > 0 && (
              <span className="badge">{sessions.length}</span>
            )}
          </button>
        ))}
      </div>

      <div>
        {/* Interaction Options (for non-owners) */}
        {activeTab === 'interactions' && !isOwner && (
          <div className="interaction-grid">
            {interactionTypes.map((interaction) => {
              const Icon = interaction.icon;
              return (
                <button
                  key={interaction.type}
                  onClick={() => {
                    setShowRequestForm(true);
                  }}
                  className="interaction-option"
                  title={interaction.description}
                >
                  <Icon className="interaction-icon" />
                  <div className="interaction-label">
                    {interaction.label}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Owner's Request Management */}
        {activeTab === 'requests' && isOwner && (
          <div>
            {requests.filter(r => r.status === 'pending').length === 0 ? (
              <div className="empty-state">
                <UserGroupIcon className="empty-icon" />
                <p className="text">No pending requests</p>
              </div>
            ) : (
              <div className="request-list">
                {requests.filter(r => r.status === 'pending').map((request) => (
                  <RequestCard
                    key={request.id}
                    request={request}
                    isOwner={isOwner}
                    onUpdate={loadInteractionData}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* All Requests View */}
        {activeTab === 'requests' && !isOwner && (
          <div>
            {requests.length === 0 ? (
              <div className="empty-state">
                <ChatBubbleLeftRightIcon className="empty-icon" />
                <p className="text">No requests yet</p>
                <button
                  onClick={() => setShowRequestForm(true)}
                  className="button button-secondary"
                  style={{ marginTop: '0.5rem' }}
                >
                  Make your first request
                </button>
              </div>
            ) : (
              <div className="request-list">
                {requests.map((request) => (
                  <RequestCard
                    key={request.id}
                    request={request}
                    isOwner={false}
                    onUpdate={loadInteractionData}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Sessions View */}
        {activeTab === 'sessions' && (
          <div>
            {sessions.length === 0 ? (
              <div className="empty-state">
                <VideoCameraIcon className="empty-icon" />
                <p className="text">No sessions yet</p>
              </div>
            ) : (
              <div className="session-list">
                {sessions.map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    currentUserId={currentUser.id}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Request Form Modal */}
      {showRequestForm && (
        <RequestFormModal
          vehicleId={vehicleId}
          vehicle={vehicle}
          onClose={() => setShowRequestForm(false)}
          onSubmit={loadInteractionData}
        />
      )}
    </div>
  );
};

// Request Card Component
const RequestCard: React.FC<{
  request: InteractionRequestWithUser;
  isOwner: boolean;
  onUpdate: () => void;
}> = ({ request, isOwner, onUpdate }) => {
  const StatusIcon = getStatusIcon(request.status);

  const handleStatusUpdate = async (status: 'approved' | 'declined', response?: string) => {
    try {
      const { error } = await supabase
        .from('vehicle_interaction_requests')
        .update({
          status,
          owner_response: response,
          responded_at: new Date().toISOString(),
          viewed_by_owner: true
        })
        .eq('id', request.id);

      if (!error) {
        onUpdate();
      }
    } catch (error) {
      console.error('Error updating request:', error);
    }
  };

  return (
    <div className="request-card">
      <div className="request-header">
        <div className="request-user">
          <div className="user-avatar">
            {request.requester?.avatar_url ? (
              <img
                src={request.requester.avatar_url}
                alt={request.requester.full_name || 'User'}
                className="avatar-img"
              />
            ) : (
              <div className="avatar-placeholder">
                <span className="avatar-initial">
                  {request.requester?.full_name?.[0] || 'U'}
                </span>
              </div>
            )}
          </div>
          <div>
            <div className="request-title">{request.title}</div>
            <div className="request-subtitle">
              by {request.requester?.full_name || request.requester?.username || 'Anonymous'}
            </div>
          </div>
        </div>
        <div className="status-badge">
          <StatusIcon className="status-icon" />
          {request.status}
        </div>
      </div>

      {request.message && (
        <div className="request-message">{request.message}</div>
      )}

      <div className="request-details">
        <span>Type: {request.interaction_type.replace('_', ' ')}</span>
        <span>Duration: {request.duration_minutes}min</span>
        {request.preferred_date && (
          <span>Preferred: {new Date(request.preferred_date).toLocaleDateString()}</span>
        )}
      </div>

      {isOwner && request.status === 'pending' && (
        <div className="request-actions">
          <button
            onClick={() => handleStatusUpdate('approved')}
            className="button button-success"
          >
            Approve
          </button>
          <button
            onClick={() => handleStatusUpdate('declined')}
            className="button button-danger"
          >
            Decline
          </button>
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
  const otherUser = isHost ? session.participant : session.host;

  return (
    <div className="session-card">
      <div className="session-header">
        <div className="session-info">
          <div className="session-status">
            {session.status === 'live' ? (
              <div className="status-indicator live"></div>
            ) : (
              <div className={`status-indicator ${session.status === 'completed' ? 'completed' : 'inactive'}`}></div>
            )}
          </div>
          <div>
            <div className="session-title">{session.title}</div>
            <div className="session-subtitle">
              {isHost ? 'Hosted by you' : `with ${otherUser?.full_name || 'Host'}`}
            </div>
          </div>
        </div>
        <div className="session-date">
          <div className="date">
            {new Date(session.start_time).toLocaleDateString()}
          </div>
          <div className="time">
            {new Date(session.start_time).toLocaleTimeString()}
          </div>
        </div>
      </div>

      {session.description && (
        <div className="session-description">{session.description}</div>
      )}

      <div className="session-details">
        <div className="details-left">
          <span>Type: {session.session_type.replace('_', ' ')}</span>
          {session.duration_minutes && <span>Duration: {session.duration_minutes}min</span>}
          {session.viewer_count > 0 && <span>Viewers: {session.viewer_count}</span>}
        </div>
        {session.status === 'live' && (
          <div className="live-indicator">
            <div className="live-dot"></div>
            <span>LIVE</span>
          </div>
        )}
      </div>
    </div>
  );
};

// Request Form Modal Component
const RequestFormModal: React.FC<{
  vehicleId: string;
  vehicle: any;
  onClose: () => void;
  onSubmit: () => void;
}> = ({ vehicleId, vehicle, onClose, onSubmit }) => {
  const [formData, setFormData] = useState<Partial<CreateInteractionRequestData>>({
    vehicle_id: vehicleId,
    interaction_type: 'viewing_request',
    title: '',
    message: '',
    duration_minutes: 30,
    flexible_scheduling: true
  });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const { error } = await supabase
        .from('vehicle_interaction_requests')
        .insert([{
          ...formData,
          title: formData.title || `${formData.interaction_type?.replace('_', ' ')} request for ${vehicle.year} ${vehicle.make} ${vehicle.model}`
        }]);

      if (!error) {
        onSubmit();
        onClose();
      }
    } catch (error) {
      console.error('Error creating request:', error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3 className="modal-title">Make Interaction Request</h3>
          <button onClick={onClose} className="modal-close">×</button>
        </div>
        <div className="modal-body">
          <form onSubmit={handleSubmit} className="form">
            <div className="form-group">
              <label className="label">Request Type</label>
              <select
                value={formData.interaction_type}
                onChange={(e) => setFormData({ ...formData, interaction_type: e.target.value as any })}
                className="input"
              >
                <option value="viewing_request">In-Person Viewing</option>
                <option value="streaming_request">Live Stream</option>
                <option value="video_call_request">Video Call Tour</option>
                <option value="bidding_request">Place Bid</option>
                <option value="inspection_request">Professional Inspection</option>
                <option value="test_drive_request">Test Drive</option>
              </select>
            </div>

            <div className="form-group">
              <label className="label">Title (Optional)</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="input"
                placeholder="Custom title for your request"
              />
            </div>

            <div className="form-group">
              <label className="label">Message</label>
              <textarea
                value={formData.message}
                onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                className="textarea"
                rows={3}
                placeholder="Tell the owner what you're interested in..."
              />
            </div>

            <div className="form-group">
              <label className="label">Duration (minutes)</label>
              <input
                type="number"
                value={formData.duration_minutes}
                onChange={(e) => setFormData({ ...formData, duration_minutes: parseInt(e.target.value) })}
                className="input"
                min="15"
                max="480"
              />
            </div>

            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={formData.flexible_scheduling}
                  onChange={(e) => setFormData({ ...formData, flexible_scheduling: e.target.checked })}
                  className="checkbox"
                />
                I'm flexible with scheduling
              </label>
            </div>

            <div className="form-actions">
              <button type="button" onClick={onClose} className="button">
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="button button-primary">
                {submitting ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

// Helper functions (move these outside component if used elsewhere)
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

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'pending': return ClockIcon;
    case 'approved': return HandRaisedIcon;
    case 'scheduled': return CalendarIcon;
    case 'completed': return StarIcon;
    default: return ClockIcon;
  }
};

export default VehicleInteractionPanel;
