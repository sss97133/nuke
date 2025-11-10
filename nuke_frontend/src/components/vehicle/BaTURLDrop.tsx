/**
 * BaT URL Drop Component
 * Paste a BaT listing URL and automatically:
 * - Scrape all data (VIN, specs, price, images)
 * - Download images and attribute to BaT/seller
 * - Backfill vehicle profile
 * - Track attribution: who added the BaT data
 */

import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { listingURLParser } from '../../services/listingURLParser';

interface BaTURLDropProps {
  vehicleId: string;
  canEdit: boolean;
  onDataImported?: () => void;
}

export const BaTURLDrop: React.FC<BaTURLDropProps> = ({
  vehicleId,
  canEdit,
  onDataImported
}) => {
  const [url, setUrl] = useState('');
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  if (!canEdit) return null;

  const handleParse = async () => {
    if (!url.trim()) return;
    
    setParsing(true);
    setError('');
    setPreview(null);
    setProgress('Importing complete BaT data with AI...');

    try {
      // Use complete import function (GPT-4 powered)
      const { data, error } = await supabase.functions.invoke('complete-bat-import', {
        body: { bat_url: url, vehicle_id: vehicleId }
      });
      
      if (error) throw error;
      if (!data?.success) throw new Error('Import failed');
      
      // Show success summary
      setProgress(`✅ Imported: ${data.imported.timeline_events} events, ${data.imported.modifications} mods, ${data.imported.specs_updated} specs`);
      
      // Refresh page after 2 seconds to show new data
      setTimeout(() => {
        if (onDataImported) onDataImported();
        window.location.reload();
      }, 2000);
      
    } catch (err: any) {
      console.error('Import error:', err);
      setError(err.message || 'Failed to import listing');
      setProgress('');
    } finally {
      setParsing(false);
    }
  };

  const handleImport = async () => {
    if (!preview) return;

    setImporting(true);
    setError('');
    setProgress('Starting import...');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        throw new Error('You must be logged in');
      }

      // Step 1: Update vehicle data
      setProgress('Updating vehicle data...');
      const updates: any = {};
      if (preview.vin) updates.vin = preview.vin;
      if (preview.year) updates.year = preview.year;
      if (preview.make) updates.make = preview.make;
      if (preview.model) updates.model = preview.model;
      if (preview.trim) updates.trim = preview.trim;
      if (preview.mileage) updates.mileage = preview.mileage;
      
      if (Object.keys(updates).length > 0) {
        const { error: updateError } = await supabase
          .from('vehicles')
          .update(updates)
          .eq('id', vehicleId);

        if (updateError) throw updateError;
      }

      // Step 2: Track field sources
      setProgress('Recording data attribution...');
      const fieldsToTrack = Object.keys(updates);
      for (const fieldName of fieldsToTrack) {
        await supabase
          .from('vehicle_field_sources')
          .upsert({
            vehicle_id: vehicleId,
            field_name: fieldName,
            source_type: 'user_input',
            source_user_id: user.id,
            source_url: url,
            confidence_score: 95,
            entered_at: new Date().toISOString()
          }, {
            onConflict: 'vehicle_id,field_name'
          });
      }

      // Step 3: Download and import images
      if (preview.images && preview.images.length > 0) {
        setProgress(`Downloading ${preview.images.length} images from BaT...`);
        
        let successCount = 0;
        for (let i = 0; i < preview.images.length; i++) {
          const imageUrl = preview.images[i];
          setProgress(`Downloading image ${i + 1}/${preview.images.length}...`);
          
          try {
            // Download image
            const response = await fetch(imageUrl);
            if (!response.ok) continue;
            
            const blob = await response.blob();
            
            // Upload to Supabase storage
            const fileExt = imageUrl.split('.').pop()?.split('?')[0] || 'jpg';
            const fileName = `bat_${Date.now()}_${i}.${fileExt}`;
            const storagePath = `vehicles/${vehicleId}/bat/${fileName}`;

            const { error: uploadError } = await supabase.storage
              .from('vehicle-data')
              .upload(storagePath, blob);

            if (uploadError) {
              console.error(`Upload error for image ${i}:`, uploadError);
              continue;
            }

            // Get public URL
            const publicUrl = supabase.storage
              .from('vehicle-data')
              .getPublicUrl(storagePath).data.publicUrl;

            // Insert into vehicle_images
            // Use auction end date as taken_at (best guess until photographer claims)
            const takenAt = preview.sold_date || new Date().toISOString();
            
            const { data: imageData, error: insertError } = await supabase
              .from('vehicle_images')
              .insert({
                vehicle_id: vehicleId,
                user_id: user.id, // Importer (Skylar)
                image_url: publicUrl,
                category: 'exterior',
                source: 'bat_listing',
                taken_at: takenAt,
                exif_data: {
                  source_url: imageUrl,
                  bat_listing: url,
                  imported_by_user_id: user.id,
                  imported_by_name: 'Skylar Williams',
                  imported_at: new Date().toISOString(),
                  bat_seller: preview.seller,
                  attribution_note: 'Photographer unknown - images from BaT listing. Original photographer can claim with proof.',
                  claimable: true
                }
              })
              .select('id')
              .single();

            if (!insertError && imageData) {
              // Create ghost user for unknown BaT photographer
              // This allows future claiming when photographer shows up with proof
              const photographerFingerprint = `BaT-Photographer-${preview.seller || 'Unknown'}-${url}`;
              
              // Get or create ghost user for the photographer
              const { data: ghostUser } = await supabase
                .from('ghost_users')
                .select('id')
                .eq('device_fingerprint', photographerFingerprint)
                .single();

              let ghostUserId = ghostUser?.id;

              if (!ghostUserId) {
                const { data: newGhost } = await supabase
                  .from('ghost_users')
                  .insert({
                    device_fingerprint: photographerFingerprint,
                    camera_make: 'Unknown',
                    camera_model: 'BaT Listing',
                    display_name: `BaT Photographer (${preview.seller || 'Unknown'})`,
                    total_contributions: 0
                  })
                  .select('id')
                  .single();
                
                ghostUserId = newGhost?.id;
              }

              // Create device attribution
              await supabase
                .from('device_attributions')
                .insert({
                  image_id: imageData.id,
                  device_fingerprint: photographerFingerprint,
                  ghost_user_id: ghostUserId,
                  uploaded_by_user_id: user.id, // Skylar = importer
                  attribution_source: 'bat_listing_unknown_photographer',
                  confidence_score: 50 // Low confidence - we don't know who took it
                });

              successCount++;
            }
          } catch (imgErr) {
            console.error(`Error importing image ${i}:`, imgErr);
          }
        }

        setProgress(`Imported ${successCount}/${preview.images.length} images`);
      }

      // Step 4: Create timeline event
      setProgress('Creating timeline event...');
      await supabase
        .from('timeline_events')
        .insert({
          vehicle_id: vehicleId,
          user_id: user.id,
          event_type: 'data_import',
          source: 'bat_listing',
          title: `Imported BaT data: ${preview.year} ${preview.make} ${preview.model}`,
          event_date: preview.sold_date || new Date().toISOString(),
          metadata: {
            bat_url: url,
            imported_fields: fieldsToTrack,
            images_imported: preview.images?.length || 0,
            sold_price: preview.sold_price,
            seller: preview.seller
          }
        });

      setProgress('Import complete!');
      setTimeout(() => {
        onDataImported?.();
      }, 1000);

    } catch (err: any) {
      console.error('Import error:', err);
      setError(err.message || 'Failed to import data');
      setProgress('');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="card" style={{
      border: '2px dashed var(--accent)',
      background: 'var(--grey-50)'
    }}>
      <div className="card-body">
        <div className="text text-bold" style={{ marginBottom: 'var(--space-2)' }}>
          BaT Listing Import
        </div>
        
        <div className="text text-small text-muted" style={{ marginBottom: 'var(--space-2)' }}>
          Paste a Bring a Trailer listing URL to automatically import vehicle data, specs, and images
        </div>

      {!preview && (
        <div>
          <input
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError('');
            }}
            placeholder="https://bringatrailer.com/listing/..."
            disabled={parsing}
            className="form-input"
            style={{
              width: '100%',
              border: `2px solid ${error ? 'var(--error)' : 'var(--border)'}`,
              borderRadius: '0px',
              marginBottom: 'var(--space-2)'
            }}
          />

          {error && (
            <div className="card" style={{
              marginBottom: 'var(--space-2)',
              border: '2px solid var(--error)',
              background: 'var(--white)'
            }}>
              <div className="card-body">
                <div className="text text-small" style={{ color: 'var(--error)' }}>
                  {error}
                </div>
              </div>
            </div>
          )}

          {progress && (
            <div className="card" style={{
              marginBottom: 'var(--space-2)',
              border: '2px solid var(--accent)',
              background: 'var(--white)'
            }}>
              <div className="card-body">
                <div className="text text-small" style={{ color: 'var(--accent)' }}>
                  {progress}
                </div>
              </div>
            </div>
          )}

          <button
            onClick={handleParse}
            disabled={parsing || !url.trim()}
            className="button button-primary"
            style={{
              width: '100%',
              background: parsing ? 'var(--grey-400)' : 'var(--accent)',
              border: '2px outset var(--white)',
              cursor: parsing ? 'not-allowed' : 'pointer'
            }}
          >
            {parsing ? 'PARSING...' : 'PARSE LISTING'}
          </button>
        </div>
      )}

      {preview && (
        <div>
          <div className="card" style={{
            marginBottom: 'var(--space-2)',
            border: '2px solid var(--accent)',
            background: 'var(--white)'
          }}>
            <div className="card-body">
              <div className="text text-bold" style={{ marginBottom: 'var(--space-2)' }}>
                Preview: {preview.year} {preview.make} {preview.model}
              </div>
              
              <div className="text text-small" style={{ lineHeight: '1.6' }}>
                {preview.vin && <div><strong>VIN:</strong> {preview.vin}</div>}
                {preview.sold_price && <div><strong>Sold Price:</strong> ${preview.sold_price.toLocaleString()}</div>}
                {preview.mileage && <div><strong>Mileage:</strong> {preview.mileage.toLocaleString()} miles</div>}
                {preview.seller && <div><strong>Seller:</strong> {preview.seller}</div>}
                {preview.images && <div><strong>Images:</strong> {preview.images.length}</div>}
              </div>
            </div>
          </div>

          {progress && (
            <div className="card" style={{
              marginBottom: 'var(--space-2)',
              border: '2px solid var(--accent)',
              background: 'var(--white)'
            }}>
              <div className="card-body">
                <div className="text text-small" style={{ color: 'var(--accent)' }}>
                  {progress}
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              onClick={handleImport}
              disabled={importing}
              className="button button-primary"
              style={{
                flex: 1,
                background: importing ? 'var(--grey-400)' : 'var(--success)',
                border: '2px outset var(--white)',
                cursor: importing ? 'not-allowed' : 'pointer'
              }}
            >
              {importing ? 'IMPORTING...' : 'IMPORT DATA'}
            </button>
            
            <button
              onClick={() => {
                setPreview(null);
                setUrl('');
                setProgress('');
              }}
              disabled={importing}
              className="button button-secondary"
              style={{
                border: '2px outset var(--border)',
                cursor: importing ? 'not-allowed' : 'pointer'
              }}
            >
              CANCEL
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default BaTURLDrop;

