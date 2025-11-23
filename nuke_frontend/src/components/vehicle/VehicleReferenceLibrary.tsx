import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import ImageLightbox from '../image/ImageLightbox';

interface ReferenceBook {
  id: string;
  title: string;
  document_type: string;
  page_count: number;
  total_size: number;
  uploaded_at: string;
  uploaded_by: string;
  uploader_name?: string;
  extraction?: {
    status: string;
    colors?: number;
    engines?: number;
    options?: number;
  };
  pages: Array<{
    id: string;
    title: string;
    file_url: string;
  }>;
}

interface VehicleReferenceLibraryProps {
  vehicleId: string;
  year: number;
  make: string;
  series?: string | null;
  model?: string;
  bodyStyle?: string | null;
}

const VehicleReferenceLibrary: React.FC<VehicleReferenceLibraryProps> = ({
  vehicleId,
  year,
  make,
  series,
  model,
  bodyStyle
}) => {
  const [books, setBooks] = useState<ReferenceBook[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Lightbox state
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [currentBookIndex, setCurrentBookIndex] = useState(0);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);

  useEffect(() => {
    loadReferenceBooks();
  }, [year, make, series, model, bodyStyle]);

  const loadReferenceBooks = async () => {
    try {
      setLoading(true);
      
      // Find libraries matching this vehicle
      const { data: libraries, error: libError } = await supabase
        .from('reference_libraries')
        .select('id')
        .eq('year', year)
        .eq('make', make)
        .eq('series', series || null)
        .eq('body_style', bodyStyle || null);

      if (libError) throw libError;
      if (!libraries || libraries.length === 0) {
        setBooks([]);
        setLoading(false);
        return;
      }

      const libraryIds = libraries.map(l => l.id);

      // Get all documents from matching libraries
      const { data: docs, error: docsError } = await supabase
        .from('library_documents')
        .select(`
          id,
          title,
          document_type,
          file_url,
          file_size_bytes,
          uploaded_at,
          uploaded_by,
          library_id,
          document_extractions (
            id,
            status,
            extracted_data
          )
        `)
        .in('library_id', libraryIds)
        .order('uploaded_at', { ascending: false });

      if (docsError) throw docsError;

      // Group documents by upload batch (within 2 minutes = same book)
      const grouped = groupDocumentsByBook(docs || []);

      // Get uploader names
      const uploaderIds = [...new Set(grouped.flatMap(b => b.pages.map(p => p.uploaded_by)).filter(Boolean))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, username')
        .in('id', uploaderIds);

      const profileMap = new Map((profiles || []).map(p => [p.id, p]));

      // Enrich with uploader names
      const enriched = grouped.map(book => ({
        ...book,
        uploader_name: book.uploaded_by 
          ? (profileMap.get(book.uploaded_by)?.full_name || profileMap.get(book.uploaded_by)?.username || 'Anonymous')
          : 'Anonymous',
        extraction: book.extraction ? {
          status: book.extraction.status,
          colors: book.extraction.extracted_data?.colors?.length || 0,
          engines: book.extraction.extracted_data?.specifications?.engines?.length || 0,
          options: book.extraction.extracted_data?.options?.length || 0
        } : undefined
      }));

      setBooks(enriched);
    } catch (error) {
      console.error('Failed to load reference books:', error);
    } finally {
      setLoading(false);
    }
  };

  const groupDocumentsByBook = (docs: any[]): ReferenceBook[] => {
    if (docs.length === 0) return [];
    
    const books: ReferenceBook[] = [];
    let currentBook: any = null;
    
    for (const doc of docs) {
      if (!currentBook) {
        currentBook = {
          id: doc.id,
          title: doc.title,
          document_type: doc.document_type,
          page_count: 1,
          total_size: doc.file_size_bytes || 0,
          uploaded_at: doc.uploaded_at,
          uploaded_by: doc.uploaded_by,
          extraction: doc.document_extractions?.[0] || null,
          pages: [{
            id: doc.id,
            title: doc.title,
            file_url: doc.file_url
          }]
        };
      } else {
        const timeDiff = new Date(doc.uploaded_at).getTime() - new Date(currentBook.uploaded_at).getTime();
        const twoMinutes = 2 * 60 * 1000;
        
        if (timeDiff <= twoMinutes && doc.library_id === currentBook.library_id) {
          currentBook.pages.push({
            id: doc.id,
            title: doc.title,
            file_url: doc.file_url
          });
          currentBook.page_count = currentBook.pages.length;
          currentBook.total_size += (doc.file_size_bytes || 0);
          if (!currentBook.extraction && doc.document_extractions?.[0]) {
            currentBook.extraction = doc.document_extractions[0];
          }
        } else {
          books.push(currentBook);
          currentBook = {
            id: doc.id,
            title: doc.title,
            document_type: doc.document_type,
            page_count: 1,
            total_size: doc.file_size_bytes || 0,
            uploaded_at: doc.uploaded_at,
            uploaded_by: doc.uploaded_by,
            extraction: doc.document_extractions?.[0] || null,
            pages: [{
              id: doc.id,
              title: doc.title,
              file_url: doc.file_url
            }]
          };
        }
      }
    }
    
    if (currentBook) {
      books.push(currentBook);
    }
    
    return books;
  };

  const getDocumentIcon = (type: string) => {
    switch (type) {
      case 'brochure': return '📘';
      case 'owners_manual': return '📗';
      case 'service_manual': return '📙';
      case 'parts_catalog': return '📚';
      default: return '📄';
    }
  };
  
  const openBook = (bookIndex: number) => {
    setCurrentBookIndex(bookIndex);
    setCurrentPageIndex(0);
    setLightboxOpen(true);
  };
  
  const handleNextPage = () => {
    const currentBook = books[currentBookIndex];
    if (currentPageIndex < currentBook.pages.length - 1) {
      setCurrentPageIndex(currentPageIndex + 1);
    } else {
      // Move to next book if available
      if (currentBookIndex < books.length - 1) {
        setCurrentBookIndex(currentBookIndex + 1);
        setCurrentPageIndex(0);
      }
    }
  };
  
  const handlePrevPage = () => {
    if (currentPageIndex > 0) {
      setCurrentPageIndex(currentPageIndex - 1);
    } else {
      // Move to previous book if available
      if (currentBookIndex > 0) {
        setCurrentBookIndex(currentBookIndex - 1);
        setCurrentPageIndex(books[currentBookIndex - 1].pages.length - 1);
      }
    }
  };
  
  const currentBook = books[currentBookIndex];
  const currentPage = currentBook?.pages[currentPageIndex];
  const hasNext = currentPageIndex < (currentBook?.pages.length - 1) || currentBookIndex < books.length - 1;
  const hasPrev = currentPageIndex > 0 || currentBookIndex > 0;

  if (loading) {
    return (
      <div className="card">
        <div className="card-body" style={{ textAlign: 'center', padding: '20px' }}>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Loading reference documents...</div>
        </div>
      </div>
    );
  }

  if (books.length === 0) {
    return null; // Don't show section if no books
  }

  return (
    <>
      <section className="section" id="reference-library-section">
        <div className="card">
          <div className="card-header">
            <h3 style={{ fontSize: '11pt', fontWeight: 700, margin: 0 }}>
              Factory Reference Documents
            </h3>
          </div>
          <div className="card-body">
            <p style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Brochures, manuals, and technical documentation for {year} {make} {series || model}
            </p>
            
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: '16px'
            }}>
              {books.map((book, bookIndex) => (
                <div 
                  key={book.id} 
                  className="card"
                  style={{ 
                    border: '2px solid var(--border)',
                    cursor: 'pointer',
                    transition: 'all 0.12s ease',
                    overflow: 'hidden'
                  }}
                  onClick={() => openBook(bookIndex)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-4px)';
                    e.currentTarget.style.boxShadow = '0 8px 16px rgba(0,0,0,0.15)';
                    e.currentTarget.style.borderColor = 'var(--primary)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = 'none';
                    e.currentTarget.style.borderColor = 'var(--border)';
                  }}
                >
                  {/* Cover Image Preview */}
                  <div style={{ 
                    position: 'relative',
                    width: '100%',
                    paddingTop: '141.4%', // A4 aspect ratio (1:1.414)
                    background: '#f5f5f5',
                    overflow: 'hidden'
                  }}>
                    <img 
                      src={book.pages[0].file_url} 
                      alt={book.title}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover'
                      }}
                      loading="lazy"
                    />
                    
                    {/* Page count badge */}
                    {book.page_count > 1 && (
                      <div style={{
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        background: 'rgba(0, 0, 0, 0.8)',
                        color: 'white',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '8pt',
                        fontWeight: 600
                      }}>
                        {book.page_count} pages
                      </div>
                    )}
                  </div>
                  
                  <div className="card-body" style={{ padding: '12px' }}>
                    <div style={{ fontSize: '9pt', fontWeight: 600, marginBottom: '4px', lineHeight: 1.3 }}>
                      {book.title}
                    </div>
                    <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
                      {(book.total_size / 1024 / 1024).toFixed(1)} MB
                    </div>
                    
                    {/* Extraction Status */}
                    {book.extraction && (
                      <div style={{ 
                        fontSize: '7pt',
                        padding: '4px 6px',
                        background: book.extraction.status === 'pending_review' ? '#fef3c7' : '#f0fdf4',
                        borderRadius: '4px',
                        marginBottom: '8px'
                      }}>
                        {book.extraction.status === 'pending_review' ? '⏳ Processing' : '✓ Extracted'}
                        {book.extraction.colors > 0 && ` • ${book.extraction.colors} colors`}
                        {book.extraction.engines > 0 && ` • ${book.extraction.engines} engines`}
                      </div>
                    )}
                    
                    {/* Attribution */}
                    <div style={{ 
                      fontSize: '7pt',
                      color: 'var(--text-muted)',
                      paddingTop: '8px',
                      borderTop: '1px solid var(--border)'
                    }}>
                      <div>Provided by {book.uploader_name}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
      
      {/* ImageLightbox for flipping through pages */}
      {currentPage && (
        <ImageLightbox
          imageUrl={currentPage.file_url}
          imageId={currentPage.id}
          vehicleId={vehicleId}
          isOpen={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
          onNext={hasNext ? handleNextPage : undefined}
          onPrev={hasPrev ? handlePrevPage : undefined}
          canEdit={false}
          title={currentBook.title}
          description={`Page ${currentPageIndex + 1} of ${currentBook.pages.length} • ${currentBook.uploader_name}`}
        />
      )}
    </>
  );
};

export default VehicleReferenceLibrary;

