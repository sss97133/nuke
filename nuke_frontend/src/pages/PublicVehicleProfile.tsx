import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { ModerationService } from '../services/moderationService';
import { supabase } from '../lib/supabase';
import type { PublicVehicleProfile, VehicleContentSubmission } from '../types/moderation';
import AppLayout from '../components/layout/AppLayout';

const PublicVehicleProfile: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
    });
  }, []);
  const [profile, setProfile] = useState<PublicVehicleProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [userAccessLevel, setUserAccessLevel] = useState<string | null>(null);
  const [showSubmissionForm, setShowSubmissionForm] = useState(false);

  useEffect(() => {
    loadProfile();
  }, [slug]);

  const loadProfile = async () => {
    if (!slug) {
      navigate('/');
      return;
    }

    setLoading(true);
    try {
      const profileData = await ModerationService.getPublicVehicleProfile(slug);
      if (!profileData) {
        navigate('/404');
        return;
      }

      setProfile(profileData);

      // Check user's access level if authenticated
      if (user && profileData.vehicle) {
        const accessLevel = await ModerationService.getUserAccessLevel(profileData.vehicle.id);
        setUserAccessLevel(accessLevel);
      }
    } catch (error) {
      console.error('Error loading profile:', error);
      navigate('/404');
    } finally {
      setLoading(false);
    }
  };

  const handleContribute = () => {
    setShowSubmissionForm(true);
  };

  const renderVehicleHeader = () => {
    if (!profile?.vehicle) return null;

    const { vehicle, profile_settings } = profile;
    return (
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              {vehicle.year} {vehicle.make} {vehicle.model}
            </h1>
            {vehicle.trim && (
              <p className="text-lg text-gray-600 mt-1">{vehicle.trim}</p>
            )}
            {profile_settings.meta_description && (
              <p className="text-gray-700 mt-3">{profile_settings.meta_description}</p>
            )}
          </div>
          
          <div className="flex gap-2">
            {userAccessLevel && ['owner', 'moderator'].includes(userAccessLevel) && (
              <button
                onClick={() => navigate(`/vehicle/${vehicle.id}/moderate`)}
                className="btn btn-secondary"
              >
                Moderate
              </button>
            )}
            
            {profile_settings.allow_public_submissions && (
              <button
                onClick={handleContribute}
                className="btn btn-primary"
              >
                Contribute
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderSpecifications = () => {
    if (!profile?.profile_settings.show_specifications || !profile.vehicle) return null;

    const { vehicle } = profile;
    const specs = [
      { label: 'Engine', value: vehicle.engine_size },
      { label: 'Horsepower', value: vehicle.horsepower },
      { label: 'Torque', value: vehicle.torque },
      { label: 'Transmission', value: vehicle.transmission },
      { label: 'Drivetrain', value: vehicle.drivetrain },
      { label: 'Fuel Type', value: vehicle.fuel_type },
      { label: 'Body Style', value: vehicle.body_style },
      { label: 'Color', value: vehicle.color },
      { label: 'Mileage', value: vehicle.mileage ? `${vehicle.mileage.toLocaleString()} miles` : null }
    ].filter(spec => spec.value);

    if (specs.length === 0) return null;

    return (
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Specifications</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {specs.map((spec, index) => (
            <div key={index}>
              <dt className="text-sm font-medium text-gray-500">{spec.label}</dt>
              <dd className="text-sm text-gray-900 mt-1">{spec.value}</dd>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderPhotos = () => {
    const photoSubmissions = profile?.approved_content.filter(
      content => content.submission_type === 'photo'
    ) || [];

    if (photoSubmissions.length === 0) return null;

    return (
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Photos</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {photoSubmissions.map((submission) => (
            <div key={submission.id} className="relative group">
              <img
                src={submission.content_data.image_url}
                alt={submission.content_data.caption || 'Vehicle photo'}
                className="w-full h-48 object-cover rounded-lg"
              />
              {submission.contributor_credit && (
                <div className="absolute bottom-2 left-2 bg-black bg-opacity-75 text-white text-xs px-2 py-1 rounded">
                  📸 {submission.contributor_credit}
                </div>
              )}
              {submission.submission_context && (
                <div className="absolute top-2 right-2 bg-black bg-opacity-75 text-white text-xs px-2 py-1 rounded">
                  {submission.submission_context}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderTimeline = () => {
    if (!profile?.profile_settings.show_timeline) return null;

    const timelineEvents = [
      ...profile.timeline_events,
      ...profile.approved_content.filter(content => content.submission_type === 'timeline_event')
    ].sort((a, b) => new Date(b.event_date || b.submission_date).getTime() - new Date(a.event_date || a.submission_date).getTime());

    if (timelineEvents.length === 0) return null;

    return (
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Timeline</h2>
        <div className="space-y-4">
          {timelineEvents.map((event, index) => (
            <div key={event.id || index} className="flex items-start gap-3">
              <div className="w-2 h-2 bg-blue-500 rounded-full mt-2 flex-shrink-0"></div>
              <div>
                <p className="font-medium text-gray-900">
                  {event.event_title || event.content_data?.title}
                </p>
                <p className="text-sm text-gray-600">
                  {new Date(event.event_date || event.submission_date).toLocaleDateString()}
                </p>
                {(event.event_description || event.content_data?.description) && (
                  <p className="text-sm text-gray-700 mt-1">
                    {event.event_description || event.content_data?.description}
                  </p>
                )}
                {event.contributor_credit && (
                  <p className="text-xs text-gray-500 mt-1">
                    Contributed by {event.contributor_credit}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderContributors = () => {
    if (!profile?.profile_settings.show_contributor_credits || profile.contributors.length === 0) {
      return null;
    }

    return (
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Contributors</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {profile.contributors.slice(0, 6).map((contributor) => (
            <div key={contributor.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
              <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white font-semibold">
                {contributor.contributor_name?.charAt(0) || '?'}
              </div>
              <div>
                <p className="font-medium text-gray-900">
                  {contributor.contributor_name || 'Anonymous'}
                </p>
                <p className="text-sm text-gray-600">
                  {contributor.approved_submissions} contributions
                </p>
                {contributor.contributor_badge && (
                  <span className="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full mt-1">
                    {contributor.contributor_badge}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="max-w-4xl mx-auto py-8">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-3/4 mb-4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2 mb-8"></div>
            <div className="space-y-6">
              <div className="h-48 bg-gray-200 rounded"></div>
              <div className="h-32 bg-gray-200 rounded"></div>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!profile) {
    return (
      <AppLayout>
        <div className="max-w-4xl mx-auto py-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Vehicle Not Found</h1>
          <p className="text-gray-600 mb-8">This vehicle profile doesn't exist or isn't public.</p>
          <button onClick={() => navigate('/')} className="btn btn-primary">
            Go Home
          </button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto py-8">
        {renderVehicleHeader()}
        {renderPhotos()}
        {renderSpecifications()}
        {renderTimeline()}
        {renderContributors()}
        
        {/* Contribution Form Modal */}
        {showSubmissionForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <h3 className="text-lg font-semibold mb-4">Contribute to this Vehicle</h3>
              <p className="text-gray-600 mb-4">
                Share photos, corrections, or additional information about this vehicle.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => navigate(`/vehicle/${profile.vehicle.id}/contribute`)}
                  className="btn btn-primary flex-1"
                >
                  Start Contributing
                </button>
                <button
                  onClick={() => setShowSubmissionForm(false)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default PublicVehicleProfile;
