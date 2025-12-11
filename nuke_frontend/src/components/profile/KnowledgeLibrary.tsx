import React, { useState, useEffect, useRef } from 'react';
import { ReferenceDocumentService } from '../../services/referenceDocumentService';
import type { ReferenceDocument } from '../../services/referenceDocumentService';
import { useToast } from '../../hooks/useToast';
import { supabase } from '../../lib/supabase';

interface KnowledgeLibraryProps {
  userId: string;
  isOwnProfile: boolean;
}

const DOCUMENT_TYPES = [
  { value: 'brochure', label: 'Brochure' },
  { value: 'owners_manual', label: "Owner's Manual" },
  { value: 'service_manual', label: 'Service Manual' },
  { value: 'parts_catalog', label: 'Parts Catalog' },
  { value: 'spec_sheet', label: 'Spec Sheet' },
  { value: 'paint_codes', label: 'Paint Codes' },
  { value: 'rpo_codes', label: 'RPO Codes' },
  { value: 'wiring_diagram', label: 'Wiring Diagram' },
  { value: 'build_sheet', label: 'Build Sheet' },
  { value: 'recall_notice', label: 'Recall Notice' },
  { value: 'tsb', label: 'TSB (Technical Service Bulletin)' },
  { value: 'material_manual', label: 'Material Manual' },
  { value: 'tds', label: 'TDS (Technical Data Sheet)' },
  { value: 'other', label: 'Other' }
];

