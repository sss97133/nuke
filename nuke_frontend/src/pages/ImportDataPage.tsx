/**
 * Import Data Page
 *
 * Universal data import interface for all file types:
 * - Images (vehicle photos, receipts, documents)
 * - Spreadsheets (CSV, XLSX, Numbers)
 * - PDFs (service records, titles, registrations)
 * - URLs (paste a link to extract)
 *
 * Route: /import
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, getSupabaseFunctionsUrl } from '../lib/supabase';

interface FileUpload {
  id: string;
  file: File;
  preview?: string;
  status: 'pending' | 'uploading' | 'processing' | 'complete' | 'error';
  progress: number;
  result?: any;
  error?: string;
}

interface ExtractedVehicle {
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  mileage?: number;
  price?: number;
  color?: string;
  description?: string;
}

export default function ImportDataPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [uploads, setUploads] = useState<FileUpload[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const [urlProcessing, setUrlProcessing] = useState(false);
  const [extractedVehicles, setExtractedVehicles] = useState<ExtractedVehicle[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<'files' | 'url' | 'results'>('files');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);
      setLoading(false);
      if (!session) {
        navigate('/login');
      }
    };
    getSession();
  }, [navigate]);

  // Handle drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    addFiles(files);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    addFiles(files);
  };

  const addFiles = (files: File[]) => {
    const newUploads: FileUpload[] = files.map(file => ({
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      file,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
      status: 'pending',
      progress: 0,
    }));
    setUploads(prev => [...prev, ...newUploads]);
  };

  const removeFile = (id: string) => {
    setUploads(prev => {
      const upload = prev.find(u => u.id === id);
      if (upload?.preview) {
        URL.revokeObjectURL(upload.preview);
      }
      return prev.filter(u => u.id !== id);
    });
  };

  const uploadFile = async (upload: FileUpload) => {
    setUploads(prev => prev.map(u =>
      u.id === upload.id ? { ...u, status: 'uploading', progress: 10 } : u
    ));

    try {
      const formData = new FormData();
      formData.append('file', upload.file);
      formData.append('process_immediately', 'true');

      const token = (await supabase.auth.getSession()).data.session?.access_token;

      const response = await fetch(`${getSupabaseFunctionsUrl()}/process-file-upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      setUploads(prev => prev.map(u =>
        u.id === upload.id ? { ...u, progress: 80 } : u
      ));

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Upload failed');
      }

      setUploads(prev => prev.map(u =>
        u.id === upload.id ? { ...u, status: 'complete', progress: 100, result } : u
      ));

      // If vehicles were extracted, add them to results
      if (result.extractedData?.vehicles) {
        setExtractedVehicles(prev => [...prev, ...result.extractedData.vehicles]);
        setActiveTab('results');
      }

    } catch (error: any) {
      console.error('Upload error:', error);
      setUploads(prev => prev.map(u =>
        u.id === upload.id ? { ...u, status: 'error', error: error.message } : u
      ));
    }
  };

  const uploadAll = async () => {
    const pending = uploads.filter(u => u.status === 'pending');
    for (const upload of pending) {
      await uploadFile(upload);
    }
  };

  const processUrl = async () => {
    if (!urlInput.trim()) return;

    setUrlProcessing(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;

      // Call the URL drop processor
      const response = await fetch(`${getSupabaseFunctionsUrl()}/process-url-drop`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: urlInput.trim() }),
      });

      const result = await response.json();

      if (result.success && result.data) {
        setExtractedVehicles(prev => [...prev, result.data]);
        setActiveTab('results');
        setUrlInput('');
      }
    } catch (error: any) {
      console.error('URL processing error:', error);
      alert(`Failed to process URL: ${error.message}`);
    } finally {
      setUrlProcessing(false);
    }
  };

  const createVehicle = async (vehicle: ExtractedVehicle, index: number) => {
    try {
      const { data, error } = await supabase
        .from('vehicles')
        .insert({
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          vin: vehicle.vin,
          mileage: vehicle.mileage,
          sale_price: vehicle.price,
          exterior_color: vehicle.color,
          description: vehicle.description,
          owner_id: session?.user?.id,
          is_public: false,
        })
        .select()
        .single();

      if (error) throw error;

      // Remove from extracted list
      setExtractedVehicles(prev => prev.filter((_, i) => i !== index));

      // Navigate to the new vehicle
      if (data?.id) {
        navigate(`/vehicle/${data.id}`);
      }
    } catch (error: any) {
      console.error('Create vehicle error:', error);
      alert(`Failed to create vehicle: ${error.message}`);
    }
  };

  const getFileIcon = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (file.type.startsWith('image/')) return '[ IMG ]';
    if (ext === 'pdf') return '[ PDF ]';
    if (['csv', 'xlsx', 'xls', 'numbers'].includes(ext || '')) return '[ XLS ]';
    if (['doc', 'docx', 'txt', 'rtf'].includes(ext || '')) return '[ DOC ]';
    return '[ FILE ]';
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', paddingTop: '100px' }}>
          <p style={{ fontSize: '10pt', color: 'var(--text-muted)' }}>Loading...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontSize: '14pt', marginBottom: '8px', color: 'var(--text)' }}>
            Import Data
          </h1>
          <p style={{ fontSize: '10pt', color: 'var(--text-muted)' }}>
            Drop files or paste URLs to import vehicle data. Supports images, spreadsheets, PDFs, and web links.
          </p>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
          <button
            onClick={() => setActiveTab('files')}
            style={{
              background: activeTab === 'files' ? 'var(--accent)' : 'transparent',
              color: activeTab === 'files' ? 'var(--bg)' : 'var(--text)',
              border: '1px solid var(--border)',
              padding: '8px 16px',
              fontSize: '10pt',
              cursor: 'pointer',
            }}
          >
            Files ({uploads.length})
          </button>
          <button
            onClick={() => setActiveTab('url')}
            style={{
              background: activeTab === 'url' ? 'var(--accent)' : 'transparent',
              color: activeTab === 'url' ? 'var(--bg)' : 'var(--text)',
              border: '1px solid var(--border)',
              padding: '8px 16px',
              fontSize: '10pt',
              cursor: 'pointer',
            }}
          >
            URL
          </button>
          {extractedVehicles.length > 0 && (
            <button
              onClick={() => setActiveTab('results')}
              style={{
                background: activeTab === 'results' ? 'var(--accent)' : 'transparent',
                color: activeTab === 'results' ? 'var(--bg)' : 'var(--text)',
                border: '1px solid var(--border)',
                padding: '8px 16px',
                fontSize: '10pt',
                cursor: 'pointer',
              }}
            >
              Results ({extractedVehicles.length})
            </button>
          )}
        </div>

        {/* File Upload Tab */}
        {activeTab === 'files' && (
          <>
            {/* Drop Zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${isDragging ? 'var(--accent)' : 'var(--border)'}`,
                background: isDragging ? 'rgba(0, 255, 0, 0.05)' : 'var(--bg-secondary)',
                padding: '48px',
                textAlign: 'center',
                cursor: 'pointer',
                marginBottom: '16px',
                transition: 'all 0.2s',
              }}
            >
              <div style={{ fontSize: '24px', marginBottom: '12px' }}>
                {isDragging ? '[ DROP HERE ]' : '[ + ]'}
              </div>
              <div style={{ fontSize: '10pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
                Drop files here or click to browse
              </div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
                Images, PDFs, CSV, XLSX, Numbers files supported
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileSelect}
                accept="image/*,.pdf,.csv,.xlsx,.xls,.numbers,.doc,.docx,.txt"
                style={{ display: 'none' }}
              />
            </div>

            {/* File List */}
            {uploads.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontSize: '10pt', color: 'var(--text-muted)' }}>
                    {uploads.length} file(s) selected
                  </span>
                  <button
                    onClick={uploadAll}
                    disabled={!uploads.some(u => u.status === 'pending')}
                    style={{
                      background: 'var(--accent)',
                      color: 'var(--bg)',
                      border: 'none',
                      padding: '8px 16px',
                      fontSize: '10pt',
                      cursor: 'pointer',
                      opacity: uploads.some(u => u.status === 'pending') ? 1 : 0.5,
                    }}
                  >
                    Upload All
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {uploads.map(upload => (
                    <div
                      key={upload.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '12px',
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      {/* Preview or Icon */}
                      {upload.preview ? (
                        <img
                          src={upload.preview}
                          alt=""
                          style={{ width: '48px', height: '48px', objectFit: 'cover' }}
                        />
                      ) : (
                        <div style={{
                          width: '48px',
                          height: '48px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'var(--bg)',
                          fontSize: '8pt',
                          fontFamily: 'monospace',
                          color: 'var(--accent)',
                        }}>
                          {getFileIcon(upload.file)}
                        </div>
                      )}

                      {/* File Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: '10pt',
                          color: 'var(--text)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {upload.file.name}
                        </div>
                        <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
                          {formatFileSize(upload.file.size)}
                        </div>
                      </div>

                      {/* Status */}
                      <div style={{ fontSize: '9pt', textAlign: 'right' }}>
                        {upload.status === 'pending' && (
                          <span style={{ color: 'var(--text-muted)' }}>Pending</span>
                        )}
                        {upload.status === 'uploading' && (
                          <span style={{ color: 'var(--accent)' }}>
                            Uploading... {upload.progress}%
                          </span>
                        )}
                        {upload.status === 'processing' && (
                          <span style={{ color: 'var(--accent)' }}>Processing...</span>
                        )}
                        {upload.status === 'complete' && (
                          <span style={{ color: 'var(--success, #4caf50)' }}>Complete</span>
                        )}
                        {upload.status === 'error' && (
                          <span style={{ color: 'var(--error, #f44336)' }}>
                            Error: {upload.error}
                          </span>
                        )}
                      </div>

                      {/* Remove Button */}
                      <button
                        onClick={() => removeFile(upload.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                          padding: '4px',
                          fontSize: '14pt',
                        }}
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* URL Tab */}
        {activeTab === 'url' && (
          <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', padding: '24px' }}>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '10pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
                Paste a URL to extract vehicle data
              </label>
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://bringatrailer.com/listing/..."
                style={{
                  width: '100%',
                  padding: '12px',
                  fontSize: '10pt',
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                }}
              />
            </div>
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Supported: Bring a Trailer, Cars & Bids, Hagerty, Craigslist, eBay, and many more
            </div>
            <button
              onClick={processUrl}
              disabled={urlProcessing || !urlInput.trim()}
              style={{
                background: 'var(--accent)',
                color: 'var(--bg)',
                border: 'none',
                padding: '12px 24px',
                fontSize: '10pt',
                cursor: 'pointer',
                opacity: urlProcessing || !urlInput.trim() ? 0.5 : 1,
              }}
            >
              {urlProcessing ? 'Processing...' : 'Extract Data'}
            </button>
          </div>
        )}

        {/* Results Tab */}
        {activeTab === 'results' && extractedVehicles.length > 0 && (
          <div>
            <div style={{ marginBottom: '16px', fontSize: '10pt', color: 'var(--text-muted)' }}>
              Review extracted vehicles and create profiles
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {extractedVehicles.map((vehicle, index) => (
                <div
                  key={index}
                  style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    padding: '16px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: '12pt', fontWeight: 'bold', marginBottom: '8px' }}>
                        {vehicle.year} {vehicle.make} {vehicle.model}
                      </div>
                      <div style={{ fontSize: '10pt', color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
                        {vehicle.vin && <span>VIN: {vehicle.vin}</span>}
                        {vehicle.mileage && <span>{vehicle.mileage.toLocaleString()} miles</span>}
                        {vehicle.price && <span>${vehicle.price.toLocaleString()}</span>}
                        {vehicle.color && <span>{vehicle.color}</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => createVehicle(vehicle, index)}
                        style={{
                          background: 'var(--accent)',
                          color: 'var(--bg)',
                          border: 'none',
                          padding: '8px 16px',
                          fontSize: '10pt',
                          cursor: 'pointer',
                        }}
                      >
                        Create Vehicle
                      </button>
                      <button
                        onClick={() => setExtractedVehicles(prev => prev.filter((_, i) => i !== index))}
                        style={{
                          background: 'transparent',
                          color: 'var(--text-muted)',
                          border: '1px solid var(--border)',
                          padding: '8px 16px',
                          fontSize: '10pt',
                          cursor: 'pointer',
                        }}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Help Text */}
        <div style={{
          marginTop: '32px',
          padding: '16px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          fontSize: '9pt',
          color: 'var(--text-muted)',
        }}>
          <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>Supported file types:</div>
          <ul style={{ margin: 0, paddingLeft: '20px' }}>
            <li><strong>Images</strong> - JPG, PNG, HEIC - Vehicle photos, receipts, documents</li>
            <li><strong>Spreadsheets</strong> - CSV, XLSX, Numbers - Bulk vehicle data</li>
            <li><strong>PDFs</strong> - Service records, titles, registrations</li>
            <li><strong>URLs</strong> - Auction listings, classified ads, dealer inventory</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
