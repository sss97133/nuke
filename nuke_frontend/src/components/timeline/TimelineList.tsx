import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { timelineService } from '../../services/supabase/timelineService';
import type { TimelineEvent } from '../../types';
import EnhancedTimelineEventForm from '../EnhancedTimelineEventForm';

interface TimelineListProps {
  vehicleId: string;
}

const TimelineList = ({ vehicleId }: TimelineListProps) => {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddEventForm, setShowAddEventForm] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);

  useEffect(() => {
    const fetchTimelineEvents = async () => {
      try {
        setLoading(true);
        const data = await timelineService.getByVehicleId(vehicleId);
        setEvents(data || []);
      } catch (err) {
        console.error('Error fetching timeline events:', err);
        setError('Failed to load timeline events. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    const fetchUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        setCurrentUser(user);
      } catch (error) {
        console.error('Error loading user:', error);
      }
    };

    fetchTimelineEvents();
    fetchUser();
  }, [vehicleId]);

  if (loading) {
    return <div className="text-center p-8">Loading timeline events...</div>;
  }

  if (error) {
    return <div className="text-center p-8 text-red-500">{error}</div>;
  }

  if (events.length === 0) {
    return (
      <div className="text-center p-8 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <p className="mb-4 text-gray-700 dark:text-gray-300">No timeline events found for this vehicle.</p>
        <button
          onClick={() => setShowAddEventForm(true)}
          className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
        >
          Add First Event
        </button>

        {/* Add Event Modal */}
        {showAddEventForm && currentUser && (
          <EnhancedTimelineEventForm
            vehicleId={vehicleId}
            currentUser={currentUser}
            userRole="owner"
            onEventCreated={() => {
              setShowAddEventForm(false);
              // Refresh events
              const fetchTimelineEvents = async () => {
                try {
                  const data = await timelineService.getByVehicleId(vehicleId);
                  setEvents(data || []);
                } catch (err) {
                  console.error('Error fetching timeline events:', err);
                }
              };
              fetchTimelineEvents();
            }}
            onClose={() => setShowAddEventForm(false)}
          />
        )}
      </div>
    );
  }

  // Group events by year for better visual organization
  const groupedEvents: Record<string, TimelineEvent[]> = {};
  events.forEach(event => {
    const year = new Date(event.event_date).getFullYear().toString();
    if (!groupedEvents[year]) {
      groupedEvents[year] = [];
    }
    groupedEvents[year].push(event);
  });

  // Sort years in descending order (most recent first)
  const sortedYears = Object.keys(groupedEvents).sort((a, b) => parseInt(b) - parseInt(a));

  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-6">
      {/* Add Event Button - Always visible */}
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white">Timeline Events</h3>
        <button
          onClick={() => setShowAddEventForm(true)}
          className="bg-blue-500 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md text-sm transition-colors"
        >
          Add Event
        </button>
      </div>

      <div className="relative">
        {/* Vertical timeline line */}
        <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-gray-300 dark:bg-gray-600"></div>
        
        {sortedYears.map(year => (
          <div key={year} className="mb-8">
            <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">{year}</h3>
            
            {groupedEvents[year].map(event => (
              <div key={event.id} className="relative mb-6 ml-10">
                {/* Timeline dot */}
                <div className="absolute -left-10 mt-1.5">
                  <div className={`w-4 h-4 rounded-full border-2 ${
                    event.verified 
                      ? 'bg-blue-500 border-blue-600' 
                      : getEventTypeColor(event.event_type)
                  }`}></div>
                </div>
                
                {/* Event card */}
                <div className="bg-white dark:bg-gray-700 rounded-lg shadow-md p-4 hover:shadow-lg transition-shadow">
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="text-lg font-bold text-gray-900 dark:text-white">{event.title}</h4>
                    
                    <div className="flex items-center">
                      {/* Event type badge */}
                      <span className={`mr-2 px-2 py-1 text-xs font-semibold rounded-full ${getEventTypeBgColor(event.event_type)}`}>
                        {formatEventType(event.event_type)}
                      </span>
                      
                      {/* Verification badge if verified */}
                      {event.verified && (
                        <span className="bg-blue-100 text-blue-800 px-2 py-1 text-xs font-semibold rounded-full">
                          VERIFIED
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                    {new Date(event.event_date).toLocaleDateString()} |
                    {event.location && ` ${event.location} | `}
                    {event.source && ` Source: ${event.source}`}
                  </p>
                  
                  {event.description && (
                    <p className="mb-4 text-gray-700 dark:text-gray-300">{event.description}</p>
                  )}
                  
                  {/* Confidence score indicator */}
                  <div className="flex items-center mt-2">
                    <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2.5 mr-2">
                      <div 
                        className={`h-2.5 rounded-full ${getConfidenceColor(event.confidence_score)}`}
                        style={{ width: `${event.confidence_score * 100}%` }}
                      ></div>
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      Confidence: {Math.round(event.confidence_score * 100)}%
                    </span>
                  </div>
                  
                  {/* Actions */}
                  <div className="flex justify-end mt-4">
                    <Link 
                      to={`/vehicles/${vehicleId}/timeline/${event.id}`}
                      className="text-blue-500 hover:text-blue-700 text-sm mr-4"
                    >
                      View Details
                    </Link>
                    
                    {!event.verified && (
                      <button
                        onClick={async () => {
                          try {
                            await timelineService.verify(event.id);

                            // Refresh the events list
                            const data = await timelineService.getByVehicleId(vehicleId);
                            setEvents(data || []);
                          } catch (err) {
                            console.error('Error verifying event:', err);
                            alert('Failed to verify event. Please try again.');
                          }
                        }}
                        className="text-green-500 hover:text-green-700 text-sm"
                      >
                        Verify
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Add Event Modal */}
      {showAddEventForm && currentUser && (
        <EnhancedTimelineEventForm
          vehicleId={vehicleId}
          currentUser={currentUser}
          userRole="owner"
          onEventCreated={() => {
            setShowAddEventForm(false);
            // Refresh events
            const fetchTimelineEvents = async () => {
              try {
                const data = await timelineService.getByVehicleId(vehicleId);
                setEvents(data || []);
              } catch (err) {
                console.error('Error fetching timeline events:', err);
              }
            };
            fetchTimelineEvents();
          }}
          onClose={() => setShowAddEventForm(false)}
        />
      )}
    </div>
  );
};

// Helper functions for timeline event styling
const formatEventType = (eventType: string): string => {
  return eventType
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

const getEventTypeColor = (eventType: string): string => {
  switch (eventType) {
    case 'purchase':
    case 'sale':
      return 'bg-green-500 border-green-600';
    case 'service':
    case 'repair':
      return 'bg-yellow-500 border-yellow-600';
    case 'restoration':
      return 'bg-purple-500 border-purple-600';
    case 'inspection':
      return 'bg-blue-500 border-blue-600';
    case 'modification':
      return 'bg-indigo-500 border-indigo-600';
    case 'registration':
      return 'bg-gray-500 border-gray-600';
    case 'accident':
      return 'bg-red-500 border-red-600';
    case 'milestone':
      return 'bg-teal-500 border-teal-600';
    default:
      return 'bg-gray-400 border-gray-500';
  }
};

const getEventTypeBgColor = (eventType: string): string => {
  switch (eventType) {
    case 'purchase':
    case 'sale':
      return 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300';
    case 'service':
    case 'repair':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300';
    case 'restoration':
      return 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300';
    case 'inspection':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300';
    case 'modification':
      return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300';
    case 'registration':
      return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    case 'accident':
      return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300';
    case 'milestone':
      return 'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-300';
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
  }
};

const getConfidenceColor = (confidence: number): string => {
  if (confidence >= 0.8) return 'bg-green-500';
  if (confidence >= 0.5) return 'bg-yellow-500';
  return 'bg-red-500';
};

export default TimelineList;
