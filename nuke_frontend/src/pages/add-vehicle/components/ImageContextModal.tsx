import React, { useState, useEffect } from 'react';
import styles from './ImageContextModal.module.css';

interface ImageContextModalProps {
  isOpen: boolean;
  imageFileName: string;
  imagePreview: string;
  existingContext?: string;
  onSave: (context: string) => void;
  onClose: () => void;
}

export const ImageContextModal: React.FC<ImageContextModalProps> = ({
  isOpen,
  imageFileName,
  imagePreview,
  existingContext = '',
  onSave,
  onClose
}) => {
  const [context, setContext] = useState(existingContext);

  useEffect(() => {
    setContext(existingContext);
  }, [existingContext, isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave(context);
    onClose();
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Add Context to Image</h2>
          <button className={styles.closeButton} onClick={onClose}>✕</button>
        </div>

        <div className={styles.content}>
          <div className={styles.imagePreview}>
            <img src={imagePreview} alt={imageFileName} />
          </div>

          <div className={styles.formSection}>
            <label>File: <span className={styles.fileName}>{imageFileName}</span></label>
            
            <label htmlFor="context">Add notes or context:</label>
            <textarea
              id="context"
              className={styles.textarea}
              placeholder="e.g., 'Front view showing chrome trim damage', 'Engine bay with all original parts', 'Interior showing factory leather seats'"
              value={context}
              onChange={e => setContext(e.target.value)}
              rows={4}
            />

            <div className={styles.hints}>
              <p>💡 Tips for good context:</p>
              <ul>
                <li>Describe what's visible in the image</li>
                <li>Note any damage, modifications, or unique features</li>
                <li>Mention the condition of parts shown</li>
                <li>Reference any documentation or receipts in photos</li>
              </ul>
            </div>
          </div>

          <div className={styles.footer}>
            <button className={styles.cancelButton} onClick={onClose}>
              Cancel
            </button>
            <button 
              className={styles.saveButton}
              onClick={handleSave}
              disabled={context.length === 0}
            >
              Save Context
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
