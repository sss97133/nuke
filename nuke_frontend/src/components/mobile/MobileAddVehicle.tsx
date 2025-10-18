/**
 * Mobile-Optimized Add Vehicle Component
 * 
 * iOS-optimized with large touch targets, native camera/photo picker
 * Photo-first workflow: Images → Title Scan → URL
 * Maintains Windows 95 aesthetic with mobile usability
 */

import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { ImageUploadService } from '../../services/imageUploadService';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

interface MobileAddVehicleProps {
  onClose?: () => void;
  onSuccess?: (vehicleId: string) => void;
}

interface PhotoPreview {
  file: File;
  preview: string;
  exif?: any;
}

export const MobileAddVehicle: React.FC<MobileAddVehicleProps> = ({
  onClose,
  onSuccess
}) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  
  // Photo-first state
  const [photos, setPhotos] = useState<PhotoPreview[]>([]);
  const [isProcessingPhotos, setIsProcessingPhotos] = useState(false);
  
  // Quick form data (auto-filled from photos/URL/title)
  const [formData, setFormData] = useState({
    year: '',
    make: '',
    model: '',
    vin: '',
    bat_auction_url: '',
  });
  
  // UI state
  const [activeSection, setActiveSection] = useState<'photos' | 'details' | 'url'>('photos');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ uploaded: number; total: number } | null>(null);
  
  // Refs
  const photoInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  
  // PHOTO HANDLERS
  const handlePhotoPicker = () => {
    photoInputRef.current?.click();
  };
  
  const handleCamera = () => {
    cameraInputRef.current?.click();
  };
  
  const handlePhotoChange = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    setIsProcessingPhotos(true);
    const newPhotos: PhotoPreview[] = [];
    
    try {
      for (const file of Array.from(files)) {
        // Create preview
        const preview = URL.createObjectURL(file);
        
        // Extract EXIF for auto-fill
        const exifr = await import('exifr');
        const exif = await exifr.parse(file);
        
        newPhotos.push({ file, preview, exif });
        
        // Try to extract VIN from first photo
        if (photos.length === 0 && !formData.vin) {
          // TODO: Call OpenAI Vision to detect VIN
        }
      }
      
      setPhotos(prev => [...prev, ...newPhotos]);
    } catch (error) {
      console.error('Photo processing error:', error);
    } finally {
      setIsProcessingPhotos(false);
    }
  };
  
  // TITLE SCAN HANDLER
  const handleTitleScan = async (file: File | null) => {
    if (!file) return;
    
    setIsProcessingPhotos(true);
    setError(null);
    
    try {
      // Upload to storage for processing
      const fileName = `title-scan-${Date.now()}.jpg`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('vehicle-images')
        .upload(`temp/${fileName}`, file);
      
      if (uploadError) {
        console.error('Upload error:', uploadError);
        throw new Error('Failed to upload title image');
      }
      
      // Get public URL
      const { data: urlData } = supabase.storage
        .from('vehicle-images')
        .getPublicUrl(`temp/${fileName}`);
      
      if (!urlData?.publicUrl) {
        throw new Error('Failed to get image URL');
      }
      
      // Call OpenAI Vision to extract title data
      const { data: result, error: visionError } = await supabase.functions.invoke('extract-title-data', {
        body: { image_url: urlData.publicUrl }
      });
      
      if (visionError) {
        console.error('Vision error:', visionError);
        throw new Error(visionError.message || 'Failed to analyze title');
      }
      
      // Auto-fill from extracted data
      let fieldsFound = 0;
      if (result) {
        const updates: any = {};
        if (result.year) { updates.year = result.year; fieldsFound++; }
        if (result.make) { updates.make = result.make; fieldsFound++; }
        if (result.model) { updates.model = result.model; fieldsFound++; }
        if (result.vin) { updates.vin = result.vin; fieldsFound++; }
        
        setFormData(prev => ({ ...prev, ...updates }));
      }
      
      // Show success with what was found
      if (fieldsFound > 0) {
        alert(`✓ Title scanned! Found ${fieldsFound} fields.\nCheck details below.`);
        setActiveSection('details');
      } else {
        alert('Title scanned but no data extracted.\nPlease enter details manually.');
      }
      
      // Clean up temp file after a delay
      setTimeout(async () => {
        await supabase.storage
          .from('vehicle-images')
          .remove([`temp/${fileName}`]);
      }, 60000); // Clean up after 1 minute
      
    } catch (error) {
      console.error('Title scan error:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setError(`Title scan failed: ${errorMsg}`);
      alert(`❌ Title scan failed\n\n${errorMsg}\n\nPlease enter details manually.`);
    } finally {
      setIsProcessingPhotos(false);
    }
  };
  
  // URL HANDLER
  const handleUrlPaste = async (url: string) => {
    if (!url.trim()) return;
    
    // Check for duplicate
    const { data: existing } = await supabase
      .from('vehicles')
      .select('id, year, make, model')
      .eq('discovery_url', url)
      .single();
    
    if (existing) {
      alert(`This vehicle is already in the system!\n\n${existing.year} ${existing.make} ${existing.model}\n\nRedirecting...`);
      if (onSuccess) {
        onSuccess(existing.id);
      } else {
        navigate(`/vehicle/${existing.id}`);
      }
      if (onClose) onClose();
      return;
    }
    
    // Scrape URL
    setIsProcessingPhotos(true);
    try {
      const { data, error } = await supabase.functions.invoke('scrape-bat-url', {
        body: { url }
      });
      
      if (error) throw error;
      
      if (data) {
        setFormData(prev => ({
          ...prev,
          year: data.year || prev.year,
          make: data.make || prev.make,
          model: data.model || prev.model,
          bat_auction_url: url,
        }));
        
        alert('✓ URL imported! Data auto-filled below.');
        setActiveSection('details');
      }
    } catch (error) {
      console.error('URL scrape error:', error);
      alert('Could not import from URL. Try photos or manual entry.');
    } finally {
      setIsProcessingPhotos(false);
    }
  };
  
  // SUBMIT HANDLER WITH BATCH UPLOAD
  const handleSubmit = async () => {
    if (!user) {
      alert('Please sign in to add a vehicle');
      return;
    }
    
    setIsSubmitting(true);
    setError(null);
    
    try {
      // Create vehicle
      const { data: vehicle, error: vehicleError } = await supabase
        .from('vehicles')
        .insert({
          user_id: user.id,
          year: formData.year ? parseInt(formData.year) : null,
          make: formData.make || null,
          model: formData.model || null,
          vin: formData.vin || null,
          bat_auction_url: formData.bat_auction_url || null,
          discovery_url: formData.bat_auction_url || null,
          discovered_by: user.id,
          is_public: formData.vin ? true : false, // VIN required for public
        })
        .select()
        .single();
      
      if (vehicleError) throw vehicleError;
      
      // Upload photos in batches
      if (photos.length > 0) {
        const BATCH_SIZE = 5; // Upload 5 at a time
        const totalPhotos = photos.length;
        let uploaded = 0;
        let failed = 0;
        
        setUploadProgress({ uploaded: 0, total: totalPhotos });
        
        for (let i = 0; i < photos.length; i += BATCH_SIZE) {
          const batch = photos.slice(i, i + BATCH_SIZE);
          
          // Upload batch in parallel
          const uploadPromises = batch.map(async (photo) => {
            try {
              const result = await ImageUploadService.uploadImage(
                vehicle.id,
                photo.file,
                'general'
              );
              if (result.success) {
                uploaded++;
                setUploadProgress({ uploaded, total: totalPhotos });
              } else {
                failed++;
              }
            } catch (error) {
              console.error('Upload error:', error);
              failed++;
            }
          });
          
          await Promise.all(uploadPromises);
          
          // Update progress display
          setUploadProgress({ uploaded, total: totalPhotos });
          console.log(`Uploaded ${uploaded}/${totalPhotos} (${failed} failed)`);
        }
        
        setUploadProgress(null);
        
        if (failed > 0) {
          alert(`Uploaded ${uploaded} photos successfully. ${failed} failed.`);
        }
      }
      
      // Success!
      if (onSuccess) {
        onSuccess(vehicle.id);
      } else {
        navigate(`/vehicle/${vehicle.id}`);
      }
      
      if (onClose) onClose();
      
    } catch (error) {
      console.error('Submit error:', error);
      setError(error instanceof Error ? error.message : 'Failed to create vehicle');
    } finally {
      setIsSubmitting(false);
    }
  };
  
  return (
    <div className="win95" style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'var(--grey-100)',
      zIndex: 9999,
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
    }}>
      {/* Header */}
      <div style={{
        position: 'sticky',
        top: 0,
        backgroundColor: 'var(--white)',
        borderBottom: '2px solid var(--border-medium)',
        padding: 'var(--space-3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        zIndex: 10,
      }}>
        <h1 style={{
          fontSize: '10pt',
          fontWeight: 'bold',
          margin: 0,
        }}>
          Add Vehicle
        </h1>
        {onClose && (
          <button
            onClick={onClose}
            className="button"
            style={{
              padding: 'var(--space-2) var(--space-3)',
              fontSize: '8pt',
            }}
          >
            Cancel
          </button>
        )}
      </div>
      
      {/* Section Tabs */}
      <div style={{
        display: 'flex',
        backgroundColor: 'var(--grey-200)',
        borderBottom: '1px solid var(--border-medium)',
      }}>
        {(['photos', 'details', 'url'] as const).map(section => (
          <button
            key={section}
            onClick={() => setActiveSection(section)}
            style={{
              flex: 1,
              padding: 'var(--space-4)',
              fontSize: '8pt',
              fontWeight: activeSection === section ? 'bold' : 'normal',
              backgroundColor: activeSection === section ? 'var(--white)' : 'transparent',
              border: 'none',
              borderBottom: activeSection === section ? '2px solid var(--text)' : 'none',
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            {section === 'photos' && `📷 Photos${photos.length > 0 ? ` (${photos.length})` : ''}`}
            {section === 'details' && '✏️ Details'}
            {section === 'url' && '🔗 URL'}
          </button>
        ))}
      </div>
      
      {/* Content */}
      <div style={{ padding: 'var(--space-4)' }}>
        {/* PHOTOS SECTION */}
        {activeSection === 'photos' && (
          <div>
            <p style={{
              fontSize: '8pt',
              color: 'var(--text-muted)',
              marginBottom: 'var(--space-4)',
            }}>
              Start with photos! VIN and details can be detected automatically.
            </p>
            
            {/* Large iOS-style buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <button
                onClick={handleCamera}
                disabled={isProcessingPhotos}
                className="button"
                style={{
                  width: '100%',
                  padding: 'var(--space-5)',
                  fontSize: '10pt',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 'var(--space-3)',
                  minHeight: '60px',
                }}
              >
                <span style={{ fontSize: '20pt' }}>📸</span>
                <span>Take Photo</span>
              </button>
              
              <button
                onClick={handlePhotoPicker}
                disabled={isProcessingPhotos}
                className="button"
                style={{
                  width: '100%',
                  padding: 'var(--space-5)',
                  fontSize: '10pt',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 'var(--space-3)',
                  minHeight: '60px',
                }}
              >
                <span style={{ fontSize: '20pt' }}>🖼️</span>
                <span>Choose from Library</span>
              </button>
              
              <button
                onClick={() => titleInputRef.current?.click()}
                disabled={isProcessingPhotos}
                className="button"
                style={{
                  width: '100%',
                  padding: 'var(--space-5)',
                  fontSize: '10pt',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 'var(--space-3)',
                  minHeight: '60px',
                }}
              >
                <span style={{ fontSize: '20pt' }}>📄</span>
                <span>Scan Title Document</span>
              </button>
            </div>
            
            {/* Photo Preview Grid */}
            {photos.length > 0 && (
              <div style={{
                marginTop: 'var(--space-5)',
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 'var(--space-2)',
              }}>
                {photos.map((photo, idx) => (
                  <div key={idx} style={{
                    position: 'relative',
                    paddingTop: '100%',
                    backgroundColor: 'var(--grey-300)',
                    border: '1px solid var(--border-medium)',
                  }}>
                    <img
                      src={photo.preview}
                      alt={`Preview ${idx + 1}`}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                      }}
                    />
                    <button
                      onClick={() => setPhotos(photos.filter((_, i) => i !== idx))}
                      style={{
                        position: 'absolute',
                        top: 'var(--space-1)',
                        right: 'var(--space-1)',
                        width: '24px',
                        height: '24px',
                        padding: 0,
                        fontSize: '8pt',
                        backgroundColor: 'var(--white)',
                        border: '1px solid var(--border-dark)',
                        cursor: 'pointer',
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            {isProcessingPhotos && (
              <p style={{
                marginTop: 'var(--space-4)',
                fontSize: '8pt',
                textAlign: 'center',
                color: 'var(--text-muted)',
              }}>
                Processing photos...
              </p>
            )}
          </div>
        )}
        
        {/* DETAILS SECTION */}
        {activeSection === 'details' && (
          <div>
            <p style={{
              fontSize: '8pt',
              color: 'var(--text-muted)',
              marginBottom: 'var(--space-4)',
            }}>
              Edit or fill in vehicle details:
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div>
                <label style={{
                  display: 'block',
                  fontSize: '8pt',
                  fontWeight: 'bold',
                  marginBottom: 'var(--space-1)',
                }}>
                  Year
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={formData.year}
                  onChange={(e) => setFormData({ ...formData, year: e.target.value })}
                  placeholder="1977"
                  style={{
                    width: '100%',
                    padding: 'var(--space-3)',
                    fontSize: '10pt',
                    border: '1px solid var(--border-medium)',
                    minHeight: '48px',
                  }}
                />
              </div>
              
              <div>
                <label style={{
                  display: 'block',
                  fontSize: '8pt',
                  fontWeight: 'bold',
                  marginBottom: 'var(--space-1)',
                }}>
                  Make
                </label>
                <input
                  type="text"
                  value={formData.make}
                  onChange={(e) => setFormData({ ...formData, make: e.target.value })}
                  placeholder="Chevrolet"
                  style={{
                    width: '100%',
                    padding: 'var(--space-3)',
                    fontSize: '10pt',
                    border: '1px solid var(--border-medium)',
                    minHeight: '48px',
                  }}
                />
              </div>
              
              <div>
                <label style={{
                  display: 'block',
                  fontSize: '8pt',
                  fontWeight: 'bold',
                  marginBottom: 'var(--space-1)',
                }}>
                  Model
                </label>
                <input
                  type="text"
                  value={formData.model}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  placeholder="K10 Blazer"
                  style={{
                    width: '100%',
                    padding: 'var(--space-3)',
                    fontSize: '10pt',
                    border: '1px solid var(--border-medium)',
                    minHeight: '48px',
                  }}
                />
              </div>
              
              <div>
                <label style={{
                  display: 'block',
                  fontSize: '8pt',
                  fontWeight: 'bold',
                  marginBottom: 'var(--space-1)',
                }}>
                  VIN (optional)
                </label>
                <input
                  type="text"
                  value={formData.vin}
                  onChange={(e) => setFormData({ ...formData, vin: e.target.value.toUpperCase() })}
                  placeholder="Auto-detected from photos"
                  style={{
                    width: '100%',
                    padding: 'var(--space-3)',
                    fontSize: '10pt',
                    border: '1px solid var(--border-medium)',
                    minHeight: '48px',
                    textTransform: 'uppercase',
                  }}
                />
                <p style={{
                  fontSize: '8pt',
                  color: 'var(--text-muted)',
                  marginTop: 'var(--space-1)',
                }}>
                  VIN required to make vehicle public
                </p>
              </div>
            </div>
          </div>
        )}
        
        {/* URL SECTION */}
        {activeSection === 'url' && (
          <div>
            <p style={{
              fontSize: '8pt',
              color: 'var(--text-muted)',
              marginBottom: 'var(--space-4)',
            }}>
              Import from Bring a Trailer, Cars & Bids, or other URLs:
            </p>
            
            <div>
              <label style={{
                display: 'block',
                fontSize: '8pt',
                fontWeight: 'bold',
                marginBottom: 'var(--space-1)',
              }}>
                URL
              </label>
              <input
                type="url"
                inputMode="url"
                value={formData.bat_auction_url}
                onChange={(e) => setFormData({ ...formData, bat_auction_url: e.target.value })}
                onBlur={(e) => {
                  if (e.target.value) {
                    handleUrlPaste(e.target.value);
                  }
                }}
                placeholder="https://bringatrailer.com/..."
                style={{
                  width: '100%',
                  padding: 'var(--space-3)',
                  fontSize: '10pt',
                  border: '1px solid var(--border-medium)',
                  minHeight: '48px',
                }}
              />
              <p style={{
                fontSize: '8pt',
                color: 'var(--text-muted)',
                marginTop: 'var(--space-1)',
              }}>
                We'll auto-import photos and details
              </p>
            </div>
          </div>
        )}
        
        {/* Error Message */}
        {error && (
          <div style={{
            marginTop: 'var(--space-4)',
            padding: 'var(--space-3)',
            backgroundColor: '#fef2f2',
            border: '1px solid #dc2626',
            fontSize: '8pt',
            color: '#dc2626',
          }}>
            {error}
          </div>
        )}
      </div>
      
      {/* Sticky Bottom Bar */}
      <div style={{
        position: 'sticky',
        bottom: 0,
        backgroundColor: 'var(--white)',
        borderTop: '2px solid var(--border-medium)',
        padding: 'var(--space-4)',
        display: 'flex',
        gap: 'var(--space-3)',
      }}>
        {activeSection !== 'details' && (
          <button
            onClick={() => setActiveSection('details')}
            className="button button-secondary"
            style={{
              flex: 1,
              padding: 'var(--space-4)',
              fontSize: '10pt',
              minHeight: '48px',
            }}
          >
            Continue →
          </button>
        )}
        
        {activeSection === 'details' && (
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !formData.year || !formData.make}
            className="button"
            style={{
              flex: 1,
              padding: 'var(--space-4)',
              fontSize: '10pt',
              minHeight: '48px',
              fontWeight: 'bold',
            }}
          >
            {uploadProgress 
              ? `Uploading ${uploadProgress.uploaded}/${uploadProgress.total}...`
              : isSubmitting 
                ? 'Creating...' 
                : `Add Vehicle${photos.length > 0 ? ` + ${photos.length} Photos` : ''}`
            }
          </button>
        )}
      </div>
      
      {/* Hidden inputs for iOS native pickers */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => handlePhotoChange(e.target.files)}
      />
      
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => handlePhotoChange(e.target.files)}
      />
      
      <input
        ref={titleInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleTitleScan(file);
        }}
      />
    </div>
  );
};

