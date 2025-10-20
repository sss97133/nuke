import React from 'react';
import styles from './ImagePreview.module.css';

interface UploadedImage {
  id: string;
  file: File;
  preview: string;
  progress: number;
  status: 'uploading' | 'success' | 'error';
  context?: string;
}

interface ImagePreviewProps {
  images: UploadedImage[];
  onDelete: (imageId: string) => void;
  onAddContext: (imageId: string) => void;
}

export const ImagePreview: React.FC<ImagePreviewProps> = ({
  images,
  onDelete,
  onAddContext
}) => {
  return (
    <div className={styles.previewContainer}>
      <h3>{images.length} images selected</h3>
      <div className={styles.grid}>
        {images.map(image => (
          <div key={image.id} className={styles.imageCard}>
            <div className={styles.imageWrapper}>
              <img src={image.preview} alt={image.file.name} />
              
              {image.status === 'uploading' && (
                <div className={styles.progressOverlay}>
                  <div className={styles.progressBar}>
                    <div 
                      className={styles.progressFill}
                      style={{ width: `${image.progress}%` }}
                    />
                  </div>
                  <span className={styles.progressText}>{image.progress}%</span>
                </div>
              )}

              {image.status === 'success' && (
                <div className={styles.successBadge}>✓</div>
              )}

              {image.status === 'error' && (
                <div className={styles.errorBadge}>!</div>
              )}

              <button
                className={styles.deleteButton}
                onClick={() => onDelete(image.id)}
                title="Delete image"
              >
                ✕
              </button>
            </div>

            <div className={styles.actions}>
              <button
                className={styles.contextButton}
                onClick={() => onAddContext(image.id)}
                title="Add context or notes to this image"
              >
                📝 Add context
              </button>
              {image.context && (
                <div className={styles.contextIndicator}>
                  Has note: {image.context.substring(0, 20)}...
                </div>
              )}
            </div>

            <div className={styles.fileName}>{image.file.name}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
