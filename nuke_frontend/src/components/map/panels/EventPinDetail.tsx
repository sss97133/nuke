import React from 'react';
import { getConfidenceTier, getConfidenceLabel } from '../types';
import type { MapEventPoint } from '../types';
import { MAP_FONT, EVENT_COLORS } from '../constants';
import { thumbUrl } from '../mapService';

interface Props {
  event: MapEventPoint;
  onBack: () => void;
  onViewVehicle: (vehicleId: string) => void;
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  listing: 'LISTING',
  sighting: 'SIGHTING',
  auction: 'AUCTION',
  sale: 'SALE',
};

export default function EventPinDetail({ event, onBack, onViewVehicle }: Props) {
  const title = [event.year, event.make, event.model].filter(Boolean).join(' ') || 'Unknown Vehicle';
  const tier = getConfidenceTier(event.confidence);
  const tierLabel = getConfidenceLabel(tier);
  const eventLabel = EVENT_TYPE_LABELS[event.event_type] || event.event_type.toUpperCase();
  const color = EVENT_COLORS[event.event_type] || EVENT_COLORS.default;
  const colorStr = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;

  const observedDate = event.observed_at
    ? new Date(event.observed_at).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <div style={{ fontFamily: MAP_FONT, fontSize: 11 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
        <button onClick={onBack} style={backBtnStyle}>BACK</button>
      </div>

      {/* Thumbnail */}
      {event.thumbnail && (
        <div style={{ width: '100%', height: 160, overflow: 'hidden' }}>
          <img
            src={thumbUrl(event.thumbnail) || event.thumbnail}
            alt={title}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      )}

      <div style={{ padding: '12px' }}>
        {/* Event type badge */}
        <div style={{
          display: 'inline-block', fontSize: 8, fontWeight: 700,
          padding: '2px 6px', border: `1px solid ${colorStr}`, color: colorStr,
          letterSpacing: '0.5px', marginBottom: 8,
        }}>
          {eventLabel}
        </div>

        {/* Confidence badge */}
        <div style={{
          display: 'inline-block', fontSize: 7, fontWeight: 600,
          padding: '2px 5px', marginLeft: 4,
          border: '1px solid var(--border)', color: 'var(--text-secondary)',
          letterSpacing: '0.3px', marginBottom: 8,
        }}>
          {tierLabel} ({Math.round(event.confidence * 100)}%)
        </div>

        {/* Title */}
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{title}</div>

        {/* Timestamp */}
        {observedDate && (
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 6 }}>
            {observedDate}
          </div>
        )}

        {/* Location */}
        {event.location && (
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 6 }}>
            {event.location}
          </div>
        )}

        {/* Price */}
        {event.price && (
          <div style={{ fontSize: 16, fontFamily: 'Courier New, monospace', fontWeight: 700, color: 'var(--success, #16825d)', marginBottom: 8 }}>
            ${event.price.toLocaleString()}
          </div>
        )}

        {/* Source */}
        {event.source && (
          <div style={{ fontSize: 8, color: 'var(--text-disabled)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
            SOURCE: {event.source}
          </div>
        )}

        {/* Coordinates */}
        <div style={{ fontSize: 8, fontFamily: 'Courier New, monospace', color: 'var(--text-disabled)', marginBottom: 12 }}>
          {event.lat.toFixed(4)}, {event.lng.toFixed(4)}
        </div>

        {/* View Vehicle button */}
        <button
          onClick={() => onViewVehicle(event.vehicle_id)}
          style={{
            display: 'block', width: '100%', textAlign: 'center', padding: '10px',
            background: 'transparent', color: colorStr, cursor: 'pointer',
            fontWeight: 700, fontSize: 10, fontFamily: MAP_FONT,
            border: `1px solid ${colorStr}`, textTransform: 'uppercase', letterSpacing: '0.5px',
          }}
        >
          VIEW VEHICLE
        </button>
      </div>
    </div>
  );
}

const backBtnStyle: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)',
  fontSize: 9, fontWeight: 700, fontFamily: MAP_FONT, cursor: 'pointer', padding: '4px 8px',
  textTransform: 'uppercase', letterSpacing: '0.5px',
};
