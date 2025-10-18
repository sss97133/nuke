import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import EnhancedTimelineEventForm from './EnhancedTimelineEventForm';

interface TimelineEvent {
  id: string;
  vehicle_id: string;
  title: string;
  description?: string;
  event_type: string;
  event_date: string;
  created_at: string;
  user_id: string;
  metadata?: any;
  mileage?: number;
  cost?: number;
  location?: string;
  images?: any[];
}

interface TimelineEventDetailsPanelProps {
  event: TimelineEvent;
  vehicleId: string;
  onEventUpdated: () => void;
  onClose: () => void;
}

const TimelineEventDetailsPanel: React.FC<TimelineEventDetailsPanelProps> = ({
  event,
  vehicleId,
  onEventUpdated,
  onClose
}) => {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userRole, setUserRole] = useState<'owner' | 'professional' | 'contributor'>('contributor');
  const [showEditForm, setShowEditForm] = useState(false);
  const [showWorkDetails, setShowWorkDetails] = useState(false);
  const [showCorrectForm, setShowCorrectForm] = useState(false);
  const [showTagPeople, setShowTagPeople] = useState(false);
  const [showTechnicianDetails, setShowTechnicianDetails] = useState(false);
  const [eventTypeEditable, setEventTypeEditable] = useState(false);
  const [newEventType, setNewEventType] = useState(event.event_type);

  useEffect(() => {
    loadCurrentUser();
  }, []);

  const loadCurrentUser = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user);

      // Determine user role based on relationship to vehicle
      if (user) {
        const { data: ownership } = await supabase
          .from('vehicle_user_permissions')
          .select('role')
          .eq('vehicle_id', vehicleId)
          .eq('user_id', user.id)
          .single();

        if (ownership?.role === 'owner') {
          setUserRole('owner');
        } else if (ownership?.role === 'professional') {
          setUserRole('professional');
        } else {
          setUserRole('contributor');
        }
      }
    } catch (error) {
      console.error('Error loading user:', error);
    }
  };

  const handleEventTypeChange = async () => {
    if (!eventTypeEditable || newEventType === event.event_type) return;

    try {
      const { error } = await supabase
        .from('vehicle_timeline_events')
        .update({ event_type: newEventType })
        .eq('id', event.id);

      if (error) throw error;

      onEventUpdated();
      setEventTypeEditable(false);

    } catch (error) {
      console.error('Error updating event type:', error);
      alert('Failed to update event type');
    }
  };

  const handleAddWorkDetails = () => {
    setShowWorkDetails(true);
  };

  const handleCorrectInformation = () => {
    setShowCorrectForm(true);
  };

  const handleTagPeople = () => {
    setShowTagPeople(true);
  };

  const handleAddTechnicianDetails = () => {
    setShowTechnicianDetails(true);
  };

  const eventTypes = [
    { value: 'maintenance', label: 'Maintenance' },
    { value: 'repair', label: 'Repair' },
    { value: 'modification', label: 'Modification' },
    { value: 'inspection', label: 'Inspection' },
    { value: 'purchase', label: 'Purchase' },
    { value: 'transport', label: 'Transport' },
    { value: 'accident', label: 'Accident' },
    { value: 'registration', label: 'Registration' },
    { value: 'insurance', label: 'Insurance' },
    { value: 'evaluation', label: 'Evaluation' },
    { value: 'general', label: 'General' },
    { value: 'custom', label: 'Custom' }
  ];

  // Get session ID from metadata or generate one
  const sessionId = event.metadata?.session_id || event.id.substring(0, 8);

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {/* Contributor Section */}
        <div>
          <h3 className="font-semibold text-gray-900 mb-2" style={{ fontSize: '9pt' }}>
            Contributor
          </h3>
          <div className="space-y-1">
            <div>
              <span className="font-medium text-gray-600">Role:</span>
              <span className="ml-2 capitalize">{userRole}</span>
            </div>
            <div>
              <span className="font-medium text-gray-600">Session ID:</span>
              <span className="ml-2 font-mono">{sessionId}</span>
            </div>
            <button
              onClick={handleAddTechnicianDetails}
              style={{
                marginTop: '4px',
                padding: '2px 6px',
                border: '1px outset rgb(189, 189, 189)',
                backgroundColor: 'rgb(245, 245, 245)',
                color: 'rgb(0, 0, 0)',
                fontSize: '8pt',
                cursor: 'pointer'
              }}
            >
              Add Technician Details
            </button>
          </div>
        </div>

        {/* Event Details Section */}
        <div>
          <h3 className="font-semibold text-gray-900 mb-2" style={{ fontSize: '9pt' }}>
            Event Details
          </h3>
          <div className="space-y-1">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="font-medium text-gray-600">Type:</span>
              {eventTypeEditable ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <select
                    value={newEventType}
                    onChange={(e) => setNewEventType(e.target.value)}
                    style={{
                      fontSize: '8pt',
                      padding: '1px 3px',
                      border: '1px solid #ccc',
                      background: 'white'
                    }}
                  >
                    {eventTypes.map(type => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleEventTypeChange}
                    style={{
                      padding: '1px 4px',
                      fontSize: '7pt',
                      border: '1px outset rgb(189, 189, 189)',
                      backgroundColor: 'rgb(240, 255, 240)',
                      cursor: 'pointer'
                    }}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setEventTypeEditable(false);
                      setNewEventType(event.event_type);
                    }}
                    style={{
                      padding: '1px 4px',
                      fontSize: '7pt',
                      border: '1px outset rgb(189, 189, 189)',
                      backgroundColor: 'rgb(255, 240, 240)',
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span className="ml-2 capitalize">{event.event_type}</span>
                  <button
                    onClick={() => setEventTypeEditable(true)}
                    style={{
                      padding: '1px 4px',
                      fontSize: '7pt',
                      border: '1px outset rgb(189, 189, 189)',
                      backgroundColor: 'rgb(245, 245, 245)',
                      cursor: 'pointer'
                    }}
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>
            {event.event_date && (
              <div>
                <span className="font-medium text-gray-600">Date:</span>
                <span className="ml-2">{new Date(event.event_date).toLocaleDateString()}</span>
              </div>
            )}
            {event.mileage && (
              <div>
                <span className="font-medium text-gray-600">Mileage:</span>
                <span className="ml-2">{event.mileage.toLocaleString()} miles</span>
              </div>
            )}
            {event.cost && (
              <div>
                <span className="font-medium text-gray-600">Cost:</span>
                <span className="ml-2">${event.cost.toFixed(2)}</span>
              </div>
            )}
            {event.location && (
              <div>
                <span className="font-medium text-gray-600">Location:</span>
                <span className="ml-2">{event.location}</span>
              </div>
            )}
          </div>
        </div>

        {/* Photo Details Section */}
        <div>
          <h3 className="font-semibold text-gray-900 mb-2" style={{ fontSize: '9pt' }}>
            Photo Details
          </h3>
          <div className="space-y-1">
            {event.images && event.images.length > 0 ? (
              <div>
                <span className="font-medium text-gray-600">Images:</span>
                <span className="ml-2">{event.images.length} photo(s) attached</span>
              </div>
            ) : (
              <div className="text-gray-500 text-xs">No photos attached to this event</div>
            )}
          </div>
        </div>

        {/* Action Buttons Section */}
        <div style={{ paddingTop: '6px', borderTop: '1px solid rgb(224, 224, 224)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <button
              onClick={handleAddWorkDetails}
              style={{
                width: '100%',
                padding: '4px 6px',
                border: '1px outset rgb(189, 189, 189)',
                backgroundColor: 'rgb(245, 245, 245)',
                color: 'rgb(0, 0, 0)',
                fontSize: '8pt',
                cursor: 'pointer'
              }}
            >
              Add Work Details
            </button>
            <button
              onClick={handleCorrectInformation}
              style={{
                width: '100%',
                padding: '4px 6px',
                border: '1px outset rgb(189, 189, 189)',
                backgroundColor: 'rgb(245, 245, 245)',
                color: 'rgb(0, 0, 0)',
                fontSize: '8pt',
                cursor: 'pointer'
              }}
            >
              Correct Information
            </button>
            <button
              onClick={handleTagPeople}
              style={{
                width: '100%',
                padding: '4px 6px',
                border: '1px outset rgb(189, 189, 189)',
                backgroundColor: 'rgb(245, 245, 245)',
                color: 'rgb(0, 0, 0)',
                fontSize: '8pt',
                cursor: 'pointer'
              }}
            >
              Tag People
            </button>
          </div>
        </div>
      </div>

      {/* Enhanced Timeline Event Form for Work Details */}
      {showWorkDetails && (
        <EnhancedTimelineEventForm
          vehicleId={vehicleId}
          currentUser={currentUser}
          userRole={userRole}
          onEventCreated={() => {
            setShowWorkDetails(false);
            onEventUpdated();
          }}
          onClose={() => setShowWorkDetails(false)}
          initialData={{
            event_type: 'purchase',
            title: 'Truck Purchase Journey',
            description: 'Complete documentation of vehicle acquisition including U-Haul rental, gas stops, route documentation, and pickup process',
            event_date: event.event_date
          }}
        />
      )}

      {/* Correction Form Modal */}
      {showCorrectForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-lg w-full max-h-[80vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold">Correct Event Information</h2>
              <button
                onClick={() => setShowCorrectForm(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <div className="p-4">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">What needs to be corrected?</label>
                  <textarea
                    className="w-full p-2 border rounded text-sm"
                    rows={4}
                    placeholder="Describe the corrections needed for this timeline event..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Suggested corrections</label>
                  <textarea
                    className="w-full p-2 border rounded text-sm"
                    rows={3}
                    placeholder="What should the correct information be?"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setShowCorrectForm(false)}
                    className="px-4 py-2 text-sm border rounded hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      // Handle correction submission
                      setShowCorrectForm(false);
                      alert('Correction submitted for review');
                    }}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    Submit Correction
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tag People Modal */}
      {showTagPeople && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-lg w-full max-h-[80vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold">Tag People in Event</h2>
              <button
                onClick={() => setShowTagPeople(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <div className="p-4">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">People involved</label>
                  <input
                    type="text"
                    className="w-full p-2 border rounded text-sm"
                    placeholder="Enter names or email addresses"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Role in event</label>
                  <select className="w-full p-2 border rounded text-sm">
                    <option value="">Select role</option>
                    <option value="owner">Owner</option>
                    <option value="technician">Technician</option>
                    <option value="passenger">Passenger</option>
                    <option value="witness">Witness</option>
                    <option value="seller">Seller</option>
                    <option value="buyer">Buyer</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setShowTagPeople(false)}
                    className="px-4 py-2 text-sm border rounded hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      // Handle tagging submission
                      setShowTagPeople(false);
                      alert('People tagged in event');
                    }}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    Tag People
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Technician Details Modal */}
      {showTechnicianDetails && (
        <EnhancedTimelineEventForm
          vehicleId={vehicleId}
          currentUser={currentUser}
          userRole="professional"
          onEventCreated={() => {
            setShowTechnicianDetails(false);
            onEventUpdated();
          }}
          onClose={() => setShowTechnicianDetails(false)}
          initialData={{
            event_type: event.event_type,
            title: event.title,
            description: event.description,
            event_date: event.event_date
          }}
        />
      )}
    </>
  );
};

export default TimelineEventDetailsPanel;