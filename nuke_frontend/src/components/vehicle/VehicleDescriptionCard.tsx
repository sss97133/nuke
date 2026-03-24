import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { FaviconIcon } from '../common/FaviconIcon';
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
  const [rawListingDescriptions, setRawListingDescriptions] = useState<Array<{ text: string; extracted_at: string | null; source_url: string | null; event_date: string | null }>>([]);
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
      const normalizeUrlLoose = (u: string | null | undefined): string => {
        const s = String(u || '').trim();
        if (!s) return '';
        try {
          const url = new URL(s);
          url.hash = '';
          url.search = '';
          const out = url.toString();
          return out.endsWith('/') ? out.slice(0, -1) : out;
        } catch {
          return s.split('#')[0].split('?')[0].replace(/\/+$/, '').trim();
        }
      };

      // Map listing URL -> auction end date (so we can display provenance by event date, not extraction run date)
      const { data: auctionEvents } = await supabase
        .from('auction_events')
        .select('source_url, auction_end_date')
        .eq('vehicle_id', vehicleId)
        .order('auction_end_date', { ascending: false, nullsFirst: false })
        .limit(20);

      const endDateByUrl = new Map<string, string>();
      for (const ev of (auctionEvents || [])) {
        const u = normalizeUrlLoose((ev as any)?.source_url);
        const d = (ev as any)?.auction_end_date ? String((ev as any).auction_end_date) : '';
        if (u && d && !endDateByUrl.has(u)) endDateByUrl.set(u, d);
      }

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
          source_url: r?.source_url ? String(r.source_url) : null,
          event_date: (() => {
            const u = normalizeUrlLoose(r?.source_url ? String(r.source_url) : '');
            return u ? (endDateByUrl.get(u) || null) : null;
          })()
        }))
        .filter((r: any) => r.text && r.text.trim().length > 0);

      // Also check for BaT event data (vehicle_events)
      const { data: batEvent } = await supabase
        .from('vehicle_events')
        .select('id, source_url, metadata, created_at')
        .eq('vehicle_id', vehicleId)
        .eq('source_platform', 'bat')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Add BaT event as a source if it exists and has description data
      if (batEvent) {
        const batDescription = (batEvent.metadata as any)?.description ||
                              (batEvent.metadata as any)?.post_excerpt ||
                              (batEvent.metadata as any)?.title || (batEvent.metadata as any)?.bat_listing_title;

        if (batDescription && batDescription.trim().length > 0) {
          const batText = batDescription.toString();
          // Only add if not already present (check if any existing entry has same text)
          const isDuplicate = mapped.some((entry: any) => {
            const entryStart = entry.text.trim().substring(0, 200);
            const batStart = batText.trim().substring(0, 200);
            return entryStart === batStart || entry.text.trim() === batText.trim();
          });

          if (!isDuplicate) {
            mapped.unshift({
              text: batText,
              extracted_at: batEvent.created_at ? String(batEvent.created_at) : null,
              source_url: batEvent.source_url || null,
              event_date: (() => {
                const u = normalizeUrlLoose(batEvent.source_url || '');
                return u ? (endDateByUrl.get(u) || null) : null;
              })()
            });
          }
        }
      }

      // Final deduplication pass: remove entries with identical or very similar text (same source URL)
      const deduplicated = mapped.filter((r: any, idx: number, arr: any[]) => {
        // Keep first occurrence of each unique text+source_url combination
        const firstMatch = arr.findIndex((other: any) => 
          other.source_url === r.source_url && 
          other.text.trim().substring(0, 200) === r.text.trim().substring(0, 200)
        );
        return firstMatch === idx;
      });

      // Prefer auction event date ordering if available, otherwise fall back to extracted_at.
      const sorted = [...deduplicated].sort((a: any, b: any) => {
        const aTs = a.event_date ? new Date(a.event_date).getTime() : (a.extracted_at ? new Date(a.extracted_at).getTime() : 0);
        const bTs = b.event_date ? new Date(b.event_date).getTime() : (b.extracted_at ? new Date(b.extracted_at).getTime() : 0);
        return (bTs || 0) - (aTs || 0);
      });

      setRawListingDescriptions(sorted);
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
            {isEmpty ? (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                No description yet. Use Generate or Edit to create one.
              </div>
            ) : (
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
            )}
          </div>
        )}
      </div>
    </CollapsibleWidget>
  );
};

export default VehicleDescriptionCard;

