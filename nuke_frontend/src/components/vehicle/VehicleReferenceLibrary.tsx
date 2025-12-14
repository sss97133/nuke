import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import ImageLightbox from '../image/ImageLightbox';
import { ReferenceDocumentService, type ReferenceDocument } from '../../services/referenceDocumentService';

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
  userId?: string;
  year: number;
  make: string;
  series?: string | null;
  model?: string;
  bodyStyle?: string | null;
  refreshKey?: number;
}

const VehicleReferenceLibrary: React.FC<VehicleReferenceLibraryProps> = ({
  vehicleId,
  userId,
  year,
  make,
  series,
  model,
  bodyStyle,
  refreshKey
}) => {
  const [books, setBooks] = useState<ReferenceBook[]>([]);
  const [loadingFactory, setLoadingFactory] = useState(true);

  // User/Profile-library (reference_documents) state
  const [loadingUserDocs, setLoadingUserDocs] = useState(false);
  const [linkedDocs, setLinkedDocs] = useState<ReferenceDocument[]>([]);
  const [myDocs, setMyDocs] = useState<ReferenceDocument[]>([]);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const [userDocsRefreshKey, setUserDocsRefreshKey] = useState(0);
  
  // Lightbox state
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [currentBookIndex, setCurrentBookIndex] = useState(0);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);

  useEffect(() => {
    loadReferenceBooks();
  }, [year, make, series, model, bodyStyle, refreshKey]);

  const loadReferenceBooks = async () => {
    try {
      setLoadingFactory(true);
      
      // Find libraries matching this vehicle
      let libQuery = supabase
        .from('reference_libraries')
        .select('id')
        .eq('year', year)
        .eq('make', make);

      // Apply the most-specific filters when present, but don't over-constrain.
      if (series) libQuery = libQuery.eq('series', series);
      else if (model) libQuery = libQuery.eq('model', model);
      if (bodyStyle) libQuery = libQuery.eq('body_style', bodyStyle);

      const { data: libraries, error: libError } = await libQuery;

      if (libError) throw libError;
      if (!libraries || libraries.length === 0) {
        setBooks([]);
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
      const uploaderIds = [...new Set(grouped.map(b => b.uploaded_by).filter(Boolean))];
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
      setLoadingFactory(false);
    }
  };

  const normalize = (v?: string | null) => (v || '').trim().toLowerCase();

  const vehicleCtx = useMemo(() => {
    // Prefer the more-specific series if present, otherwise fall back to model.
    const seriesOrModel = series || model || null;
    return {
      year,
      make,
      series: seriesOrModel,
      bodyStyle: bodyStyle || null
    };
  }, [year, make, series, model, bodyStyle]);

  const matchesVehicle = (doc: ReferenceDocument) => {
    const makeMatch = !doc.make || normalize(doc.make) === normalize(vehicleCtx.make);
    const seriesMatch = !doc.series || !vehicleCtx.series || normalize(doc.series) === normalize(vehicleCtx.series);
    const bodyStyleMatch = !doc.body_style || !vehicleCtx.bodyStyle || normalize(doc.body_style) === normalize(vehicleCtx.bodyStyle);

    const yearExactMatch = !doc.year || doc.year === vehicleCtx.year;
    const rangeStart = doc.year_range_start ?? null;
    const rangeEnd = doc.year_range_end ?? null;
    const yearRangeMatch = rangeStart !== null && rangeEnd !== null && vehicleCtx.year >= rangeStart && vehicleCtx.year <= rangeEnd;

    return makeMatch && seriesMatch && bodyStyleMatch && (yearExactMatch || yearRangeMatch);
  };

  const docLabel = (t: string) => {
    switch (t) {
      case 'parts_catalog': return 'Parts Catalog';
      case 'service_manual': return 'Service Manual';
      case 'owners_manual': return "Owner's Manual";
      case 'brochure': return 'Brochure';
      case 'spec_sheet': return 'Spec Sheet';
      case 'wiring_diagram': return 'Wiring Diagram';
      default: return 'Document';
    }
  };

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const run = async () => {
      try {
        setLoadingUserDocs(true);
        const [linked, mine] = await Promise.all([
          ReferenceDocumentService.getVehicleDocuments(vehicleId),
          ReferenceDocumentService.getUserDocuments(userId, true)
        ]);
        if (cancelled) return;
        setLinkedDocs(linked);
        setMyDocs(mine);
      } finally {
        if (!cancelled) setLoadingUserDocs(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [userId, vehicleId, userDocsRefreshKey]);

  const linkedIds = useMemo(() => new Set(linkedDocs.map(d => d.id)), [linkedDocs]);
  const suggestedDocs = useMemo(() => {
    if (!userId) return [];
    return myDocs
      .filter((d) => !linkedIds.has(d.id))
      .filter((d) => matchesVehicle(d))
      .slice(0, 25);
  }, [userId, myDocs, linkedIds, vehicleCtx]);

  const handleLink = async (docId: string) => {
    if (!userId) return;
    try {
      setLinkingId(docId);
      await ReferenceDocumentService.linkToVehicle(docId, vehicleId, userId, 'owner');
      setUserDocsRefreshKey((v) => v + 1);
    } finally {
      setLinkingId(null);
    }
  };

  const handleUnlink = async (docId: string) => {
    if (!confirm('Unlink this document from the vehicle?')) return;
    try {
      setUnlinkingId(docId);
      await ReferenceDocumentService.unlinkFromVehicle(docId, vehicleId);
      setUserDocsRefreshKey((v) => v + 1);
    } finally {
      setUnlinkingId(null);
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
          library_id: doc.library_id,
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
            library_id: doc.library_id,
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
      case 'brochure': return 'BROCHURE';
      case 'owners_manual': return 'OWNERS MANUAL';
      case 'service_manual': return 'SERVICE MANUAL';
      case 'parts_catalog': return 'PARTS CATALOG';
      default: return 'DOCUMENT';
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

  if (loadingFactory) {
    return (
      <div className="card">
        <div className="card-body" style={{ textAlign: 'center', padding: '20px' }}>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Loading reference documents...</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <section className="section" id="reference-library-section">
        <div className="card">
          <div className="card-header">
            <h3 style={{ fontSize: '11pt', fontWeight: 700, margin: 0 }}>
              Reference Documents
            </h3>
          </div>
          <div className="card-body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '6px' }}>
                  Factory Library
                </div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '12px' }}>
                  Brochures, manuals, and parts catalogs for {year} {make} {series || model}
                </div>

                {books.length === 0 ? (
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                    No factory library docs found yet for this vehicle. Upload above to add manuals, brochures, and parts catalogs.
                  </div>
                ) : (
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
                              {book.extraction.status === 'pending_review' ? 'Processing' : 'Extracted'}
                              {book.extraction.colors && book.extraction.colors > 0 && ` • ${book.extraction.colors} colors`}
                              {book.extraction.engines && book.extraction.engines > 0 && ` • ${book.extraction.engines} engines`}
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
                )}
              </div>

              {/* Unify: show vehicle-linked + matching docs from your Profile Library (reference_documents) */}
              {userId && (
                <div>
                  <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '6px' }}>
                    Your Profile Library
                  </div>

                  {loadingUserDocs ? (
                    <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Loading...</div>
                  ) : (
                    <>
                      {linkedDocs.length === 0 && suggestedDocs.length === 0 ? (
                        <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                          No matching Profile Library docs found for this vehicle.
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          {linkedDocs.length > 0 && (
                            <div>
                              <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '6px' }}>Linked to this vehicle</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {linkedDocs.slice(0, 25).map((d) => (
                                  <div key={d.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px', alignItems: 'center' }}>
                                    <div style={{ minWidth: 0 }}>
                                      <div style={{ fontSize: '9pt', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {d.title}
                                      </div>
                                      <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                                        {docLabel(d.document_type)}
                                      </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '6px' }}>
                                      <button
                                        className="btn-utility"
                                        style={{ fontSize: '8pt' }}
                                        onClick={() => window.open(d.file_url, '_blank')}
                                      >
                                        Open
                                      </button>
                                      <button
                                        className="btn-utility"
                                        style={{ fontSize: '8pt' }}
                                        onClick={() => handleUnlink(d.id)}
                                        disabled={unlinkingId === d.id}
                                      >
                                        {unlinkingId === d.id ? 'Unlinking...' : 'Unlink'}
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {suggestedDocs.length > 0 && (
                            <div>
                              <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '6px' }}>
                                Matches ({vehicleCtx.year} {vehicleCtx.make}{vehicleCtx.series ? ` ${vehicleCtx.series}` : ''})
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {suggestedDocs.map((d) => (
                                  <div key={d.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px', alignItems: 'center' }}>
                                    <div style={{ minWidth: 0 }}>
                                      <div style={{ fontSize: '9pt', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {d.title}
                                      </div>
                                      <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                                        {docLabel(d.document_type)}
                                      </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '6px' }}>
                                      <button
                                        className="btn-utility"
                                        style={{ fontSize: '8pt' }}
                                        onClick={() => window.open(d.file_url, '_blank')}
                                      >
                                        Preview
                                      </button>
                                      <button
                                        className="button button-primary"
                                        style={{ fontSize: '8pt', padding: '6px 10px' }}
                                        onClick={() => handleLink(d.id)}
                                        disabled={linkingId === d.id}
                                      >
                                        {linkingId === d.id ? 'Linking...' : 'Link to vehicle'}
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
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

