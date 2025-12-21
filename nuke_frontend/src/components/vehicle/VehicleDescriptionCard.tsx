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
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return 'Date unknown';
    }
  };

  const sanitizeCuratedSummary = (raw: string): string => {
    let cleaned = raw || '';
    // Remove BaT listing boilerplate patterns
    cleaned = cleaned.replace(/\s*for sale on BaT Auctions?\s*/gi, '');
    cleaned = cleaned.replace(/\s*sold for \$[\d,]+ on [A-Z][a-z]+ \d{1,2}, \d{4}\s*/gi, '');
    cleaned = cleaned.replace(/\s*\(Lot #[\d,]+\)\s*/gi, '');
    cleaned = cleaned.replace(/\s*\|\s*Bring a Trailer\s*/gi, '');
    cleaned = cleaned.replace(/\s*on bringatrailer\.com\s*/gi, '');
    // Clean up whitespace
    cleaned = cleaned.trim().replace(/\s+/g, ' ');
    return cleaned;
  };

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

      // Also check for BaT listing data
      const { data: batListing } = await supabase
        .from('bat_listings')
        .select('id, bat_listing_title, bat_listing_url, raw_data, created_at')
        .eq('vehicle_id', vehicleId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Add BaT listing as a source if it exists and has description data
      if (batListing) {
        const batDescription = (batListing.raw_data as any)?.description || 
                              (batListing.raw_data as any)?.post_excerpt ||
                              batListing.bat_listing_title;
        
        if (batDescription && batDescription.trim().length > 0) {
          mapped.unshift({
            text: batDescription.toString(),
            extracted_at: batListing.created_at ? String(batListing.created_at) : null,
            source_url: batListing.bat_listing_url || null
          });
        }
      }

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
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Curated summary (editable) - Only show if it's substantial and not just listing boilerplate */}
            {(() => {
              const cleaned = sanitizeCuratedSummary(description);
              const isSubstantial = cleaned && cleaned.length > 100 && !cleaned.toLowerCase().includes('chrome-finished') && !cleaned.toLowerCase().includes('braking is provide');
              // Hide if it's too short or looks like bad AI generation
              if (!isSubstantial && !isEmpty) return null;
              
              return (
                <div>
                  <div style={{ fontSize: '7pt', fontWeight: 700, marginBottom: '6px', color: 'var(--text-muted)' }}>
                    CURATED SUMMARY
                  </div>
                  {isEmpty ? (
                    <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
                      No curated summary yet. Use Generate or Edit to create one.
                    </div>
                  ) : (
                    <div style={{ fontSize: '9pt', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                      {cleaned || <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>No summary available</span>}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Source description entries (provenance-backed) */}
            <div>
              <div style={{ fontSize: '7pt', fontWeight: 700, marginBottom: '6px', color: 'var(--text-muted)' }}>
                DESCRIPTION ENTRIES
              </div>
              {rawListingDescriptions.length === 0 ? (
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
                  No source descriptions yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {rawListingDescriptions.map((row, idx) => {
                    const domain = getSourceDomain(row.source_url);
                    const dateLabel = formatEntryDate(row.extracted_at);
                    const linkLabel = domain ? `${domain} listing` : 'Source listing';
                    return (
                      <details
                        key={`${idx}-${row.extracted_at || 'unknown'}`}
                        style={{
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                          padding: '8px 10px',
                          background: 'var(--bg-secondary)',
                        }}
                      >
                        <summary
                          style={{
                            cursor: 'pointer',
                            listStyle: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '8px',
                            fontSize: '8pt',
                            fontWeight: 700,
                          }}
                        >
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                            {row.source_url ? <FaviconIcon url={row.source_url} matchTextSize={true} textSize={8} /> : null}
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              Imported listing description
                              {domain ? ` • ${domain}` : ''}
                            </span>
                          </span>
                          <span style={{ fontSize: '7pt', fontWeight: 500, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            {dateLabel}
                          </span>
                        </summary>
                        <div style={{ marginTop: '8px' }}>
                          <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
                            {row.source_url ? (
                              <a
                                href={row.source_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ textDecoration: 'underline' }}
                              >
                                {linkLabel}
                              </a>
                            ) : null}
                          </div>
                          <div style={{ fontSize: '8.5pt', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                            {row.text}
                          </div>
                        </div>
                      </details>
                    );
                  })}
                </div>
              )}
            </div>

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

