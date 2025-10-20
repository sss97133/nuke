import React, { useCallback, useRef, useState } from 'react';
import styles from './ImageUploadZone.module.css';

interface ImageUploadZoneProps {
  onFilesSelected: (files: File[]) => void;
  isUploading?: boolean;
  uploadedCount?: number;
  maxFiles?: number;
}

export const ImageUploadZone: React.FC<ImageUploadZoneProps> = ({
  onFilesSelected,
  isUploading = false,
  uploadedCount = 0,
  maxFiles = 50
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files).filter(file =>
      file.type.startsWith('image/')
    );

    if (files.length > 0) {
      onFilesSelected(files);
    }
  }, [onFilesSelected]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      onFilesSelected(files);
    }
  }, [onFilesSelected]);

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div
      className={`${styles.uploadZone} ${isDragging ? styles.dragging : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
      />

      <div className={styles.content}>
        <div className={styles.icon}>📸</div>
        <h3>Drop images here or click to select</h3>
        <p>Upload photos of your vehicle, interior, exterior, or documentation</p>
        {uploadedCount > 0 && (
          <div className={styles.uploadStatus}>
            ✓ {uploadedCount} image{uploadedCount !== 1 ? 's' : ''} uploaded
          </div>
        )}
        {isUploading && (
          <div className={styles.uploadingIndicator}>
            ⏳ Uploading in progress...
          </div>
        )}
      </div>
    </div>
  );
};
