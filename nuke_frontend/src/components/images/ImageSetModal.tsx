/**
 * ImageSetModal - Create and Edit Image Sets
 * Modal component for managing image set properties
 */

import React, { useState, useEffect } from 'react';
import { ImageSet, ImageSetService } from '../../services/imageSetService';
import { supabase } from '../../lib/supabase';

interface ImageSetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (set: ImageSet) => void;
  vehicleId: string;
  editingSet?: ImageSet | null;
}

const PRESET_COLORS = [
  { value: '#808080', label: 'Gray' },
  { value: '#FF5733', label: 'Red' },
  { value: '#FFA500', label: 'Orange' },
  { value: '#FFD700', label: 'Gold' },
  { value: '#90EE90', label: 'Green' },
  { value: '#87CEEB', label: 'Blue' },
  { value: '#DDA0DD', label: 'Purple' },
  { value: '#FFB6C1', label: 'Pink' },
];

export const ImageSetModal: React.FC<ImageSetModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  vehicleId,
  editingSet
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#808080');
  const [icon, setIcon] = useState('');
  const [timelineEventId, setTimelineEventId] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<any[]>([]);

  // Load timeline events for linking
  useEffect(() => {
    if (isOpen && vehicleId) {
      loadTimelineEvents();
    }
  }, [isOpen, vehicleId]);

  // Populate form when editing
  useEffect(() => {
    if (editingSet) {
      setName(editingSet.name);
      setDescription(editingSet.description || '');
      setColor(editingSet.color);
      setIcon(editingSet.icon || '');
      setTimelineEventId(editingSet.timeline_event_id || '');
      setEventDate(editingSet.event_date ? new Date(editingSet.event_date).toISOString().split('T')[0] : '');
    } else {
      // Reset form for new set
      setName('');
      setDescription('');
      setColor('#808080');
      setIcon('');
      setTimelineEventId('');
      setEventDate('');
    }
    setError(null);
  }, [editingSet, isOpen]);

  const loadTimelineEvents = async () => {
    try {
      const { data, error } = await supabase
        .from('timeline_events')
        .select('id, event_type, event_date, description')
        .eq('vehicle_id', vehicleId)
        .order('event_date', { ascending: false })
        .limit(50);

      if (error) throw error;
      setTimelineEvents(data || []);
    } catch (err) {
      console.error('Error loading timeline events:', err);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Set name is required');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (editingSet) {
        // Update existing set
        const updated = await ImageSetService.updateImageSet(editingSet.id, {
          name: name.trim(),
          description: description.trim() || undefined,
          color,
          icon: icon.trim() || undefined,
          timeline_event_id: timelineEventId || undefined,
          event_date: eventDate || undefined
        });
        if (updated) {
          onSaved(updated);
          onClose();
        }
      } else {
        // Create new set
        const created = await ImageSetService.createImageSet({
          vehicleId,
          name: name.trim(),
          description: description.trim() || undefined,
          color,
          icon: icon.trim() || undefined,
          timelineEventId: timelineEventId || undefined,
          eventDate: eventDate || undefined
        });
        if (created) {
          onSaved(created);
          onClose();
        }
      }
    } catch (err: any) {
      console.error('Error saving image set:', err);
      setError(err.message || 'Failed to save image set');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: 'var(--space-4)'
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '500px',
          maxHeight: '90vh',
          overflow: 'auto',
          backgroundColor: 'var(--white)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-header" style={{ borderBottom: '2px solid var(--border)' }}>
          <h3 className="text" style={{ fontWeight: 700, fontSize: '11pt', margin: 0 }}>
            {editingSet ? 'Edit Image Set' : 'Create Image Set'}
          </h3>
        </div>

        <div className="card-body" style={{ padding: 'var(--space-4)' }}>
          {error && (
            <div style={{
              padding: 'var(--space-2)',
              backgroundColor: 'var(--error-light)',
              border: '2px solid var(--error)',
              marginBottom: 'var(--space-3)',
              color: 'var(--error-dark)'
            }}>
              <p className="text" style={{ fontSize: '8pt', margin: 0 }}>{error}</p>
            </div>
          )}

          {/* Name */}
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <label className="text" style={{ display: 'block', marginBottom: 'var(--space-1)', fontWeight: 700, fontSize: '8pt' }}>
              Set Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Restoration Progress, Engine Bay, Before & After"
              className="form-input"
              style={{ width: '100%', fontSize: '9pt', padding: 'var(--space-2)' }}
              maxLength={100}
            />
          </div>

          {/* Description */}
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <label className="text" style={{ display: 'block', marginBottom: 'var(--space-1)', fontWeight: 700, fontSize: '8pt' }}>
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description of this image set"
              className="form-input"
              style={{ width: '100%', fontSize: '9pt', padding: 'var(--space-2)', minHeight: '80px', resize: 'vertical' }}
              maxLength={500}
            />
          </div>

          {/* Color */}
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <label className="text" style={{ display: 'block', marginBottom: 'var(--space-1)', fontWeight: 700, fontSize: '8pt' }}>
              Color Tag
            </label>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {PRESET_COLORS.map((preset) => (
                <button
                  key={preset.value}
                  onClick={() => setColor(preset.value)}
                  className="button"
                  style={{
                    width: '40px',
                    height: '40px',
                    padding: 0,
                    backgroundColor: preset.value,
                    border: color === preset.value ? '3px solid var(--grey-900)' : '2px solid var(--border)',
                    cursor: 'pointer'
                  }}
                  title={preset.label}
                />
              ))}
            </div>
          </div>

          {/* Icon (optional) */}
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <label className="text" style={{ display: 'block', marginBottom: 'var(--space-1)', fontWeight: 700, fontSize: '8pt' }}>
              Icon (optional)
            </label>
            <input
              type="text"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="e.g., wrench, camera, star"
              className="form-input"
              style={{ width: '100%', fontSize: '9pt', padding: 'var(--space-2)' }}
              maxLength={20}
            />
            <p className="text text-muted" style={{ fontSize: '7pt', marginTop: 'var(--space-1)' }}>
              Used for quick visual identification
            </p>
          </div>

          {/* Link to Timeline Event */}
          {timelineEvents.length > 0 && (
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <label className="text" style={{ display: 'block', marginBottom: 'var(--space-1)', fontWeight: 700, fontSize: '8pt' }}>
                Link to Timeline Event
              </label>
              <select
                value={timelineEventId}
                onChange={(e) => setTimelineEventId(e.target.value)}
                className="form-select"
                style={{ width: '100%', fontSize: '9pt', padding: 'var(--space-2)' }}
              >
                <option value="">No timeline link</option>
                {timelineEvents.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.event_date ? new Date(event.event_date).toLocaleDateString() : ''} - {event.event_type} - {event.description || 'No description'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Event Date */}
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <label className="text" style={{ display: 'block', marginBottom: 'var(--space-1)', fontWeight: 700, fontSize: '8pt' }}>
              Event Date (optional)
            </label>
            <input
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              className="form-input"
              style={{ width: '100%', fontSize: '9pt', padding: 'var(--space-2)' }}
            />
            <p className="text text-muted" style={{ fontSize: '7pt', marginTop: 'var(--space-1)' }}>
              When this set represents a specific date/event
            </p>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="card-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', padding: 'var(--space-3)', borderTop: '2px solid var(--border)' }}>
          <button
            onClick={onClose}
            className="button"
            style={{ fontSize: '8pt', padding: 'var(--space-2) var(--space-3)' }}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="button button-primary"
            style={{ fontSize: '8pt', padding: 'var(--space-2) var(--space-3)' }}
            disabled={saving || !name.trim()}
          >
            {saving ? 'Saving...' : editingSet ? 'Update Set' : 'Create Set'}
          </button>
        </div>
      </div>
    </div>
  );
};

