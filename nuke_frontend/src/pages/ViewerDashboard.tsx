import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  StarIcon,
  EyeIcon,
  ClockIcon,
  TrophyIcon,
  ChartBarIcon,
  UserCircleIcon,
  VideoCameraIcon,
  ChatBubbleLeftRightIcon,
  HeartIcon,
  FireIcon,
  CalendarIcon,
  MapPinIcon
} from '@heroicons/react/24/outline';
import type { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';
import { supabase } from '../lib/supabase';
import type { VehicleInteractionService } from '../services/vehicleInteractionService';
import AppLayout from '../components/layout/AppLayout';
import type { ViewerReputation, ViewerStats, ViewerActivity } from '../types/vehicleInteractions';

const ViewerDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [reputation, setReputation] = useState<ViewerReputation | null>(null);
  const [stats, setStats] = useState<ViewerStats | null>(null);
  const [recentActivity, setRecentActivity] = useState<ViewerActivity[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'activity' | 'achievements' | 'profile'>('overview');

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (user) {
      loadDashboardData();
    }
  }, [user]);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      navigate('/auth');
      return;
    }
    setUser(session.user);
  };

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      const [reputationData, statsData] = await Promise.all([
        VehicleInteractionService.getViewerReputation(user.id),
        VehicleInteractionService.getViewerStats(user.id)
      ]);

      setReputation(reputationData);
      setStats(statsData);

      if (statsData?.recent_activity) {
        setRecentActivity(statsData.recent_activity);
      }
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getCriticLevelInfo = (level: string) => {
    switch (level) {
      case 'novice':
        return {
          label: 'Novice Viewer',
          description: 'Just getting started',
          color: 'gray',
          icon: UserCircleIcon,
          nextLevel: 'enthusiast',
          requirement: '11 vehicles viewed'
        };
      case 'enthusiast':
        return {
          label: 'Vehicle Enthusiast',
          description: 'Active community member',
          color: 'blue',
          icon: HeartIcon,
          nextLevel: 'expert',
          requirement: '51 vehicles viewed'
        };
      case 'expert':
        return {
          label: 'Vehicle Expert',
          description: 'Knowledgeable reviewer',
          color: 'purple',
          icon: StarIcon,
          nextLevel: 'critic',
          requirement: '201 vehicles viewed'
        };
      case 'critic':
        return {
          label: 'Vehicle Critic',
          description: 'Trusted voice in the community',
          color: 'yellow',
          icon: TrophyIcon,
          nextLevel: 'master_critic',
          requirement: '500 vehicles viewed'
        };
      case 'master_critic':
        return {
          label: 'Master Critic',
          description: 'Elite automotive authority',
          color: 'red',
          icon: FireIcon,
          nextLevel: null,
          requirement: 'Maximum level achieved'
        };
      default:
        return {
          label: 'Unknown',
          description: '',
          color: 'gray',
          icon: UserCircleIcon,
          nextLevel: null,
          requirement: ''
        };
    }
  };

  const getProgressToNextLevel = () => {
    if (!reputation) return 0;
    
    const current = reputation.total_vehicles_viewed;
    const level = reputation.critic_level;
    
    switch (level) {
      case 'novice': return Math.min((current / 11) * 100, 100);
      case 'enthusiast': return Math.min(((current - 11) / (51 - 11)) * 100, 100);
      case 'expert': return Math.min(((current - 51) / (201 - 51)) * 100, 100);
      case 'critic': return Math.min(((current - 201) / (500 - 201)) * 100, 100);
      case 'master_critic': return 100;
      default: return 0;
    }
  };

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  };

  const getActivityIcon = (activityType: string) => {
    switch (activityType) {
      case 'profile_view': return EyeIcon;
      case 'streaming_session': return VideoCameraIcon;
      case 'video_call': return VideoCameraIcon;
      case 'comment_added': return ChatBubbleLeftRightIcon;
      case 'rating_given': return StarIcon;
      default: return EyeIcon;
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-gray-200 rounded w-1/3"></div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-32 bg-gray-200 rounded"></div>
              ))}
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  const criticInfo = getCriticLevelInfo(reputation?.critic_level || 'novice');
  const CriticIcon = criticInfo.icon;
  const progress = getProgressToNextLevel();

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center space-x-4 mb-4">
            <div className={`p-3 bg-${criticInfo.color}-100 rounded-lg`}>
              <CriticIcon className={`h-8 w-8 text-${criticInfo.color}-600`} />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">{criticInfo.label}</h1>
              <p className="text-gray-600">{criticInfo.description}</p>
            </div>
          </div>

          {/* Progress to Next Level */}
          {criticInfo.nextLevel && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">
                  Progress to {getCriticLevelInfo(criticInfo.nextLevel).label}
                </span>
                <span className="text-sm text-gray-500">
                  {reputation?.total_vehicles_viewed || 0} vehicles viewed
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className={`bg-${criticInfo.color}-600 h-2 rounded-full transition-all duration-300`}
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {criticInfo.requirement}
              </p>
            </div>
          )}
        </div>

        {/* Tab Navigation */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex space-x-8">
            {[
              { key: 'overview', label: 'Overview' },
              { key: 'activity', label: 'Recent Activity' },
              { key: 'achievements', label: 'Achievements' },
              { key: 'profile', label: 'Critic Profile' }
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
              </button>
            ))}
          </nav>
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <StatCard
                title="Vehicles Viewed"
                value={reputation?.total_vehicles_viewed || 0}
                icon={EyeIcon}
                color="blue"
              />
              <StatCard
                title="Total Viewing Time"
                value={formatDuration(reputation?.total_viewing_time_minutes || 0)}
                icon={ClockIcon}
                color="green"
              />
              <StatCard
                title="Sessions Attended"
                value={reputation?.total_sessions_attended || 0}
                icon={VideoCameraIcon}
                color="purple"
              />
              <StatCard
                title="Reviews Written"
                value={reputation?.reviews_written || 0}
                icon={ChatBubbleLeftRightIcon}
                color="yellow"
              />
            </div>

            {/* Quality Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <QualityMetric
                title="Reliability Score"
                value={reputation?.reliability_score || 0}
                max={1}
                description="Attendance and punctuality"
                color="green"
              />
              <QualityMetric
                title="Engagement Score"
                value={reputation?.engagement_score || 0}
                max={1}
                description="Interaction quality"
                color="blue"
              />
              <QualityMetric
                title="Average Rating"
                value={reputation?.average_session_rating || 0}
                max={5}
                description="Host feedback"
                color="yellow"
                showStars
              />
            </div>

            {/* Favorite Makes */}
            {reputation?.favorite_makes && reputation.favorite_makes.length > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Favorite Makes</h3>
                <div className="flex flex-wrap gap-2">
                  {reputation.favorite_makes.map((make) => (
                    <span
                      key={make}
                      className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800"
                    >
                      {make}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Activity Tab */}
        {activeTab === 'activity' && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">Recent Activity</h3>
            {recentActivity.length === 0 ? (
              <div className="text-center py-12">
                <ChartBarIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No recent activity</h3>
                <p className="text-gray-600">Start viewing vehicles to build your activity history</p>
              </div>
            ) : (
              recentActivity.map((activity) => (
                <ActivityCard key={activity.id} activity={activity} getActivityIcon={getActivityIcon} />
              ))
            )}
          </div>
        )}

        {/* Achievements Tab */}
        {activeTab === 'achievements' && (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold text-gray-900">Achievements</h3>
            
            {/* Badges */}
            {reputation?.badges && reputation.badges.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {reputation.badges.map((badge, index) => (
                  <div key={index} className="bg-white rounded-lg border border-gray-200 p-4 text-center">
                    <TrophyIcon className="h-8 w-8 text-yellow-500 mx-auto mb-2" />
                    <div className="text-sm font-medium text-gray-900">{badge}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <TrophyIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No achievements yet</h3>
                <p className="text-gray-600">Keep viewing and interacting to earn achievements</p>
              </div>
            )}
          </div>
        )}

        {/* Profile Tab */}
        {activeTab === 'profile' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Critic Profile</h3>
              
              <div className="space-y-4">
                <div className="flex items-center space-x-4">
                  <div className={`p-2 bg-${criticInfo.color}-100 rounded-lg`}>
                    <CriticIcon className={`h-6 w-6 text-${criticInfo.color}-600`} />
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">{criticInfo.label}</div>
                    <div className="text-sm text-gray-600">{criticInfo.description}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                  <div>
                    <div className="text-sm font-medium text-gray-900">Member Since</div>
                    <div className="text-sm text-gray-600">
                      {reputation?.first_activity_at 
                        ? new Date(reputation.first_activity_at).toLocaleDateString()
                        : 'Recently joined'
                      }
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-900">Level Achieved</div>
                    <div className="text-sm text-gray-600">
                      {reputation?.critic_level_achieved_at 
                        ? new Date(reputation.critic_level_achieved_at).toLocaleDateString()
                        : 'Not available'
                      }
                    </div>
                  </div>
                </div>

                {reputation?.expertise_areas && reputation.expertise_areas.length > 0 && (
                  <div className="pt-4 border-t">
                    <div className="text-sm font-medium text-gray-900 mb-2">Areas of Expertise</div>
                    <div className="flex flex-wrap gap-2">
                      {reputation.expertise_areas.map((area) => (
                        <span
                          key={area}
                          className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800"
                        >
                          {area}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-4 border-t">
                  <div className="text-sm font-medium text-gray-900 mb-2">Community Standing</div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600">Helpful Votes: </span>
                      <span className="font-medium">{reputation?.helpful_votes_received || 0}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Followers: </span>
                      <span className="font-medium">{reputation?.followers_count || 0}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

// Stat Card Component
const StatCard: React.FC<{
  title: string;
  value: number | string;
  icon: any;
  color: string;
}> = ({ title, value, icon: Icon, color }) => (
  <div className="bg-white rounded-lg border border-gray-200 p-6">
    <div className="flex items-center">
      <div className={`p-2 bg-${color}-100 rounded-lg`}>
        <Icon className={`h-6 w-6 text-${color}-600`} />
      </div>
      <div className="ml-4">
        <div className="text-2xl font-bold text-gray-900">{value}</div>
        <div className="text-sm text-gray-600">{title}</div>
      </div>
    </div>
  </div>
);

// Quality Metric Component
const QualityMetric: React.FC<{
  title: string;
  value: number;
  max: number;
  description: string;
  color: string;
  showStars?: boolean;
}> = ({ title, value, max, description, color, showStars }) => {
  const percentage = (value / max) * 100;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-lg font-semibold text-gray-900">{title}</h4>
        {showStars ? (
          <div className="flex items-center space-x-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <StarIconSolid
                key={star}
                className={`h-4 w-4 ${
                  star <= value ? 'text-yellow-400' : 'text-gray-300'
                }`}
              />
            ))}
            <span className="ml-2 text-sm text-gray-600">
              {value.toFixed(1)}/{max}
            </span>
          </div>
        ) : (
          <span className="text-2xl font-bold text-gray-900">
            {value.toFixed(2)}
          </span>
        )}
      </div>
      
      {!showStars && (
        <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
          <div 
            className={`bg-${color}-600 h-2 rounded-full transition-all duration-300`}
            style={{ width: `${percentage}%` }}
          ></div>
        </div>
      )}
      
      <p className="text-sm text-gray-600">{description}</p>
    </div>
  );
};

// Activity Card Component
const ActivityCard: React.FC<{
  activity: ViewerActivity;
  getActivityIcon: (type: string) => any;
}> = ({ activity, getActivityIcon }) => {
  const Icon = getActivityIcon(activity.activity_type);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-start space-x-3">
        <div className="flex-shrink-0">
          <Icon className="h-6 w-6 text-blue-600" />
        </div>
        <div className="flex-1">
          <div className="flex items-center space-x-2 mb-1">
            <span className="font-medium text-gray-900">
              {activity.activity_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </span>
            {activity.engagement_quality && (
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                activity.engagement_quality === 'high' ? 'bg-green-100 text-green-800' :
                activity.engagement_quality === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                'bg-gray-100 text-gray-800'
              }`}>
                {activity.engagement_quality} engagement
              </span>
            )}
          </div>
          
          <div className="flex items-center space-x-4 text-sm text-gray-600">
            <span>{new Date(activity.created_at).toLocaleDateString()}</span>
            {activity.duration_seconds > 0 && (
              <span>{Math.round(activity.duration_seconds / 60)} minutes</span>
            )}
            {activity.interaction_count > 0 && (
              <span>{activity.interaction_count} interactions</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ViewerDashboard;
