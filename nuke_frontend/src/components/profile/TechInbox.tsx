/**
 * TechInbox - Review and organize daily data from Telegram
 *
 * Allows technicians to:
 * - See all photos/notes submitted via Telegram
 * - Reassign items to correct vehicles
 * - Add labels/categories
 * - Train the system by correcting misattributions
 */

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';

interface TelegramImage {
  id: string;
  image_url: string;
  caption: string | null;
  created_at: string;
  vehicle_id: string;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_vin: string | null;
  category: string | null;
  labels: string[] | null;
  // AI classification
  ai_suggested_vehicle_id: string | null;
  ai_confidence: number | null;
  ai_reasoning: string | null;
  ai_detected_features: any | null;
}

interface TelegramNote {
  id: string;
  note: string;
  created_at: string;
  vehicle_id: string;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_vin: string | null;
}

interface Vehicle {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
}

interface TechInboxProps {
  technicianId?: string;
}

export default function TechInbox({ technicianId }: TechInboxProps) {
  const [images, setImages] = useState<TelegramImage[]>([]);
  const [notes, setNotes] = useState<TelegramNote[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [reassignVehicleId, setReassignVehicleId] = useState<string>('');
  const [filterDate, setFilterDate] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);

  // Load data
  useEffect(() => {
    loadData();
  }, [technicianId]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load images from telegram with AI classifications
      const { data: imgData, error: imgError } = await supabase
        .from('vehicle_images')
        .select(`
          id,
          image_url,
          caption,
          created_at,
          vehicle_id,
          category,
          labels,
          vehicles!inner(year, make, model, vin),
          vehicle_image_classifications(
            suggested_vehicle_id,
            confidence,
            reasoning,
            detected_features,
            auto_applied
          )
        `)
        .eq('source', 'telegram')
        .order('created_at', { ascending: false })
        .limit(100);

      if (imgError) throw imgError;

      const formattedImages: TelegramImage[] = (imgData || []).map((img: any) => {
        const classification = img.vehicle_image_classifications?.[0];
        return {
          id: img.id,
          image_url: img.image_url,
          caption: img.caption,
          created_at: img.created_at,
          vehicle_id: img.vehicle_id,
          vehicle_year: img.vehicles?.year,
          vehicle_make: img.vehicles?.make,
          vehicle_model: img.vehicles?.model,
          vehicle_vin: img.vehicles?.vin,
          category: img.category,
          labels: img.labels,
          ai_suggested_vehicle_id: classification?.suggested_vehicle_id,
          ai_confidence: classification?.confidence,
          ai_reasoning: classification?.reasoning,
          ai_detected_features: classification?.detected_features
        };
      });

      setImages(formattedImages);

      // Load notes from telegram
      const { data: noteData, error: noteError } = await supabase
        .from('vehicle_notes')
        .select(`
          id,
          note,
          created_at,
          vehicle_id,
          vehicles!inner(year, make, model, vin)
        `)
        .eq('source', 'telegram')
        .order('created_at', { ascending: false })
        .limit(100);

      if (noteError) throw noteError;

      const formattedNotes: TelegramNote[] = (noteData || []).map((n: any) => ({
        id: n.id,
        note: n.note,
        created_at: n.created_at,
        vehicle_id: n.vehicle_id,
        vehicle_year: n.vehicles?.year,
        vehicle_make: n.vehicles?.make,
        vehicle_model: n.vehicles?.model,
        vehicle_vin: n.vehicles?.vin
      }));

      setNotes(formattedNotes);

      // Load all vehicles for reassignment dropdown
      const { data: vehData } = await supabase
        .from('vehicles')
        .select('id, year, make, model, vin')
        .order('created_at', { ascending: false })
        .limit(200);

      setVehicles(vehData || []);

    } catch (err) {
      console.error('Failed to load inbox:', err);
    } finally {
      setLoading(false);
    }
  };

  // Toggle item selection
  const toggleSelect = (id: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Select all visible
  const selectAll = () => {
    const allIds = new Set([
      ...images.map(i => `img-${i.id}`),
      ...notes.map(n => `note-${n.id}`)
    ]);
    setSelectedItems(allIds);
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedItems(new Set());
  };

  // Reassign selected items to a different vehicle
  const handleReassign = async () => {
    if (!reassignVehicleId || selectedItems.size === 0) return;

    setSaving(true);
    setMessage(null);

    try {
      const imageIds = Array.from(selectedItems)
        .filter(id => id.startsWith('img-'))
        .map(id => id.replace('img-', ''));

      const noteIds = Array.from(selectedItems)
        .filter(id => id.startsWith('note-'))
        .map(id => id.replace('note-', ''));

      // Update images
      if (imageIds.length > 0) {
        const { error: imgErr } = await supabase
          .from('vehicle_images')
          .update({ vehicle_id: reassignVehicleId })
          .in('id', imageIds);
        if (imgErr) throw imgErr;
      }

      // Update notes
      if (noteIds.length > 0) {
        const { error: noteErr } = await supabase
          .from('vehicle_notes')
          .update({ vehicle_id: reassignVehicleId })
          .in('id', noteIds);
        if (noteErr) throw noteErr;
      }

      const targetVehicle = vehicles.find(v => v.id === reassignVehicleId);
      setMessage(`Moved ${selectedItems.size} items to ${targetVehicle?.year} ${targetVehicle?.make} ${targetVehicle?.model}`);

      // Reload and clear selection
      await loadData();
      setSelectedItems(new Set());
      setReassignVehicleId('');

    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Update category for selected images
  const handleSetCategory = async (category: string) => {
    const imageIds = Array.from(selectedItems)
      .filter(id => id.startsWith('img-'))
      .map(id => id.replace('img-', ''));

    if (imageIds.length === 0) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('vehicle_images')
        .update({ category })
        .in('id', imageIds);

      if (error) throw error;

      setMessage(`Set category to "${category}" for ${imageIds.length} images`);
      await loadData();
      setSelectedItems(new Set());

    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Trigger AI classification for selected images
  const handleAIClassify = async () => {
    const imageIds = Array.from(selectedItems)
      .filter(id => id.startsWith('img-'))
      .map(id => id.replace('img-', ''));

    if (imageIds.length === 0) {
      setMessage('Select images to classify');
      return;
    }

    setClassifying(true);
    setMessage('AI is analyzing images...');

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auto-sort-photos`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
          },
          body: JSON.stringify({
            action: 'classify',
            image_ids: imageIds,
            auto_apply: false  // Just suggest, don't auto-apply
          })
        }
      );

      const result = await response.json();

      if (result.error) {
        setMessage(`Error: ${result.error}`);
      } else {
        setMessage(`AI classified ${result.summary.classified}/${result.summary.total} images (${result.summary.high_confidence} high confidence)`);
        await loadData();
        setSelectedItems(new Set());
      }
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setClassifying(false);
    }
  };

  // Apply AI suggestion for an image
  const applyAISuggestion = async (imageId: string, vehicleId: string) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('vehicle_images')
        .update({ vehicle_id: vehicleId })
        .eq('id', imageId);

      if (error) throw error;

      setMessage('Applied AI suggestion');
      await loadData();
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Filter by date
  const getFilteredItems = useCallback(() => {
    if (filterDate === 'all') {
      return { filteredImages: images, filteredNotes: notes };
    }

    const now = new Date();
    let cutoff: Date;

    switch (filterDate) {
      case 'today':
        cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        cutoff = new Date(0);
    }

    return {
      filteredImages: images.filter(i => new Date(i.created_at) >= cutoff),
      filteredNotes: notes.filter(n => new Date(n.created_at) >= cutoff)
    };
  }, [images, notes, filterDate]);

  const { filteredImages, filteredNotes } = getFilteredItems();

  // Group items by vehicle
  const groupByVehicle = () => {
    const groups: Record<string, { vehicle: Vehicle; images: TelegramImage[]; notes: TelegramNote[] }> = {};

    filteredImages.forEach(img => {
      if (!groups[img.vehicle_id]) {
        groups[img.vehicle_id] = {
          vehicle: {
            id: img.vehicle_id,
            year: img.vehicle_year,
            make: img.vehicle_make,
            model: img.vehicle_model,
            vin: img.vehicle_vin
          },
          images: [],
          notes: []
        };
      }
      groups[img.vehicle_id].images.push(img);
    });

    filteredNotes.forEach(note => {
      if (!groups[note.vehicle_id]) {
        groups[note.vehicle_id] = {
          vehicle: {
            id: note.vehicle_id,
            year: note.vehicle_year,
            make: note.vehicle_make,
            model: note.vehicle_model,
            vin: note.vehicle_vin
          },
          images: [],
          notes: []
        };
      }
      groups[note.vehicle_id].notes.push(note);
    });

    return Object.values(groups);
  };

  const vehicleGroups = groupByVehicle();

  if (loading) {
    return (
      <div className="card">
        <div className="card-body text-center">
          <div className="text-small text-muted">Loading inbox...</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="card" style={{ marginBottom: 'var(--space-3)' }}>
        <div className="card-header" style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 'var(--space-2)'
        }}>
          <h3 className="text font-bold" style={{ fontSize: '8pt', margin: 0 }}>
            Tech Inbox ({filteredImages.length} photos, {filteredNotes.length} notes)
          </h3>

          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            {/* Date filter */}
            <select
              className="form-input text-small"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              style={{ padding: '4px 8px' }}
            >
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
            </select>

            {/* View toggle */}
            <button
              className={`button button-small ${viewMode === 'grid' ? 'button-primary' : ''}`}
              onClick={() => setViewMode('grid')}
            >
              Grid
            </button>
            <button
              className={`button button-small ${viewMode === 'list' ? 'button-primary' : ''}`}
              onClick={() => setViewMode('list')}
            >
              List
            </button>
          </div>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div className="card" style={{
          marginBottom: 'var(--space-3)',
          background: message.startsWith('Error') ? 'var(--danger-bg)' : 'var(--success-bg)',
          border: `1px solid ${message.startsWith('Error') ? 'var(--danger)' : 'var(--success)'}`
        }}>
          <div className="card-body text-small">{message}</div>
        </div>
      )}

      {/* Selection toolbar */}
      {selectedItems.size > 0 && (
        <div className="card" style={{
          marginBottom: 'var(--space-3)',
          background: 'var(--surface-hover)',
          position: 'sticky',
          top: '0',
          zIndex: 10
        }}>
          <div className="card-body" style={{
            display: 'flex',
            gap: 'var(--space-3)',
            alignItems: 'center',
            flexWrap: 'wrap'
          }}>
            <span className="text-small font-bold">{selectedItems.size} selected</span>

            {/* Reassign dropdown */}
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <select
                className="form-input text-small"
                value={reassignVehicleId}
                onChange={(e) => setReassignVehicleId(e.target.value)}
                style={{ minWidth: '200px' }}
              >
                <option value="">Move to vehicle...</option>
                {vehicles.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.year} {v.make} {v.model} {v.vin ? `(${v.vin.slice(-6)})` : ''}
                  </option>
                ))}
              </select>
              <button
                className="button button-small button-primary"
                onClick={handleReassign}
                disabled={!reassignVehicleId || saving}
              >
                {saving ? 'Moving...' : 'Move'}
              </button>
            </div>

            {/* Category buttons (images only) */}
            <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
              {['exterior', 'interior', 'engine', 'damage', 'detail'].map(cat => (
                <button
                  key={cat}
                  className="button button-small"
                  onClick={() => handleSetCategory(cat)}
                  disabled={saving}
                  title={`Set category to ${cat}`}
                >
                  {cat}
                </button>
              ))}
            </div>

            <button
              className="button button-small"
              onClick={handleAIClassify}
              disabled={classifying}
              style={{ background: 'var(--primary)', color: 'white' }}
            >
              {classifying ? '🤖 Analyzing...' : '🤖 AI Classify'}
            </button>

            <button
              className="button button-small"
              onClick={clearSelection}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Quick select */}
      <div style={{ marginBottom: 'var(--space-3)', display: 'flex', gap: 'var(--space-2)' }}>
        <button className="button button-small" onClick={selectAll}>Select All</button>
        <button className="button button-small" onClick={clearSelection}>Deselect All</button>
      </div>

      {/* Empty state */}
      {vehicleGroups.length === 0 && (
        <div className="card">
          <div className="card-body text-center">
            <div className="text-small text-muted">No Telegram submissions yet</div>
            <div className="text-small text-muted" style={{ marginTop: 'var(--space-2)' }}>
              Send photos and notes to @Nukeproof_bot to see them here
            </div>
          </div>
        </div>
      )}

      {/* Vehicle groups */}
      {vehicleGroups.map(group => (
        <div key={group.vehicle.id} className="card" style={{ marginBottom: 'var(--space-3)' }}>
          <div className="card-header" style={{
            background: 'var(--surface-hover)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div>
              <span className="text font-bold" style={{ fontSize: '8pt' }}>
                {group.vehicle.year} {group.vehicle.make} {group.vehicle.model}
              </span>
              {group.vehicle.vin && (
                <span className="text-small text-muted" style={{ marginLeft: 'var(--space-2)' }}>
                  {group.vehicle.vin}
                </span>
              )}
            </div>
            <span className="text-small text-muted">
              {group.images.length} photos, {group.notes.length} notes
            </span>
          </div>

          <div className="card-body">
            {/* Images grid/list */}
            {group.images.length > 0 && (
              <div style={{
                display: viewMode === 'grid' ? 'grid' : 'flex',
                gridTemplateColumns: viewMode === 'grid' ? 'repeat(auto-fill, minmax(120px, 1fr))' : undefined,
                flexDirection: viewMode === 'list' ? 'column' : undefined,
                gap: 'var(--space-2)',
                marginBottom: group.notes.length > 0 ? 'var(--space-3)' : 0
              }}>
                {group.images.map(img => (
                  <div
                    key={img.id}
                    onClick={() => toggleSelect(`img-${img.id}`)}
                    style={{
                      position: 'relative',
                      cursor: 'pointer',
                      border: selectedItems.has(`img-${img.id}`)
                        ? '3px solid var(--primary)'
                        : '1px solid var(--border)',
                      borderRadius: '4px',
                      overflow: 'hidden',
                      background: selectedItems.has(`img-${img.id}`) ? 'var(--primary-bg)' : 'var(--surface)'
                    }}
                  >
                    {viewMode === 'grid' ? (
                      <>
                        <img
                          src={img.image_url}
                          alt={img.caption || 'Vehicle photo'}
                          style={{
                            width: '100%',
                            height: '100px',
                            objectFit: 'cover'
                          }}
                        />
                        {img.caption && (
                          <div className="text-small" style={{
                            padding: '4px',
                            background: 'var(--surface)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}>
                            {img.caption}
                          </div>
                        )}
                        {img.category && (
                          <div style={{
                            position: 'absolute',
                            top: '4px',
                            right: '4px',
                            background: 'var(--black)',
                            color: 'var(--white)',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '6pt'
                          }}>
                            {img.category}
                          </div>
                        )}
                        {/* AI Suggestion indicator */}
                        {img.ai_confidence && img.ai_confidence >= 0.7 && img.ai_suggested_vehicle_id !== img.vehicle_id && (
                          <div style={{
                            position: 'absolute',
                            bottom: '4px',
                            left: '4px',
                            right: '4px',
                            background: 'rgba(0,0,0,0.8)',
                            color: 'var(--white)',
                            padding: '4px',
                            borderRadius: '4px',
                            fontSize: '6pt'
                          }}>
                            🤖 AI: {Math.round(img.ai_confidence * 100)}%
                          </div>
                        )}
                      </>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2)' }}>
                        <img
                          src={img.image_url}
                          alt={img.caption || 'Vehicle photo'}
                          style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '4px' }}
                        />
                        <div style={{ flex: 1 }}>
                          <div className="text-small">{img.caption || '(no caption)'}</div>
                          <div className="text-small text-muted">
                            {new Date(img.created_at).toLocaleString()}
                          </div>
                          {img.category && (
                            <span className="text-small" style={{
                              background: 'var(--surface-hover)',
                              padding: '2px 6px',
                              borderRadius: '4px'
                            }}>
                              {img.category}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Selection indicator */}
                    {selectedItems.has(`img-${img.id}`) && (
                      <div style={{
                        position: 'absolute',
                        top: '4px',
                        left: '4px',
                        width: '20px',
                        height: '20px',
                        background: 'var(--primary)',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        fontSize: '12px'
                      }}>
                        ✓
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Notes */}
            {group.notes.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {group.notes.map(note => (
                  <div
                    key={note.id}
                    onClick={() => toggleSelect(`note-${note.id}`)}
                    style={{
                      padding: 'var(--space-2)',
                      border: selectedItems.has(`note-${note.id}`)
                        ? '2px solid var(--primary)'
                        : '1px solid var(--border)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      background: selectedItems.has(`note-${note.id}`) ? 'var(--primary-bg)' : 'var(--surface)',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 'var(--space-2)'
                    }}
                  >
                    <span style={{ fontSize: '16px' }}>📝</span>
                    <div style={{ flex: 1 }}>
                      <div className="text-small">{note.note}</div>
                      <div className="text-small text-muted">
                        {new Date(note.created_at).toLocaleString()}
                      </div>
                    </div>
                    {selectedItems.has(`note-${note.id}`) && (
                      <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>✓</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
