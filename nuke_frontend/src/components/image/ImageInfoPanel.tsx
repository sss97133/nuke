/**
 * ImageInfoPanel - Swipeable info panel for mobile lightbox
 * No emojis, no headers, just clean contextual data
 * Uses native touch events (no external dependencies)
 */

import React, { useState, useRef, useEffect } from 'react';

type PanelState = 'closed' | 'peek' | 'full';
type TabType = 'info' | 'tags' | 'comments' | 'actions';

interface ImageInfoPanelProps {
  imageMetadata: any;
  attribution: any;
  tags: any[];
  comments: any[];
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

    return (
      <div style={{ color: 'white', fontSize: '10pt', lineHeight: '1.5' }}>
        {/* Date/Time */}
        {(imageMetadata?.created_at || imageMetadata?.taken_at) && (
          <>
            <div>{formatDate(imageMetadata.taken_at || imageMetadata.created_at)}</div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '8pt' }}>
              {(() => {
                const now = new Date();
                const then = new Date(imageMetadata.taken_at || imageMetadata.created_at);
                const days = Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24));
                if (days === 0) return 'Today';
                if (days === 1) return 'Yesterday';
                return `${days} days ago`;
              })()}
            </div>
          </>
        )}

      {/* Location - Check multiple sources */}
      {(() => {
        const location = imageMetadata?.exif_data?.location;
        const gps = imageMetadata?.exif_data?.gps;
        const lat = location?.latitude || gps?.latitude || imageMetadata?.latitude;
        const lng = location?.longitude || gps?.longitude || imageMetadata?.longitude;
        
        if (!lat || !lng) return null;
        
        return (
          <>
            <div style={{ height: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)', margin: '12px 0' }} />
            {/* Priority 1: City + State (if reverse geocoded) */}
            {location && typeof location === 'object' && location.city ? (
              <>
                <div>{location.city}{location.state ? `, ${location.state}` : ''}</div>
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '8pt' }}>
                  {lat.toFixed(4)}, {lng.toFixed(4)}
                </div>
              </>
            ) : location && typeof location === 'string' ? (
              <div>{location}</div>
            ) : (
              <div>{lat.toFixed(4)}, {lng.toFixed(4)}</div>
            )}
          </>
        );
      })()}

      {/* Camera/EXIF - Always show if camera exists, even without EXIF details */}
      {imageMetadata?.exif_data?.camera && (
        <>
          <div style={{ height: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)', margin: '12px 0' }} />
          <div>
            {typeof imageMetadata.exif_data.camera === 'string' 
              ? imageMetadata.exif_data.camera 
              : `${imageMetadata.exif_data.camera.make || ''} ${imageMetadata.exif_data.camera.model || ''}`.trim() || 'Camera'
            }
          </div>
          {getExifText() && (
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '9pt' }}>
              {getExifText()}
            </div>
          )}
          {imageMetadata?.exif_data?.dimensions && (
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '8pt' }}>
              {imageMetadata.exif_data.dimensions.width} × {imageMetadata.exif_data.dimensions.height}
            </div>
          )}
          {!getExifText() && !imageMetadata?.exif_data?.dimensions && (
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '8pt', fontStyle: 'italic' }}>
              No EXIF details available
            </div>
          )}
        </>
      )}

      {/* Source/Attribution */}
      {attribution && (
        <>
          <div style={{ height: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)', margin: '12px 0' }} />
          {attribution.photographer?.name && (
            <div>{attribution.photographer.name}</div>
          )}
          {attribution.organization ? (
            <>
              <div style={{ fontWeight: 600 }}>{attribution.organization.name}</div>
              {attribution.organization.relationshipLabel && (
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '9pt' }}>
                  {attribution.organization.relationshipLabel}
                </div>
              )}
            </>
          ) : attribution.uploader ? (
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '9pt' }}>
              {attribution.uploader.full_name || attribution.uploader.username || 'User'}
            </div>
          ) : null}
          {/* Only show source if it's not bat_listing (already shown via organization) */}
          {attribution.source && attribution.source !== 'bat_listing' && (
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '8pt' }}>
              Source: {attribution.source}
            </div>
          )}
        </>
      )}

      {/* Stats - Always show if we have any data */}
      {(imageMetadata?.view_count || imageMetadata?.comment_count || comments.length > 0) && (
        <>
          <div style={{ height: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)', margin: '12px 0' }} />
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '9pt' }}>
            {[
              imageMetadata?.view_count ? `${imageMetadata.view_count} ${imageMetadata.view_count === 1 ? 'view' : 'views'}` : null,
              comments.length > 0 ? `${comments.length} ${comments.length === 1 ? 'comment' : 'comments'}` : null
            ].filter(Boolean).join(' • ') || 'No stats'}
          </div>
        </>
      )}

      {/* Tags preview - Show even if empty to indicate section exists */}
      <div style={{ height: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)', margin: '12px 0' }} />
      {tags.length > 0 ? (
        <div style={{ fontSize: '9pt', color: 'rgba(255,255,255,0.7)' }}>
          {tags.slice(0, 5).map(tag => tag.tag_text || tag.tag_name || tag.text || 'tag').filter(Boolean).join(' • ')}
        </div>
      ) : (
        <div style={{ fontSize: '8pt', color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' }}>
          No tags
        </div>
      )}

      {/* AI Analysis if available */}
      {imageMetadata?.ai_scan_metadata?.appraiser && (
        <>
          <div style={{ height: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)', margin: '12px 0' }} />
          {imageMetadata.ai_scan_metadata.appraiser.angle && (
            <div>{imageMetadata.ai_scan_metadata.appraiser.angle}</div>
          )}
          {imageMetadata.ai_scan_metadata.appraiser.description && (
            <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '9pt', marginTop: '4px' }}>
              {imageMetadata.ai_scan_metadata.appraiser.description}
            </div>
          )}
        </>
      )}
      </div>
    );
  };

  const renderTagsTab = () => (
    <div style={{ color: 'white' }}>
      {tags.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
          {tags.map((tag, i) => (
            <span
              key={i}
              style={{
                padding: '4px 8px',
                backgroundColor: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                fontSize: '8pt'
              }}
            >
              {tag.tag_text || tag.tag_name}
            </span>
          ))}
        </div>
      ) : (
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '9pt' }}>
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
            fontSize: '9pt',
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
              <div style={{ fontSize: '8pt', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>
                {comment.username} • {comment.created_at}
              </div>
              <div style={{ fontSize: '9pt' }}>{comment.comment_text}</div>
            </div>
          ))
        ) : (
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '9pt' }}>
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
          backgroundColor: 'white',
          color: 'black',
          border: '2px solid white',
          fontSize: '9pt',
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
          backgroundColor: imageMetadata?.is_primary ? '#16a34a' : 'rgba(255,255,255,0.1)',
          border: '2px solid rgba(255,255,255,0.3)',
          color: 'white',
          fontSize: '9pt',
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
          fontSize: '9pt',
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
          backgroundColor: imageMetadata?.is_sensitive ? '#eab308' : 'rgba(255,255,255,0.1)',
          border: '2px solid rgba(255,255,255,0.3)',
          color: imageMetadata?.is_sensitive ? 'black' : 'white',
          fontSize: '9pt',
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
          backgroundColor: '#dc2626',
          border: '2px solid #ef4444',
          color: 'white',
          fontSize: '9pt',
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
        backgroundColor: '#0a0a0a',
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
            backgroundColor: 'rgba(255,255,255,0.3)',
            borderRadius: '2px'
          }}
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
                fontSize: '8pt',
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
              fontSize: '8pt',
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
              fontSize: '8pt',
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
              fontSize: '8pt',
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
