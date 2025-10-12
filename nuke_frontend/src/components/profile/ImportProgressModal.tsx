import React from 'react';

interface ImportProgressModalProps {
  isOpen: boolean;
  status: {
    step: string;
    message: string;
    progress: number;
    details?: string;
    error?: string;
  };
  onClose: () => void;
  canClose: boolean;
}

const ImportProgressModal: React.FC<ImportProgressModalProps> = ({
  isOpen,
  status,
  onClose,
  canClose
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: '500px' }}>
        <div className="modal-header">
          <h3 className="modal-title">Processing Receipt</h3>
        </div>

        <div className="modal-body">
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <strong className="text">{status.step}</strong>
            <p className="text text-muted" style={{ margin: 'var(--space-2) 0 0 0' }}>
              {status.message}
            </p>
            {status.details && (
              <p className="text-small text-muted" style={{ margin: 'var(--space-1) 0 0 0' }}>
                {status.details}
              </p>
            )}
          </div>

          {/* Progress bar */}
          <div style={{
            height: '4px',
            background: 'var(--grey-300)',
            border: '1px inset var(--border-medium)',
            marginBottom: 'var(--space-4)'
          }}>
            <div style={{
              height: '100%',
              width: `${status.progress}%`,
              background: 'var(--grey-800)',
              transition: 'width 0.3s ease'
            }} />
          </div>

          {status.error && (
            <div>
              <div className="alert alert-error" style={{ marginBottom: 'var(--space-3)' }}>
                <strong>Error:</strong> {status.error}
              </div>
              
              {/* Helpful suggestions for common issues */}
              <div className="info-box" style={{ marginBottom: 'var(--space-4)' }}>
                <strong>Troubleshooting Tips:</strong>
                <ul style={{ margin: 'var(--space-2) 0 0 var(--space-4)', fontSize: 'var(--font-size-small)' }}>
                  <li>Make sure the receipt includes part numbers and prices</li>
                  <li>For PDFs: Try copying all text and pasting it instead</li>
                  <li>For images: Ensure the text is clear and readable</li>
                  <li>Check that it's a tool receipt (Snap-on, Mac Tools, Matco, etc.)</li>
                  <li>If the receipt is multi-page, paste all pages' text</li>
                </ul>
              </div>
            </div>
          )}

          {/* Steps */}
          <div className="text-small text-muted">
            <div>1. Upload Receipt {status.progress >= 10 && '✓'}</div>
            <div>2. Extract Text {status.progress >= 30 && '✓'}</div>
            <div>3. Parse Tools {status.progress >= 60 && '✓'}</div>
            <div>4. Save to Database {status.progress >= 90 && '✓'}</div>
            <div>5. Complete {status.progress === 100 && '✓'}</div>
          </div>
        </div>

        {(status.progress === 100 || status.error) && canClose && (
          <div className="modal-footer">
            <button className="button button-primary" onClick={onClose}>
              {status.error ? 'Close' : 'Done'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImportProgressModal;
