/**
 * Mobile Bottom Toolbar
 * Instagram/Snapchat-style bottom toolbar with camera, comment, and tag tools
 */

import React, { useState, useRef } from 'react';
import { useImageUpload } from '../../hooks/useImageUpload';
import { MobilePhotoDump } from './MobilePhotoDump';

interface MobileBottomToolbarProps {
  vehicleId: string;
  session: any;
  isOwner: boolean;
  hasContributorAccess: boolean;
  onToolSelect?: (tool: 'camera' | 'comment' | 'tag') => void;
  currentImage?: any;
}

export const MobileBottomToolbar: React.FC<MobileBottomToolbarProps> = ({
  vehicleId,
  session,
  isOwner,
  hasContributorAccess,
  onToolSelect,
  currentImage
}) => {
  const [activeTool, setActiveTool] = useState<'camera' | 'comment' | 'tag' | null>(null);
  const [showPhotoDump, setShowPhotoDump] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploading, upload } = useImageUpload(session, isOwner, hasContributorAccess);
  
  const handleToolClick = (tool: 'camera' | 'comment' | 'tag') => {
    if (tool === 'camera') {
      fileInputRef.current?.click();
    } else {
      const isActivating = activeTool !== tool;
      setActiveTool(isActivating ? tool : null);
      onToolSelect?.(tool);
      
      // Focus comment input or trigger keyboard for tag mode
      if (isActivating) {
        setTimeout(() => {
          if (tool === 'comment') {
            // Find and focus the comment textarea
            const commentInput = document.querySelector('textarea[placeholder*="comment" i]') as HTMLTextAreaElement;
            if (commentInput) {
              commentInput.focus();
              commentInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          } else if (tool === 'tag') {
            // Tag mode - user will tap image to place pin, then keyboard appears
          }
        }, 100);
      }
    }
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files) return;
    await upload(vehicleId, files, 'general');
  };

  const canUpload = session?.user && (isOwner || hasContributorAccess);

  // DEBUG: Log upload permissions
  console.log('[MobileBottomToolbar] Upload check:', {
    hasSession: !!session?.user,
    userId: session?.user?.id,
    isOwner,
    hasContributorAccess,
    canUpload,
    willShowCameraButton: canUpload
  });

  return (
    <>
      {/* Photo Dump Modal */}
      {showPhotoDump && (
        <MobilePhotoDump 
          onClose={() => setShowPhotoDump(false)}
          session={session}
        />
      )}

      {/* Hidden file input for camera/library */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => handleFileUpload(e.target.files)}
      />

      {/* Bottom Toolbar - X/Twitter Style */}
      <div style={styles.toolbar}>
        {/* Comment Tool - Left */}
        <button
          onClick={() => handleToolClick('comment')}
          style={{
            ...styles.toolButton,
            opacity: activeTool === 'comment' ? 1 : 0.6
          }}
          title="Comment"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>

        {/* Photo Dump Tool - Upload Multiple Photos */}
        {canUpload && (
          <button
            onClick={() => setShowPhotoDump(true)}
            style={{
              ...styles.toolButton,
              opacity: 0.8
            }}
            title="Photo Dump - Upload Multiple"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ position: 'absolute', top: 2, right: 2 }}>
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            </svg>
          </button>
        )}

        {/* Camera Tool - Center (only for contributors) */}
        {canUpload && (
          <button
            onClick={() => handleToolClick('camera')}
            disabled={uploading}
            style={{
              ...styles.cameraButton,
              opacity: uploading ? 0.5 : 1
            }}
            title="Take Photo"
          >
            <span style={{ fontSize: '24px', lineHeight: 1 }}>+</span>
            {uploading && <div style={styles.uploadingDot} />}
          </button>
        )}

        {/* Tag/Question Tool - Right */}
        <button
          onClick={() => handleToolClick('tag')}
          style={{
            ...styles.toolButton,
            opacity: activeTool === 'tag' ? 1 : 0.6
          }}
          title="Pin Question"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v6m0 6v10m10-10h-6m-6 0H0" />
          </svg>
        </button>
      </div>

      {/* Tool Status/Instructions */}
      {activeTool === 'tag' && (
        <div style={styles.toolHint}>
          Tap anywhere on an image to ask a question about that specific part
        </div>
      )}
      {activeTool === 'comment' && (
        <div style={styles.toolHint}>
          Quick comment mode active
        </div>
      )}
    </>
  );
};

const styles: Record<string, React.CSSProperties> = {
  toolbar: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    height: '56px',
    background: 'transparent',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    borderTop: 'none',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0 32px',
    zIndex: 1000
  },
  toolButton: {
    width: '44px',
    height: '44px',
    background: 'transparent',
    border: 'none',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'opacity 0.2s',
    color: '#fff',
    WebkitTapHighlightColor: 'transparent'
  },
  cameraButton: {
    width: '48px',
    height: '48px',
    background: 'rgba(0, 0, 0, 0.4)',
    color: '#fff',
    border: 'none',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s',
    position: 'relative',
    WebkitTapHighlightColor: 'transparent',
    boxShadow: 'none'
  },
  uploadingDot: {
    position: 'absolute',
    top: '6px',
    right: '6px',
    width: '10px',
    height: '10px',
    background: '#00ff00',
    borderRadius: '50%',
    animation: 'pulse 1s infinite'
  },
  toolHint: {
    position: 'fixed',
    bottom: '66px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(0, 0, 0, 0.75)',
    color: '#fff',
    padding: '6px 12px',
    borderRadius: '16px',
    fontSize: '7pt',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    zIndex: 999,
    maxWidth: '85%',
    textAlign: 'center',
    pointerEvents: 'none'
  }
};

export default MobileBottomToolbar;

