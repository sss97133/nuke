import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

interface MessageCardProps {
  id: string;
  type: string;
  priority: 1 | 2 | 3 | 4 | 5;
  title: string;
  message: string;
  metadata?: {
    vehicle_id?: string;
    vehicle_name?: string;
    organization_id?: string;
    organization_name?: string;
    confidence?: number;
    match_type?: string;
    action_url?: string;
    [key: string]: any;
  };
  is_read: boolean;
  created_at: string;
  expires_at?: string;
  actions?: Array<{
    id: string;
    label: string;
    type: 'primary' | 'secondary' | 'danger' | 'link';
    handler: () => void;
  }>;
  onMarkRead?: (id: string) => void;
  onClick?: () => void;
}

const getPriorityColor = (priority: number): string => {
  const colors: Record<number, string> = {
    1: '#dc2626',
    2: '#f59e0b',
    3: '#3b82f6',
    4: '#10b981',
    5: '#6b7280'
  };
  return colors[priority] || '#6b7280';
};

const getPriorityBackground = (priority: number): string => {
  const backgrounds: Record<number, string> = {
    1: '#fef2f2',
    2: '#fffbeb',
    3: '#f8fafc',
    4: '#f0fdf4',
    5: '#ffffff'
  };
  return backgrounds[priority] || '#ffffff';
};

const getMessageIcon = (type: string): string => {
  const icons: Record<string, string> = {
    'work_approval_request': 'WRENCH',
    'vehicle_merged': 'MERGE',
    'pending_vehicle_assignment': 'LINK',
    'document_extraction_pending': 'DOCUMENT',
    'photo_approval': 'IMAGE',
    'offer_received': 'DOLLAR',
    'auction_ending_soon': 'CLOCK',
    'vehicle_listed': 'CAR',
    'new_images_added': 'PHOTO',
    'timeline_contribution': 'CALENDAR',
    'ownership_verification_pending': 'CHECK',
    'contribution_request': 'USER',
    'vin_request': 'KEY',
    'system_alert': 'GEAR'
  };
  return icons[type] || 'INFO';
};

const formatTimeAgo = (timestamp: string): string => {
  const now = new Date();
  const time = new Date(timestamp);
  const diffMs = now.getTime() - time.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return time.toLocaleDateString();
};

