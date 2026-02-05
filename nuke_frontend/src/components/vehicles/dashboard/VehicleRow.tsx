import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ScoreBadge } from './ScoreBadge';

interface VehicleRowProps {
  vehicleId: string;
  year: number | null;
  make: string | null;
  model: string | null;
  subtitle: string;
  eventCount?: number;
  imageCount?: number;
  confidenceScore: number;
  interactionScore: number;
  backgroundColor?: string;
  thumbnailUrl?: string | null;
  onLogWork?: () => void;
  onUpload?: () => void;
  onEdit?: () => void;
}

export const VehicleRow: React.FC<VehicleRowProps> = ({
  vehicleId,
  year,
  make,
  model,
  subtitle,
  eventCount,
  imageCount,
  confidenceScore,
  interactionScore,
  backgroundColor,
  thumbnailUrl,
  onLogWork,
  onUpload,
  onEdit
}) => {
  const navigate = useNavigate();

  const vehicleTitle = [year, make, model].filter(Boolean).join(' ') || 'Unknown Vehicle';

  const handleClick = () => {
    navigate(`/vehicle/${vehicleId}`);
  };

  const handleLogWork = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onLogWork) {
      onLogWork();
    } else {
      navigate(`/vehicles/${vehicleId}?action=log`);
    }
  };

  const handleUpload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onUpload) {
      onUpload();
    } else {
      navigate(`/vehicles/${vehicleId}?action=upload`);
    }
  };

  return (
    <div
      onClick={handleClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '10px 12px',
        background: backgroundColor || 'var(--surface)',
        borderBottom: '1px solid var(--border-light)',
        cursor: 'pointer',
        transition: 'background 0.1s ease',
        gap: '12px'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--surface-hover)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = backgroundColor || 'var(--surface)';
      }}
    >
      {/* Thumbnail */}
      <div style={{
        width: '48px',
        height: '36px',
        borderRadius: '3px',
        overflow: 'hidden',
        flexShrink: 0,
        background: 'var(--grey-200)'
      }}>
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt=""
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover'
            }}
            loading="lazy"
          />
        ) : (
          <div style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '10px',
            color: 'var(--text-muted)'
          }}>
            —
          </div>
        )}
      </div>

      {/* Vehicle Title */}
      <div style={{ flex: '1 1 200px', minWidth: '150px' }}>
        <div style={{
          fontSize: '9pt',
          fontWeight: 600,
          color: 'var(--text)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}>
          {vehicleTitle}
        </div>
        <div style={{
          fontSize: '7pt',
          color: 'var(--text-muted)',
          marginTop: '2px'
        }}>
          {subtitle}
        </div>
      </div>

      {/* Stats */}
      {(eventCount !== undefined || imageCount !== undefined) && (
        <div style={{
          flex: '0 0 auto',
          display: 'flex',
          gap: '12px',
          fontSize: '8pt',
          color: 'var(--text-muted)',
          fontFamily: 'monospace'
        }}>
          {eventCount !== undefined && (
            <span title="Timeline Events">{eventCount}ev</span>
          )}
          {imageCount !== undefined && (
            <span title="Images">{imageCount}img</span>
          )}
        </div>
      )}

      {/* Scores */}
      <div style={{ flex: '0 0 auto' }}>
        <ScoreBadge
          confidence={confidenceScore}
          interaction={interactionScore}
          compact
        />
      </div>

      {/* Quick Actions */}
      <div style={{
        flex: '0 0 auto',
        display: 'flex',
        gap: '4px'
      }}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit?.();
          }}
          title="Edit Vehicle"
          style={{
            padding: '4px 8px',
            fontSize: '7pt',
            fontWeight: 600,
            background: 'var(--surface-hover)',
            border: '1px solid var(--border)',
            borderRadius: '2px',
            cursor: 'pointer',
            color: 'var(--text-muted)'
          }}
        >
          EDIT
        </button>
        <button
          type="button"
          onClick={handleLogWork}
          title="Log Work"
          style={{
            padding: '4px 8px',
            fontSize: '7pt',
            fontWeight: 600,
            background: 'var(--surface-hover)',
            border: '1px solid var(--border)',
            borderRadius: '2px',
            cursor: 'pointer',
            color: 'var(--text-muted)'
          }}
        >
          LOG
        </button>
        <button
          type="button"
          onClick={handleUpload}
          title="Upload Images"
          style={{
            padding: '4px 8px',
            fontSize: '7pt',
            fontWeight: 600,
            background: 'var(--surface-hover)',
            border: '1px solid var(--border)',
            borderRadius: '2px',
            cursor: 'pointer',
            color: 'var(--text-muted)'
          }}
        >
          IMG
        </button>
      </div>
    </div>
  );
};

export default VehicleRow;