const KnowledgeLibrary: React.FC<KnowledgeLibraryProps> = ({ userId, isOwnProfile }) => {
  const [documents, setDocuments] = useState<ReferenceDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  useEffect(() => {
    loadDocuments();
  }, [userId, isOwnProfile]);

  const loadDocuments = async () => {
    try {
      setLoading(true);
      const docs = isOwnProfile
        ? await ReferenceDocumentService.getUserDocuments(userId, true)
        : await ReferenceDocumentService.getPublicDocuments(userId);
      setDocuments(docs);
    } catch (error) {
      console.error('Error loading reference documents:', error);
      showToast('Failed to load documents', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Show upload form with file pre-selected
    setShowUploadForm(true);
    // Store file in component state for later upload
    (window as any).__pendingUploadFile = file;
  };

  const handleUpload = async (formData: {
    document_type: string;
    title: string;
    description?: string;
    year?: number;
    make?: string;
    series?: string;
    is_public?: boolean;
    is_factory_original?: boolean;
    tags?: string[];
  }) => {
    const file = (window as any).__pendingUploadFile;
    if (!file) {
      showToast('No file selected', 'error');
      return;
    }

    try {
      setUploading(true);
      await ReferenceDocumentService.uploadDocument(userId, {
        file,
        ...formData,
        auto_index: true // Automatically trigger indexing
      });
      
      showToast('Document uploaded and indexing started', 'success');
      setShowUploadForm(false);
      (window as any).__pendingUploadFile = null;
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      await loadDocuments();
    } catch (error: any) {
      console.error('Error uploading document:', error);
      showToast(error?.message || 'Failed to upload document', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (documentId: string) => {
    if (!confirm('Are you sure you want to delete this document? This cannot be undone.')) return;

    try {
      await ReferenceDocumentService.deleteDocument(documentId, userId);
      showToast('Document deleted', 'success');
      await loadDocuments();
    } catch (error: any) {
      console.error('Error deleting document:', error);
      showToast(error?.message || 'Failed to delete document', 'error');
    }
  };

  const handleDownload = async (document: ReferenceDocument) => {
    try {
      await ReferenceDocumentService.incrementStat(document.id, 'download');
      window.open(document.file_url, '_blank');
    } catch (error) {
      console.error('Error downloading document:', error);
    }
  };

  const filteredDocuments = documents.filter(doc => {
    const matchesSearch = !searchTerm || 
      doc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.tags?.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesType = selectedType === 'all' || doc.document_type === selectedType;
    
    return matchesSearch && matchesType;
  });

  const documentTypes = ['all', ...Array.from(new Set(documents.map(d => d.document_type)))];

  if (loading) {
    return (
      <div className="card">
        <div className="card-body" style={{ textAlign: 'center', padding: '40px' }}>
          <div className="text text-muted">Loading knowledge library...</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 className="heading-3">Knowledge Library ({documents.length})</h3>
        </div>
        <div className="card-body">
          {/* Upload entry point */}
          {isOwnProfile && (
            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                padding: '16px',
                marginBottom: 'var(--space-3)'
              }}
            >
              <div className="text font-bold" style={{ marginBottom: '4px' }}>
                Upload Reference Documents
              </div>
              <div className="text text-muted" style={{ marginBottom: '8px' }}>
                Drop brochures, manuals, or images. Everything is detected automatically.
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
              <button
                className="button button-primary"
                style={{ fontSize: '9pt', padding: '8px 12px' }}
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? 'Uploading...' : 'Upload Document'}
              </button>
            </div>
          )}

          {/* Upload Form Modal */}
          {showUploadForm && isOwnProfile && (
            <DocumentUploadForm
              onUpload={handleUpload}
              onCancel={() => {
                setShowUploadForm(false);
                (window as any).__pendingUploadFile = null;
                if (fileInputRef.current) {
                  fileInputRef.current.value = '';
                }
              }}
              uploading={uploading}
            />
          )}

          {/* Search and Filter */}
          {documents.length > 0 && (
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
              <input
                type="text"
                placeholder="Search documents..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="form-input"
                style={{ flex: 1, fontSize: '9pt', padding: '6px 8px' }}
              />
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="form-select"
                style={{ fontSize: '9pt', padding: '6px 8px' }}
              >
                {documentTypes.map(type => (
                  <option key={type} value={type}>
                    {type === 'all' ? 'All Types' : DOCUMENT_TYPES.find(dt => dt.value === type)?.label || type}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Documents List */}
          {filteredDocuments.length === 0 ? (
            <div className="text text-muted" style={{ textAlign: 'center', padding: 'var(--space-4)' }}>
              {isOwnProfile 
                ? 'No reference documents yet. Upload your first document to get started.' 
                : 'No public reference documents to display.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {filteredDocuments.map(doc => (
                <DocumentCard
                  key={doc.id}
                  document={doc}
                  isOwnProfile={isOwnProfile}
                  onDelete={() => handleDelete(doc.id)}
                  onDownload={() => handleDownload(doc)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface DocumentCardProps {
  document: ReferenceDocument;
  isOwnProfile: boolean;
  onDelete: () => void;
  onDownload: () => void;
}

const DocumentCard: React.FC<DocumentCardProps> = ({ document, isOwnProfile, onDelete, onDownload }) => {
  const docTypeLabel = DOCUMENT_TYPES.find(dt => dt.value === document.document_type)?.label || document.document_type;
  const fileSizeMB = document.file_size_bytes ? (document.file_size_bytes / 1024 / 1024).toFixed(2) : null;

  return (
    <div
      style={{
        padding: 'var(--space-3)',
        border: '1px solid var(--border)',
        borderRadius: '4px',
        background: 'var(--white)'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 'var(--space-2)' }}>
        <div style={{ flex: 1 }}>
          <h4 className="text font-bold" style={{ marginBottom: '4px' }}>
            {document.title}
            {document.is_public && (
              <span style={{
                marginLeft: '8px',
                padding: '2px 6px',
                background: 'var(--success-dim)',
                color: 'var(--success)',
                fontSize: '7pt',
                borderRadius: '2px'
              }}>
                PUBLIC
              </span>
            )}
            {document.is_factory_original && (
              <span style={{
                marginLeft: '8px',
                padding: '2px 6px',
                background: 'var(--primary-dim)',
                color: 'var(--primary)',
                fontSize: '7pt',
                borderRadius: '2px'
              }}>
                FACTORY
              </span>
            )}
          </h4>
          <div className="text text-small text-muted" style={{ marginBottom: '4px' }}>
            {docTypeLabel}
            {document.year && ` • ${document.year}`}
            {document.make && ` ${document.make}`}
            {document.series && ` ${document.series}`}
            {document.page_count && ` • ${document.page_count} pages`}
            {fileSizeMB && ` • ${fileSizeMB} MB`}
          </div>
          {document.description && (
            <div className="text text-small" style={{ marginTop: '4px', color: 'var(--text-muted)' }}>
              {document.description}
            </div>
          )}
          {document.tags && document.tags.length > 0 && (
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
              {document.tags.map(tag => (
                <span
                  key={tag}
                  style={{
                    padding: '2px 6px',
                    background: 'var(--grey-200)',
                    fontSize: '7pt',
                    borderRadius: '2px'
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        {isOwnProfile && (
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={onDownload}
              className="button button-secondary"
              style={{ fontSize: '8pt', padding: '4px 8px' }}
            >
              View
            </button>
            <button
              onClick={onDelete}
              className="button button-secondary"
              style={{ fontSize: '8pt', padding: '4px 8px' }}
            >
              Delete
            </button>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: '8px', fontSize: '7pt', color: 'var(--text-muted)' }}>
        {document.view_count > 0 && <span>{document.view_count} views</span>}
        {document.download_count > 0 && <span>{document.download_count} downloads</span>}
        {document.link_count > 0 && <span>{document.link_count} vehicles</span>}
        <span>{new Date(document.uploaded_at).toLocaleDateString()}</span>
      </div>
    </div>
  );
};

interface DocumentUploadFormProps {
  onUpload: (data: any) => void;
  onCancel: () => void;
  uploading: boolean;
}

const DocumentUploadForm: React.FC<DocumentUploadFormProps> = ({ onUpload, onCancel, uploading }) => {
  const [documentType, setDocumentType] = useState('brochure');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [year, setYear] = useState<number | undefined>();
  const [make, setMake] = useState('');
  const [series, setSeries] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [isFactoryOriginal, setIsFactoryOriginal] = useState(false);
  const [tags, setTags] = useState('');

  const handleSubmit = () => {
    if (!title.trim()) {
      alert('Title is required');
      return;
    }

    onUpload({
      document_type: documentType,
      title: title.trim(),
      description: description.trim() || undefined,
      year: year || undefined,
      make: make.trim() || undefined,
      series: series.trim() || undefined,
      is_public: isPublic,
      is_factory_original: isFactoryOriginal,
      tags: tags.split(',').map(t => t.trim()).filter(Boolean)
    });
  };

  return (
    <div style={{
      padding: 'var(--space-3)',
      border: '1px solid var(--border)',
      borderRadius: '4px',
      marginBottom: 'var(--space-3)',
      background: 'var(--grey-50)'
    }}>
      <div className="text font-bold" style={{ marginBottom: 'var(--space-2)' }}>
        Document Information
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <select
          value={documentType}
          onChange={(e) => setDocumentType(e.target.value)}
          className="form-select"
          style={{ fontSize: '9pt', padding: '6px 8px' }}
        >
          {DOCUMENT_TYPES.map(dt => (
            <option key={dt.value} value={dt.value}>{dt.label}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Document title (required)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="form-input"
          style={{ fontSize: '10pt', padding: '8px' }}
        />
        <textarea
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="form-input"
          style={{ fontSize: '9pt', padding: '8px', minHeight: '60px', fontFamily: 'inherit' }}
        />
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <input
            type="number"
            placeholder="Year"
            value={year || ''}
            onChange={(e) => setYear(e.target.value ? parseInt(e.target.value) : undefined)}
            className="form-input"
            style={{ flex: 1, fontSize: '9pt', padding: '6px 8px' }}
          />
          <input
            type="text"
            placeholder="Make"
            value={make}
            onChange={(e) => setMake(e.target.value)}
            className="form-input"
            style={{ flex: 1, fontSize: '9pt', padding: '6px 8px' }}
          />
          <input
            type="text"
            placeholder="Series (C10, K5, etc.)"
            value={series}
            onChange={(e) => setSeries(e.target.value)}
            className="form-input"
            style={{ flex: 1, fontSize: '9pt', padding: '6px 8px' }}
          />
        </div>
        <input
          type="text"
          placeholder="Tags (comma-separated)"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className="form-input"
          style={{ fontSize: '9pt', padding: '6px 8px' }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '9pt' }}>
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
            />
            Make public (others can discover and use)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '9pt' }}>
            <input
              type="checkbox"
              checked={isFactoryOriginal}
              onChange={(e) => setIsFactoryOriginal(e.target.checked)}
            />
            Factory original document
          </label>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button
            onClick={handleSubmit}
            className="button button-primary"
            style={{ fontSize: '9pt', padding: '6px 12px' }}
            disabled={uploading || !title.trim()}
          >
            {uploading ? 'Uploading...' : 'Upload & Index'}
          </button>
          <button
            onClick={onCancel}
            className="button button-secondary"
            style={{ fontSize: '9pt', padding: '6px 12px' }}
            disabled={uploading}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default KnowledgeLibrary;
