/**
 * Mobile Bottom Toolbar
 * Instagram/Snapchat-style bottom toolbar with camera, comment, and tag tools
 */

import React, { useState, useRef } from 'react';
import { useImageUpload } from '../../hooks/useImageUpload';
import CursorButton from '../CursorButton';
// import { MobilePhotoDump } from './MobilePhotoDump'; // Component not yet implemented

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
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.8)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <div style={{ 
            background: 'var(--surface)', 
            padding: 'var(--space-5)', 
            borderRadius: 'var(--radius)',
            border: '2px solid var(--border)',
            maxWidth: '90%'
          }}>
            <p style={{ fontSize: '10px', color: 'var(--text)', marginBottom: 'var(--space-3)' }}>
              Photo Dump feature coming soon
            </p>
            <CursorButton onClick={() => setShowPhotoDump(false)} variant="secondary" size="sm">
              Close
            </CursorButton>
          </div>
        </div>
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

      {/* Bottom Toolbar - Design System Style */}
      <div style={styles.toolbar}>
        {/* Comment Tool - Left */}
        <CursorButton
          onClick={() => handleToolClick('comment')}
          variant={activeTool === 'comment' ? 'primary' : 'secondary'}
          size="md"
          title="Comment"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </CursorButton>

        {/* Photo Dump Tool - Upload Multiple Photos */}
        {canUpload && (
          <CursorButton
            onClick={() => setShowPhotoDump(true)}
            variant="secondary"
            size="md"
            title="Photo Dump - Upload Multiple"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
          </CursorButton>
        )}

        {/* Camera Tool - Center (only for contributors) */}
        {canUpload && (
          <CursorButton
            onClick={() => handleToolClick('camera')}
            disabled={uploading}
            variant="primary"
            size="lg"
            title="Take Photo"
          >
            <span style={{ fontSize: '20px', lineHeight: 1 }}>+</span>
            {uploading && <div style={styles.uploadingDot} />}
          </CursorButton>
        )}

        {/* Tag/Question Tool - Right */}
        <CursorButton
          onClick={() => handleToolClick('tag')}
          variant={activeTool === 'tag' ? 'primary' : 'secondary'}
          size="md"
          title="Pin Question"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v6m0 6v10m10-10h-6m-6 0H0" />
          </svg>
        </CursorButton>
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
    height: '64px',
    background: 'var(--surface)',
    borderTop: '2px solid var(--border)',
    display: 'flex',
    justifyContent: 'space-around',
    alignItems: 'center',
    padding: 'var(--space-3)',
    zIndex: 1000,
    gap: 'var(--space-2)'
  },
  uploadingDot: {
    position: 'absolute',
    top: '4px',
    right: '4px',
    width: '8px',
    height: '8px',
    background: 'var(--success)',
    borderRadius: '50%',
    animation: 'pulse 1s infinite'
  },
  toolHint: {
    position: 'fixed',
    bottom: '76px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'var(--text)',
    color: 'var(--surface)',
    padding: 'var(--space-2) var(--space-3)',
    borderRadius: 'var(--radius)',
    fontSize: '8px',
    fontFamily: 'var(--font-family)',
    zIndex: 999,
    maxWidth: '85%',
    textAlign: 'center',
    pointerEvents: 'none',
    border: '2px solid var(--border)'
  }
};

export default MobileBottomToolbar;

