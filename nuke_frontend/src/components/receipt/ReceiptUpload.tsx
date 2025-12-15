import { useState, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import '../../design-system.css';

interface ReceiptUploadProps {
  onUploadComplete?: (receiptId: string) => void;
}

const ReceiptUpload = ({ onUploadComplete }: ReceiptUploadProps) => {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');

  const handleFileSelect = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    uploadReceipt(files[0]);
  };

  const uploadReceipt = async (file: File) => {
    if (!user) return;

    setUploading(true);
    setUploadProgress('Uploading receipt...');

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `receipt_${Date.now()}.${fileExt}`;
      const filePath = `receipts/${user.id}/${fileName}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, file);

      if (uploadError) {
        console.error('Upload error:', uploadError);
        return;
      }

      const { data: urlData } = supabase.storage
        .from('documents')
        .getPublicUrl(filePath);

      setUploadProgress('Processing receipt...');
      setProcessing(true);

      const { data: receiptData, error: receiptError } = await supabase
        .from('receipts')
        .insert({
          user_id: user.id,
          file_url: urlData.publicUrl,
          file_name: file.name,
          file_type: file.type,
          processing_status: 'pending'
        })
        .select()
        .single();

      if (receiptError) {
        console.error('Receipt creation error:', receiptError);
        return;
      }

      const { error: functionError } = await supabase.functions.invoke('process-receipt', {
        body: {
          receipt_id: receiptData.id,
          file_url: urlData.publicUrl
        }
      });

      if (functionError) {
        console.error('Processing error:', functionError);
      }

      if (onUploadComplete) {
        onUploadComplete(receiptData.id);
      }

      setUploadProgress('Receipt uploaded successfully!');
      setTimeout(() => setUploadProgress(''), 3000);

    } catch (error) {
      console.error('Upload failed:', error);
      setUploadProgress('Upload failed');
      setTimeout(() => setUploadProgress(''), 3000);
    } finally {
      setUploading(false);
      setProcessing(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    handleFileSelect(e.dataTransfer.files);
  };

  return (
    <div style={{
      background: 'var(--bg)',
      border: '1px solid #bdbdbd',
      padding: '16px',
      margin: '16px',
      fontFamily: 'Arial, sans-serif'
    }}>
      <h3 style={{ fontSize: '8pt', fontWeight: 'bold', margin: '0 0 8px 0' }}>
        📋 Upload Receipt
      </h3>

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: dragActive ? '2px solid #424242' : '1px solid #bdbdbd',
          background: dragActive ? '#e0e0e0' : 'white',
          padding: '24px',
          textAlign: 'center',
          cursor: uploading ? 'not-allowed' : 'pointer',
          marginBottom: '12px'
        }}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={(e) => handleFileSelect(e.target.files)}
          accept="image/*,.pdf"
          style={{ display: 'none' }}
          disabled={uploading}
        />

        {uploading ? (
          <div>
            <div style={{ fontSize: '10pt', marginBottom: '8px', fontWeight: 700 }}>Processing</div>
            <div style={{ fontSize: '8pt' }}>Uploading...</div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: '16pt', marginBottom: '8px' }}>📄</div>
            <div style={{ fontSize: '8pt', marginBottom: '4px' }}>
              Drop receipt image here or click to browse
            </div>
            <div style={{ fontSize: '7pt', color: '#757575' }}>
              Supports JPG, PNG, PDF files
            </div>
          </div>
        )}
      </div>

      {uploadProgress && (
        <div style={{
          background: processing ? '#e7f3ff' : '#e8f5e8',
          border: processing ? '1px solid #b8daff' : '1px solid #c8e6c8',
          padding: '8px',
          fontSize: '8pt',
          marginBottom: '8px'
        }}>
          {uploadProgress}
        </div>
      )}

      <div style={{ fontSize: '8pt', color: '#757575' }}>
        <div style={{ marginBottom: '4px' }}>Tips for better OCR results:</div>
        <div>• Take photos in good lighting</div>
        <div>• Keep receipt flat and straight</div>
        <div>• Include entire receipt in frame</div>
        <div>• Avoid shadows and glare</div>
      </div>
    </div>
  );
};

export default ReceiptUpload;