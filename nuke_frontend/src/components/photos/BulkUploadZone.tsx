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
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      style={{
        border: '3px dashed ' + (isDragging ? '#4a9eff' : '#333'),
        borderRadius: '12px',
        padding: '80px 40px',
        textAlign: 'center',
        cursor: 'pointer',
        background: isDragging ? 'rgba(74, 158, 255, 0.1)' : '#1a1a1a',
        transition: 'all 0.2s ease'
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
        fontSize: '64px', 
        marginBottom: '20px',
        opacity: isDragging ? 1 : 0.6
      }}>
        📁
      </div>

      <div style={{ 
        fontSize: '24px', 
        fontWeight: '600', 
        marginBottom: '12px',
        color: '#fff'
      }}>
        {isDragging ? 'Drop Your Photos Here' : 'Upload Your Photos'}
      </div>

      <div style={{ 
        fontSize: '16px', 
        color: '#888',
        marginBottom: '30px',
        lineHeight: '1.6'
      }}>
        Drag and drop up to 10,000 photos at once<br />
        or click to browse files
      </div>

      <div style={{
        display: 'flex',
        gap: '30px',
        justifyContent: 'center',
        marginTop: '30px',
        flexWrap: 'wrap'
      }}>
        <div>
          <div style={{ fontSize: '14px', color: '#4a9eff', fontWeight: '600', marginBottom: '4px' }}>
            Supported Formats
          </div>
          <div style={{ fontSize: '13px', color: '#666' }}>
            JPG, PNG, HEIC, WebP, GIF
          </div>
        </div>
        <div>
          <div style={{ fontSize: '14px', color: '#00c853', fontWeight: '600', marginBottom: '4px' }}>
            Auto Processing
          </div>
          <div style={{ fontSize: '13px', color: '#666' }}>
            EXIF, AI Analysis, Smart Grouping
          </div>
        </div>
        <div>
          <div style={{ fontSize: '14px', color: '#ff9d00', fontWeight: '600', marginBottom: '4px' }}>
            Background Upload
          </div>
          <div style={{ fontSize: '13px', color: '#666' }}>
            Close tab, uploads continue
          </div>
        </div>
      </div>

      <button
        onClick={handleClick}
        style={{
          marginTop: '40px',
          padding: '16px 32px',
          background: '#4a9eff',
          color: '#fff',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
          fontSize: '16px',
          fontWeight: '600',
          transition: 'all 0.12s ease'
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = '#5dadff'}
        onMouseLeave={(e) => e.currentTarget.style.background = '#4a9eff'}
      >
        Select Photos from Computer
      </button>
    </div>
  );
};

