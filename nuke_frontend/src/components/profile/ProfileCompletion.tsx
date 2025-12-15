// Profile Completion Component - Shows completion progress and actionable items
import React from 'react';
import type { ProfileCompletion as ProfileCompletionType } from '../../types/profile';

interface ProfileCompletionProps {
  completion: ProfileCompletionType | null;
  onActionClick: (action: string) => void;
}

const ProfileCompletion: React.FC<ProfileCompletionProps> = ({ completion, onActionClick }) => {
  if (!completion) return null;

  const completionItems = [
    {
      key: 'basic_info_complete',
      label: 'Basic Information',
      description: 'Add your name and basic details',
      action: 'edit_basic_info',
      completed: completion.basic_info_complete
    },
    {
      key: 'avatar_uploaded',
      label: 'Profile Photo',
      description: 'Upload a profile picture',
      action: 'upload_avatar',
      completed: completion.avatar_uploaded
    },
    {
      key: 'bio_added',
      label: 'Bio',
      description: 'Tell others about yourself',
      action: 'edit_bio',
      completed: completion.bio_added
    },
    {
      key: 'location_added',
      label: 'Location',
      description: 'Add your location',
      action: 'edit_location',
      completed: completion.location_added
    },
    {
      key: 'social_links_added',
      label: 'Social Links',
      description: 'Connect your social profiles',
      action: 'edit_social',
      completed: completion.social_links_added
    },
    {
      key: 'first_vehicle_added',
      label: 'First Vehicle',
      description: 'Add your first vehicle',
      action: 'add_vehicle',
      completed: completion.first_vehicle_added
    }
  ];

  const completedCount = completionItems.filter(item => item.completed).length;
  const totalCount = completionItems.length;
  // Derive percentage from booleans to avoid stale backend value
  const percentage = Math.round((completedCount / Math.max(totalCount, 1)) * 100);

  // Auto-hide when fully complete; parent also guards, but this is defensive
  if (completedCount === totalCount) return null;

  return (
    <div className="card">
      <div className="card-body">
        <h3 className="text font-bold">Profile Completion</h3>
        
        {/* Progress Bar */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span className="text-small">Progress</span>
            <span className="text-small font-bold">{percentage}%</span>
          </div>
          <div style={{ 
            width: '100%', 
            height: '8px', 
            backgroundColor: 'var(--surface)', 
            borderRadius: '4px',
            overflow: 'hidden'
          }}>
            <div style={{
              width: `${percentage}%`,
              height: '100%',
              backgroundColor: percentage === 100 ? '#22c55e' : '#3b82f6',
              transition: 'width 0.3s ease'
            }} />
          </div>
          <p className="text-small text-muted" style={{ marginTop: '4px' }}>
            {completedCount} of {totalCount} items completed
          </p>
        </div>

        {/* Completion Items */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {completionItems.map(item => (
            <div 
              key={item.key}
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between',
                padding: '8px',
                backgroundColor: item.completed ? '#f0fdf4' : '#fafafa',
                borderRadius: '4px',
                border: item.completed ? '1px solid #22c55e' : '1px solid #e5e5e5'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{
                  width: '16px',
                  height: '16px',
                  borderRadius: '50%',
                  backgroundColor: item.completed ? '#22c55e' : '#e5e5e5',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  {item.completed && (
                    <span style={{ color: 'white', fontSize: '8pt' }}>✓</span>
                  )}
                </div>
                <div>
                  <div className="text-small font-bold">{item.label}</div>
                  <div className="text-small text-muted">{item.description}</div>
                </div>
              </div>
              
              {!item.completed && (
                <button 
                  className="button button-primary"
                  style={{ fontSize: '8pt', padding: '4px 8px' }}
                  onClick={() => onActionClick(item.action)}
                >
                  Complete
                </button>
              )}
            </div>
          ))}
        </div>

        {percentage === 100 && (
          <div style={{ 
            marginTop: '16px', 
            padding: '12px', 
            backgroundColor: '#f0fdf4', 
            borderRadius: '4px',
            border: '1px solid #22c55e'
          }}>
            <div className="text-small font-bold" style={{ color: '#16a34a', fontSize: '8pt' }}>
              Profile Complete
            </div>
            <div className="text-small" style={{ color: '#16a34a', fontSize: '8pt' }}>
              Your profile is fully set up and ready to showcase your vehicles.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProfileCompletion;
