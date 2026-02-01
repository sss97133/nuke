import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { 
  ChartBarIcon, 
  ClockIcon, 
  CameraIcon, 
  DocumentTextIcon,
  UserIcon,
  TruckIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  SparklesIcon
} from '@heroicons/react/24/outline';

interface ProjectMetrics {
  totalWorkSessions: number;
  totalHoursWorked: number;
  averageSessionLength: number;
  imagesDocumented: number;
  timelineEventsAdded: number;
  clientApprovalRate: number;
  dataQualityScore: number;
  contributionPoints: number;
}

interface WorkSessionData {
  id: string;
  session_type: string;
  start_time: string;
  end_time?: string;
  duration_minutes?: number;
  images_uploaded: number;
  timeline_events_added: number;
  client_approved: boolean;
  provider_name: string;
}

interface DataQualityMetric {
  field_name: string;
  source_count: number;
  confidence_score: number;
  verification_status: string;
  last_updated: string;
}

interface ProjectDataVisualizerProps {
  vehicleId: string;
  timeRange?: 'week' | 'month' | 'quarter' | 'year' | 'all';
}

const ProjectDataVisualizer: React.FC<ProjectDataVisualizerProps> = ({
  vehicleId,
  timeRange = 'all'
}) => {
  const [metrics, setMetrics] = useState<ProjectMetrics | null>(null);
  const [workSessions, setWorkSessions] = useState<WorkSessionData[]>([]);
  const [dataQuality, setDataQuality] = useState<DataQualityMetric[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (vehicleId) {
      loadProjectAnalytics();
    }
  }, [vehicleId, timeRange]);

  const loadProjectAnalytics = async () => {
    setLoading(true);
    
    try {
      // Calculate date filter based on time range
      const getDateFilter = () => {
        const now = new Date();
        switch (timeRange) {
          case 'week': return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          case 'month': return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          case 'quarter': return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          case 'year': return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          default: return new Date('2020-01-01'); // All time
        }
      };

      const dateFilter = getDateFilter().toISOString();

      // Load work sessions data
      const { data: sessions, error: sessionsError } = await supabase
        .from('vehicle_work_sessions')
        .select(`
          *,
          provider:service_provider_id (full_name)
        `)
        .eq('vehicle_id', vehicleId)
        .gte('created_at', dateFilter)
        .order('start_time', { ascending: false });

      if (sessionsError) throw sessionsError;

      // Load timeline events for this vehicle
      const { data: timeline, error: timelineError } = await supabase
        .from('vehicle_timeline_events')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .gte('created_at', dateFilter);

      if (timelineError) throw timelineError;

      // Load vehicle images
      const { data: images, error: imagesError } = await supabase
        .from('vehicle_images')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .gte('created_at', dateFilter);

      if (imagesError) throw imagesError;

      // Load data quality metrics (from data annotation system)
      const { data: dataSources, error: dataError } = await supabase
        .from('vehicle_data_sources')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .gte('created_at', dateFilter);

      // Calculate metrics
      const formattedSessions = (sessions || []).map(session => ({
        ...session,
        provider_name: session.provider?.full_name || 'Unknown'
      }));

      const totalHours = formattedSessions.reduce((sum, session) => {
        return sum + (session.duration_minutes || 0);
      }, 0) / 60;

      const approvedSessions = formattedSessions.filter(s => s.client_approved);
      const approvalRate = formattedSessions.length > 0 
        ? (approvedSessions.length / formattedSessions.length) * 100 
        : 0;

      const totalImages = formattedSessions.reduce((sum, s) => sum + s.images_uploaded, 0);
      const totalTimelineEvents = formattedSessions.reduce((sum, s) => sum + s.timeline_events_added, 0);

      // Calculate data quality score
      const qualityScore = dataSources && dataSources.length > 0
        ? dataSources.reduce((sum, ds) => sum + ds.confidence_score, 0) / dataSources.length
        : 85; // Default if no data sources

      // Calculate contribution points (simplified)
      const contributionPoints = (totalImages * 5) + (totalTimelineEvents * 10) + (totalHours * 25);

      const projectMetrics: ProjectMetrics = {
        totalWorkSessions: formattedSessions.length,
        totalHoursWorked: totalHours,
        averageSessionLength: formattedSessions.length > 0 ? totalHours / formattedSessions.length : 0,
        imagesDocumented: totalImages,
        timelineEventsAdded: totalTimelineEvents,
        clientApprovalRate: approvalRate,
        dataQualityScore: qualityScore,
        contributionPoints: Math.round(contributionPoints)
      };

      // Process data quality metrics
      const qualityMetrics = (dataSources || []).reduce((acc, source) => {
        const existing = acc.find((m: any) => m.field_name === source.field_name);
        if (existing) {
          existing.source_count += 1;
          existing.confidence_score = Math.max(existing.confidence_score, source.confidence_score);
        } else {
          acc.push({
            field_name: source.field_name,
            source_count: 1,
            confidence_score: source.confidence_score,
            verification_status: 'unverified', // Default
            last_updated: source.created_at
          });
        }
        return acc;
      }, [] as DataQualityMetric[]);

      setMetrics(projectMetrics);
      setWorkSessions(formattedSessions);
      setDataQuality(qualityMetrics);

    } catch (error) {
      console.error('Error loading project analytics:', error);
    }
    
    setLoading(false);
  };

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  };

  const getQualityColor = (score: number) => {
    if (score >= 90) return 'text-green-600';
    if (score >= 70) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getQualityBadge = (score: number) => {
    if (score >= 90) return { text: 'Excellent', color: 'bg-green-100 text-green-800' };
    if (score >= 70) return { text: 'Good', color: 'bg-yellow-100 text-yellow-800' };
    return { text: 'Needs Work', color: 'bg-red-100 text-red-800' };
  };

  if (loading) {
    return (
      <div className="bg-white p-4 rounded border">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 rounded w-1/3"></div>
          <div className="grid grid-cols-3 gap-4">
            <div className="h-16 bg-gray-200 rounded"></div>
            <div className="h-16 bg-gray-200 rounded"></div>
            <div className="h-16 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="bg-white p-4 rounded border text-center">
        <TruckIcon className="w-8 h-8 mx-auto mb-2 text-gray-400" />
        <p className="text-sm text-gray-600">No project data available yet</p>
        <p className="text-xs text-gray-500 mt-1">Start a work session to see analytics</p>
      </div>
    );
  }

  const qualityBadge = getQualityBadge(metrics.dataQualityScore);

  return (
    <div className="space-y-4">
      {/* Key Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-blue-50 p-3 rounded border border-blue-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-blue-600 font-medium">Work Sessions</p>
              <p className="text-lg font-bold text-blue-900">{metrics.totalWorkSessions}</p>
            </div>
            <ClockIcon className="w-5 h-5 text-blue-500" />
          </div>
        </div>

        <div className="bg-green-50 p-3 rounded border border-green-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-green-600 font-medium">Hours Worked</p>
              <p className="text-lg font-bold text-green-900">{metrics.totalHoursWorked.toFixed(1)}h</p>
            </div>
            <ChartBarIcon className="w-5 h-5 text-green-500" />
          </div>
        </div>

        <div className="bg-purple-50 p-3 rounded border border-purple-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-purple-600 font-medium">Documentation</p>
              <p className="text-lg font-bold text-purple-900">{metrics.imagesDocumented + metrics.timelineEventsAdded}</p>
            </div>
            <DocumentTextIcon className="w-5 h-5 text-purple-500" />
          </div>
        </div>

        <div className="bg-orange-50 p-3 rounded border border-orange-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-orange-600 font-medium">Quality Score</p>
              <p className={`text-lg font-bold ${getQualityColor(metrics.dataQualityScore)}`}>
                {metrics.dataQualityScore.toFixed(0)}%
              </p>
            </div>
            <SparklesIcon className="w-5 h-5 text-orange-500" />
          </div>
        </div>
      </div>

      {/* Detailed Analytics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Work Progress Chart */}
        <div className="bg-white p-4 rounded border">
          <h4 className="font-medium text-sm mb-3 flex items-center gap-2">
            <ChartBarIcon className="w-4 h-4" />
            Work Progress
          </h4>
          
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-600">Client Approval Rate</span>
              <div className="flex items-center gap-2">
                <div className="w-20 bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-green-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${metrics.clientApprovalRate}%` }}
                  ></div>
                </div>
                <span className="text-xs font-medium">{metrics.clientApprovalRate.toFixed(0)}%</span>
              </div>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-600">Data Quality</span>
              <div className="flex items-center gap-2">
                <div className="w-20 bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${metrics.dataQualityScore}%` }}
                  ></div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded ${qualityBadge.color}`}>
                  {qualityBadge.text}
                </span>
              </div>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-600">Documentation Rate</span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">
                  {metrics.imagesDocumented} photos, {metrics.timelineEventsAdded} events
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Professional Contribution Tracking */}
        <div className="bg-white p-4 rounded border">
          <h4 className="font-medium text-sm mb-3 flex items-center gap-2">
            <SparklesIcon className="w-4 h-4" />
            Professional Impact
          </h4>
          
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-600">Contribution Points</span>
              <span className="text-sm font-bold text-blue-600">
                {metrics.contributionPoints.toLocaleString()}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="flex items-center gap-2">
                <CameraIcon className="w-3 h-3 text-gray-400" />
                <span>{metrics.imagesDocumented} images</span>
              </div>
              <div className="flex items-center gap-2">
                <DocumentTextIcon className="w-3 h-3 text-gray-400" />
                <span>{metrics.timelineEventsAdded} events</span>
              </div>
              <div className="flex items-center gap-2">
                <ClockIcon className="w-3 h-3 text-gray-400" />
                <span>{metrics.totalHoursWorked.toFixed(1)}h work</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircleIcon className="w-3 h-3 text-gray-400" />
                <span>{metrics.clientApprovalRate.toFixed(0)}% approved</span>
              </div>
            </div>

            {/* Professional Level Indicator */}
            <div className="pt-2 border-t">
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-600">Professional Level</span>
                <span className="text-xs font-medium bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                  {metrics.contributionPoints >= 1000 ? 'Expert' : 
                   metrics.contributionPoints >= 500 ? 'Professional' : 
                   metrics.contributionPoints >= 100 ? 'Skilled' : 'Apprentice'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Work Sessions Timeline */}
      {workSessions.length > 0 && (
        <div className="bg-white p-4 rounded border">
          <h4 className="font-medium text-sm mb-3 flex items-center gap-2">
            <ClockIcon className="w-4 h-4" />
            Recent Work Sessions
          </h4>
          
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {workSessions.slice(0, 5).map((session) => (
              <div key={session.id} className="flex items-center justify-between p-2 bg-gray-50 rounded text-xs">
                <div className="flex-1">
                  <div className="font-medium">{session.session_type}</div>
                  <div className="text-gray-600">{session.provider_name}</div>
                </div>
                <div className="text-right">
                  <div className="font-medium">
                    {session.duration_minutes ? formatDuration(session.duration_minutes) : 'In progress'}
                  </div>
                  <div className="flex items-center gap-1 text-gray-500">
                    {session.images_uploaded > 0 && (
                      <span>{session.images_uploaded} images</span>
                    )}
                    {session.timeline_events_added > 0 && (
                      <span>{session.timeline_events_added}📝</span>
                    )}
                    {session.client_approved && (
                      <CheckCircleIcon className="w-3 h-3 text-green-500" />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Data Quality Breakdown */}
      {dataQuality.length > 0 && (
        <div className="bg-white p-4 rounded border">
          <h4 className="font-medium text-sm mb-3 flex items-center gap-2">
            <DocumentTextIcon className="w-4 h-4" />
            Data Quality Breakdown
          </h4>
          
          <div className="space-y-2 max-h-32 overflow-y-auto">
            {dataQuality.slice(0, 8).map((field) => (
              <div key={field.field_name} className="flex items-center justify-between text-xs">
                <span className="font-medium capitalize">
                  {field.field_name.replace(/_/g, ' ')}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">{field.source_count} sources</span>
                  <div className="w-12 bg-gray-200 rounded-full h-1">
                    <div 
                      className="bg-blue-500 h-1 rounded-full"
                      style={{ width: `${field.confidence_score}%` }}
                    ></div>
                  </div>
                  <span className="font-medium">{field.confidence_score}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="bg-gray-50 p-3 rounded border">
        <h5 className="text-xs font-medium text-gray-700 mb-2">Quick Actions</h5>
        <div className="flex gap-2 text-xs">
          <button className="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">
            Export Report
          </button>
          <button className="px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700">
            Schedule Work
          </button>
          <button className="px-2 py-1 bg-purple-600 text-white rounded hover:bg-purple-700">
            Quality Audit
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProjectDataVisualizer;
