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
  const [documentType, setDocumentType] = useState('brochure');
  const [title, setTitle] = useState('');
  const [yearPublished, setYearPublished] = useState(year);
  const [isFactoryOriginal, setIsFactoryOriginal] = useState(true);
  const [autoExtract, setAutoExtract] = useState(true);
  const [uploadProgress, setUploadProgress] = useState<{[key: string]: number}>({});

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length > 0) {
      setFiles(selectedFiles);
      // Auto-populate title if empty and only one file
      if (!title && selectedFiles.length === 1) {
        const baseName = selectedFiles[0].name.replace(/\.[^/.]+$/, '');
        setTitle(baseName);
      }
    }
  }, [title]);

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

          // Create document record
          const docTitle = files.length === 1 && title 
            ? title 
            : title 
              ? `${title} (${i + 1}/${files.length})` 
              : file.name;

          const { data: document, error: docError } = await supabase
            .from('library_documents')
            .insert({
              library_id: libraryId,
              document_type: documentType,
              title: docTitle,
              file_url: publicUrl,
              file_size_bytes: file.size,
              mime_type: file.type,
              uploaded_by: user.id,
              year_published: yearPublished,
              is_factory_original: isFactoryOriginal
            })
            .select('id')
            .single();

          if (docError) throw docError;
          
          documentIds.push(document.id);
          setUploadProgress(prev => ({ ...prev, [fileKey]: 100 }));
          uploadedCount++;

        } catch (error: any) {
          console.error(`Failed to upload ${file.name}:`, error);
          showToast(`Failed to upload ${file.name}: ${error.message}`, 'error');
        }
      }

      if (uploadedCount > 0) {
        showToast(`${uploadedCount} document${uploadedCount > 1 ? 's' : ''} uploaded successfully!`, 'success');

        // 5. Auto-extract if enabled (queue all uploads)
        if (autoExtract && documentType !== 'other') {
          setExtracting(true);
          showToast('Starting AI extraction...', 'info');

          for (const docId of documentIds) {
            try {
              await supabase.functions.invoke('parse-reference-document', {
                body: { documentId: docId }
              });
            } catch (error) {
              console.error('Extraction error:', error);
            }
          }
          
          showToast(`${documentIds.length} extraction${documentIds.length > 1 ? 's' : ''} queued - check review page soon!`, 'success');
        }
      }

      // Reset form
      setFiles([]);
      setTitle('');
      setUploadProgress({});
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
      <h3 style={{ margin: '0 0 12px 0', fontSize: '10pt', fontWeight: 700 }}>
        Upload Reference Document  
      </h3>
      <p style={{ fontSize: '8pt', color: 'var(--text-muted)', margin: '0 0 16px 0' }}>
        Share factory brochures & manuals for {year} {make} {series || model}. Your contribution helps all owners!
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {/* File Input */}
        <div>
          <label style={{ fontSize: '8pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
            Select Files (PDF, ZIP, or Images)
          </label>
          <input
            type="file"
            accept=".pdf,.zip,.jpg,.jpeg,.png,.webp"
            onChange={handleFileSelect}
            disabled={uploading}
            multiple
            style={{ fontSize: '8pt', width: '100%' }}
          />
          {files.length > 0 && (
            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '4px' }}>
              {files.length} file{files.length > 1 ? 's' : ''} selected ({(files.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024).toFixed(2)} MB total)
            </div>
          )}
          {Object.keys(uploadProgress).length > 0 && (
            <div style={{ marginTop: '8px' }}>
              {Object.entries(uploadProgress).map(([key, progress]) => (
                <div key={key} style={{ marginBottom: '4px' }}>
                  <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '2px' }}>
                    {key.split('-').slice(1).join('-')}
                  </div>
                  <div style={{ background: '#e5e7eb', borderRadius: '4px', height: '4px', overflow: 'hidden' }}>
                    <div style={{ background: 'var(--primary)', height: '100%', width: `${progress}%`, transition: 'width 0.3s' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Document Type */}
        <div>
          <label style={{ fontSize: '8pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
            Document Type
          </label>
          <select
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
            disabled={uploading}
            className="form-select"
            style={{ fontSize: '8pt', width: '100%' }}
          >
            {DOCUMENT_TYPES.map(type => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
        </div>

        {/* Title */}
        <div>
          <label style={{ fontSize: '8pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
            Document Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={`e.g., ${year} ${make} Sales Brochure`}
            disabled={uploading}
            className="form-input"
            style={{ fontSize: '8pt', width: '100%' }}
          />
        </div>

        {/* Year Published */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <div>
            <label style={{ fontSize: '8pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
              Year Published
            </label>
            <input
              type="number"
              value={yearPublished}
              onChange={(e) => setYearPublished(parseInt(e.target.value))}
              min="1900"
              max={new Date().getFullYear()}
              disabled={uploading}
              className="form-input"
              style={{ fontSize: '8pt', width: '100%' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '8pt', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={isFactoryOriginal}
                onChange={(e) => setIsFactoryOriginal(e.target.checked)}
                disabled={uploading}
              />
              Factory Original
            </label>
          </div>
        </div>

        {/* Auto Extract */}
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '8pt', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={autoExtract}
            onChange={(e) => setAutoExtract(e.target.checked)}
            disabled={uploading}
          />
          Extract specs automatically (uses AI)
        </label>

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
    </div>
  );
};

export default ReferenceLibraryUpload;

