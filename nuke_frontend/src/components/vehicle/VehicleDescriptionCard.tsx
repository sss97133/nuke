import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { FaviconIcon } from '../common/FaviconIcon';

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
  const [rawListingDescriptions, setRawListingDescriptions] = useState<Array<{ text: string; extracted_at: string | null; source_url: string | null }>>([]);
  const [generating, setGenerating] = useState(false);
  const [sourceInfo, setSourceInfo] = useState<{
    url?: string;
    source?: string;
    date?: string;
  } | null>(null);

  useEffect(() => {
    loadDescriptionMetadata();
  }, [vehicleId]);

  const loadDescriptionMetadata = async () => {
    try {
      const { data } = await supabase
        .from('vehicles')
        .select('description, description_source, description_generated_at, discovery_url, origin_metadata')
        .eq('id', vehicleId)
        .single();

      if (data) {
        setDescription(data.description || '');
        setIsAIGenerated(data.description_source === 'ai_generated');
        setGeneratedAt(data.description_generated_at);
        
        // Store source info for display
        if (data.discovery_url || data.origin_metadata?.listing_url) {
          setSourceInfo({
            url: data.discovery_url || data.origin_metadata?.listing_url,
            source: data.description_source,
            date: data.description_generated_at
          });
        } else if (data.description_source === 'craigslist_listing') {
          setSourceInfo({
            source: data.description_source,
            date: data.description_generated_at
          });
        }
      }
    } catch (err) {
      console.warn('Failed to load description metadata:', err);
    }

    // Raw listing description history (provenance-backed)
    try {
      const { data: rows } = await supabase
        .from('extraction_metadata')
        .select('field_value, extracted_at, source_url')
        .eq('vehicle_id', vehicleId)
        .eq('field_name', 'raw_listing_description')
        .order('extracted_at', { ascending: false })
        .limit(5);

      const mapped = (rows || [])
        .map((r: any) => ({
          text: (r?.field_value || '').toString(),
          extracted_at: r?.extracted_at ? String(r.extracted_at) : null,
          source_url: r?.source_url ? String(r.source_url) : null
        }))
        .filter((r: any) => r.text && r.text.trim().length > 0);

      setRawListingDescriptions(mapped);
    } catch (err) {
      // Non-fatal if table missing in some environments
      setRawListingDescriptions([]);
    }
  };

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
      // Refresh metadata + raw listing descriptions
      await loadDescriptionMetadata();
    } catch (err: any) {
      console.error('Failed to generate description:', err);
    } finally {
      setGenerating(false);
    }
  };

  const isEmpty = !description || description.trim().length === 0;

  return (
    <div className="card">
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', fontWeight: 700 }}>Description</span>
        {isEditable && !isEditing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
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
        )}
      </div>
      <div className="card-body">
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
                fontSize: '9pt',
                padding: '8px',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                resize: 'vertical',
                fontFamily: 'inherit'
              }}
            />
            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textAlign: 'right' }}>
              {editValue.length}/500
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                className="button button-secondary"
                style={{ fontSize: '8pt', padding: '4px 12px' }}
                onClick={handleCancel}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                style={{ fontSize: '8pt', padding: '4px 12px' }}
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        ) : isEmpty ? (
          <div style={{ padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '12px' }}>
              No description yet.
            </div>
            {isEditable && (
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
              <button
                className="button button-primary"
                  style={{ fontSize: '8pt', padding: '4px 12px' }}
                  onClick={handleGenerate}
                  disabled={generating}
                >
                  {generating ? 'Generating...' : 'Generate'}
                </button>
                <button
                  className="button button-secondary"
                style={{ fontSize: '8pt', padding: '4px 12px' }}
                onClick={handleEdit}
              >
                Add Description
              </button>
              </div>
            )}
          </div>
        ) : (
          <div>
            {/* Normalized description display */}
            <div style={{ fontSize: '9pt', lineHeight: 1.5, whiteSpace: 'pre-wrap', marginBottom: rawListingDescriptions.length > 0 ? '8px' : '0' }}>
              {description}
            </div>
            
            {/* Raw listing descriptions - button with hover */}
            {rawListingDescriptions.length > 0 && (
              <div style={{ marginTop: '8px' }}>
                <button
                  type="button"
                  style={{
                    padding: '4px 8px',
                    fontSize: '8pt',
                    border: '1px solid var(--border)',
                    background: 'var(--white)',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    borderRadius: '3px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    position: 'relative'
                  }}
                  onMouseEnter={(e) => {
                    const popup = document.getElementById('raw-description-popup');
                    if (popup) {
                      const rect = e.currentTarget.getBoundingClientRect();
                      popup.style.display = 'block';
                      popup.style.top = `${rect.bottom + 8}px`;
                      popup.style.left = `${rect.left}px`;
                    }
                  }}
                  onMouseLeave={(e) => {
                    const popup = document.getElementById('raw-description-popup');
                    if (popup) {
                      const popupRect = popup.getBoundingClientRect();
                      const buttonRect = e.currentTarget.getBoundingClientRect();
                      // Only hide if mouse isn't over popup
                      if (!(e.clientX >= popupRect.left && e.clientX <= popupRect.right &&
                            e.clientY >= popupRect.top && e.clientY <= popupRect.bottom)) {
                        popup.style.display = 'none';
                      }
                    }
                  }}
                >
                  <span>Raw Listing Descriptions ({rawListingDescriptions.length})</span>
                  <span style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>ⓘ</span>
                </button>
                <div
                  id="raw-description-popup"
                  style={{
                    display: 'none',
                    position: 'fixed',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    padding: '12px',
                    maxWidth: '500px',
                    maxHeight: '400px',
                    overflowY: 'auto',
                    boxShadow: '0 8px 20px rgba(0,0,0,0.15)',
                    zIndex: 1000,
                    fontSize: '8pt',
                    lineHeight: 1.5
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.display = 'block';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: '8px', fontSize: '9pt' }}>
                    Original Listing Descriptions
                  </div>
                  {rawListingDescriptions.map((row, idx) => (
                    <div key={idx} style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: idx < rawListingDescriptions.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
                        {row.extracted_at ? `Extracted ${new Date(row.extracted_at).toLocaleDateString()}` : 'Extracted date unknown'}
                        {row.source_url ? ' • ' : ''}
                        {row.source_url ? (
                          <a href={row.source_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>
                            Source
                          </a>
                        ) : null}
                      </div>
                      <div style={{ whiteSpace: 'pre-wrap', fontSize: '8pt' }}>
                        {row.text}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {rawListingDescriptions.length > 0 && (
              <div style={{ marginTop: '12px' }}>
                <details>
                  <summary style={{ cursor: 'pointer', fontSize: '8pt', fontWeight: 700 }}>
                    Raw listing descriptions ({rawListingDescriptions.length})
                  </summary>
                  <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {rawListingDescriptions.map((row, idx) => (
                      <div key={idx} style={{ border: '1px solid var(--border)', borderRadius: '6px', padding: '8px', background: 'var(--bg-secondary)' }}>
                        <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '6px' }}>
                          {row.extracted_at ? `Extracted ${new Date(row.extracted_at).toLocaleDateString()}` : 'Extracted date unknown'}
                          {row.source_url ? ' • ' : ''}
                          {row.source_url ? (
                            <a href={row.source_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>
                              Source
                            </a>
                          ) : null}
                        </div>
                        <div style={{ fontSize: '8pt', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                          {row.text}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            )}

            {(isAIGenerated || sourceInfo) && (
              <div style={{
                marginTop: '12px',
                padding: '8px',
                background: 'var(--bg-secondary)',
                borderRadius: '4px',
                fontSize: '7pt',
                color: 'var(--text-muted)',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
              }}>
                {(isAIGenerated || sourceInfo?.source === 'craigslist_listing') && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span>
                      {sourceInfo?.source === 'craigslist_listing' 
                        ? 'Extracted from listing' 
                        : (generatedAt ? 'AI-generated from vehicle images' : 'AI-generated')
                      }
                    </span>
                    {generatedAt && (
                      <span>• {new Date(generatedAt).toLocaleDateString()}</span>
                    )}
                  </div>
                )}
                {sourceInfo?.url && (
                  <div style={{ marginTop: sourceInfo.url ? '4px' : '0', paddingTop: sourceInfo.url ? '4px' : '0', borderTop: sourceInfo.url ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ fontSize: '6pt', marginBottom: '2px', fontWeight: 500 }}>Source:</div>
                    <a 
                      href={sourceInfo.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: 'var(--link-color, #0066cc)',
                        textDecoration: 'underline',
                        fontSize: '6pt',
                        wordBreak: 'break-all',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px'
                      }}
                    >
                      {sourceInfo.url.includes('craigslist') && (
                        <FaviconIcon url={sourceInfo.url} matchTextSize={true} textSize={6} />
                      )}
                      {sourceInfo.url.includes('craigslist') ? 'View Craigslist Listing' : sourceInfo.url}
                    </a>
                    {sourceInfo.date && (
                      <div style={{ fontSize: '6pt', marginTop: '2px', color: 'var(--text-muted)' }}>
                        Extracted {new Date(sourceInfo.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default VehicleDescriptionCard;

