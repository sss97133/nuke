/**
 * ImageSetManager - Main component for viewing and managing image sets
 * Displays all image sets for a vehicle with management controls
 */

import React, { useState, useEffect } from 'react';
import { ImageSet, ImageSetService } from '../../services/imageSetService';
import { ImageSetModal } from './ImageSetModal';
import { supabase } from '../../lib/supabase';

interface ImageSetManagerProps {
  vehicleId: string;
  onSetSelected?: (setId: string | null) => void;
  onRequestAddImages?: (setId: string) => void;
}

export const ImageSetManager: React.FC<ImageSetManagerProps> = ({
  vehicleId,
  onSetSelected,
  onRequestAddImages
}) => {
  const [sets, setSets] = useState<ImageSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSet, setEditingSet] = useState<ImageSet | null>(null);
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [session, setSession] = useState<any>(null);

  useEffect(() => {
    loadSets();
    checkAuth();
  }, [vehicleId]);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setSession(session);
  };

  const loadSets = async () => {
    try {
      setLoading(true);
      const data = await ImageSetService.getImageSets(vehicleId);
      setSets(data);
    } catch (err) {
      console.error('Error loading image sets:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSet = () => {
    setEditingSet(null);
    setModalOpen(true);
  };

  const handleEditSet = (set: ImageSet) => {
    setEditingSet(set);
    setModalOpen(true);
  };

  const handleDeleteSet = async (setId: string) => {
    if (!confirm('Are you sure you want to delete this image set? Images will not be deleted, only the set.')) {
      return;
    }

    try {
      await ImageSetService.deleteImageSet(setId);
      setSets(prev => prev.filter(s => s.id !== setId));
      if (selectedSetId === setId) {
        setSelectedSetId(null);
        onSetSelected?.(null);
      }
    } catch (err) {
      console.error('Error deleting set:', err);
      alert('Failed to delete image set');
    }
  };

  const handleSetSaved = (set: ImageSet) => {
    loadSets(); // Reload all sets
  };

  const handleViewSet = (setId: string) => {
    if (selectedSetId === setId) {
      // Deselect if clicking same set
      setSelectedSetId(null);
      onSetSelected?.(null);
    } else {
      setSelectedSetId(setId);
      onSetSelected?.(setId);
    }
  };

  if (loading) {
    return (
      <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="card-body">
          <p className="text text-muted" style={{ fontSize: '8pt' }}>Loading image sets...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
      {/* Header */}
      <div
        className="card-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          borderBottom: expanded ? '2px solid var(--border)' : 'none'
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <h3 className="text" style={{ fontWeight: 700, fontSize: '10pt', margin: 0 }}>
          IMAGE SETS ({sets.length})
        </h3>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          {session && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleCreateSet();
              }}
              className="button button-primary"
              style={{ fontSize: '8pt', padding: 'var(--space-1) var(--space-2)' }}
            >
              + New Set
            </button>
          )}
          <span className="text" style={{ fontSize: '9pt' }}>
            {expanded ? '▼' : '▶'}
          </span>
        </div>
      </div>

      {/* Content */}
      {expanded && (
        <div className="card-body" style={{ padding: 'var(--space-3)' }}>
          {sets.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-4)' }}>
              <p className="text text-muted" style={{ marginBottom: 'var(--space-2)' }}>
                No image sets yet
              </p>
              {session && (
                <button
                  onClick={handleCreateSet}
                  className="button button-primary"
                  style={{ fontSize: '8pt', padding: 'var(--space-2) var(--space-3)' }}
                >
                  Create Your First Set
                </button>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {sets.map((set) => (
                <div
                  key={set.id}
                  className="card"
                  style={{
                    border: selectedSetId === set.id ? '3px solid var(--grey-900)' : '2px solid var(--border)',
                    backgroundColor: selectedSetId === set.id ? 'var(--grey-100)' : 'var(--white)'
                  }}
                >
                  <div style={{ padding: 'var(--space-3)' }}>
                    {/* Set Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 'var(--space-2)' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
                          <div
                            style={{
                              width: '16px',
                              height: '16px',
                              backgroundColor: set.color,
                              border: '1px solid var(--border)',
                              flexShrink: 0
                            }}
                          />
                          {set.icon && (
                            <span className="text" style={{ fontSize: '8pt' }}>{set.icon}</span>
                          )}
                          <h4 className="text" style={{ fontWeight: 700, fontSize: '9pt', margin: 0 }}>
                            {set.name}
                          </h4>
                          {set.is_primary && (
                            <span
                              className="button button-small"
                              style={{
                                fontSize: '6pt',
                                padding: '2px 6px',
                                backgroundColor: 'var(--grey-600)',
                                color: 'var(--white)'
                              }}
                            >
                              PRIMARY
                            </span>
                          )}
                        </div>

                        {set.description && (
                          <p className="text text-muted" style={{ fontSize: '8pt', margin: 0, marginBottom: 'var(--space-1)' }}>
                            {set.description}
                          </p>
                        )}

                        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                          <span className="text" style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                            {set.image_count || 0} images
                          </span>
                          {set.event_date && (
                            <span className="text" style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                              {new Date(set.event_date).toLocaleDateString()}
                            </span>
                          )}
                          {set.timeline_event_id && (
                            <span className="text" style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                              Linked to Timeline
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Actions Dropdown */}
                      <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                        <button
                          onClick={() => handleViewSet(set.id)}
                          className={selectedSetId === set.id ? 'button button-primary' : 'button'}
                          style={{ fontSize: '7pt', padding: 'var(--space-1) var(--space-2)' }}
                        >
                          {selectedSetId === set.id ? 'Viewing' : 'View'}
                        </button>
                        {session && (
                          <>
                            <button
                              onClick={() => onRequestAddImages?.(set.id)}
                              className="button"
                              style={{ fontSize: '7pt', padding: 'var(--space-1) var(--space-2)' }}
                            >
                              Add Images
                            </button>
                            <button
                              onClick={() => handleEditSet(set)}
                              className="button"
                              style={{ fontSize: '7pt', padding: 'var(--space-1) var(--space-2)' }}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteSet(set.id)}
                              className="button"
                              style={{
                                fontSize: '7pt',
                                padding: 'var(--space-1) var(--space-2)',
                                border: '2px solid var(--error)',
                                color: 'var(--error)'
                              }}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Visual Progress Bar (showing image distribution) */}
                    {set.image_count && set.image_count > 0 && (
                      <div
                        style={{
                          display: 'flex',
                          gap: '2px',
                          height: '4px',
                          marginTop: 'var(--space-2)',
                          opacity: 0.5
                        }}
                      >
                        {Array.from({ length: Math.min(set.image_count, 20) }).map((_, i) => (
                          <div
                            key={i}
                            style={{
                              flex: 1,
                              backgroundColor: set.color,
                              border: '1px solid var(--white)'
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      <ImageSetModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingSet(null);
        }}
        onSaved={handleSetSaved}
        vehicleId={vehicleId}
        editingSet={editingSet}
      />
    </div>
  );
};