export const MessageCard: React.FC<MessageCardProps> = ({
  id,
  type,
  priority,
  title,
  message,
  metadata,
  is_read,
  created_at,
  actions,
  onMarkRead,
  onClick
}) => {
  const navigate = useNavigate();
  const [vehicleImageUrl, setVehicleImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (metadata?.vehicle_id) {
      loadVehicleImage(metadata.vehicle_id);
    }
  }, [metadata?.vehicle_id]);

  const loadVehicleImage = async (vehicleId: string) => {
    try {
      const { data, error } = await supabase
        .from('vehicle_images')
        .select('image_url, thumbnail_url, large_url, variants, is_primary')
        .eq('vehicle_id', vehicleId)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(1);

      if (error) throw error;

      const image = data?.[0];
      if (image) {
        setVehicleImageUrl(image.thumbnail_url || image.variants?.medium || image.variants?.large || image.image_url || null);
      }
    } catch (error) {
      console.error('Error loading vehicle image:', error);
    }
  };

  // Determine if this needs yes/no confirmation
  const needsConfirmation = actions?.some(a => 
    a.id === 'approve' || a.id === 'reject' || 
    a.label.toLowerCase() === 'approve' || a.label.toLowerCase() === 'reject'
  );

  // Get yes/no actions
  const yesAction = actions?.find(a => 
    a.id === 'approve' || a.label.toLowerCase() === 'approve' || a.type === 'primary'
  );
  const noAction = actions?.find(a => 
    a.id === 'reject' || a.label.toLowerCase() === 'reject' || a.type === 'danger'
  );
  
  // Handle loading state
  if (type === 'loading') {
    return (
      <div
        style={{
          fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
          fontSize: '8pt',
          background: '#f5f5f5',
          borderLeft: '1px solid #bdbdbd',
          padding: '8px',
          marginBottom: '4px',
          color: '#757575'
        }}
      >
        {'>'} Loading...
      </div>
    );
  }
  
  const borderColor = getPriorityColor(priority);
  const backgroundColor = is_read ? '#ffffff' : getPriorityBackground(priority);
  const borderWidth = is_read ? '1px' : '4px';

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else if (metadata?.vehicle_id) {
      navigate(`/vehicle/${metadata.vehicle_id}`);
    } else if (metadata?.action_url) {
      navigate(metadata.action_url);
    }
  };

  return (
    <div
      style={{
        fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
        fontSize: '8pt',
        lineHeight: '1.2',
        background: backgroundColor,
        borderLeft: `${borderWidth} solid ${borderColor}`,
        borderBottom: '1px solid #bdbdbd',
        padding: '8px 8px 8px 4px',
        marginBottom: '4px',
        cursor: (onClick || metadata?.vehicle_id || metadata?.action_url) && !needsConfirmation ? 'pointer' : 'default',
        position: 'relative'
      }}
      onClick={needsConfirmation ? undefined : handleClick}
    >
      {/* Unread indicator */}
      {!is_read && (
        <div
          style={{
            position: 'absolute',
            left: '4px',
            top: '50%',
            transform: 'translateY(-50%)',
            width: '4px',
            height: '4px',
            background: '#3b82f6',
            borderRadius: '50%'
          }}
        />
      )}

      {/* Message content */}
      <div style={{ paddingLeft: is_read ? '0' : '12px', display: 'flex', gap: '12px' }}>
        {/* Vehicle Image */}
        {vehicleImageUrl && (
          <div style={{ flex: '0 0 60px', height: '60px', background: '#f0f0f0', border: '1px solid #bdbdbd', overflow: 'hidden' }}>
            <img
              src={vehicleImageUrl}
              alt="Vehicle"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover'
              }}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none'
              }}
            />
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Type header */}
          <div style={{ color: '#757575', marginBottom: '4px' }}>
            {'>'} {getMessageIcon(type)} {type}
          </div>

          {/* Title */}
          <div
            style={{
              color: is_read ? '#424242' : '#000000',
              fontWeight: is_read ? 'normal' : '600',
              marginBottom: '4px'
            }}
          >
            {title}
          </div>

          {/* Message body / Data Point */}
          <div style={{ color: '#424242', marginBottom: '4px', whiteSpace: 'pre-wrap', fontWeight: needsConfirmation ? '500' : 'normal' }}>
            {message}
          </div>
        {/* Metadata */}
        {metadata && (
          <div style={{ color: '#757575', marginTop: '4px', marginBottom: '4px' }}>
            {metadata.vehicle_name && (
              <div>vehicle: <span style={{ color: '#000000' }}>{metadata.vehicle_name}</span></div>
            )}
            {metadata.organization_name && (
              <div>organization: <span style={{ color: '#000000' }}>{metadata.organization_name}</span></div>
            )}
            {metadata.confidence !== undefined && (
              <div>confidence: <span style={{ color: '#000000' }}>{metadata.confidence}%</span></div>
            )}
            {metadata.match_type && (
              <div>match_type: <span style={{ color: '#000000' }}>{metadata.match_type}</span></div>
            )}
          </div>
        )}

        {/* Timestamp */}
        <div style={{ color: '#9e9e9e', marginTop: '4px', fontSize: '7pt' }}>
          created: {formatTimeAgo(created_at)}
        </div>

        {/* Yes/No Actions */}
        {needsConfirmation && (yesAction || noAction) ? (
          <div
            style={{
              marginTop: '8px',
              display: 'flex',
              gap: '8px',
              alignItems: 'center'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {yesAction && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  yesAction.handler();
                }}
                style={{
                  fontSize: '9pt',
                  fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
                  padding: '6px 16px',
                  border: '1px solid #059669',
                  background: '#059669',
                  color: 'white',
                  cursor: 'pointer',
                  fontWeight: '600'
                }}
              >
                YES
              </button>
            )}
            {noAction && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  // If handler accepts a callback for notes, trigger it
                  // Otherwise call directly
                  if (noAction.handler.length > 0) {
                    // Handler expects a callback that provides notes
                    const notes = prompt('Why are you rejecting this? (Optional)');
                    if (notes !== null) {
                      noAction.handler(notes || undefined);
                    }
                  } else {
                    noAction.handler();
                  }
                }}
                style={{
                  fontSize: '9pt',
                  fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
                  padding: '6px 16px',
                  border: '1px solid #dc2626',
                  background: '#ffffff',
                  color: '#dc2626',
                  cursor: 'pointer',
                  fontWeight: '600'
                }}
              >
                NO
              </button>
            )}
          </div>
        ) : actions && actions.length > 0 ? (
          <div
            style={{
              marginTop: '8px',
              display: 'flex',
              gap: '4px',
              flexWrap: 'wrap'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {actions.map((action) => (
              <button
                key={action.id}
                onClick={(e) => {
                  e.stopPropagation();
                  action.handler();
                }}
                style={{
                  fontSize: '8pt',
                  fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
                  padding: '4px 8px',
                  border: '1px solid #bdbdbd',
                  background: '#ffffff',
                  cursor: 'pointer',
                  color: '#000000'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#f5f5f5';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#ffffff';
                }}
              >
                [{action.label}]
              </button>
            ))}
          </div>
        ) : null}

        {/* Mark read button */}
        {!is_read && onMarkRead && (
          <div
            style={{
              marginTop: '4px',
              display: 'inline-block'
            }}
            onClick={(e) => {
              e.stopPropagation();
              onMarkRead(id);
            }}
          >
            <button
              style={{
                fontSize: '8pt',
                fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
                padding: '2px 6px',
                border: '1px solid #bdbdbd',
                background: '#ffffff',
                cursor: 'pointer',
                color: '#757575'
              }}
            >
              [mark_read]
            </button>
          </div>
        )}
      </div>
    </div>
    </div>
  );
};

