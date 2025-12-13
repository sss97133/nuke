import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';

interface ReferenceDocument {
  id: string;
  library_id: string;
  document_type: string;
  title: string;
  description?: string;
  file_url: string;
  thumbnail_url?: string;
  page_count?: number;
  year_published?: number;
  publisher?: string;
  is_factory_original: boolean;
  is_verified: boolean;
  view_count: number;
  download_count: number;
  uploaded_at: string;
  
  // From join
  library_year?: number;
  library_make?: string;
  library_series?: string;
  library_body_style?: string;
  vehicles_using?: number;
}

const Library: React.FC = () => {
  const navigate = useNavigate();
  const [session, setSession] = useState<any>(null);
  const [documents, setDocuments] = useState<ReferenceDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Upload form state
  const [uploadForm, setUploadForm] = useState({
    document_type: 'brochure',
    title: '',
    description: '',
    year: '',
    make: '',
    series: '',
    body_style: '',
    year_published: '',
    publisher: '',
    part_number: '',
    is_factory_original: true,
    file: null as File | null
  });

  const [stats, setStats] = useState({
    total_documents: 0,
    total_downloads: 0,
    vehicles_helped: 0,
    libraries_contributed: 0
  });

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (session) {
      loadDocuments();
      loadStats();
    }
  }, [session]);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setSession(session);
    if (!session) {
      navigate('/login');
    }
  };

  const loadDocuments = async () => {
    if (!session?.user?.id) return;
    
    try {
      setLoading(true);
      
      // Load documents with extraction status and uploader info
      const { data, error } = await supabase
        .from('library_documents')
        .select(`
          *,
          reference_libraries!inner (
            year,
            make,
            series,
            body_style
          ),
          document_extractions (
            id,
            status,
            extracted_data,
            extracted_at
          )
        `)
        .eq('uploaded_by', session.user.id)
        .order('uploaded_at', { ascending: false });
      
      // Also get uploader profiles for attribution
      const uploaderIds = [...new Set((data || []).map((d: any) => d.uploaded_by).filter(Boolean))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, username')
        .in('id', uploaderIds);
      
      const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));

      if (!error && data) {
        const enriched = data.map((d: any) => ({
          ...d,
          library_year: d.reference_libraries?.year,
          library_make: d.reference_libraries?.make,
          library_series: d.reference_libraries?.series,
          library_body_style: d.reference_libraries?.body_style,
          extraction: d.document_extractions?.[0] || null,
          uploader_name: d.uploaded_by 
            ? (profileMap.get(d.uploaded_by)?.full_name || profileMap.get(d.uploaded_by)?.username || 'You')
            : 'You'
        }));
        
        // Group documents by upload batch (within 2 minutes = same book)
        const grouped = groupDocumentsByBook(enriched);
        setDocuments(grouped);
      }
    } catch (err) {
      console.error('Failed to load documents:', err);
    } finally {
      setLoading(false);
    }
  };

  // Group documents uploaded within 2 minutes as one "book"
  const groupDocumentsByBook = (docs: any[]): any[] => {
    if (docs.length === 0) return [];
    
    const books: any[] = [];
    let currentBook: any = null;
    
    for (const doc of docs) {
      if (!currentBook) {
        // Start new book
        currentBook = {
          ...doc,
          is_book: true,
          pages: [doc],
          page_count: 1,
          total_size: doc.file_size_bytes || 0
        };
      } else {
        // Check if this doc is part of same book (within 2 minutes)
        const timeDiff = new Date(doc.uploaded_at).getTime() - new Date(currentBook.uploaded_at).getTime();
        const twoMinutes = 2 * 60 * 1000;
        
        if (timeDiff <= twoMinutes && doc.library_id === currentBook.library_id) {
          // Same book - add as page
          currentBook.pages.push(doc);
          currentBook.page_count = currentBook.pages.length;
          currentBook.total_size += (doc.file_size_bytes || 0);
          // Use first extraction if available
          if (!currentBook.extraction && doc.extraction) {
            currentBook.extraction = doc.extraction;
          }
        } else {
          // New book - save current and start new
          books.push(currentBook);
          currentBook = {
            ...doc,
            is_book: true,
            pages: [doc],
            page_count: 1,
            total_size: doc.file_size_bytes || 0
          };
        }
      }
    }
    
    // Don't forget last book
    if (currentBook) {
      books.push(currentBook);
    }
    
    return books;
  };

  const loadStats = async () => {
    if (!session?.user?.id) return;
    
    try {
      const { data: docs } = await supabase
        .from('library_documents')
        .select('id, download_count')
        .eq('uploaded_by', session.user.id);

      const { data: links } = await supabase
        .from('vehicle_library_links')
        .select('vehicle_id, library_id')
        .in('library_id', 
          (docs || []).map(d => (d as any).library_id).filter(Boolean)
        );

      setStats({
        total_documents: docs?.length || 0,
        total_downloads: docs?.reduce((sum, d) => sum + (d.download_count || 0), 0) || 0,
        vehicles_helped: new Set((links || []).map(l => l.vehicle_id)).size,
        libraries_contributed: new Set((docs || []).map(d => (d as any).library_id)).size
      });
    } catch (err) {
      console.warn('Failed to load stats:', err);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadForm(prev => ({ ...prev, file }));
      setShowUploadModal(true);
    }
  };

  const handleUpload = async () => {
    if (!uploadForm.file || !session?.user?.id) return;
    
    setUploading(true);
    try {
      // 1. Upload file to storage
      const fileName = `${Date.now()}-${uploadForm.file.name}`;
      const filePath = `${session.user.id}/${fileName}`;
      
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('reference-docs')
        .upload(filePath, uploadForm.file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('reference-docs')
        .getPublicUrl(filePath);

      // 2. Find or create library
      const { data: library, error: libError } = await supabase
        .from('reference_libraries')
        .select('id')
        .eq('year', parseInt(uploadForm.year))
        .eq('make', uploadForm.make)
        .eq('series', uploadForm.series || null)
        .eq('body_style', uploadForm.body_style || null)
        .maybeSingle();

      let libraryId = library?.id;

      if (!libraryId) {
        const { data: newLib } = await supabase
          .from('reference_libraries')
          .insert({
            year: parseInt(uploadForm.year),
            make: uploadForm.make,
            series: uploadForm.series || null,
            body_style: uploadForm.body_style || null,
            created_by: session.user.id
          })
          .select('id')
          .single();
        
        libraryId = newLib?.id;
      }

      // 3. Create document record
      const { error: docError } = await supabase
        .from('library_documents')
        .insert({
          library_id: libraryId,
          document_type: uploadForm.document_type,
          title: uploadForm.title,
          description: uploadForm.description,
          file_url: publicUrl,
          file_size_bytes: uploadForm.file.size,
          mime_type: uploadForm.file.type,
          year_published: uploadForm.year_published ? parseInt(uploadForm.year_published) : null,
          publisher: uploadForm.publisher,
          part_number: uploadForm.part_number,
          is_factory_original: uploadForm.is_factory_original,
          uploaded_by: session.user.id
        });

      if (docError) throw docError;

      // Trigger AI parsing for automatic spec extraction
      try {
        const { data: parseResult, error: parseError } = await supabase.functions.invoke('parse-reference-document', {
          body: { documentId: null, imageUrls: [publicUrl] }  // Will extract from uploaded image/PDF
        });
        
        if (!parseError && parseResult) {
          console.log('AI extraction started:', parseResult);
          // Extraction will be available for review in document_extractions table
        }
      } catch (parseErr) {
        console.warn('AI parsing skipped (will process later):', parseErr);
      }

      // Success - reload
      setShowUploadModal(false);
      setUploadForm({
        document_type: 'brochure',
        title: '',
        description: '',
        year: '',
        make: '',
        series: '',
        body_style: '',
        year_published: '',
        publisher: '',
        part_number: '',
        is_factory_original: true,
        file: null
      });
      loadDocuments();
      loadStats();
      
    } catch (err) {
      console.error('Upload failed:', err);
      alert('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return '0 KB';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  };

  const getDocumentIcon = (type: string) => {
    switch (type) {
      case 'brochure': return '📘';
      case 'owners_manual': return '📗';
      case 'service_manual': return '📙';
      case 'parts_catalog': return '📚';
      case 'spec_sheet': return '📊';
      case 'paint_codes': return '🎨';
      case 'rpo_codes': return '🔢';
      case 'wiring_diagram': return '⚡';
      default: return '📄';
    }
  };

  if (loading) {
    return (
      <div className="card">
        <div className="card-body" style={{ textAlign: 'center', padding: '40px' }}>
          Loading library...
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: 'var(--space-4)' }}>
      {/* Header */}
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <h1 style={{ fontSize: '18pt', fontWeight: 700, marginBottom: '8px' }}>
          Reference Library
        </h1>
        <p style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
          Your factory documentation collection - brochures, manuals, specs, and technical references
        </p>
      </div>

      {/* Stats */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
        gap: 'var(--space-3)',
        marginBottom: 'var(--space-4)'
      }}>
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '20pt', fontWeight: 700 }}>{stats.total_documents}</div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Documents</div>
          </div>
        </div>
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '20pt', fontWeight: 700 }}>{stats.vehicles_helped}</div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Vehicles Helped</div>
          </div>
        </div>
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '20pt', fontWeight: 700 }}>{stats.total_downloads}</div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Downloads</div>
          </div>
        </div>
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '20pt', fontWeight: 700 }}>{stats.libraries_contributed}</div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Libraries</div>
          </div>
        </div>
      </div>

      {/* Upload Button */}
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <button
          className="button button-primary"
          onClick={() => fileInputRef.current?.click()}
          style={{ fontSize: '9pt' }}
        >
          + Upload Document
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/*"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
      </div>

      {/* Documents Grid */}
      {documents.length === 0 ? (
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: '40pt', marginBottom: '16px' }}>📚</div>
            <div style={{ fontSize: '11pt', fontWeight: 600, marginBottom: '8px' }}>
              No documents yet
            </div>
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '20px' }}>
              Upload factory brochures, manuals, and specs to build your reference library
            </div>
            <button
              className="button button-primary"
              onClick={() => fileInputRef.current?.click()}
            >
              Upload First Document
            </button>
          </div>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 'var(--space-3)'
        }}>
          {documents.map((book) => (
            <div key={book.id} className="card" style={{ cursor: 'pointer' }}>
              <div className="card-body">
                <div style={{ fontSize: '32pt', textAlign: 'center', marginBottom: '8px' }}>
                  {getDocumentIcon(book.document_type)}
                </div>
                <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '4px' }}>
                  {book.is_book && book.page_count > 1 
                    ? `${book.page_count} Pages - ${book.pages[0]?.title || book.title}`
                    : book.title}
                </div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
                  {book.library_year} {book.library_make} {book.library_series}
                  {book.library_body_style && ` ${book.library_body_style}`}
                </div>
                
                {/* Book Stats */}
                {book.is_book && book.page_count > 1 && (
                  <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
                    {book.page_count} pages • {(book.total_size / 1024 / 1024).toFixed(1)} MB
                  </div>
                )}
                
                {/* Extraction Status */}
                {book.extraction && (
                  <div style={{ 
                    marginTop: '8px',
                    padding: '6px',
                    background: book.extraction.status === 'pending_review' ? '#fef3c7' : '#f0fdf4',
                    borderRadius: '4px',
                    fontSize: '7pt'
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                      {book.extraction.status === 'pending_review' ? 'Processing...' : 
                       book.extraction.status === 'applied' ? '✓ Extracted' : 
                       book.extraction.status === 'rejected' ? '✗ Rejected' : 'Processing'}
                    </div>
                    {book.extraction.extracted_data && (
                      <div style={{ fontSize: '6pt', color: 'var(--text-muted)' }}>
                        {book.extraction.extracted_data.colors?.length || 0} colors • {' '}
                        {book.extraction.extracted_data.specifications?.engines?.length || 0} engines • {' '}
                        {book.extraction.extracted_data.options?.length || 0} options
                      </div>
                    )}
                  </div>
                )}
                
                <div style={{ 
                  display: 'flex', 
                  gap: '4px', 
                  marginTop: '8px',
                  fontSize: '7pt'
                }}>
                  {book.is_factory_original && (
                    <span className="badge badge-secondary">Factory</span>
                  )}
                  {book.is_verified && (
                    <span className="badge badge-success">Verified</span>
                  )}
                  {book.is_book && book.page_count > 1 && (
                    <span className="badge badge-primary">{book.page_count} pages</span>
                  )}
                </div>
                <div style={{ 
                  marginTop: '8px',
                  paddingTop: '8px',
                  borderTop: '1px solid var(--border)',
                  fontSize: '7pt',
                  color: 'var(--text-muted)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '4px'
                }}>
                  <span>{book.download_count || 0} downloads</span>
                  <span>{book.vehicles_using || 0} vehicles</span>
                </div>
                {/* Attribution */}
                <div style={{
                  fontSize: '7pt',
                  color: 'var(--text-muted)',
                  marginTop: '8px',
                  paddingTop: '8px',
                  borderTop: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'space-between'
                }}>
                  <span>Provided by</span>
                  <span style={{ fontWeight: 600 }}>{book.uploader_name || 'You'}</span>
                </div>
                <div style={{ marginTop: '8px', display: 'flex', gap: '4px' }}>
                  <button
                    className="button button-small"
                    style={{ fontSize: '7pt', flex: 1 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(doc.file_url, '_blank');
                      supabase.rpc('increment_document_stat', { 
                        p_document_id: doc.id, 
                        p_stat_type: 'view' 
                      });
                    }}
                  >
                    View
                  </button>
                  <button
                    className="button button-small"
                    style={{ fontSize: '7pt', flex: 1 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      const link = document.createElement('a');
                      link.href = doc.file_url;
                      link.download = doc.title;
                      link.click();
                      supabase.rpc('increment_document_stat', { 
                        p_document_id: doc.id, 
                        p_stat_type: 'download' 
                      });
                    }}
                  >
                    Download
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.75)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 10000
          }}
          onClick={() => setShowUploadModal(false)}
        >
          <div
            className="card"
            style={{ width: '90%', maxWidth: '500px', maxHeight: '90vh', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-header">
              <h3 style={{ fontSize: '11pt', fontWeight: 700, margin: 0 }}>
                Upload Reference Document
              </h3>
            </div>
            <div className="card-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {/* File info */}
                {uploadForm.file && (
                  <div style={{ padding: '8px', background: 'var(--bg-secondary)', borderRadius: '4px' }}>
                    <div style={{ fontSize: '8pt', fontWeight: 600 }}>{uploadForm.file.name}</div>
                    <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                      {formatBytes(uploadForm.file.size)}
                    </div>
                  </div>
                )}

                {/* Document Type */}
                <div>
                  <label style={{ fontSize: '8pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Document Type
                  </label>
                  <select
                    className="form-select"
                    value={uploadForm.document_type}
                    onChange={(e) => setUploadForm(prev => ({ ...prev, document_type: e.target.value }))}
                    style={{ fontSize: '8pt' }}
                  >
                    <option value="brochure">Sales Brochure</option>
                    <option value="owners_manual">Owner's Manual</option>
                    <option value="service_manual">Service Manual</option>
                    <option value="parts_catalog">Parts Catalog</option>
                    <option value="spec_sheet">Spec Sheet</option>
                    <option value="paint_codes">Paint Codes</option>
                    <option value="rpo_codes">RPO Codes</option>
                    <option value="wiring_diagram">Wiring Diagram</option>
                    <option value="build_sheet">Build Sheet</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                {/* Title */}
                <div>
                  <label style={{ fontSize: '8pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Title *
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    value={uploadForm.title}
                    onChange={(e) => setUploadForm(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="1973 Chevrolet Trucks - Blazer"
                    style={{ fontSize: '8pt' }}
                  />
                </div>

                {/* YMM */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: 'var(--space-2)' }}>
                  <div>
                    <label style={{ fontSize: '8pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                      Year *
                    </label>
                    <input
                      type="number"
                      className="form-input"
                      value={uploadForm.year}
                      onChange={(e) => setUploadForm(prev => ({ ...prev, year: e.target.value }))}
                      placeholder="1973"
                      style={{ fontSize: '8pt' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '8pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                      Make *
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      value={uploadForm.make}
                      onChange={(e) => setUploadForm(prev => ({ ...prev, make: e.target.value }))}
                      placeholder="Chevrolet"
                      style={{ fontSize: '8pt' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '8pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                      Series
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      value={uploadForm.series}
                      onChange={(e) => setUploadForm(prev => ({ ...prev, series: e.target.value }))}
                      placeholder="K5"
                      style={{ fontSize: '8pt' }}
                    />
                  </div>
                </div>

                {/* Body Style */}
                <div>
                  <label style={{ fontSize: '8pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Body Style
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    value={uploadForm.body_style}
                    onChange={(e) => setUploadForm(prev => ({ ...prev, body_style: e.target.value }))}
                    placeholder="Blazer"
                    style={{ fontSize: '8pt' }}
                  />
                </div>

                {/* Publisher */}
                <div>
                  <label style={{ fontSize: '8pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Publisher
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    value={uploadForm.publisher}
                    onChange={(e) => setUploadForm(prev => ({ ...prev, publisher: e.target.value }))}
                    placeholder="General Motors"
                    style={{ fontSize: '8pt' }}
                  />
                </div>

                {/* Factory Original */}
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '8pt' }}>
                    <input
                      type="checkbox"
                      checked={uploadForm.is_factory_original}
                      onChange={(e) => setUploadForm(prev => ({ ...prev, is_factory_original: e.target.checked }))}
                    />
                    Factory original document
                  </label>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button
                    className="button button-secondary"
                    onClick={() => setShowUploadModal(false)}
                    disabled={uploading}
                    style={{ flex: 1, fontSize: '8pt' }}
                  >
                    Cancel
                  </button>
                  <button
                    className="button button-primary"
                    onClick={handleUpload}
                    disabled={uploading || !uploadForm.title || !uploadForm.year || !uploadForm.make}
                    style={{ flex: 1, fontSize: '8pt' }}
                  >
                    {uploading ? 'Uploading...' : 'Upload'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Library;

