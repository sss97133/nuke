import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { 
  ArrowPathIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  ChartBarIcon,
  DocumentTextIcon,
  CameraIcon
} from '@heroicons/react/24/outline';

interface DataPipelineMetrics {
  // Data flow metrics
  timeline_events_today: number;
  images_uploaded_today: number;
  data_sources_added_today: number;
  
  // Quality metrics
  average_confidence_score: number;
  verified_data_percentage: number;
  data_conflicts: number;
  
  // Professional activity
  work_sessions_active: number;
  professionals_contributing: number;
  documentation_rate: number; // docs per hour of work
  
  // Real-time indicators
  last_activity: string;
  data_freshness_score: number;
  pipeline_health: 'excellent' | 'good' | 'warning' | 'critical';
}

interface DataFlowEvent {
  id: string;
  event_type: 'image_upload' | 'timeline_event' | 'work_session' | 'data_verification' | 'conflict_resolution';
  description: string;
  contributor: string;
  timestamp: string;
  impact_score: number;
}

interface ProjectDataPipelineProps {
  vehicleId: string;
  showRealTime?: boolean;
}

const ProjectDataPipeline: React.FC<ProjectDataPipelineProps> = ({
  vehicleId,
  showRealTime = true
}) => {
  const [metrics, setMetrics] = useState<DataPipelineMetrics | null>(null);
  const [recentEvents, setRecentEvents] = useState<DataFlowEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  useEffect(() => {
    if (vehicleId) {
      loadPipelineData();
      
      // Set up real-time updates if enabled
      if (showRealTime) {
        const interval = setInterval(loadPipelineData, 30000); // Every 30 seconds
        return () => clearInterval(interval);
      }
    }
  }, [vehicleId, showRealTime]);

  const loadPipelineData = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      // Parallel data loading for real-time performance
      const [
        timelineResult,
        imagesResult,
        dataSourcesResult,
        workSessionsResult,
        annotationsResult
      ] = await Promise.all([
        // Timeline events today
        supabase.from('vehicle_timeline_events')
          .select('*, user:user_id(full_name)')
          .eq('vehicle_id', vehicleId)
          .gte('created_at', last24h),
          
        // Images uploaded today  
        supabase.from('vehicle_images')
          .select('*, user:user_id(full_name)')
          .eq('vehicle_id', vehicleId)
          .gte('created_at', last24h),
          
        // Data sources added
        supabase.from('vehicle_data_sources')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .gte('created_at', last24h),
          
        // Active work sessions
        supabase.from('vehicle_work_sessions')
          .select('*, provider:service_provider_id(full_name)')
          .eq('vehicle_id', vehicleId)
          .is('end_time', null), // Active sessions
          
        // Field annotations for quality metrics
        supabase.from('vehicle_field_annotations')
          .select('*')
          .eq('vehicle_id', vehicleId)
      ]);

      const timelineEvents = timelineResult.data || [];
      const images = imagesResult.data || [];
      const dataSources = dataSourcesResult.data || [];
      const activeSessions = workSessionsResult.data || [];
      const annotations = annotationsResult.data || [];

      // Calculate metrics
      const avgConfidence = dataSources.length > 0 
        ? dataSources.reduce((sum, ds) => sum + ds.confidence_score, 0) / dataSources.length 
        : 85;

      const verifiedAnnotations = annotations.filter(a => a.verification_status !== 'unverified');
      const verifiedPercentage = annotations.length > 0 
        ? (verifiedAnnotations.length / annotations.length) * 100 
        : 100;

      // Calculate documentation rate (docs per hour of active work)
      const totalActiveHours = activeSessions.reduce((sum, s) => {
        const start = new Date(s.start_time);
        const now = new Date();
        return sum + (now.getTime() - start.getTime()) / (1000 * 60 * 60);
      }, 0);

      const documentationRate = totalActiveHours > 0 
        ? (timelineEvents.length + images.length) / totalActiveHours 
        : 0;

      // Determine pipeline health
      let pipelineHealth: DataPipelineMetrics['pipeline_health'] = 'excellent';
      if (avgConfidence < 70 || verifiedPercentage < 50) pipelineHealth = 'warning';
      if (avgConfidence < 50 || verifiedPercentage < 25) pipelineHealth = 'critical';

      const pipelineMetrics: DataPipelineMetrics = {
        timeline_events_today: timelineEvents.length,
        images_uploaded_today: images.length,
        data_sources_added_today: dataSources.length,
        average_confidence_score: avgConfidence,
        verified_data_percentage: verifiedPercentage,
        data_conflicts: 0, // TODO: Calculate from conflicts table
        work_sessions_active: activeSessions.length,
        professionals_contributing: new Set(activeSessions.map(s => s.service_provider_id)).size,
        documentation_rate: documentationRate,
        last_activity: Math.max(
          ...timelineEvents.map(e => new Date(e.created_at).getTime()),
          ...images.map(i => new Date(i.created_at).getTime()),
          Date.now() - 24 * 60 * 60 * 1000 // Default to 24h ago
        ).toString(),
        data_freshness_score: 95, // Placeholder calculation
        pipeline_health: pipelineHealth
      };

      // Create recent events feed
      const events: DataFlowEvent[] = [];
      
      timelineEvents.forEach(event => {
        events.push({
          id: event.id,
          event_type: 'timeline_event',
          description: `Added timeline event: ${event.event_title}`,
          contributor: event.user?.full_name || 'Unknown',
          timestamp: event.created_at,
          impact_score: 10
        });
      });

      images.forEach(image => {
        events.push({
          id: image.id,
          event_type: 'image_upload',
          description: `Uploaded ${image.category || 'vehicle'} image`,
          contributor: image.user?.full_name || 'Unknown',
          timestamp: image.created_at,
          impact_score: 5
        });
      });

      activeSessions.forEach(session => {
        events.push({
          id: session.id,
          event_type: 'work_session',
          description: `Started ${session.session_type} session: ${session.project_scope}`,
          contributor: session.provider?.full_name || 'Unknown',
          timestamp: session.start_time,
          impact_score: 25
        });
      });

      // Sort by timestamp (most recent first)
      events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      setMetrics(pipelineMetrics);
      setRecentEvents(events.slice(0, 10)); // Last 10 events
      setLastUpdate(new Date());

    } catch (error) {
      console.error('Error loading pipeline data:', error);
    }
    
    setLoading(false);
  };

  const getHealthColor = (health: string) => {
    switch (health) {
      case 'excellent': return 'text-green-600';
      case 'good': return 'text-blue-600';
      case 'warning': return 'text-yellow-600';
      case 'critical': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getHealthIcon = (health: string) => {
    switch (health) {
      case 'excellent': return CheckCircleIcon;
      case 'good': return CheckCircleIcon;
      case 'warning': return ExclamationTriangleIcon;
      case 'critical': return ExclamationTriangleIcon;
      default: return ClockIcon;
    }
  };

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case 'image_upload': return CameraIcon;
      case 'timeline_event': return DocumentTextIcon;
      case 'work_session': return ClockIcon;
      default: return ChartBarIcon;
    }
  };

  if (loading) {
    return (
      <div className="bg-white p-4 rounded border">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/3 mb-4"></div>
          <div className="grid grid-cols-3 gap-4">
            <div className="h-12 bg-gray-200 rounded"></div>
            <div className="h-12 bg-gray-200 rounded"></div>
            <div className="h-12 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!metrics) return null;

  const HealthIcon = getHealthIcon(metrics.pipeline_health);

  return (
    <div className="space-y-4">
      {/* Pipeline Health Header */}
      <div className="bg-white p-4 rounded border">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-medium text-sm flex items-center gap-2">
            <ArrowPathIcon className="w-4 h-4" />
            Data Pipeline Status
          </h4>
          <div className="flex items-center gap-2">
            <HealthIcon className={`w-4 h-4 ${getHealthColor(metrics.pipeline_health)}`} />
            <span className={`text-xs font-medium ${getHealthColor(metrics.pipeline_health)}`}>
              {metrics.pipeline_health.toUpperCase()}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 text-xs">
          <div className="text-center">
            <div className="font-bold text-lg">{metrics.timeline_events_today}</div>
            <div className="text-gray-600">Events Today</div>
          </div>
          <div className="text-center">
            <div className="font-bold text-lg">{metrics.images_uploaded_today}</div>
            <div className="text-gray-600">Images Today</div>
          </div>
          <div className="text-center">
            <div className="font-bold text-lg">{metrics.work_sessions_active}</div>
            <div className="text-gray-600">Active Sessions</div>
          </div>
        </div>
      </div>

      {/* Real-time Activity Feed */}
      <div className="bg-white p-4 rounded border">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-medium text-sm">Real-time Activity</h4>
          <span className="text-xs text-gray-500">
            Updated: {lastUpdate.toLocaleTimeString()}
          </span>
        </div>

        {recentEvents.length === 0 ? (
          <div className="text-center py-4 text-gray-500">
            <ClockIcon className="w-6 h-6 mx-auto mb-2 text-gray-400" />
            <p className="text-xs">No recent activity</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {recentEvents.map((event) => {
              const EventIcon = getEventIcon(event.event_type);
              return (
                <div key={event.id} className="flex items-start gap-3 p-2 hover:bg-gray-50 rounded">
                  <EventIcon className="w-4 h-4 mt-0.5 text-gray-400" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-900 truncate">
                      {event.description}
                    </p>
                    <p className="text-xs text-gray-500">
                      {event.contributor} • {new Date(event.timestamp).toLocaleTimeString()}
                    </p>
                  </div>
                  <div className="text-xs text-gray-400">
                    +{event.impact_score}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Data Quality Indicators */}
      <div className="bg-white p-4 rounded border">
        <h4 className="font-medium text-sm mb-3">Data Quality Pipeline</h4>
        
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-xs text-gray-600">Average Confidence</span>
            <div className="flex items-center gap-2">
              <div className="w-16 bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-green-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${metrics.average_confidence_score}%` }}
                ></div>
              </div>
              <span className="text-xs font-medium">{metrics.average_confidence_score.toFixed(0)}%</span>
            </div>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-xs text-gray-600">Verified Data</span>
            <div className="flex items-center gap-2">
              <div className="w-16 bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${metrics.verified_data_percentage}%` }}
                ></div>
              </div>
              <span className="text-xs font-medium">{metrics.verified_data_percentage.toFixed(0)}%</span>
            </div>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-xs text-gray-600">Documentation Rate</span>
            <span className="text-xs font-medium">
              {metrics.documentation_rate.toFixed(1)} items/hour
            </span>
          </div>
        </div>
      </div>

      {/* Professional Activity Heatmap */}
      <div className="bg-white p-4 rounded border">
        <h4 className="font-medium text-sm mb-3">Professional Activity</h4>
        
        <div className="grid grid-cols-7 gap-1 mb-3">
          {Array.from({ length: 14 }, (_, i) => {
            const date = new Date();
            date.setDate(date.getDate() - (13 - i));
            const dayActivity = recentEvents.filter(event => {
              const eventDate = new Date(event.timestamp);
              return eventDate.toDateString() === date.toDateString();
            }).length;
            
            const intensity = Math.min(1, dayActivity / 5); // Max 5 events for full intensity
            
            return (
              <div
                key={i}
                className="w-3 h-3 rounded-sm"
                style={{
                  backgroundColor: intensity > 0 
                    ? `rgba(59, 130, 246, ${0.2 + intensity * 0.8})` // Blue with varying opacity
                    : '#f3f4f6'
                }}
                title={`${date.toLocaleDateString()}: ${dayActivity} activities`}
              />
            );
          })}
        </div>
        
        <div className="flex justify-between text-xs text-gray-500">
          <span>2 weeks ago</span>
          <span>Today</span>
        </div>
      </div>

      {/* Pipeline Optimization Suggestions */}
      {metrics.pipeline_health !== 'excellent' && (
        <div className="bg-yellow-50 p-4 rounded border border-yellow-200">
          <h4 className="font-medium text-sm mb-2 text-yellow-800">Pipeline Optimization</h4>
          <div className="space-y-2 text-xs text-yellow-700">
            {metrics.average_confidence_score < 80 && (
              <p>• Consider adding more data sources to improve confidence scores</p>
            )}
            {metrics.verified_data_percentage < 70 && (
              <p>• Encourage professional verification of critical data points</p>
            )}
            {metrics.documentation_rate < 2 && (
              <p>• Increase documentation during work sessions for better tracking</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectDataPipeline;
