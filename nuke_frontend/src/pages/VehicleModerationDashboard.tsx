import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { ModerationService } from '../services/moderationService';
import { supabase } from '../lib/supabase';
import type { ModerationDashboardData, VehicleContentSubmission, SubmissionStatus } from '../types/moderation';
// AppLayout now provided globally by App.tsx

const VehicleModerationDashboard: React.FC = () => {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
    });
  }, []);
  const [dashboard, setDashboard] = useState<ModerationDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSubmissions, setSelectedSubmissions] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'pending' | 'recent' | 'contributors' | 'settings'>('pending');

  useEffect(() => {
    if (!user) {
      navigate(`/login?returnUrl=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`);
      return;
    }
    loadDashboard();
  }, [vehicleId, user]);

  const loadDashboard = async () => {
    if (!vehicleId) return;

    setLoading(true);
    try {
      const dashboardData = await ModerationService.getModerationDashboard(vehicleId);
      if (!dashboardData) {
        navigate('/vehicles');
        return;
      }
      setDashboard(dashboardData);
    } catch (error) {
      console.error('Error loading moderation dashboard:', error);
      navigate('/vehicles');
    } finally {
      setLoading(false);
    }
  };

  const handleReviewSubmission = async (
    submissionId: string,
    status: SubmissionStatus,
    reviewNotes?: string
  ) => {
    const success = await ModerationService.reviewSubmission(submissionId, status, reviewNotes);
    if (success) {
      loadDashboard(); // Refresh data
    }
  };

  const handleBulkApprove = async () => {
    if (selectedSubmissions.length === 0) return;
    
    const success = await ModerationService.bulkApproveSubmissions(selectedSubmissions);
    if (success) {
      setSelectedSubmissions([]);
      loadDashboard();
    }
  };

  const toggleSubmissionSelection = (submissionId: string) => {
    setSelectedSubmissions(prev => 
      prev.includes(submissionId)
        ? prev.filter(id => id !== submissionId)
        : [...prev, submissionId]
    );
  };

  const renderSubmissionCard = (submission: VehicleContentSubmission) => {
    const isSelected = selectedSubmissions.includes(submission.id);
    
    return (
      <div key={submission.id} className={`border rounded-lg p-4 ${isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => toggleSubmissionSelection(submission.id)}
              className="rounded border-gray-300"
            />
            <div>
              <span className="inline-block bg-gray-100 text-gray-800 text-xs px-2 py-1 rounded-full">
                {submission.submission_type.replace('_', ' ')}
              </span>
              {submission.submission_context && (
                <span className="ml-2 text-sm text-gray-600">
                  {submission.submission_context}
                </span>
              )}
            </div>
          </div>
          <div className="text-sm text-gray-500">
            {new Date(submission.submission_date).toLocaleDateString()}
          </div>
        </div>

        {/* Content Preview */}
        <div className="mb-3">
          {submission.submission_type === 'photo' && submission.content_data.image_url && (
            <img
              src={submission.content_data.image_url}
              alt="Submission"
              className="w-32 h-24 object-cover rounded"
            />
          )}
          {submission.content_data.description && (
            <p className="text-sm text-gray-700 mt-2">
              {submission.content_data.description}
            </p>
          )}
        </div>

        {/* Contributor Info */}
        {submission.contributor_credit && (
          <p className="text-sm text-gray-600 mb-3">
            Contributed by: {submission.contributor_credit}
          </p>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => handleReviewSubmission(submission.id, 'approved')}
            className="btn btn-sm bg-green-600 text-white hover:bg-green-700"
          >
            Approve
          </button>
          <button
            onClick={() => handleReviewSubmission(submission.id, 'rejected')}
            className="btn btn-sm bg-red-600 text-white hover:bg-red-700"
          >
            Reject
          </button>
          <button
            onClick={() => handleReviewSubmission(submission.id, 'needs_review', 'Needs more information')}
            className="btn btn-sm btn-secondary"
          >
            Needs Review
          </button>
        </div>
      </div>
    );
  };

  const renderPendingTab = () => {
    if (!dashboard?.pending_submissions.length) {
      return (
        <div className="text-center py-8">
          <p className="text-gray-500">No pending submissions</p>
        </div>
      );
    }

    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">
            Pending Submissions ({dashboard.pending_submissions.length})
          </h3>
          {selectedSubmissions.length > 0 && (
            <button
              onClick={handleBulkApprove}
              className="btn btn-primary"
            >
              Bulk Approve ({selectedSubmissions.length})
            </button>
          )}
        </div>
        <div className="space-y-4">
          {dashboard.pending_submissions.map(renderSubmissionCard)}
        </div>
      </div>
    );
  };

  const renderRecentTab = () => {
    if (!dashboard?.recent_activity.length) {
      return (
        <div className="text-center py-8">
          <p className="text-gray-500">No recent activity</p>
        </div>
      );
    }

    return (
      <div>
        <h3 className="text-lg font-semibold mb-4">Recent Activity</h3>
        <div className="space-y-3">
          {dashboard.recent_activity.map((submission) => (
            <div key={submission.id} className="border rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className={`inline-block px-2 py-1 rounded-full text-xs ${
                    submission.status === 'approved' ? 'bg-green-100 text-green-800' :
                    submission.status === 'rejected' ? 'bg-red-100 text-red-800' :
                    'bg-yellow-100 text-yellow-800'
                  }`}>
                    {submission.status}
                  </span>
                  <span className="ml-2 text-sm">
                    {submission.submission_type.replace('_', ' ')} submission
                  </span>
                  {submission.contributor_credit && (
                    <span className="ml-2 text-sm text-gray-600">
                      by {submission.contributor_credit}
                    </span>
                  )}
                </div>
                <div className="text-sm text-gray-500">
                  {new Date(submission.submission_date).toLocaleDateString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderContributorsTab = () => {
    if (!dashboard?.contributor_stats.length) {
      return (
        <div className="text-center py-8">
          <p className="text-gray-500">No contributors yet</p>
        </div>
      );
    }

    return (
      <div>
        <h3 className="text-lg font-semibold mb-4">Top Contributors</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {dashboard.contributor_stats.map((contributor) => (
            <div key={contributor.id} className="border rounded-lg p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center text-white font-semibold">
                  {contributor.contributor_name?.charAt(0) || '?'}
                </div>
                <div>
                  <p className="font-medium">{contributor.contributor_name || 'Anonymous'}</p>
                  <p className="text-sm text-gray-600">
                    Reputation: {contributor.reputation_score}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="text-center">
                  <div className="font-semibold">{contributor.total_submissions}</div>
                  <div className="text-gray-600">Total</div>
                </div>
                <div className="text-center">
                  <div className="font-semibold text-green-600">{contributor.approved_submissions}</div>
                  <div className="text-gray-600">Approved</div>
                </div>
                <div className="text-center">
                  <div className="font-semibold text-red-600">{contributor.rejected_submissions}</div>
                  <div className="text-gray-600">Rejected</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderSettingsTab = () => {
    if (!dashboard?.profile_settings) return null;

    const settings = dashboard.profile_settings;
    
    return (
      <div>
        <h3 className="text-lg font-semibold mb-4">Profile Settings</h3>
        <div className="space-y-6">
          <div className="border rounded-lg p-4">
            <h4 className="font-medium mb-3">Public Visibility</h4>
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.is_public}
                  onChange={(e) => {
                    ModerationService.updateProfileSettings(vehicleId!, {
                      is_public: e.target.checked
                    }).then(() => loadDashboard());
                  }}
                />
                <span>Make profile public</span>
              </label>
              {settings.is_public && (
                <p className="text-sm text-gray-600 ml-6">
                  Public URL: /vehicle/{settings.public_url_slug}
                </p>
              )}
            </div>
          </div>

          <div className="border rounded-lg p-4">
            <h4 className="font-medium mb-3">Content Display</h4>
            <div className="space-y-2">
              {[
                { key: 'show_specifications', label: 'Show specifications' },
                { key: 'show_modifications', label: 'Show modifications' },
                { key: 'show_service_history', label: 'Show service history' },
                { key: 'show_timeline', label: 'Show timeline' },
                { key: 'show_contributor_credits', label: 'Show contributor credits' }
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settings[key as keyof typeof settings] as boolean}
                    onChange={(e) => {
                      ModerationService.updateProfileSettings(vehicleId!, {
                        [key]: e.target.checked
                      }).then(() => loadDashboard());
                    }}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="border rounded-lg p-4">
            <h4 className="font-medium mb-3">Submission Settings</h4>
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.allow_public_submissions}
                  onChange={(e) => {
                    ModerationService.updateProfileSettings(vehicleId!, {
                      allow_public_submissions: e.target.checked
                    }).then(() => loadDashboard());
                  }}
                />
                <span>Allow public submissions</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.allow_anonymous_submissions}
                  onChange={(e) => {
                    ModerationService.updateProfileSettings(vehicleId!, {
                      allow_anonymous_submissions: e.target.checked
                    }).then(() => loadDashboard());
                  }}
                />
                <span>Allow anonymous submissions</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      
        <div className="max-w-6xl mx-auto py-8">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-200 rounded w-1/3"></div>
            <div className="h-32 bg-gray-200 rounded"></div>
          </div>
        </div>
      
    );
  }

  if (!dashboard) {
    return (
      
        <div className="max-w-6xl mx-auto py-8 text-center">
          <h1 className="text-2xl font-bold mb-4">Access Denied</h1>
          <p className="text-gray-600 mb-8">You don't have permission to moderate this vehicle.</p>
          <button onClick={() => navigate('/vehicles')} className="btn btn-primary">
            Back to Vehicles
          </button>
        </div>
      
    );
  }

  return (
    
      <div className="max-w-6xl mx-auto py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Vehicle Moderation Dashboard</h1>
          <div className="flex gap-2">
            <button
              onClick={() => navigate(`/vehicle/${dashboard.profile_settings.public_url_slug}`)}
              className="btn btn-secondary"
            >
              View Public Profile
            </button>
            <button
              onClick={() => navigate(`/vehicle/${vehicleId}`)}
              className="btn btn-primary"
            >
              Edit Vehicle
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex space-x-8">
            {[
              { key: 'pending', label: 'Pending', count: dashboard.pending_submissions.length },
              { key: 'recent', label: 'Recent Activity', count: dashboard.recent_activity.length },
              { key: 'contributors', label: 'Contributors', count: dashboard.contributor_stats.length },
              { key: 'settings', label: 'Settings' }
            ].map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key as any)}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === key
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {label}
                {count !== undefined && count > 0 && (
                  <span className="ml-2 bg-gray-100 text-gray-900 py-0.5 px-2 rounded-full text-xs">
                    {count}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="bg-white rounded-lg border p-6">
          {activeTab === 'pending' && renderPendingTab()}
          {activeTab === 'recent' && renderRecentTab()}
          {activeTab === 'contributors' && renderContributorsTab()}
          {activeTab === 'settings' && renderSettingsTab()}
        </div>
      </div>
    
  );
};

export default VehicleModerationDashboard;
