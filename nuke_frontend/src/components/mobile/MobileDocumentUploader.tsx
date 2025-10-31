/**
 * Mobile Document Uploader
 * Camera-first document scanner with OCR and auto-categorization
 */

import React, { useState, useRef } from 'react';
import ReactDOM from 'react-dom';
import { supabase } from '../../lib/supabase';

interface MobileDocumentUploaderProps {
  vehicleId: string;
  session: any;
  onClose: () => void;
  onSuccess?: () => void;
}

export const MobileDocumentUploader: React.FC<MobileDocumentUploaderProps> = ({
  vehicleId,
  session,
  onClose,
  onSuccess
}) => {
  const [step, setStep] = useState<'category' | 'capture' | 'processing' | 'details'>('category');
  const [category, setCategory] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [extractedData, setExtractedData] = useState<any>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const categories = [
    { id: 'receipt', label: '🧾 Receipt', desc: 'Service receipt or invoice' },
    { id: 'title', label: '📜 Title', desc: 'Vehicle title document' },
    { id: 'registration', label: '🪪 Registration', desc: 'Current registration' },
    { id: 'insurance', label: '🛡️ Insurance', desc: 'Insurance card/policy' },
    { id: 'service_record', label: '🔧 Service Record', desc: 'Maintenance log' },
    { id: 'other', label: '📄 Other', desc: 'Other document' }
  ];

  const handleCategorySelect = (catId: string) => {
    setCategory(catId);
    setStep('capture');
    // Auto-trigger camera
    setTimeout(() => fileInputRef.current?.click(), 100);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setPreview(URL.createObjectURL(file));
    setStep('processing');

    // Auto-process for receipts
    if (category === 'receipt' || category === 'service_record') {
      await processReceipt(file);
    } else {
      setStep('details');
    }
  };

  const processReceipt = async (file: File) => {
    try {
      // Upload to storage first
      const fileName = `doc_${Date.now()}.${file.name.split('.').pop()}`;
      const filePath = `vehicles/${vehicleId}/documents/${fileName}`;
      
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('vehicle-data')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('vehicle-data')
        .getPublicUrl(filePath);

      // Try to parse with AI (best effort)
      try {
        const { data: functionData, error: functionError } = await supabase.functions.invoke('extract-receipt-data', {
          body: {
            imageUrl: urlData.publicUrl,
            mimeType: file.type
          }
        });

        if (!functionError && functionData) {
          setExtractedData(functionData);
          setTitle(functionData.vendor_name || 'Service Receipt');
        }
      } catch (err) {
        console.log('OCR not available, skipping');
      }

      setStep('details');
    } catch (error) {
      console.error('Processing error:', error);
      setStep('details');
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);

    try {
      // Upload file
      const fileName = `doc_${Date.now()}.${selectedFile.name.split('.').pop()}`;
      const filePath = `vehicles/${vehicleId}/documents/${fileName}`;
      
      const { error: uploadError } = await supabase.storage
        .from('vehicle-data')
        .upload(filePath, selectedFile);

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('vehicle-data')
        .getPublicUrl(filePath);

      // Save document record
      const { error: docError } = await supabase
        .from('vehicle_documents')
        .insert({
          vehicle_id: vehicleId,
          document_type: category,
          title: title || categories.find(c => c.id === category)?.label || 'Document',
          description: notes || null,
          document_date: extractedData?.date || null,
          file_url: urlData.publicUrl,
          file_name: selectedFile.name,
          file_type: selectedFile.type,
          file_size: selectedFile.size,
          privacy_level: 'owner_only',
          contains_pii: category === 'title' || category === 'registration',
          vendor_name: extractedData?.vendor_name || null,
          amount: extractedData?.total || null,
          currency: 'USD',
          uploaded_by: session.user.id
        });

      if (docError) throw docError;

      // Create timeline event for receipts using DOCUMENT DATE, not upload date
      if ((category === 'receipt' || category === 'service_record') && extractedData) {
        // CRITICAL: Use receipt_date from the document, NOT today's date
        const documentDate = extractedData.receipt_date || extractedData.date || new Date().toISOString().split('T')[0];
        
        await supabase.from('vehicle_timeline_events').insert({
          vehicle_id: vehicleId,
          user_id: session.user.id,
          event_type: 'service',
          source: 'mobile_document_upload',
          title: extractedData.vendor_name || 'Service',
          description: notes || 'Service documented from receipt',
          event_date: documentDate, // Use parsed date from receipt
          cost_amount: extractedData.total || null,
          duration_hours: extractedData.estimated_hours || null,
          service_provider_name: extractedData.vendor_name || null,
          metadata: { 
            extracted_data: extractedData,
            document_date: documentDate,
            upload_date: new Date().toISOString()
          }
        });
      }

      // Trigger refresh
      window.dispatchEvent(new Event('vehicle_documents_updated'));
      
      onSuccess?.();
      onClose();
    } catch (error) {
      console.error('Upload error:', error);
      alert('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  return ReactDOM.createPortal(
    <div style={styles.overlay}>
      <div style={styles.modal}>
        {/* Header */}
        <div style={styles.header}>
          <h2 style={styles.title}>
            {step === 'category' && '📁 Upload Document'}
            {step === 'capture' && '📸 Take Photo'}
            {step === 'processing' && '⚙️ Processing...'}
            {step === 'details' && '✏️ Document Details'}
          </h2>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        {/* Category Selection */}
        {step === 'category' && (
          <div style={styles.categoryGrid}>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => handleCategorySelect(cat.id)}
                style={styles.categoryCard}
              >
                <div style={styles.categoryIcon}>{cat.label.split(' ')[0]}</div>
                <div style={styles.categoryName}>{cat.label.split(' ').slice(1).join(' ')}</div>
                <div style={styles.categoryDesc}>{cat.desc}</div>
              </button>
            ))}
          </div>
        )}

        {/* File Input (Hidden) */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />

        {/* Processing Indicator */}
        {step === 'processing' && (
          <div style={styles.processing}>
            <div style={styles.spinner}>⏳</div>
            <p>Scanning document...</p>
            <p style={styles.processingSubtext}>Extracting data with AI</p>
          </div>
        )}

        {/* Details Form */}
        {step === 'details' && (
          <div style={styles.detailsForm}>
            {/* Preview */}
            {preview && (
              <div style={styles.previewContainer}>
                <img src={preview} alt="Document preview" style={styles.previewImage} />
              </div>
            )}

            {/* Extracted Data (if available) */}
            {extractedData && (
              <div style={styles.extractedDataCard}>
                <div style={styles.extractedTitle}>📊 Extracted Data</div>
                {extractedData.vendor_name && (
                  <div style={styles.extractedRow}>
                    <span>Vendor:</span>
                    <strong>{extractedData.vendor_name}</strong>
                  </div>
                )}
                {extractedData.total && (
                  <div style={styles.extractedRow}>
                    <span>Total:</span>
                    <strong>${extractedData.total.toFixed(2)}</strong>
                  </div>
                )}
                {extractedData.date && (
                  <div style={styles.extractedRow}>
                    <span>Date:</span>
                    <strong>{new Date(extractedData.date).toLocaleDateString()}</strong>
                  </div>
                )}
                {extractedData.estimated_hours && (
                  <div style={styles.extractedRow}>
                    <span>Est. Hours:</span>
                    <strong>{extractedData.estimated_hours}h</strong>
                  </div>
                )}
              </div>
            )}

            {/* Manual Fields */}
            <div style={styles.field}>
              <label style={styles.label}>Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Oil Change Receipt"
                style={styles.input}
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional details..."
                rows={3}
                style={styles.textarea}
              />
            </div>

            {/* Actions */}
            <div style={styles.actions}>
              <button
                onClick={() => setStep('category')}
                style={styles.backBtn}
                disabled={uploading}
              >
                ← Back
              </button>
              <button
                onClick={handleUpload}
                style={styles.uploadBtn}
                disabled={uploading}
              >
                {uploading ? 'Uploading...' : '✓ Save Document'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

const styles = {
  overlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.85)',
    zIndex: 999999,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'auto'
  },
  modal: {
    background: '#ffffff',
    width: '100%',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column' as const
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px',
    borderBottom: '2px solid #000080',
    background: '#f0f0f0'
  },
  title: {
    margin: 0,
    fontSize: '10px',
    fontFamily: '"MS Sans Serif", sans-serif',
    fontWeight: 'bold'
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: '10px',
    cursor: 'pointer',
    padding: '0',
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  categoryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '12px',
    padding: '16px'
  },
  categoryCard: {
    background: '#ffffff',
    border: '2px solid #c0c0c0',
    padding: '20px 12px',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '8px',
    minHeight: '120px',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  categoryIcon: {
    fontSize: '36px'
  },
  categoryName: {
    fontSize: '10px',
    fontWeight: 'bold',
    textAlign: 'center' as const
  },
  categoryDesc: {
    fontSize: '10px',
    color: '#666',
    textAlign: 'center' as const
  },
  processing: {
    padding: '60px 16px',
    textAlign: 'center' as const
  },
  spinner: {
    fontSize: '10px',
    animation: 'spin 2s linear infinite'
  },
  processingSubtext: {
    fontSize: '10px',
    color: '#666',
    marginTop: '8px'
  },
  detailsForm: {
    padding: '16px',
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px'
  },
  previewContainer: {
    width: '100%',
    borderRadius: '8px',
    overflow: 'hidden',
    border: '2px solid #c0c0c0',
    maxHeight: '200px'
  },
  previewImage: {
    width: '100%',
    height: 'auto',
    display: 'block'
  },
  extractedDataCard: {
    background: '#f0f8ff',
    border: '2px solid #000080',
    borderRadius: '8px',
    padding: '12px'
  },
  extractedTitle: {
    fontWeight: 'bold',
    marginBottom: '8px',
    fontSize: '13px'
  },
  extractedRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '4px 0',
    fontSize: '10px',
    borderBottom: '1px solid rgba(0,0,128,0.1)'
  },
  field: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px'
  },
  label: {
    fontSize: '10px',
    fontWeight: 'bold',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  input: {
    padding: '12px',
    border: '2px inset #c0c0c0',
    borderRadius: '4px',
    fontSize: '10px',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  textarea: {
    padding: '12px',
    border: '2px inset #c0c0c0',
    borderRadius: '4px',
    fontSize: '10px',
    fontFamily: '"MS Sans Serif", sans-serif',
    resize: 'vertical' as const
  },
  actions: {
    display: 'flex',
    gap: '12px',
    marginTop: 'auto',
    paddingTop: '16px'
  },
  backBtn: {
    flex: 1,
    padding: '14px',
    background: '#c0c0c0',
    border: '2px outset #ffffff',
    borderRadius: '4px',
    fontSize: '10px',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  uploadBtn: {
    flex: 2,
    padding: '14px',
    background: '#000080',
    color: '#ffffff',
    border: '2px outset #ffffff',
    borderRadius: '4px',
    fontSize: '10px',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: '"MS Sans Serif", sans-serif'
  }
};

