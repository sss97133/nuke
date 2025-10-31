import React, { useState } from 'react';
import { SmartInvoiceUploader } from '../SmartInvoiceUploader';

interface DocumentUploadButtonProps {
  vehicleId: string;
  onSuccess?: () => void;
  variant?: 'primary' | 'secondary' | 'inline';
  label?: string;
}

/**
 * Clean, simple document upload button
 * 
 * Uses SmartInvoiceUploader (working AI parser) under the hood
 * One button, clear purpose, no confusion
 */
export const DocumentUploadButton: React.FC<DocumentUploadButtonProps> = ({
  vehicleId,
  onSuccess,
  variant = 'primary',
  label = '🧾 Add Receipt'
}) => {
  const [showUploader, setShowUploader] = useState(false);

  const handleSuccess = () => {
    setShowUploader(false);
    onSuccess?.();
  };

  return (
    <>
      <button
        className={`button button-${variant}`}
        onClick={() => setShowUploader(true)}
        style={{
          fontSize: '8pt',
          padding: variant === 'inline' ? '4px 8px' : '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}
      >
        {label}
      </button>

      {showUploader && (
        <SmartInvoiceUploader
          vehicleId={vehicleId}
          onClose={() => setShowUploader(false)}
          onSaved={handleSuccess}
        />
      )}
    </>
  );
};

