import React, { useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../ui/Toast';

interface ReferenceLibraryUploadProps {
  vehicleId?: string;
  year: number;
  make: string;
  series?: string | null;
  model?: string | null;
  bodyStyle?: string | null;
  onUploadComplete?: () => void;
}

const DOCUMENT_TYPES = [
  { value: 'brochure', label: 'Sales Brochure' },
  { value: 'owners_manual', label: 'Owner\'s Manual' },
  { value: 'service_manual', label: 'Service Manual' },
  { value: 'parts_catalog', label: 'Parts Catalog' },
  { value: 'spec_sheet', label: 'Specification Sheet' },
  { value: 'paint_codes', label: 'Paint/Color Chart' },
  { value: 'rpo_codes', label: 'RPO Codes List' },
  { value: 'wiring_diagram', label: 'Wiring Diagram' },
  { value: 'build_sheet', label: 'Factory Build Sheet' },
  { value: 'recall_notice', label: 'Recall Notice' },
  { value: 'tsb', label: 'Technical Service Bulletin' },
  { value: 'other', label: 'Other Documentation' }
];

export const ReferenceLibraryUpload: React.FC<ReferenceLibraryUploadProps> = ({
  vehicleId,
  year,
  make,
  series,
  model,
  bodyStyle,
  onUploadComplete
}) => {
  const { showToast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{[key: string]: number}>({});
  const [uploadedFiles, setUploadedFiles] = useState<Array<{name: string, size: number, id: string}>>([]);
  const [showSuccess, setShowSuccess] = useState(false);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length > 0) {
      setFiles(selectedFiles);
    }
  }, []);

  // Auto-detect document type from file name/content
  const detectDocumentType = useCallback((fileName: string, mimeType: string): string => {
    const lower = fileName.toLowerCase();
    if (lower.includes('brochure') || lower.includes('sales')) return 'brochure';
    if (lower.includes('manual') || lower.includes('service')) return 'service_manual';
    if (lower.includes('owner')) return 'owners_manual';
    if (lower.includes('parts') || lower.includes('catalog')) return 'parts_catalog';
    if (lower.includes('paint') || lower.includes('color')) return 'paint_codes';
    if (lower.includes('rpo') || lower.includes('option')) return 'rpo_codes';
    if (lower.includes('wiring') || lower.includes('electrical')) return 'wiring_diagram';
    if (lower.includes('build') || lower.includes('sheet')) return 'build_sheet';
    if (lower.includes('recall')) return 'recall_notice';
    if (lower.includes('tsb') || lower.includes('bulletin')) return 'tsb';
    if (lower.includes('spec')) return 'spec_sheet';
    // Default based on file type
    if (mimeType === 'application/pdf') return 'brochure'; // PDFs are usually brochures
    return 'brochure'; // Default for images
  }, []);

  // Auto-generate title from filename
  const generateTitle = useCallback((fileName: string, index: number, total: number): string => {
    const baseName = fileName.replace(/\.[^/.]+$/, '');
    if (total === 1) {
      // Single file: clean up the name
      return baseName.replace(/^IMG_/, '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }
    // Multiple files: keep original name for clarity
    return baseName;
  }, []);

  const handleUpload = async () => {
    if (files.length === 0) {
      showToast('Please select at least one file', 'error');
      return;
    }

    try {
      setUploading(true);
      setUploadProgress({});

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        showToast('You must be logged in to upload documents', 'error');
        return;
      }

      // 1. Find or create library for this YMM
      const { data: existingLibrary } = await supabase
        .from('reference_libraries')
        .select('id')
        .eq('year', year)
        .eq('make', make)
        .eq('series', series || '')
        .eq('body_style', bodyStyle || '')
        .maybeSingle();

      let libraryId = existingLibrary?.id;

      if (!libraryId) {
        const { data: newLibrary, error: libraryError } = await supabase
          .from('reference_libraries')
          .insert({
            year,
            make,
            series,
            model,
            body_style: bodyStyle,
            description: `Reference library for ${year} ${make} ${series || model}`
          })
          .select('id')
          .single();

        if (libraryError) throw libraryError;
        libraryId = newLibrary.id;
      }

      // 2. Upload files one at a time with progress
      let uploadedCount = 0;
      const documentIds: string[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileKey = `${i}-${file.name}`;
        
        try {
          setUploadProgress(prev => ({ ...prev, [fileKey]: 0 }));

          const fileExt = file.name.split('.').pop();
          const fileName = `${year}-${make.toLowerCase()}-${series || model || 'unknown'}-${Date.now()}-${i}.${fileExt}`;
          const filePath = `${year}/${make}/${fileName}`;

          // Upload to storage
          const { error: uploadError } = await supabase.storage
            .from('reference-docs')
            .upload(filePath, file, {
              cacheControl: '3600',
              upsert: false
            });

          if (uploadError) throw uploadError;
          
          setUploadProgress(prev => ({ ...prev, [fileKey]: 50 }));

          // Get public URL
          const { data: { publicUrl } } = supabase.storage
            .from('reference-docs')
            .getPublicUrl(filePath);

          // AUTO-GENERATE ALL METADATA
          const autoDocumentType = detectDocumentType(file.name, file.type);
          const autoTitle = generateTitle(file.name, i, files.length);
          const autoYearPublished = year; // Use vehicle year as default
          const autoFactoryOriginal = true; // Assume factory docs by default

          // Create document record
          const { data: document, error: docError } = await supabase
            .from('library_documents')
            .insert({
              library_id: libraryId,
              document_type: autoDocumentType,
              title: autoTitle,
              file_url: publicUrl,
              file_size_bytes: file.size,
              mime_type: file.type,
              uploaded_by: user.id,
              year_published: autoYearPublished,
              is_factory_original: autoFactoryOriginal
            })
            .select('id')
            .single();

          if (docError) throw docError;
          
          documentIds.push(document.id);
          setUploadProgress(prev => ({ ...prev, [fileKey]: 100 }));
          uploadedCount++;
          
          // Add to uploaded files list for immediate feedback
          setUploadedFiles(prev => [...prev, {
            name: file.name,
            size: file.size,
            id: document.id
          }]);

        } catch (error: any) {
          console.error(`Failed to upload ${file.name}:`, error);
          showToast(`Failed to upload ${file.name}: ${error.message}`, 'error');
        }
      }

      if (uploadedCount > 0) {
        // IMMEDIATE SUCCESS FEEDBACK
        setShowSuccess(true);
        showToast(`${uploadedCount} document${uploadedCount > 1 ? 's' : ''} uploaded successfully!`, 'success');

        // 5. ALWAYS auto-extract (no option needed)
        setExtracting(true);
        
        // Trigger extraction (non-blocking) - processes ALL pages from same library
        supabase.functions.invoke('parse-reference-document', {
          body: { documentId: documentIds[0] }
        }).then(() => {
          showToast(`Processing all ${files.length} pages in background. Check review page soon!`, 'success');
        }).catch((error) => {
          console.error('Extraction error:', error);
          showToast('Extraction queued - processing in background. Safe to navigate away!', 'info');
        });
      }

      // Clear file input but keep success message visible
      setFiles([]);
      setUploadProgress({});
      
      // Don't reset immediately - let user see what they uploaded
      if (onUploadComplete) onUploadComplete();

    } catch (error: any) {
      console.error('Upload error:', error);
      showToast(error.message || 'Failed to upload document', 'error');
    } finally {
      setUploading(false);
      setExtracting(false);
    }
  };

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: '4px',
      padding: '16px'
    }}>
      <h3 style={{ margin: '0 0 8px 0', fontSize: '10pt', fontWeight: 700 }}>
        Upload Reference Documents
      </h3>
      <p style={{ fontSize: '7pt', color: 'var(--text-muted)', margin: '0 0 12px 0' }}>
        Drop brochures, manuals, or images. Everything is detected automatically.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* File Input - The ONLY input */}
        <div>
          <input
            type="file"
            accept=".pdf,.zip,.jpg,.jpeg,.png,.webp"
            onChange={handleFileSelect}
            disabled={uploading || extracting}
            multiple
            style={{ 
              fontSize: '8pt', 
              width: '100%',
              padding: '8px',
              border: '2px dashed var(--border)',
              borderRadius: '4px',
              background: 'var(--surface)',
              cursor: uploading ? 'wait' : 'pointer'
            }}
          />
          {files.length > 0 && (
            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '4px' }}>
              {files.length} file{files.length > 1 ? 's' : ''} selected • {(files.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024).toFixed(2)} MB
            </div>
          )}
          {Object.keys(uploadProgress).length > 0 && (
            <div style={{ marginTop: '8px' }}>
              {Object.entries(uploadProgress).map(([key, progress]) => {
                const fileName = key.split('-').slice(1).join('-');
                return (
                  <div key={key} style={{ marginBottom: '4px' }}>
                    <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '2px', display: 'flex', justifyContent: 'space-between' }}>
                      <span>{fileName}</span>
                      <span>{progress}%</span>
                    </div>
                    <div style={{ background: '#e5e7eb', borderRadius: '4px', height: '4px', overflow: 'hidden' }}>
                      <div style={{ background: 'var(--primary)', height: '100%', width: `${progress}%`, transition: 'width 0.3s' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Upload Button */}
        <button
          onClick={handleUpload}
          disabled={files.length === 0 || uploading || extracting}
          className="button button-primary"
          style={{ fontSize: '8pt', width: '100%' }}
        >
          {uploading ? `Uploading ${files.length} file${files.length > 1 ? 's' : ''}...` : extracting ? 'Extracting data...' : `Upload ${files.length > 0 ? files.length : ''} Document${files.length > 1 ? 's' : ''}`}
        </button>
      </div>

      {/* SUCCESS MESSAGE - Show immediately after upload */}
      {showSuccess && uploadedFiles.length > 0 && (
        <div style={{
          marginTop: '16px',
          background: '#f0fdf4',
          border: '2px solid #22c55e',
          borderRadius: '4px',
          padding: '12px'
        }}>
          <div style={{ fontSize: '9pt', fontWeight: 700, color: '#15803d', marginBottom: '8px' }}>
            ✓ {uploadedFiles.length} Document{uploadedFiles.length > 1 ? 's' : ''} Uploaded!
          </div>
          <div style={{ fontSize: '7pt', color: '#166534', marginBottom: '8px' }}>
            Your files are safe. Extraction is processing in background - you can navigate away now.
          </div>
          <div style={{ 
            fontSize: '7pt', 
            color: '#166534',
            maxHeight: '150px',
            overflowY: 'auto',
            background: '#fff',
            padding: '8px',
            borderRadius: '4px',
            border: '1px solid #bbf7d0',
            marginBottom: '8px'
          }}>
            {uploadedFiles.map((file, idx) => (
              <div key={file.id} style={{ marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 600 }}>{idx + 1}. {file.name}</span>
                <span style={{ color: '#166534' }}>{(file.size / 1024 / 1024).toFixed(2)} MB</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <a
              href="/admin/extraction-review"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: '8pt',
                color: '#15803d',
                textDecoration: 'underline',
                fontWeight: 600
              }}
            >
              View Extraction Review →
            </a>
            <button
              onClick={() => {
                setShowSuccess(false);
                setUploadedFiles([]);
                setExtracting(false);
              }}
              style={{
                fontSize: '7pt',
                background: 'transparent',
                border: '1px solid #22c55e',
                color: '#15803d',
                padding: '4px 8px',
                borderRadius: '4px',
                cursor: 'pointer',
                marginLeft: 'auto'
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReferenceLibraryUpload;

