import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface TimelineEvent {
  id: string;
  vehicle_id: string;
  title: string;
  description?: string;
  event_type: string;
  event_date: string;
  image_urls?: string[];
  metadata?: any;
}

interface SimpleTimelineProps {
  vehicleId: string;
  isOwner: boolean;
}

const SimpleTimeline: React.FC<SimpleTimelineProps> = ({ vehicleId, isOwner }) => {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadEvents = async () => {
      if (!vehicleId) return;
      
      try {
        // Try vehicle_timeline_events first
        let { data, error } = await supabase
          .from('vehicle_timeline_events')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('event_date', { ascending: false })
          .limit(50);

        // Fallback to timeline_events if needed
        if (error || !data || data.length === 0) {
          const legacy = await supabase
            .from('timeline_events')
            .select('*')
            .eq('vehicle_id', vehicleId)
            .order('event_date', { ascending: false })
            .limit(50);
          
          if (legacy.data) {
            data = legacy.data;
          }
        }

        // If still no events, derive from images
        if (!data || data.length === 0) {
          const { data: images } = await supabase
            .from('vehicle_images')
            .select('id, image_url, created_at')
            .eq('vehicle_id', vehicleId)
            .order('created_at', { ascending: false })
            .limit(10);

          if (images && images.length > 0) {
            data = images.map(img => ({
              id: `img-${img.id}`,
              vehicle_id: vehicleId,
              title: 'Photo Added',
              event_type: 'photo',
              event_date: img.created_at,
              image_urls: [img.image_url]
            }));
          }
        }

        setEvents(data || []);
      } catch (err) {
        console.error('Error loading timeline:', err);
      } finally {
        setLoading(false);
      }
    };

    loadEvents();
  }, [vehicleId]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getEventColor = (type: string) => {
    const colors: Record<string, string> = {
      maintenance: 'bg-blue-100 text-blue-800',
      repair: 'bg-red-100 text-red-800',
      modification: 'bg-purple-100 text-purple-800',
      purchase: 'bg-green-100 text-green-800',
      photo: 'bg-gray-100 text-gray-800',
      default: 'bg-gray-100 text-gray-800'
    };
    return colors[type] || colors.default;
  };

  if (loading) {
    return (
      <div className="mt-6">
        <h3 className="text-lg font-semibold mb-4">Timeline</h3>
        <div className="animate-pulse space-y-3">
          <div className="h-20 bg-gray-100 rounded"></div>
          <div className="h-20 bg-gray-100 rounded"></div>
        </div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="mt-6">
        <h3 className="text-lg font-semibold mb-4">Timeline</h3>
        <div className="text-center py-8 bg-gray-50 rounded-lg">
          <p className="text-gray-500">No timeline events yet</p>
          <p className="text-sm text-gray-400 mt-1">Events will appear here as you document your vehicle's history</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <h3 className="text-lg font-semibold mb-4">Timeline</h3>
      <div className="space-y-3">
        {events.map(event => (
          <div key={event.id} className="bg-white border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${getEventColor(event.event_type)}`}>
                    {event.event_type}
                  </span>
                  <span className="text-xs text-gray-500">
                    {formatDate(event.event_date)}
                  </span>
                </div>
                <h4 className="font-medium text-gray-900">{event.title}</h4>
                {event.description && (
                  <p className="text-sm text-gray-600 mt-1">{event.description}</p>
                )}
              </div>
              {event.image_urls && event.image_urls[0] && (
                <img 
                  src={event.image_urls[0]} 
                  alt=""
                  className="w-16 h-16 object-cover rounded ml-4 flex-shrink-0"
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SimpleTimeline;
