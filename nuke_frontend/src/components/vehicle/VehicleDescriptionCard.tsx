import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { FaviconIcon } from '../common/FaviconIcon';
import { listingDescriptionsFromSpecs, type ListingDescription } from './listingDescriptions';
import { CollapsibleWidget } from '../ui/CollapsibleWidget';

interface VehicleDescriptionCardProps {
  vehicleId: string;
  initialDescription?: string | null;
  isEditable: boolean;
  onUpdate?: (description: string) => void;
}

export const VehicleDescriptionCard: React.FC<VehicleDescriptionCardProps> = ({
  vehicleId,
  initialDescription,
  isEditable,
  onUpdate
}) => {
  const [description, setDescription] = useState(initialDescription || '');
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [isAIGenerated, setIsAIGenerated] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [listingDescriptions, setListingDescriptions] = useState<ListingDescription[]>([]);
  const [generating, setGenerating] = useState(false);
  const [sourceInfo, setSourceInfo] = useState<{
    url?: string;
    source?: string;
    date?: string;
  } | null>(null);

  const getSourceDomain = (u?: string | null): string | null => {
    try {
      if (!u) return null;
      const url = new URL(u);
      return url.hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  };

  const formatEntryDate = (iso?: string | null): string => {
    try {
      if (!iso) return 'Date unknown';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return 'Date unknown';
      return iso;
    } catch {
      return 'Date unknown';
    }
  };

  useEffect(() => {
    let active = true;
    // The same vehicle gate as the specs reader; no mutable raw metadata or auction-date fallback.
    setListingDescriptions([]);
    setDescription(initialDescription || '');
    const load = async () => {
      const [{ data }, reports] = await Promise.all([
        supabase.from('vehicles').select('description, description_source, description_generated_at')
          .eq('id', vehicleId).single(),
        supabase.rpc('get_vehicle_specs', { p_vehicle_id: vehicleId }),
      ]);
      if (!active) return;
      if (data) {
        setDescription(data.description || '');
        setIsAIGenerated(data.description_source === 'ai_generated');
        setGeneratedAt(data.description_generated_at);
        // Manual summaries do not inherit a mutable listing URL as their citation.
        setSourceInfo({ source: data.description_source, date: data.description_generated_at });
      }
      setListingDescriptions(reports.error ? [] : listingDescriptionsFromSpecs(reports.data));
    };
    load().catch(err => { if (active) console.warn('Failed to load description evidence:', err); });
    return () => { active = false; };
  }, [vehicleId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('vehicles')
        .update({
          description: editValue,
          description_source: 'user_input',
          updated_at: new Date().toISOString()
        })
        .eq('id', vehicleId);

      if (!error) {
        setDescription(editValue);
        setIsAIGenerated(false);
        setIsEditing(false);
        if (onUpdate) onUpdate(editValue);
      }
    } catch (err) {
      console.error('Failed to save description:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = () => {
    setEditValue(description);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setEditValue('');
    setIsEditing(false);
  };

  const handleGenerate = async () => {
    if (!vehicleId) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-vehicle-description', {
        body: { vehicle_id: vehicleId }
      });
      if (error) throw error;
      const next = (data as any)?.description;
      if (typeof next === 'string' && next.trim()) {
        setDescription(next);
        setIsAIGenerated(true);
        setGeneratedAt(new Date().toISOString());
        if (onUpdate) onUpdate(next);
      }
      // Refresh the generated summary without changing source testimony.
      const { data: refreshed } = await supabase.from('vehicles')
        .select('description, description_source, description_generated_at').eq('id', vehicleId).single();
      if (refreshed) {
        setDescription(refreshed.description || '');
        setIsAIGenerated(refreshed.description_source === 'ai_generated');
        setGeneratedAt(refreshed.description_generated_at);
      }
    } catch (err: any) {
      console.error('Failed to generate description:', err);
    } finally {
      setGenerating(false);
    }
  };

  const isEmpty = !description || description.trim().length === 0;

  // Progressive density: hide entirely when no description and user can't edit
  if (isEmpty && !isEditable && listingDescriptions.length === 0) return null;

  return (
    <CollapsibleWidget
      variant="profile"
      className="vehicle-profile-section"
      title="Description"
      defaultCollapsed={false}
      action={isEditable && !isEditing ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={(e) => e.stopPropagation()}>
          <button
            className="btn-utility"
            style={{ fontSize: '8px', padding: '2px 6px' }}
            onClick={handleGenerate}
            disabled={generating}
            title="Generate a factual description from known vehicle data and evidence"
          >
            {generating ? 'Generating...' : 'Generate'}
          </button>
          <button
            className="btn-utility"
            style={{ fontSize: '8px', padding: '2px 6px' }}
            onClick={handleEdit}
          >
            Edit
          </button>
        </div>
      ) : undefined}
    >
      <div>
        {isEditing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              maxLength={500}
              rows={6}
              placeholder="Describe the vehicle, modifications, history..."
              style={{
                width: '100%',
                fontSize: '12px',
                padding: '8px',
                border: '1px solid var(--border)', resize: 'vertical',
                fontFamily: 'inherit'
              }}
            />
            <div style={{ fontSize: '9px', color: 'var(--text-muted)', textAlign: 'right' }}>
              {editValue.length}/500
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                className="button button-secondary"
                style={{ fontSize: '11px', padding: '4px 12px' }}
                onClick={handleCancel}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                style={{ fontSize: '11px', padding: '4px 12px' }}
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <div>
            {/* Single description — show vehicles.description, with source attribution if available */}
            {isEmpty && listingDescriptions.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                No description yet. Use Generate or Edit to create one.
              </div>
            ) : !isEmpty ? (
              <div>
                <div style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '11px', lineHeight: 1.7, whiteSpace: 'pre-wrap', color: 'var(--text)' }}>
                  {description}
                </div>
                {/* Source attribution */}
                {(sourceInfo?.url || isAIGenerated) && (
                  <div style={{ marginTop: '8px', fontSize: '9px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {sourceInfo?.url && (
                      <>
                        <FaviconIcon url={sourceInfo.url} matchTextSize={true} textSize={8} />
                        <a href={sourceInfo.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>
                          {getSourceDomain(sourceInfo.url)}
                        </a>
                      </>
                    )}
                    {isAIGenerated && <span>AI-generated</span>}
                    {generatedAt && <span>• {new Date(generatedAt).toLocaleDateString()}</span>}
                  </div>
                )}
              </div>
            ) : null}
            {listingDescriptions.map(entry => (
              <details key={entry.source_observation_id} open={listingDescriptions.length === 1}
                style={{ marginTop: '12px' }}>
                <summary style={{ cursor: 'pointer', fontSize: '11px' }}>Preserved listing text · {getSourceDomain(entry.source_url)}</summary>
                <div style={{ fontSize: '11px', lineHeight: 1.7, whiteSpace: 'pre-wrap', marginTop: '8px' }}>{entry.text}</div>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '8px' }}>
                  <a href={entry.source_url} target="_blank" rel="noopener noreferrer">Listing source ↗</a>
                  {' · '}<a href={`/vehicle/${vehicleId}/observation/${entry.source_observation_id}`}>Observation ↗</a>
                  <div>Recorded observation: {formatEntryDate(entry.recorded_observed_at)} · Captured: {formatEntryDate(entry.source_captured_at)} · Received: {formatEntryDate(entry.ingested_at)}</div>
                  <div>Original listing event date unknown. Original source completeness unknown. Preserved text shown without shortening.</div>
                  <div>Method: {entry.extraction_method || 'Unknown'} · Stored confidence: {entry.confidence ?? 'Unknown'}</div>
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </CollapsibleWidget>
  );
};

export default VehicleDescriptionCard;
