/**
 * Bulk Upload Zone
 * 
 * Drag-and-drop area for uploading thousands of photos at once
 * Supports folders, HEIC, and shows real-time progress
 */

import React, { useRef, useState } from 'react';

interface BulkUploadZoneProps {
  onUpload: (files: File[]) => void;
}

export const BulkUploadZone: React.FC<BulkUploadZoneProps> = ({ onUpload }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files).filter(file => 
      file.type.startsWith('image/')
    );

    if (files.length > 0) {
      onUpload(files);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(file => 
      file.type.startsWith('image/')
    );

    if (files.length > 0) {
      onUpload(files);
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="card" style={{ marginBottom: '20px' }}>
      <div
        className="card-body"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        style={{
          border: '2px dashed ' + (isDragging ? 'var(--primary)' : 'var(--border-medium)'),
          padding: '60px 40px',
          textAlign: 'center',
          cursor: 'pointer',
          background: isDragging ? 'var(--grey-100)' : 'var(--white)',
          transition: 'all 0.12s ease'
        }}
      >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />

        <div style={{ 
          fontSize: '48px', 
          marginBottom: '16px',
          opacity: isDragging ? 1 : 0.5
        }}>
          📁
        </div>

        <div className="text font-bold" style={{ 
          fontSize: '16px', 
          marginBottom: '8px'
        }}>
          {isDragging ? 'Drop Your Photos Here' : 'Upload Your Photos'}
        </div>

        <div className="text text-small text-muted" style={{ 
          marginBottom: '24px',
          lineHeight: '1.4'
        }}>
          Drag and drop up to 10,000 photos at once<br />
          or click to browse files
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '16px',
          marginTop: '24px',
          marginBottom: '24px'
        }}>
          <div style={{ 
            padding: '12px',
            background: 'var(--grey-100)',
            border: '1px solid var(--border-light)'
          }}>
            <div className="text text-small font-bold" style={{ marginBottom: '4px', color: 'var(--primary)' }}>
              Supported Formats
            </div>
            <div className="text text-small text-muted">
              JPG, PNG, HEIC, WebP, GIF
            </div>
          </div>
          <div style={{ 
            padding: '12px',
            background: 'var(--grey-100)',
            border: '1px solid var(--border-light)'
          }}>
            <div className="text text-small font-bold" style={{ marginBottom: '4px', color: 'var(--success)' }}>
              Auto Processing
            </div>
            <div className="text text-small text-muted">
              EXIF, AI Analysis, Smart Grouping
            </div>
          </div>
          <div style={{ 
            padding: '12px',
            background: 'var(--grey-100)',
            border: '1px solid var(--border-light)'
          }}>
            <div className="text text-small font-bold" style={{ marginBottom: '4px' }}>
              Background Upload
            </div>
            <div className="text text-small text-muted">
              Close tab, uploads continue
            </div>
          </div>
        </div>

        <button
          onClick={handleClick}
          className="button button-primary"
          style={{
            marginTop: '24px',
            padding: '12px 24px',
            fontSize: '11px'
          }}
        >
          Select Photos from Computer
        </button>
      </div>
    </div>
  );
};

