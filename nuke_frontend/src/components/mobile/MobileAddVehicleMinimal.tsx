import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

/**
 * Mobile Add Vehicle - MINIMAL & FUNCTIONAL
 * 
 * Philosophy: Just paste URL or take photos. That's it.
 * No complex forms, no overwhelming fields.
 */

interface Props {
  onClose?: () => void;
  onSuccess?: (vehicleId: string) => void;
}

export default function MobileAddVehicleMinimal({ onClose, onSuccess }: Props) {
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  const [step, setStep] = useState<'input' | 'review' | 'uploading'>('input');
  const [scrapedData, setScrapedData] = useState<any>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const handleUrlSubmit = async () => {
    if (!url.trim()) return;
    
    setProcessing(true);
    try {
      // Scrape URL
      const { data, error } = await supabase.functions.invoke('scrape-vehicle', {
        body: { url }
      });

      if (error) throw error;
      if (!data.success) throw new Error('Scraping failed');

      setScrapedData(data.data);
      setStep('review');
    } catch (error: any) {
      alert('Failed to import: ' + error.message);
    } finally {
      setProcessing(false);
    }
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setPhotos(Array.from(e.target.files));
      setStep('review');
    }
  };

  const handleCreate = async () => {
    setProcessing(true);
    setStep('uploading');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Please sign in');

      // Create vehicle with scraped data
      const vehicleData: Record<string, any> = {
        make: scrapedData?.make || null,
        model: scrapedData?.model || null,
        year: scrapedData?.year ? parseInt(scrapedData.year, 10) : null,
        vin: scrapedData?.vin || null,
        mileage: scrapedData?.mileage
          ? parseInt(String(scrapedData.mileage).replace(/,/g, ''), 10)
          : null,
        engine_size: scrapedData?.engine_size || null,
        drivetrain: scrapedData?.drivetrain || null,
        transmission: scrapedData?.transmission || null,
        fuel_type: scrapedData?.fuel_type || null,
        color: scrapedData?.color || null,
        asking_price: scrapedData?.asking_price || scrapedData?.price || null,
        discovery_url: url || null,
        discovery_source: 'user_import',
        relationship_type: 'discovered',
        notes: scrapedData?.description || null,
        is_public: true,
        user_id: user.id
      };

      if (scrapedData?.source === 'Bring a Trailer') {
        vehicleData.bat_auction_url = url;
        vehicleData.bat_listing_title = scrapedData.title || null;
      }

      const { data: vehicle, error: vehicleError } = await supabase
        .from('vehicles')
        .insert([vehicleData])
        .select()
        .single();

      if (vehicleError) throw vehicleError;

      // Upload photos if any
      if (photos.length > 0) {
        for (const photo of photos) {
          const fileExt = photo.name.split('.').pop();
          const fileName = `${vehicle.id}/${Date.now()}.${fileExt}`;

          const { error: uploadError } = await supabase.storage
            .from('vehicle-images')
            .upload(fileName, photo);

          if (uploadError) throw uploadError;

          const { data: { publicUrl } } = supabase.storage
            .from('vehicle-images')
            .getPublicUrl(fileName);

          await supabase.from('vehicle_images').insert({
            vehicle_id: vehicle.id,
            image_url: publicUrl,
            user_id: user.id,
            category: 'general'
          });
        }
      }

      // Success!
      if (onSuccess) {
        onSuccess(vehicle.id);
      } else {
        navigate(`/vehicle/${vehicle.id}`);
      }
      if (onClose) onClose();

    } catch (error: any) {
      alert('Failed to create vehicle: ' + error.message);
      setStep('review');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#000',
      color: '#fff',
      zIndex: 9999,
      overflow: 'auto'
    }}>
      {/* Header */}
      <div style={{
        position: 'sticky',
        top: 0,
        background: '#000',
        borderBottom: '1px solid #333',
        padding: '16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <button
          onClick={onClose || (() => navigate(-1))}
          style={{
            background: 'none',
            border: 'none',
            color: '#fff',
            fontSize: '24px',
            cursor: 'pointer'
          }}
        >
          ×
        </button>
        <h1 style={{ fontSize: '17px', fontWeight: 600, margin: 0 }}>
          Add Vehicle
        </h1>
        <div style={{ width: '24px' }} />
      </div>

      {/* Input Step */}
      {step === 'input' && (
        <div style={{ padding: '24px' }}>
          <div style={{ fontSize: '15px', color: '#999', marginBottom: '24px', textAlign: 'center' }}>
            Paste a URL or take photos
          </div>

          {/* URL Input */}
          <div style={{ marginBottom: '24px' }}>
            <input
              type="text"
              placeholder="Paste Craigslist, BaT, or any vehicle URL..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              style={{
                width: '100%',
                padding: '16px',
                fontSize: '15px',
                background: '#1a1a1a',
                border: '1px solid #333',
                borderRadius: '12px',
                color: '#fff'
              }}
            />
            <button
              onClick={handleUrlSubmit}
              disabled={!url.trim() || processing}
              style={{
                width: '100%',
                marginTop: '12px',
                padding: '16px',
                background: url.trim() && !processing ? '#fff' : '#333',
                color: url.trim() && !processing ? '#000' : '#666',
                border: 'none',
                borderRadius: '12px',
                fontSize: '15px',
                fontWeight: 600,
                cursor: url.trim() && !processing ? 'pointer' : 'not-allowed'
              }}
            >
              {processing ? 'Scraping...' : 'Import from URL'}
            </button>
          </div>

          {/* OR Divider */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            margin: '32px 0'
          }}>
            <div style={{ flex: 1, height: '1px', background: '#333' }} />
            <div style={{ color: '#666', fontSize: '13px' }}>OR</div>
            <div style={{ flex: 1, height: '1px', background: '#333' }} />
          </div>

          {/* Photo Upload */}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            multiple
            capture="environment"
            style={{ display: 'none' }}
            onChange={handlePhotoSelect}
          />
          
          <button
            onClick={() => photoInputRef.current?.click()}
            style={{
              width: '100%',
              padding: '48px',
              background: '#1a1a1a',
              border: '2px dashed #333',
              borderRadius: '12px',
              color: '#999',
              fontSize: '15px',
              cursor: 'pointer',
              textAlign: 'center'
            }}
          >
            <div style={{ fontSize: '18px', marginBottom: '12px' }}>Add Photos</div>
            <div>Capture from camera or pick from gallery</div>
          </button>
        </div>
      )}

      {/* Review Step */}
      {step === 'review' && scrapedData && (
        <div style={{ padding: '24px' }}>
          <div style={{ fontSize: '15px', marginBottom: '24px' }}>
            Review imported data:
          </div>

          {/* Auto-Filled Data */}
          <div style={{
            background: '#1a1a1a',
            borderRadius: '12px',
            padding: '16px',
            marginBottom: '24px'
          }}>
            {scrapedData.year && (
              <div style={{ marginBottom: '12px', fontSize: '15px' }}>
                <span style={{ color: '#666' }}>Year:</span>{' '}
                <span style={{ fontWeight: 600 }}>{scrapedData.year}</span>
              </div>
            )}
            {scrapedData.make && (
              <div style={{ marginBottom: '12px', fontSize: '15px' }}>
                <span style={{ color: '#666' }}>Make:</span>{' '}
                <span style={{ fontWeight: 600 }}>{scrapedData.make}</span>
              </div>
            )}
            {scrapedData.model && (
              <div style={{ marginBottom: '12px', fontSize: '15px' }}>
                <span style={{ color: '#666' }}>Model:</span>{' '}
                <span style={{ fontWeight: 600 }}>{scrapedData.model}</span>
              </div>
            )}
            {scrapedData.mileage && (
              <div style={{ marginBottom: '12px', fontSize: '15px' }}>
                <span style={{ color: '#666' }}>Mileage:</span>{' '}
                <span style={{ fontWeight: 600 }}>{scrapedData.mileage.toLocaleString()}</span>
              </div>
            )}
            {scrapedData.asking_price && (
              <div style={{ marginBottom: '12px', fontSize: '15px' }}>
                <span style={{ color: '#666' }}>Price:</span>{' '}
                <span style={{ fontWeight: 600, color: '#00c805' }}>
                  ${Number(scrapedData.asking_price).toLocaleString()}
                </span>
              </div>
            )}
            <div style={{ fontSize: '13px', color: '#666', marginTop: '16px' }}>
              +{Object.keys(scrapedData).length - 3} more fields
            </div>
          </div>

          <button
            onClick={handleCreate}
            disabled={processing}
            style={{
              width: '100%',
              padding: '16px',
              background: '#fff',
              color: '#000',
              border: 'none',
              borderRadius: '12px',
              fontSize: '15px',
              fontWeight: 600,
              cursor: processing ? 'wait' : 'pointer'
            }}
          >
            {processing ? 'Creating...' : 'Create Vehicle'}
          </button>

          <button
            onClick={() => {
              setStep('input');
              setScrapedData(null);
              setUrl('');
            }}
            style={{
              width: '100%',
              marginTop: '12px',
              padding: '16px',
              background: 'none',
              color: '#fff',
              border: '1px solid #333',
              borderRadius: '12px',
              fontSize: '15px',
              cursor: 'pointer'
            }}
          >
            Start Over
          </button>
        </div>
      )}

      {/* Uploading Step */}
      {step === 'uploading' && (
        <div style={{
          padding: '24px',
          textAlign: 'center',
          paddingTop: '120px'
        }}>
          <div style={{ fontSize: '17px', fontWeight: 600, marginBottom: '12px' }}>
            Creating vehicle...
          </div>
          <div style={{ fontSize: '15px', color: '#666' }}>
            Uploading photos and saving data
          </div>
        </div>
      )}
    </div>
  );
}

