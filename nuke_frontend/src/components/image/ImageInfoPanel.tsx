/**
 * ImageInfoPanel - Swipeable info panel for mobile lightbox
 * No emojis, no headers, just clean contextual data
 * Uses native touch events (no external dependencies)
 */

import React, { useState, useRef, useEffect } from 'react';
import { ImageExpandedData } from './ImageExpandedData';

type PanelState = 'closed' | 'peek' | 'full';
type TabType = 'info' | 'tags' | 'comments' | 'actions';

interface ImageInfoPanelProps {
  imageMetadata: any;
  attribution: any;
  tags: any[];
  comments: any[];
  /** Full image record (caption, file_name, vehicle_zone, etc.) for catalog-style expanded data */
  imageRecord?: any;
  canEdit: boolean;
  onTag: () => void;
  onSetPrimary: () => void;
  onRotate: () => void;
  onToggleSensitive: () => void;
  onDelete: () => void;
  session: any;
  onClose: () => void;
}

export const ImageInfoPanel: React.FC<ImageInfoPanelProps> = ({
  imageMetadata,
  attribution,
  tags,
  comments,
  imageRecord,
  canEdit,
  onTag,
  onSetPrimary,
  onRotate,
  onToggleSensitive,
  onDelete,
  session,
  onClose
}) => {
  const [panelState, setPanelState] = useState<PanelState>('peek');
  const [activeTab, setActiveTab] = useState<TabType>('info');
  const [dragStartY, setDragStartY] = useState<number | null>(null);
  const [currentY, setCurrentY] = useState<number>(0);
  const panelRef = useRef<HTMLDivElement>(null);
  
  const windowHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
  
  // Calculate panel positions
  const positions = {
    closed: windowHeight,
    peek: windowHeight * 0.5,
    full: windowHeight * 0.1
  };

  useEffect(() => {
    // Start at peek position
    setCurrentY(positions.peek);
  }, []);

  const handleTouchStart = (e: React.TouchEvent) => {
    setDragStartY(e.touches[0].clientY);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (dragStartY === null) return;
    
    const deltaY = e.touches[0].clientY - dragStartY;
    const newY = positions[panelState] + deltaY;
    
    // Constrain to bounds
    if (newY >= positions.full && newY <= positions.closed) {
      setCurrentY(newY);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (dragStartY === null) return;
    
    const deltaY = currentY - positions[panelState];
    
    // Snap to nearest position based on distance
    const closedDist = Math.abs(currentY - positions.closed);
    const peekDist = Math.abs(currentY - positions.peek);
    const fullDist = Math.abs(currentY - positions.full);
    
    const minDist = Math.min(closedDist, peekDist, fullDist);
    
    if (minDist === closedDist) {
      setPanelState('closed');
      setCurrentY(positions.closed);
      onClose();
    } else if (minDist === peekDist) {
      setPanelState('peek');
      setCurrentY(positions.peek);
    } else {
      setPanelState('full');
      setCurrentY(positions.full);
    }
    
    setDragStartY(null);
  };

  const formatDate = (date: string) => {
    if (!date) return null;
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    }) + ' • ' + d.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit' 
    });
  };

  const getExifText = () => {
    if (!imageMetadata?.exif_data) return null;
    const exif = imageMetadata.exif_data;
    const parts = [];
    
    // Priority 1: Check top-level fields (new format)
    // Priority 2: Check technical object (old format)
    // Priority 3: Check various field name variations
    
    const focalLength = exif.focalLength || exif.technical?.focalLength || exif.technical?.focalLengthFormatted?.replace('mm', '') || exif.FocalLength || exif['Focal Length'];
    const fNumber = exif.fNumber || exif.technical?.fNumber || exif.technical?.aperture?.replace('f/', '') || exif.FNumber || exif['F-Number'] || exif.ApertureValue;
    const exposureTime = exif.exposureTime || exif.technical?.exposureTime || exif.technical?.shutterSpeed || exif.ExposureTime || exif['Exposure Time'];
    const iso = exif.iso || exif.technical?.iso || exif.ISO || exif.ISOSpeedRatings;
    
    if (focalLength) {
      const focal = typeof focalLength === 'number' ? focalLength : parseFloat(String(focalLength).replace('mm', ''));
      if (!isNaN(focal) && focal > 0) parts.push(`${focal}mm`);
    }
    if (fNumber) {
      const f = typeof fNumber === 'number' ? fNumber : parseFloat(String(fNumber).replace('f/', ''));
      if (!isNaN(f) && f > 0) parts.push(`f/${f.toFixed(1)}`);
    }
    if (exposureTime) {
      let exp: number;
      if (typeof exposureTime === 'number') {
        exp = exposureTime;
      } else {
        const expStr = String(exposureTime);
        // Handle "1/120s" format
        if (expStr.includes('/')) {
          const [num, den] = expStr.split('/').map(n => parseFloat(n.replace('s', '')));
          exp = num / den;
        } else {
          exp = parseFloat(expStr.replace('s', ''));
        }
      }
      if (!isNaN(exp) && exp > 0) {
        if (exp < 1) {
          parts.push(`1/${Math.round(1/exp)}s`);
        } else {
          parts.push(`${exp}s`);
        }
      }
    }
    if (iso) {
      const isoVal = typeof iso === 'number' ? iso : parseFloat(String(iso).replace('ISO', '').trim());
      if (!isNaN(isoVal) && isoVal > 0) parts.push(`ISO ${isoVal}`);
    }
    
    return parts.length > 0 ? parts.join(' • ') : null;
  };

  const renderInfoTab = () => {
    // Debug: Log what data we actually have
    if (typeof window !== 'undefined' && window.location.search.includes('debug=info')) {
      console.log('ImageInfoPanel Debug:', {
        imageMetadata,
        attribution,
        tags,
        comments,
        exif_data: imageMetadata?.exif_data,
        latitude: imageMetadata?.latitude,
        longitude: imageMetadata?.longitude
      });
    }

    // Catalog-style expanded data (same as desktop DETAIL panel)
    return (
      <div style={{ color: 'white', fontSize: '13px', lineHeight: '1.5' }}>
        <ImageExpandedData
          imageRecord={imageRecord}
          imageMetadata={imageMetadata}
          attribution={attribution}
          tags={tags}
          commentsCount={comments.length}
          dark
        />
      </div>
    );
  };

  const renderTagsTab = () => (
    <div style={{ color: 'white' }}>
      {/* Legacy Vision/Provenance/Components block removed; ImageExpandedData covers this. */}
      {false && (() => {
        const zone = imageMetadata?.vehicle_zone;
        const condScore = imageMetadata?.condition_score;
        const dmgFlags: string[] = imageMetadata?.damage_flags || [];
        const photoQuality = imageMetadata?.photo_quality_score;
        const fabStage = imageMetadata?.fabrication_stage;

        const hasAnySummary = zone || condScore || dmgFlags.length > 0 || photoQuality || fabStage;
        if (!hasAnySummary) return null;

        const renderStars = (score: number, max: number = 5) => {
          const clamped = Math.max(1, Math.min(max, Math.round(score)));
          const filled = String.fromCodePoint(0x2605);
          const empty = String.fromCodePoint(0x2606);
          return filled.repeat(clamped) + empty.repeat(max - clamped);
        };

        return (
          <>
            <div style={{ height: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)', margin: '12px 0' }} />
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px', marginBottom: '6px' }}>VISION SUMMARY</div>

            {zone && (
              <div style={{ marginBottom: '6px' }}>
                <span style={{
                  display: 'inline-block',
                  padding: '2px 6px',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  backgroundColor: 'rgba(59,130,246,0.15)',
                  border: '1px solid rgba(59,130,246,0.3)',
                  color: 'rgba(147,197,253,1)',
                  textTransform: 'uppercase'
                }}>
                  {zone.replace(/_/g, ' ')}
                </span>
                {fabStage && (
                  <span style={{
                    display: 'inline-block',
                    marginLeft: '4px',
                    padding: '2px 6px',
                    fontSize: '10px',
                    backgroundColor: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    color: 'rgba(255,255,255,0.6)',
                    textTransform: 'uppercase'
                  }}>
                    {fabStage.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
            )}

            {condScore != null && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>Condition</span>
                <span style={{
                  fontSize: '13px',
                  color: condScore >= 4 ? 'rgba(74,222,128,0.9)' : condScore >= 3 ? 'rgba(250,204,21,0.9)' : 'rgba(248,113,113,0.9)',
                  letterSpacing: '1px'
                }}>
                  {renderStars(condScore)}
                </span>
              </div>
            )}

            {photoQuality != null && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>Photo Quality</span>
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}>{photoQuality}/5</span>
              </div>
            )}

            {dmgFlags.length > 0 && (
              <div style={{ marginTop: '4px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {dmgFlags.map((flag: string, i: number) => (
                    <span key={i} style={{
                      padding: '1px 5px',
                      fontSize: '9px',
                      fontWeight: 'bold',
                      backgroundColor: 'rgba(239,68,68,0.15)',
                      border: '1px solid rgba(239,68,68,0.3)',
                      color: 'rgba(252,165,165,1)',
                      textTransform: 'uppercase'
                    }}>
                      {flag.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        );
      })()}

      {/* Provenance — cross-source duplicate tracking */}
      {(() => {
        const scanMeta = imageMetadata?.ai_scan_metadata;
        const provenance: string[] | undefined = scanMeta?.cross_source_provenance;
        const duplicateSources: Array<{ source: string; detected_at?: string }> | undefined = scanMeta?.duplicate_sources;
        const isDuplicate = imageMetadata?.is_duplicate === true;
        const duplicateOf = imageMetadata?.duplicate_of;

        const sourceLabels: Record<string, string> = {
          user_upload: 'User Upload',
          photo_auto_sync: 'Auto Sync',
          iphoto: 'Apple Photos',
          bat_import_mirrored: 'BaT (mirrored)',
          bat_import: 'BaT Import',
          bat_image_library: 'BaT Library',
          extractor: 'Extractor',
          bat_listing: 'BaT Listing',
        };
        const getLabel = (s: string) => sourceLabels[s] || s.replace(/_/g, ' ');

        const sourcePriority: Record<string, number> = { user_upload: 1, photo_auto_sync: 2, iphoto: 3 };
        const isUserSource = (s: string) => (sourcePriority[s] ?? 50) <= 3;

        if (provenance && provenance.length > 1) {
          const imgSource = imageMetadata?.source || 'unknown';
          const isOriginal = scanMeta?.is_original === true;

          return (
            <>
              <div style={{ height: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)', margin: '12px 0' }} />
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px', marginBottom: '6px' }}>PROVENANCE</div>
              <div style={{
                fontFamily: "'Courier New', monospace",
                fontSize: '10px',
                lineHeight: '16px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {isOriginal && (
                    <span style={{
                      padding: '1px 4px',
                      fontSize: '8px',
                      fontWeight: 'bold',
                      backgroundColor: 'rgba(34,197,94,0.2)',
                      border: '1px solid rgba(34,197,94,0.4)',
                      color: 'rgba(74,222,128,1)',
                      textTransform: 'uppercase',
                    }}>ORIGINAL</span>
                  )}
                  <span style={{ color: 'rgba(255,255,255,0.7)' }}>
                    Original: {getLabel(imgSource)}
                  </span>
                </div>
                <div style={{ color: 'rgba(255,255,255,0.5)', marginTop: '2px' }}>
                  Also found on: {provenance.filter(s => s !== imgSource).map(s => getLabel(s)).join(', ')}
                </div>
                {isUserSource(imgSource) && provenance.some(s => !isUserSource(s)) && (
                  <div style={{
                    marginTop: '4px',
                    padding: '3px 6px',
                    backgroundColor: 'rgba(34,197,94,0.08)',
                    border: '1px solid rgba(34,197,94,0.15)',
                    color: 'rgba(163,230,183,0.9)',
                    fontSize: '9px',
                  }}>
                    Uploaded by user before appearing on auction platforms.
                  </div>
                )}
              </div>
            </>
          );
        }

        if (isDuplicate && duplicateOf) {
          return (
            <>
              <div style={{ height: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)', margin: '12px 0' }} />
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px', marginBottom: '6px' }}>PROVENANCE</div>
              <div style={{
                fontFamily: "'Courier New', monospace",
                fontSize: '10px',
                lineHeight: '16px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{
                    padding: '1px 4px',
                    fontSize: '8px',
                    fontWeight: 'bold',
                    backgroundColor: 'rgba(239,68,68,0.2)',
                    border: '1px solid rgba(239,68,68,0.4)',
                    color: 'rgba(252,165,165,1)',
                    textTransform: 'uppercase',
                  }}>DUPLICATE</span>
                </div>
                <div style={{ color: 'rgba(255,255,255,0.6)', marginTop: '2px' }}>
                  Original: {duplicateOf.substring(0, 8)}...
                </div>
              </div>
            </>
          );
        }

        return null;
      })()}

      {/* AI Analysis if available - supports both appraiser and tier_1_analysis formats */}
      {(imageMetadata?.ai_scan_metadata?.appraiser || imageMetadata?.ai_scan_metadata?.tier_1_analysis) && (
        <>
          <div style={{ height: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)', margin: '12px 0' }} />
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px', marginBottom: '4px' }}>AI ANALYSIS</div>

          {/* Tier 1 Analysis (new format) */}
          {imageMetadata?.ai_scan_metadata?.tier_1_analysis && (
            <>
              {/* Angle and Category */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                {imageMetadata.ai_scan_metadata.tier_1_analysis.angle && (
                  <span style={{
                    padding: '2px 6px',
                    backgroundColor: 'rgba(255,255,255,0.1)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    fontSize: '11px'
                  }}>
                    {imageMetadata.ai_scan_metadata.tier_1_analysis.angle.replace(/_/g, ' ')}
                  </span>
                )}
                {imageMetadata.ai_scan_metadata.tier_1_analysis.category && (
                  <span style={{
                    padding: '2px 6px',
                    backgroundColor: 'rgba(255,255,255,0.1)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    fontSize: '11px'
                  }}>
                    {imageMetadata.ai_scan_metadata.tier_1_analysis.category.replace(/_/g, ' ')}
                  </span>
                )}
                {imageMetadata.ai_scan_metadata.tier_1_analysis.condition_glance && (
                  <span style={{
                    padding: '2px 6px',
                    backgroundColor: imageMetadata.ai_scan_metadata.tier_1_analysis.condition_glance.includes('excellent') ? 'color-mix(in srgb, var(--success) 20%, transparent)' :
                                     imageMetadata.ai_scan_metadata.tier_1_analysis.condition_glance.includes('good') ? 'color-mix(in srgb, var(--accent) 20%, transparent)' :
                                     imageMetadata.ai_scan_metadata.tier_1_analysis.condition_glance.includes('poor') ? 'color-mix(in srgb, var(--error) 20%, transparent)' : 'rgba(255,255,255,0.1)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    fontSize: '11px'
                  }}>
                    {imageMetadata.ai_scan_metadata.tier_1_analysis.condition_glance.replace(/_/g, ' ')}
                  </span>
                )}
              </div>

              {/* Components visible */}
              {imageMetadata.ai_scan_metadata.tier_1_analysis.components_visible?.length > 0 && (
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '9px', marginBottom: '2px' }}>COMPONENTS</div>
                  <div style={{ fontSize: '11px', color: 'var(--surface-glass)' }}>
                    {imageMetadata.ai_scan_metadata.tier_1_analysis.components_visible.map((c: string) => c.replace(/_/g, ' ')).join(' • ')}
                  </div>
                </div>
              )}

              {/* Basic observations - the key insight */}
              {imageMetadata.ai_scan_metadata.tier_1_analysis.basic_observations && (
                <div style={{ color: 'var(--surface-glass)', fontSize: '12px', lineHeight: '1.4' }}>
                  {imageMetadata.ai_scan_metadata.tier_1_analysis.basic_observations}
                </div>
              )}

              {/* Image quality score */}
              {imageMetadata.ai_scan_metadata.tier_1_analysis.image_quality && (
                <div style={{ marginTop: '8px', display: 'flex', gap: '8px', fontSize: '9px', color: 'rgba(255,255,255,0.5)' }}>
                  <span>Quality: {imageMetadata.ai_scan_metadata.tier_1_analysis.image_quality.overall_score}/10</span>
                  <span>Focus: {imageMetadata.ai_scan_metadata.tier_1_analysis.image_quality.focus}</span>
                  <span>Lighting: {imageMetadata.ai_scan_metadata.tier_1_analysis.image_quality.lighting}</span>
                </div>
              )}
            </>
          )}

          {/* Legacy appraiser format */}
          {imageMetadata?.ai_scan_metadata?.appraiser && !imageMetadata?.ai_scan_metadata?.tier_1_analysis && (
            <>
              {imageMetadata.ai_scan_metadata.appraiser.angle && (
                <div>{imageMetadata.ai_scan_metadata.appraiser.angle}</div>
              )}
              {imageMetadata.ai_scan_metadata.appraiser.description && (
                <div style={{ color: 'var(--surface-glass)', fontSize: '12px', marginTop: '4px' }}>
                  {imageMetadata.ai_scan_metadata.appraiser.description}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Deep Analysis — Reference Catalog forensic data (supersedes tier_1 when present) */}
      {imageMetadata?.ai_scan_metadata?.deep_analysis && (() => {
        const deep = imageMetadata.ai_scan_metadata.deep_analysis;
        const cond = deep.condition_detail;
        const surf = deep.surface_analysis;
        const deg = deep.degradation;
        const color = deep.color_data;
        const mods = deep.modifications;
        const subj = deep.subject;
        const env = deep.light_and_environment;

        const scoreColor = (s: number) =>
          s >= 7 ? 'var(--success)' : s >= 4 ? '#facc15' : 'var(--error)';

        return (
          <>
            <div style={{ height: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)', margin: '12px 0' }} />
            <div style={{ color: 'var(--gulf-orange, #F37021)', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, marginBottom: '8px' }}>
              FORENSIC ANALYSIS
            </div>

            {/* Subject */}
            {subj?.primary_focus && (
              <div style={{ marginBottom: '8px' }}>
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, marginBottom: '2px' }}>SUBJECT</div>
                <div style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: '11px', color: 'var(--surface-elevated)', lineHeight: 1.4 }}>
                  {subj.primary_focus}
                </div>
              </div>
            )}

            {/* Condition */}
            {cond && (
              <div style={{ marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                  {cond.overall_score != null && (
                    <span style={{
                      padding: '2px 7px',
                      fontFamily: "'Courier New', Courier, monospace",
                      fontSize: '12px',
                      fontWeight: 700,
                      color: 'var(--text)',
                      backgroundColor: scoreColor(cond.overall_score),
                    }}>
                      {cond.overall_score}/10
                    </span>
                  )}
                  {cond.restoration_state && (
                    <span style={{
                      padding: '1px 5px',
                      fontSize: '9px',
                      fontWeight: 700,
                      textTransform: 'uppercase' as const,
                      color: 'rgba(255,255,255,0.7)',
                      border: '1px solid rgba(255,255,255,0.2)',
                    }}>
                      {cond.restoration_state.replace(/_/g, ' ')}
                    </span>
                  )}
                  {cond.structural_integrity && (
                    <span style={{
                      padding: '1px 5px',
                      fontSize: '9px',
                      color: cond.structural_integrity.includes('concern') ? '#facc15' : 'rgba(255,255,255,0.6)',
                      border: '1px solid rgba(255,255,255,0.15)',
                    }}>
                      {cond.structural_integrity.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
                {cond.condition_notes && (
                  <div style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: '11px', color: 'rgba(255,255,255,0.8)', lineHeight: 1.4 }}>
                    {cond.condition_notes}
                  </div>
                )}
              </div>
            )}

            {/* Surface */}
            {surf && (surf.primary_material || surf.paint_observations) && (
              <div style={{ marginBottom: '8px' }}>
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, marginBottom: '2px' }}>SURFACE</div>
                <div style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: '11px', color: 'rgba(255,255,255,0.8)', lineHeight: 1.4 }}>
                  {[surf.primary_material?.replace(/_/g, ' '), surf.surface_finish?.replace(/_/g, ' ')].filter(Boolean).join(' / ')}
                </div>
                {surf.paint_observations && (
                  <div style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: '10px', color: 'rgba(255,255,255,0.6)', lineHeight: 1.4, marginTop: '2px' }}>
                    {surf.paint_observations}
                  </div>
                )}
              </div>
            )}

            {/* Degradation */}
            {deg && (deg.lifecycle_state || deg.degradation_narrative) && (
              <div style={{ marginBottom: '8px' }}>
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, marginBottom: '2px' }}>DEGRADATION</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
                  {deg.lifecycle_state && (
                    <span style={{
                      padding: '1px 5px',
                      fontSize: '9px',
                      fontWeight: 700,
                      textTransform: 'uppercase' as const,
                      color: deg.lifecycle_state === 'archaeological' || deg.lifecycle_state === 'terminal' ? 'var(--error)' :
                             deg.lifecycle_state === 'active_decay' ? '#facc15' : 'rgba(255,255,255,0.7)',
                      border: '1px solid rgba(255,255,255,0.2)',
                    }}>
                      {deg.lifecycle_state.replace(/_/g, ' ')}
                    </span>
                  )}
                  {deg.mechanisms?.map((m: string, i: number) => (
                    <span key={i} style={{
                      padding: '1px 4px',
                      fontSize: '8px',
                      fontFamily: "'Courier New', Courier, monospace",
                      color: 'rgba(255,255,255,0.6)',
                      border: '1px solid rgba(255,255,255,0.1)',
                    }}>
                      {m.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
                {deg.degradation_narrative && (
                  <div style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: '10px', color: 'rgba(255,255,255,0.6)', lineHeight: 1.4 }}>
                    {deg.degradation_narrative}
                  </div>
                )}
              </div>
            )}

            {/* Color */}
            {color && (color.dominant_colors?.length > 0 || color.paint_color_name) && (
              <div style={{ marginBottom: '8px' }}>
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, marginBottom: '2px' }}>COLOR</div>
                {color.dominant_colors?.length > 0 && (
                  <div style={{ display: 'flex', gap: '3px', marginBottom: '4px', alignItems: 'center' }}>
                    {color.dominant_colors.map((hex: string, i: number) => (
                      <span key={i} title={hex} style={{
                        display: 'inline-block',
                        width: '16px',
                        height: '16px',
                        backgroundColor: hex,
                        border: '1px solid rgba(255,255,255,0.3)',
                      }} />
                    ))}
                    {color.paint_color_name && (
                      <span style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: '11px', color: 'var(--surface-elevated)', marginLeft: '6px' }}>
                        {color.paint_color_name}
                      </span>
                    )}
                  </div>
                )}
                {color.color_narrative && (
                  <div style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: '10px', color: 'rgba(255,255,255,0.6)', lineHeight: 1.4 }}>
                    {color.color_narrative}
                  </div>
                )}
              </div>
            )}

            {/* Modifications */}
            {mods?.detected?.length > 0 && (
              <div style={{ marginBottom: '8px' }}>
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, marginBottom: '2px' }}>MODIFICATIONS</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {mods.detected.map((m: string, i: number) => (
                    <span key={i} style={{
                      padding: '1px 5px',
                      fontSize: '9px',
                      fontFamily: "'Courier New', Courier, monospace",
                      color: 'rgba(255,255,255,0.8)',
                      border: '1px solid rgba(255,255,255,0.2)',
                    }}>
                      {m.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
                {mods.period_correct != null && (
                  <div style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginTop: '2px' }}>
                    Period correct: {mods.period_correct ? 'Yes' : 'No'}
                    {mods.modification_quality ? ` / Quality: ${mods.modification_quality.replace(/_/g, ' ')}` : ''}
                  </div>
                )}
              </div>
            )}

            {/* Components & Hardware */}
            {subj?.components_visible?.length > 0 && (
              <div style={{ marginBottom: '8px' }}>
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, marginBottom: '2px' }}>COMPONENTS</div>
                <div style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: '10px', color: 'rgba(255,255,255,0.7)' }}>
                  {subj.components_visible.map((c: string) => c.replace(/_/g, ' ')).join(' / ')}
                </div>
              </div>
            )}

            {subj?.hardware_visible?.length > 0 && (
              <div style={{ marginBottom: '8px' }}>
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, marginBottom: '2px' }}>HARDWARE</div>
                <div style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: '10px', color: 'rgba(255,255,255,0.7)' }}>
                  {subj.hardware_visible.map((h: string) => h.replace(/_/g, ' ')).join(' / ')}
                </div>
              </div>
            )}

            {/* Text Visible */}
            {subj?.text_visible?.length > 0 && (
              <div style={{ marginBottom: '8px' }}>
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, marginBottom: '2px' }}>TEXT VISIBLE</div>
                <div style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: '11px', color: 'var(--surface-elevated)' }}>
                  {subj.text_visible.join(', ')}
                </div>
              </div>
            )}

            {/* Environment & Fabrication */}
            {(deep.fabrication_stage || env) && (
              <div style={{ marginBottom: '8px' }}>
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, marginBottom: '2px' }}>ENVIRONMENT</div>
                <div style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: '10px', color: 'rgba(255,255,255,0.6)' }}>
                  {[
                    deep.fabrication_stage ? `Stage: ${deep.fabrication_stage.replace(/_/g, ' ')}` : null,
                    env?.lighting ? `Light: ${env.lighting.replace(/_/g, ' ')}` : null,
                    env?.environment ? `Env: ${env.environment}` : null,
                    env?.photo_quality_score != null ? `Quality: ${env.photo_quality_score}/10` : null,
                  ].filter(Boolean).join(' / ')}
                </div>
              </div>
            )}

            {/* Forensic Observations */}
            {deep.forensic_observations && (
              <div style={{ marginBottom: '8px' }}>
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, marginBottom: '2px' }}>FORENSIC NOTES</div>
                <div style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: '10px', color: 'rgba(255,255,255,0.6)', lineHeight: 1.4 }}>
                  {deep.forensic_observations}
                </div>
              </div>
            )}

            {/* Analysis metadata */}
            {deep._meta && (
              <div style={{ fontSize: '8px', color: 'rgba(255,255,255,0.25)', marginTop: '4px' }}>
                {deep._meta.model} / {deep._meta.prompt_version}
                {deep._meta.analyzed_at ? ` / ${new Date(deep._meta.analyzed_at).toLocaleDateString()}` : ''}
              </div>
            )}
          </>
        );
      })()}

      {/* Engine Bay Analysis — deep component breakdown from analyze-engine-bay */}
      {imageMetadata?.components?.engine_family && (
        <>
          <div style={{ height: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)', margin: '12px 0' }} />
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px', marginBottom: '6px' }}>ENGINE BAY ANALYSIS</div>

          {/* Engine family + displacement */}
          <div style={{ marginBottom: '6px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600 }}>
              {imageMetadata.components.engine_family}
              {imageMetadata.components.estimated_displacement ? ` ${imageMetadata.components.estimated_displacement}` : ''}
            </span>
            {imageMetadata.components.engine_family_confidence != null && (
              <span style={{
                marginLeft: '6px',
                padding: '1px 5px',
                fontSize: '9px',
                backgroundColor: imageMetadata.components.engine_family_confidence >= 0.8 ? 'color-mix(in srgb, var(--success) 25%, transparent)' :
                                 imageMetadata.components.engine_family_confidence >= 0.5 ? 'color-mix(in srgb, var(--warning) 25%, transparent)' : 'color-mix(in srgb, var(--error) 25%, transparent)',
                border: `1px solid ${imageMetadata.components.engine_family_confidence >= 0.8 ? 'var(--success)' :
                                      imageMetadata.components.engine_family_confidence >= 0.5 ? 'var(--warning)' : 'var(--error)'}`,
              }}>
                {Math.round(imageMetadata.components.engine_family_confidence * 100)}%
              </span>
            )}
          </div>

          {/* Component rows */}
          <div style={{ fontSize: '11px', lineHeight: '1.8', color: 'rgba(255,255,255,0.8)' }}>
            {imageMetadata.components.fuel_system?.type && (
              <div>
                <span style={{ color: 'rgba(255,255,255,0.4)' }}>Fuel: </span>
                {imageMetadata.components.fuel_system.brand && imageMetadata.components.fuel_system.brand !== 'unknown'
                  ? `${imageMetadata.components.fuel_system.brand} ${imageMetadata.components.fuel_system.model || imageMetadata.components.fuel_system.type}`
                  : imageMetadata.components.fuel_system.type.replace(/_/g, ' ')}
                {imageMetadata.components.fuel_system.barrels ? ` (${imageMetadata.components.fuel_system.barrels}bbl)` : ''}
                {imageMetadata.components.fuel_system.confidence != null && (
                  <span style={{ color: 'rgba(255,255,255,0.3)', marginLeft: '4px' }}>
                    {Math.round(imageMetadata.components.fuel_system.confidence * 100)}%
                  </span>
                )}
              </div>
            )}
            {imageMetadata.components.ignition_system?.type && (
              <div>
                <span style={{ color: 'rgba(255,255,255,0.4)' }}>Ignition: </span>
                {imageMetadata.components.ignition_system.brand && imageMetadata.components.ignition_system.brand !== 'unknown'
                  ? imageMetadata.components.ignition_system.brand.replace(/_/g, ' ')
                  : imageMetadata.components.ignition_system.type.replace(/_/g, ' ')}
                {imageMetadata.components.ignition_system.aftermarket_ignition ? ' (aftermarket)' : ''}
              </div>
            )}
            {imageMetadata.components.valve_covers?.type && imageMetadata.components.valve_covers.type !== 'unknown' && (
              <div>
                <span style={{ color: 'rgba(255,255,255,0.4)' }}>Valve Covers: </span>
                {imageMetadata.components.valve_covers.type.replace(/_/g, ' ')}
              </div>
            )}
            {imageMetadata.components.exhaust_manifolds?.type && imageMetadata.components.exhaust_manifolds.type !== 'unknown' && (
              <div>
                <span style={{ color: 'rgba(255,255,255,0.4)' }}>Exhaust: </span>
                {imageMetadata.components.exhaust_manifolds.type.replace(/_/g, ' ')}
              </div>
            )}
            {imageMetadata.components.air_cleaner?.type && imageMetadata.components.air_cleaner.type !== 'unknown' && (
              <div>
                <span style={{ color: 'rgba(255,255,255,0.4)' }}>Air Cleaner: </span>
                {imageMetadata.components.air_cleaner.type.replace(/_/g, ' ')}
                {imageMetadata.components.air_cleaner.aftermarket ? ' (aftermarket)' : ''}
              </div>
            )}
            {imageMetadata.components.condition && imageMetadata.components.condition !== 'unknown' && (
              <div>
                <span style={{ color: 'rgba(255,255,255,0.4)' }}>Condition: </span>
                <span style={{
                  color: imageMetadata.components.condition === 'show_quality' ? 'var(--success)' :
                         imageMetadata.components.condition === 'well_maintained' ? 'var(--accent)' :
                         imageMetadata.components.condition === 'neglected' ? 'var(--error)' :
                         imageMetadata.components.condition === 'project' ? 'var(--warning)' : 'inherit'
                }}>
                  {imageMetadata.components.condition.replace(/_/g, ' ')}
                </span>
              </div>
            )}
            {imageMetadata.components.estimated_era && imageMetadata.components.estimated_era !== 'mixed' && (
              <div>
                <span style={{ color: 'rgba(255,255,255,0.4)' }}>Era: </span>
                {imageMetadata.components.estimated_era}
              </div>
            )}
          </div>

          {/* Visible modifications */}
          {imageMetadata.components.visible_modifications?.length > 0 && (
            <div style={{ marginTop: '6px' }}>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '9px', marginBottom: '2px' }}>
                MODS ({imageMetadata.components.visible_modifications.length})
              </div>
              <div style={{ fontSize: '11px', color: 'var(--surface-glass)' }}>
                {imageMetadata.components.visible_modifications.join(' / ')}
              </div>
            </div>
          )}

          {/* Notes */}
          {imageMetadata.components.notes && (
            <div style={{ marginTop: '4px', fontSize: '11px', color: 'rgba(255,255,255,0.5)', fontStyle: 'italic' }}>
              {imageMetadata.components.notes}
            </div>
          )}

          {/* Analysis metadata */}
          <div style={{ marginTop: '6px', fontSize: '9px', color: 'rgba(255,255,255,0.25)' }}>
            {imageMetadata.components.analyzed_by}
            {imageMetadata.components.analysis_version > 1 ? ` v${imageMetadata.components.analysis_version}` : ''}
            {imageMetadata.components.vehicle_context_used ? ' +context' : ''}
          </div>
        </>
      )}
      {tags.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
          {tags.map((tag, i) => (
            <span
              key={i}
              style={{
                padding: '4px 8px',
                backgroundColor: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                fontSize: '11px'
              }}
            >
              {tag.tag_text || tag.tag_name}
            </span>
          ))}
        </div>
      ) : (
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px' }}>
          No tags yet
        </div>
      )}
      {canEdit && (
        <button
          onClick={onTag}
          className="button"
          style={{
            width: '100%',
            padding: '12px',
            backgroundColor: 'rgba(255,255,255,0.1)',
            border: '2px solid rgba(255,255,255,0.3)',
            color: 'white',
            fontSize: '12px',
            fontWeight: 'bold',
            marginTop: '12px'
          }}
        >
          ADD TAG
        </button>
      )}
    </div>
  );

  const renderCommentsTab = () => {
    // Transform comments to handle both formats (user object or username string)
    const transformedComments = comments.map(comment => ({
      ...comment,
      username: comment.username || comment.user?.username || comment.user?.full_name || 'User',
      created_at: comment.created_at ? (() => {
        const date = new Date(comment.created_at);
        const now = new Date();
        const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
        if (seconds < 60) return 'just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      })() : 'Unknown'
    }));

    return (
      <div style={{ color: 'white' }}>
        {transformedComments.length > 0 ? (
          transformedComments.map((comment, i) => (
            <div
              key={comment.id || i}
              style={{
                padding: '12px',
                backgroundColor: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                marginBottom: '8px'
              }}
            >
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>
                {comment.username} • {comment.created_at}
              </div>
              <div style={{ fontSize: '12px' }}>{comment.comment_text}</div>
            </div>
          ))
        ) : (
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px' }}>
            No comments yet
          </div>
        )}
      </div>
    );
  };

  const renderActionsTab = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <button
        onClick={onTag}
        className="button"
        style={{
          width: '100%',
          padding: '12px',
          backgroundColor: 'var(--surface)',
          color: 'var(--text)',
          border: '2px solid white',
          fontSize: '12px',
          fontWeight: 'bold'
        }}
      >
        TAG IMAGE
      </button>
      
      <button
        onClick={onSetPrimary}
        disabled={imageMetadata?.is_primary}
        className="button"
        style={{
          width: '100%',
          padding: '12px',
          backgroundColor: imageMetadata?.is_primary ? 'var(--success)' : 'rgba(255,255,255,0.1)',
          border: '2px solid rgba(255,255,255,0.3)',
          color: 'white',
          fontSize: '12px',
          fontWeight: 'bold'
        }}
      >
        {imageMetadata?.is_primary ? 'PRIMARY IMAGE' : 'SET AS PRIMARY'}
      </button>
      
      <button
        onClick={onRotate}
        className="button"
        style={{
          width: '100%',
          padding: '12px',
          backgroundColor: 'rgba(255,255,255,0.1)',
          border: '2px solid rgba(255,255,255,0.3)',
          color: 'white',
          fontSize: '12px',
          fontWeight: 'bold'
        }}
      >
        ROTATE 90°
      </button>
      
      <button
        onClick={onToggleSensitive}
        className="button"
        style={{
          width: '100%',
          padding: '12px',
          backgroundColor: imageMetadata?.is_sensitive ? 'var(--warning)' : 'rgba(255,255,255,0.1)',
          border: '2px solid rgba(255,255,255,0.3)',
          color: imageMetadata?.is_sensitive ? 'var(--text)' : 'white',
          fontSize: '12px',
          fontWeight: 'bold'
        }}
      >
        {imageMetadata?.is_sensitive ? 'SENSITIVE (BLURRED)' : 'MARK SENSITIVE'}
      </button>

      <div style={{ height: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)', margin: '8px 0' }} />
      
      <button
        onClick={() => {
          if (confirm('Delete this image? This cannot be undone.')) {
            onDelete();
          }
        }}
        className="button"
        style={{
          width: '100%',
          padding: '12px',
          backgroundColor: 'var(--error)',
          border: '2px solid var(--error)',
          color: 'white',
          fontSize: '12px',
          fontWeight: 'bold'
        }}
      >
        DELETE IMAGE
      </button>
    </div>
  );

  return (
    <div
      ref={panelRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        height: windowHeight,
        backgroundColor: 'var(--bg)',
        borderTop: '2px solid rgba(255,255,255,0.2)',
        zIndex: 10001,
        touchAction: 'none',
        transform: `translateY(${currentY}px)`,
        transition: dragStartY === null ? 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {/* Drag Handle */}
      <div
        style={{
          padding: '12px',
          display: 'flex',
          justifyContent: 'center',
          cursor: 'grab',
          borderBottom: '1px solid rgba(255,255,255,0.1)'
        }}
      >
        <div
          style={{
            width: '40px',
            height: '4px',
            backgroundColor: 'rgba(255,255,255,0.3)'}}
        />
      </div>

      {/* Tabs (only show in full state) */}
      {panelState === 'full' && (
        <div style={{ display: 'flex', borderBottom: '2px solid rgba(255,255,255,0.2)' }}>
          {canEdit && (
            <button
              onClick={() => setActiveTab('actions')}
              style={{
                flex: 1,
                padding: '12px',
                backgroundColor: activeTab === 'actions' ? 'rgba(255,255,255,0.1)' : 'transparent',
                border: 'none',
                borderBottom: activeTab === 'actions' ? '2px solid white' : 'none',
                color: activeTab === 'actions' ? 'white' : 'rgba(255,255,255,0.5)',
                fontSize: '11px',
                fontWeight: 'bold',
                cursor: 'pointer',
                textTransform: 'uppercase'
              }}
            >
              ACTIONS
            </button>
          )}
          <button
            onClick={() => setActiveTab('info')}
            style={{
              flex: 1,
              padding: '12px',
              backgroundColor: activeTab === 'info' ? 'rgba(255,255,255,0.1)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'info' ? '2px solid white' : 'none',
              color: activeTab === 'info' ? 'white' : 'rgba(255,255,255,0.5)',
              fontSize: '11px',
              fontWeight: 'bold',
              cursor: 'pointer',
              textTransform: 'uppercase'
            }}
          >
            INFO
          </button>
          <button
            onClick={() => setActiveTab('tags')}
            style={{
              flex: 1,
              padding: '12px',
              backgroundColor: activeTab === 'tags' ? 'rgba(255,255,255,0.1)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'tags' ? '2px solid white' : 'none',
              color: activeTab === 'tags' ? 'white' : 'rgba(255,255,255,0.5)',
              fontSize: '11px',
              fontWeight: 'bold',
              cursor: 'pointer',
              textTransform: 'uppercase'
            }}
          >
            TAGS
          </button>
          <button
            onClick={() => setActiveTab('comments')}
            style={{
              flex: 1,
              padding: '12px',
              backgroundColor: activeTab === 'comments' ? 'rgba(255,255,255,0.1)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'comments' ? '2px solid white' : 'none',
              color: activeTab === 'comments' ? 'white' : 'rgba(255,255,255,0.5)',
              fontSize: '11px',
              fontWeight: 'bold',
              cursor: 'pointer',
              textTransform: 'uppercase'
            }}
          >
            COMMENTS
          </button>
        </div>
      )}

      {/* Content */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '16px',
          WebkitOverflowScrolling: 'touch'
        }}
      >
        {panelState === 'peek' ? renderInfoTab() : (
          <>
            {activeTab === 'info' && renderInfoTab()}
            {activeTab === 'tags' && renderTagsTab()}
            {activeTab === 'comments' && renderCommentsTab()}
            {activeTab === 'actions' && renderActionsTab()}
          </>
        )}
      </div>
    </div>
  );
};
