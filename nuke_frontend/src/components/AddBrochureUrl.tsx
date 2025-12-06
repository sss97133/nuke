import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useToast } from '../hooks/useToast';

const AddBrochureUrl: React.FC = () => {
  const [url, setUrl] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const { showToast } = useToast();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent AI ingestion from intercepting
    if (!url.trim()) return;

    // Validate it's a PDF URL
    const urlLower = url.toLowerCase();
    if (!urlLower.includes('.pdf') && !urlLower.includes('pdf') && !urlLower.includes('document')) {
      showToast('Please paste a PDF document URL', 'error');
      return;
    }

    setUploading(true);
    try {
      // Get or create general library
      let { data: library } = await supabase
        .from('reference_libraries')
        .select('id')
        .eq('year', 2024)
        .eq('make', 'General')
        .eq('series', 'All')
        .eq('body_style', 'All')
        .single();

      if (!library) {
        const { data: newLibrary } = await supabase
          .from('reference_libraries')
          .insert({
            year: 2024,
            make: 'General',
            series: 'All',
            body_style: 'All',
            description: 'General material catalogs and TDS sheets'
          })
          .select()
          .single();
        library = newLibrary;
      }

      if (!library) throw new Error('Failed to create library');

      // Get current user
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        showToast('Please log in to add documents', 'error');
        return;
      }

      // Extract filename from URL
      const urlPath = new URL(url).pathname;
      const filename = urlPath.split('/').pop() || 'document.pdf';
      const title = filename.replace(/\.(pdf|zip)$/i, '').replace(/[-_]/g, ' ');

      // Detect document type from URL/filename
      let documentType = 'brochure';
      const lowerUrl = url.toLowerCase();
      const lowerFilename = filename.toLowerCase();
      
      if (lowerUrl.includes('tds') || lowerFilename.includes('tds')) {
        documentType = 'tds';
      } else if (lowerUrl.includes('catalog') || lowerFilename.includes('catalog')) {
        documentType = 'material_manual';
      } else if (lowerUrl.includes('manual') || lowerFilename.includes('manual')) {
        documentType = 'service_manual';
      }

      // Detect brand from URL
      let brand: string | null = null;
      if (lowerUrl.includes('3m') || lowerFilename.includes('3m')) brand = '3M';
      else if (lowerUrl.includes('ppg')) brand = 'PPG';
      else if (lowerUrl.includes('basf')) brand = 'BASF';
      else if (lowerUrl.includes('snap-on') || lowerUrl.includes('snapon')) brand = 'Snap-on';
      else if (lowerUrl.includes('car-o-liner') || lowerUrl.includes('caroliner')) brand = 'Car-O-Liner';

      // Check if document already exists (duplicate detection)
      const { data: existingDoc } = await supabase
        .from('library_documents')
        .select('id, title, document_type')
        .eq('file_url', url)
        .single();

      if (existingDoc) {
        // Check if it's already indexed
        const { data: chunks } = await supabase
          .from('document_chunks')
          .select('id')
          .eq('document_id', existingDoc.id)
          .limit(1);

        const isIndexed = chunks && chunks.length > 0;
        
        showToast(
          `Document already exists: ${existingDoc.title}${isIndexed ? ' (indexed)' : ''}. Opening library...`,
          'info'
        );
        
        // Navigate to library page after a short delay
        setTimeout(() => {
          navigate('/library');
        }, 1000);
        
        setUrl('');
        setIsOpen(false);
        return;
      }

      // Insert document
      const { data: doc, error } = await supabase
        .from('library_documents')
        .insert({
          library_id: library.id,
          document_type: documentType,
          title: title,
          description: `Added from URL: ${url}`,
          file_url: url,
          tags: brand ? [brand.toLowerCase()] : [],
          metadata: {
            brand: brand,
            uploaded_via: 'url_paste',
            source_url: url
          },
          uploaded_by: session.user.id
        })
        .select()
        .single();

      if (error) throw error;

      showToast(`Added ${documentType}: ${title}`, 'success');
      setUrl('');
      setIsOpen(false);

      // Auto-index if it's a material_manual or tds
      if (documentType === 'material_manual' || documentType === 'tds') {
        // Check if chunks already exist (shouldn't happen for new doc, but safety check)
        const { data: existingChunks } = await supabase
          .from('document_chunks')
          .select('id')
          .eq('document_id', doc.id)
          .limit(1);

        if (!existingChunks || existingChunks.length === 0) {
          // Trigger indexing in background
          supabase.functions.invoke('index-service-manual', {
            body: { document_id: doc.id, mode: 'full' }
          }).catch(err => console.error('Indexing error:', err));
        } else {
          console.log('Document already indexed, skipping');
        }
      }
    } catch (error: any) {
      console.error('Error adding brochure:', error);
      showToast(error.message || 'Failed to add document', 'error');
    } finally {
      setUploading(false);
    }
  };

  if (!isOpen) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          background: 'var(--white)',
          border: '2px solid var(--border)',
          padding: '4px 6px',
          height: '28px',
          transition: '0.12s',
          cursor: 'pointer'
        }}
        onClick={() => setIsOpen(true)}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--primary)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--border)';
        }}
      >
        <span style={{ fontSize: '10pt' }}>📄</span>
        <span style={{ fontSize: '8pt', whiteSpace: 'nowrap' }}>Add Docs</span>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      onClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        background: 'var(--white)',
        border: '2px solid var(--border)',
        padding: '4px 6px',
        height: '28px',
        transition: '0.12s',
        position: 'relative',
        zIndex: 1000
      }}
      onBlur={(e) => {
        // Close if clicking outside
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setTimeout(() => setIsOpen(false), 200);
        }
      }}
    >
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onPaste={(e) => {
          // Stop propagation to prevent AI ingestion from intercepting
          e.stopPropagation();
        }}
        onClick={(e) => e.stopPropagation()}
        placeholder="Paste PDF URL..."
        autoFocus
        disabled={uploading}
        style={{
          border: 'none',
          outline: 'none',
          background: 'transparent',
          fontSize: '8pt',
          width: '200px',
          padding: '0 4px'
        }}
      />
      <button
        type="submit"
        disabled={uploading || !url.trim()}
        style={{
          border: 'none',
          background: uploading ? 'var(--grey-300)' : 'var(--primary)',
          color: 'white',
          padding: '2px 6px',
          fontSize: '8pt',
          cursor: uploading || !url.trim() ? 'not-allowed' : 'pointer',
          borderRadius: '2px',
          transition: '0.12s'
        }}
      >
        {uploading ? '...' : 'GO'}
      </button>
      <button
        type="button"
        onClick={() => {
          setIsOpen(false);
          setUrl('');
        }}
        style={{
          border: 'none',
          background: 'transparent',
          padding: '2px 4px',
          cursor: 'pointer',
          fontSize: '8pt'
        }}
      >
        ✕
      </button>
    </form>
  );
};

export default AddBrochureUrl;

