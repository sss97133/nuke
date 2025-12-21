/**
 * Profile Success Stories Tab
 * Displays success stories (BaT-style) for user or organization
 */

import React from 'react';
import { Link } from 'react-router-dom';
import VehicleThumbnail from '../VehicleThumbnail';

interface SuccessStory {
  id: string;
  title: string;
  story_text: string;
  story_date?: string;
  story_type?: string;
  vehicle?: any;
  source_url?: string;
  view_count?: number;
}

interface ProfileSuccessStoriesTabProps {
  stories: SuccessStory[];
  profileType: 'user' | 'organization';
}

export const ProfileSuccessStoriesTab: React.FC<ProfileSuccessStoriesTabProps> = ({ stories, profileType }) => {
  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  };

  if (stories.length === 0) {
    return (
      <div style={{
        padding: 'var(--space-6)',
        textAlign: 'center',
        color: 'var(--text-muted)',
        fontSize: '8pt',
      }}>
        No success stories yet
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-4)',
    }}>
      {stories.map((story) => {
        const vehicle = story.vehicle;
        const vehicleName = vehicle
          ? `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim()
          : null;

        return (
          <div
            key={story.id}
            style={{
              padding: 'var(--space-4)',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
            }}
          >
            {/* Header */}
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <h3 style={{
                fontSize: '10pt',
                fontWeight: 'bold',
                margin: 0,
                marginBottom: '4px',
              }}>
                {story.source_url ? (
                  <a
                    href={story.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--text)', textDecoration: 'none' }}
                  >
                    {story.title}
                  </a>
                ) : (
                  story.title
                )}
              </h3>
              {story.story_date && (
                <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                  {formatDate(story.story_date)}
                </div>
              )}
            </div>

            {/* Vehicle Thumbnail (if available) */}
            {vehicle?.id && (
              <div style={{ marginBottom: 'var(--space-3)', width: '200px' }}>
                <Link to={`/vehicle/${vehicle.id}`}>
                  <VehicleThumbnail vehicleId={vehicle.id} />
                </Link>
                {vehicleName && (
                  <div style={{ fontSize: '8pt', marginTop: '4px', fontWeight: 'bold' }}>
                    <Link
                      to={`/vehicle/${vehicle.id}`}
                      style={{ color: 'var(--text)', textDecoration: 'none' }}
                    >
                      {vehicleName}
                    </Link>
                  </div>
                )}
              </div>
            )}

            {/* Story Text */}
            <div style={{
              fontSize: '8pt',
              lineHeight: '1.6',
              color: 'var(--text)',
              whiteSpace: 'pre-wrap',
            }}>
              {story.story_text}
            </div>

            {/* Footer */}
            {story.view_count !== undefined && story.view_count > 0 && (
              <div style={{
                marginTop: 'var(--space-3)',
                fontSize: '7pt',
                color: 'var(--text-muted)',
              }}>
                {story.view_count.toLocaleString()} views
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

