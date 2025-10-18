import React, { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import EXIF from 'exif-js';
import { visionAPI, type TitleExtractionResult } from '../api/visionAPI';
import { secureDocumentService } from '../services/secureDocumentService';
import LiveDocumentCapture from './LiveDocumentCapture';

interface TitleScanProps {
  vehicleId?: string;
  onComplete?: (data: any) => void;
  onCancel?: () => void;
  onApply?: (
    fields: Partial<{
      vin: string;
      year: string;
      make: string;
      model: string;
      owner_name: string;
    }>,
    meta: {
      documentId?: string;
      issue_date?: string;
      odometer_status?: string;
      odometer_value?: number;
    }
  ) => void;
}

const TitleScan: React.FC<TitleScanProps> = ({ vehicleId, onApply, onComplete, onCancel }) => {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TitleExtractionResult | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [secureDocId, setSecureDocId] = useState<string | undefined>(undefined);
  const [showEnlarged, setShowEnlarged] = useState(false);
  const [imageMetadata, setImageMetadata] = useState<any>(null);
  const [showOldImageWarning, setShowOldImageWarning] = useState(false);
  const [showLiveCapture, setShowLiveCapture] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePick = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setError('File too large (max 10MB)');
      return;
    }
    setFile(f);
    setError(null);
    const url = URL.createObjectURL(f);
    setPreview(url);
    
    // Extract metadata from image
    extractImageMetadata(f);
  };

  const extractImageMetadata = (file: File) => {
    const img = new Image();
    img.onload = () => {
      // @ts-ignore - EXIF library expects image element
      EXIF.getData(img, function(this: any) {
        const allTags = EXIF.getAllTags(this);
        const dateTime = EXIF.getTag(this, 'DateTime') || EXIF.getTag(this, 'DateTimeOriginal') || EXIF.getTag(this, 'DateTimeDigitized');
        const gpsLat = EXIF.getTag(this, 'GPSLatitude');
        const gpsLon = EXIF.getTag(this, 'GPSLongitude');
        const gpsLatRef = EXIF.getTag(this, 'GPSLatitudeRef');
        const gpsLonRef = EXIF.getTag(this, 'GPSLongitudeRef');
        
        const metadata = {
          dateTime,
          gpsLat,
          gpsLon,
          gpsLatRef,
          gpsLonRef,
          allTags
        };
        
        setImageMetadata(metadata);
        
        // Check if image is older than 1 month
        if (dateTime) {
          const imageDate = new Date(dateTime.replace(/:/g, '-').replace(' ', 'T'));
          const oneMonthAgo = new Date();
          oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
          
          if (imageDate < oneMonthAgo) {
            setShowOldImageWarning(true);
          }
        }
      });
    };
    img.src = URL.createObjectURL(file);
  };

  const handleSendPrompt = async () => {
    try {
      // Generate capture link with vehicle ID
      const captureLink = `${window.location.origin}/capture-title/${vehicleId}`;

      // Implement SMS/email sending logic
      const { supabase } = await import('../lib/supabase');

      // Use Supabase Edge Function for sending notifications
      const { data, error } = await supabase.functions.invoke('send-title-capture-prompt', {
        body: {
          vehicleId,
          captureLink,
          method: 'sms', // or 'email'
          recipient: 'user-phone-or-email' // This should come from user profile
        }
      });

      if (error) {
        console.error('Failed to send capture prompt:', error);
        // Fallback: Copy link to clipboard
        await navigator.clipboard.writeText(captureLink);
        alert('Capture link copied to clipboard: ' + captureLink);
      } else {
        alert('Title capture prompt sent successfully!');
      }

      setShowLiveCapture(false);
    } catch (error) {
      console.error('Error sending prompt:', error);
      // Fallback: Show the link
      const captureLink = `${window.location.origin}/capture-title/${vehicleId}`;
      alert('Please use this link to capture title: ' + captureLink);
      setShowLiveCapture(false);
    }
  };

  const fileToBase64 = (f: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(f);
  });

  const handleScan = async () => {
    try {
      if (!file) return;
      setExtracting(true);
      setError(null);

      // Ensure user is logged in
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('Please sign in to scan and securely store title images');
        setExtracting(false);
        return;
      }

      // 1) Securely upload the title image (PII-safe)
      const { document, error: uploadErr } = await secureDocumentService.uploadSecureDocument(
        file,
        'vehicle_title',
        { vehicle_id: vehicleId }
      );
      if (uploadErr) throw new Error(uploadErr);
      setSecureDocId(document.id);

      // 2) Extract fields using AI via edge function
      const { data: extracted, error: extractError } = await supabase.functions.invoke('extract-title-data', {
        body: { image_url: document.file_path }
      });

      // If nothing came back, inform but keep secure upload
      if (!extracted || Object.keys(extracted).length === 0) {
        setResult(null);
        setError('AI scanning not configured or failed. Your document was securely uploaded for later review.');
        setExtracting(false);
        return;
      }

      setResult(extracted);

      const defaults: Record<string, boolean> = {};
      if (extracted.vin) defaults.vin = true;
      if (extracted.year) defaults.year = true;
      if (extracted.make) defaults.make = true;
      if (extracted.model) defaults.model = true;
      if (typeof extracted.odometer !== 'undefined' && extracted.odometer !== null) defaults.odometer_value = true;
      if (extracted.odometer_status) defaults.odometer_status = true;
      if (extracted.owner_names && extracted.owner_names.length > 0) defaults.owner_name = true;
      if (extracted.issue_date) defaults.issue_date = true;
      setSelected(defaults);
    } catch (e: any) {
      console.error('TitleScan error:', e);
      setError(e?.message || 'Scan failed');
    } finally {
      setExtracting(false);
    }
  };

  const applyToForm = () => {
    if (!result) return;
    const fields: Partial<{ vin: string; year: string; make: string; model: string; owner_name: string }> = {};
    if (selected.vin && result.vin) fields.vin = result.vin;
    if (selected.year && result.year) fields.year = String(result.year);
    if (selected.make && result.make) fields.make = result.make;
    if (selected.model && result.model) fields.model = result.model;
    if (selected.owner_name && result.owner_names && result.owner_names.length > 0) fields.owner_name = result.owner_names[0];

    const meta = {
      documentId: secureDocId,
      title_transfer_date: selected.issue_date ? result.issue_date : undefined,
      odometer_status: selected.odometer_status ? result.odometer_status : undefined,
      odometer_value: selected.odometer_value ? result.odometer : undefined
    };

    // Call onApply if provided (legacy)
    if (onApply) {
      onApply(fields, meta);
    }
    
    // Call onComplete if provided (new pattern)
    if (onComplete) {
      onComplete({ ...fields, ...meta });
    }
  };

  return (
    <div>
      <div className="mb-3">
        <div className="flex items-center gap-3">
          <button type="button" className="button button-secondary" onClick={handlePick}>Upload Title Image</button>
          <button type="button" className="button button-outline" onClick={() => setShowLiveCapture(true)}>Live Capture</button>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
          <button type="button" className="button button-primary" onClick={handleScan} disabled={!file || extracting}>
            {extracting ? 'Scanning…' : 'Scan Title'}
          </button>
          {onCancel && (
            <button type="button" className="button button-secondary" onClick={onCancel}>Cancel</button>
          )}
        </div>
        {preview && file && (
          <div className="mt-2" style={{ 
            border: '1px solid var(--border-medium)',
            padding: 'var(--space-2)',
            backgroundColor: 'var(--grey-100)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)'
          }}>
            <img 
              src={preview} 
              alt="Title preview" 
              style={{
                width: '40px',
                height: '40px',
                objectFit: 'cover',
                border: '1px solid var(--border-dark)',
                cursor: 'pointer'
              }}
              onClick={() => setShowEnlarged(true)}
              title="Click to enlarge"
            />
            <div style={{ flex: 1 }}>
              <div className="text" style={{ fontSize: '8pt', fontWeight: 'bold' }}>
                {file.name}
              </div>
              <div className="text-small text-muted" style={{ fontSize: '8pt' }}>
                {(file.size / 1024).toFixed(1)} KB
              </div>
            </div>
            <button 
              type="button"
              onClick={() => {
                setFile(null);
                setPreview(null);
                setImageMetadata(null);
                setShowOldImageWarning(false);
              }}
              className="button button-small"
              style={{ fontSize: '8pt', padding: '2px 6px' }}
              title="Remove"
            >
              ✕
            </button>
          </div>
        )}
        {preview && imageMetadata && (
          <div className="mt-2" style={{ 
            padding: 'var(--space-2)',
            backgroundColor: 'var(--grey-200)',
            border: '1px solid var(--border-medium)',
            fontSize: '8pt'
          }}>
            {imageMetadata.dateTime && (
              <div className="text">
                Taken: {new Date(imageMetadata.dateTime.replace(/:/g, '-').replace(' ', 'T')).toLocaleDateString()}
              </div>
            )}
            {imageMetadata.gpsLat && imageMetadata.gpsLon && (
              <div className="text">
                Location: {imageMetadata.gpsLat}, {imageMetadata.gpsLon}
              </div>
            )}
          </div>
        )}
        {preview && showOldImageWarning && (
          <div className="mt-2" style={{ 
            padding: 'var(--space-2)',
            backgroundColor: 'var(--grey-200)',
            border: '2px solid var(--grey-800)',
            fontSize: '8pt'
          }}>
            <div className="text font-bold">Old Image Detected</div>
            <div className="text text-muted" style={{ marginTop: 'var(--space-1)' }}>
              This image is over 1 month old. For verification purposes, consider taking a fresh photo.
            </div>
            <div style={{ marginTop: 'var(--space-2)', display: 'flex', gap: 'var(--space-1)' }}>
              <button 
                className="button button-primary"
                style={{ fontSize: '8pt', padding: '3px 6px' }}
                onClick={() => setShowLiveCapture(true)}
              >
                Take Fresh Photo
              </button>
              <button 
                className="button button-secondary"
                style={{ fontSize: '8pt', padding: '3px 6px' }}
                onClick={() => setShowOldImageWarning(false)}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
        {error && (
          <div className="mt-2" style={{ 
            padding: 'var(--space-2)',
            backgroundColor: 'var(--grey-200)',
            border: '2px solid var(--grey-800)',
            fontSize: '8pt'
          }}>
            {error}
          </div>
        )}
      </div>


      {result && (
        <div className="mt-3 p-3 bg-gray-50 rounded border">
          <div className="text-sm font-semibold mb-2">Detected Fields</div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!selected.vin} onChange={(e) => setSelected(s => ({ ...s, vin: e.target.checked }))} />
              <span>VIN:</span>
              <span className="font-mono">{result.vin || '—'}</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!selected.year} onChange={(e) => setSelected(s => ({ ...s, year: e.target.checked }))} />
              <span>Year:</span>
              <span>{result.year ?? '—'}</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!selected.make} onChange={(e) => setSelected(s => ({ ...s, make: e.target.checked }))} />
              <span>Make:</span>
              <span>{result.make || '—'}</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!selected.model} onChange={(e) => setSelected(s => ({ ...s, model: e.target.checked }))} />
              <span>Model:</span>
              <span>{result.model || '—'}</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!selected.odometer_value} onChange={(e) => setSelected(s => ({ ...s, odometer_value: e.target.checked }))} />
              <span>Odometer (number):</span>
              <span>{typeof result.odometer !== 'undefined' && result.odometer !== null ? result.odometer : '—'}</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!selected.odometer_status} onChange={(e) => setSelected(s => ({ ...s, odometer_status: e.target.checked }))} />
              <span>Odometer Status:</span>
              <span>{result.odometer_status || '—'}</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!selected.owner_name} onChange={(e) => setSelected(s => ({ ...s, owner_name: e.target.checked }))} />
              <span>Owner Name:</span>
              <span>{result.owner_names && result.owner_names.length > 0 ? result.owner_names[0] : '—'}</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!selected.issue_date} onChange={(e) => setSelected(s => ({ ...s, issue_date: e.target.checked }))} />
              <span>Title Transfer Date:</span>
              <span>{result.issue_date ? new Date(result.issue_date).toLocaleDateString() : '—'}</span>
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" className="button button-primary" onClick={applyToForm}>Apply to Form</button>
            {onCancel && (
              <button type="button" className="button button-secondary" onClick={onCancel}>Cancel</button>
            )}
          </div>
        </div>
      )}

      {/* Enlarged Image Modal */}
      {showEnlarged && preview && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50"
          onClick={() => setShowEnlarged(false)}
        >
          <div className="relative max-w-2xl max-h-[80vh] p-4">
            <img 
              src={preview} 
              alt="Enlarged title" 
              className="max-w-full max-h-full object-contain rounded cursor-pointer"
              onClick={() => setShowEnlarged(false)}
            />
            <button
              onClick={() => setShowEnlarged(false)}
              className="absolute top-2 right-2 bg-white bg-opacity-80 hover:bg-opacity-100 rounded-full p-1 text-gray-700 hover:text-gray-900 text-xs"
              title="Close"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      
      {/* Live Document Capture Modal */}
      {showLiveCapture && (
        <LiveDocumentCapture
          onSendPrompt={handleSendPrompt}
          onCancel={() => setShowLiveCapture(false)}
        />
      )}
    </div>
  );
};

export default TitleScan;
