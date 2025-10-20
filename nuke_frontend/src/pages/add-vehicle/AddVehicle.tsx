import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { uploadQueue } from '../../services/globalUploadQueue';
import { TimelineEventService } from '../../services/timelineEventService';
// AppLayout now provided globally by App.tsx
import TitleScan from '../../components/TitleScan';
import UniversalImageUpload from '../../components/UniversalImageUpload';
// Modular components
import { useVehicleForm } from './hooks/useVehicleForm';
import VehicleFormFields from './components/VehicleFormFields';
import VerificationProgress from './components/VerificationProgress';
import type { VehicleFormData, DetailLevel, ImageUploadProgress, ImageUploadStatus } from './types/index';
import { extractImageMetadata, reverseGeocode, getEventDateFromImages, getEventLocationFromImages, type ImageMetadata } from '../../utils/imageMetadata';
import { MobileAddVehicle } from '../../components/mobile/MobileAddVehicle';
import { useIsMobile } from '../../hooks/useIsMobile';

interface AddVehicleProps {
  mode?: 'modal' | 'page';
  onClose?: () => void;
  onSuccess?: (vehicleId: string) => void;
}

const AddVehicle: React.FC<AddVehicleProps> = ({ 
  mode = 'page',
  onClose,
  onSuccess 
}) => {
  const isMobile = useIsMobile();
  
  // If mobile, use mobile-optimized version
  if (isMobile) {
    return (
      <MobileAddVehicle 
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );
  }
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);

  // Form state using custom hook
  const {
    formData,
    verificationProgress,
    autoSaveState,
    error: formError,
    updateField,
    updateFormData,
    validateForm,
    clearAutosave
  } = useVehicleForm();

  // Component-specific state
  const [detailLevel, setDetailLevel] = useState<DetailLevel>('basic');
  const [showTitleScan, setShowTitleScan] = useState(false);
  const [scanCompleted, setScanCompleted] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // URL scraping state
  const [isScrapingUrl, setIsScrapingUrl] = useState(false);
  const [scrapingError, setScrapingError] = useState<string | null>(null);
  const [lastScrapedUrl, setLastScrapedUrl] = useState<string | null>(null);

  // Image upload state
  const [uploadProgress, setUploadProgress] = useState<ImageUploadProgress>({});
  const [uploadStatus, setUploadStatus] = useState<ImageUploadStatus>({});
  const [showImageUpload, setShowImageUpload] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [extractedImages, setExtractedImages] = useState<File[]>([]);
  const [imageMetadata, setImageMetadata] = useState<Map<string, ImageMetadata>>(new Map());
  const [extracting, setExtracting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Get current user
  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
    };
    getUser();
  }, []);

  // Handle title scan completion
  const handleTitleScanComplete = useCallback((scannedData: any) => {
    // Automatically set relationship to owned when title is scanned
    // This pre-certifies ownership since they have the title document
    updateFormData({
      ...scannedData,
      relationship_type: 'owned',
      scanned_fields: Object.keys(scannedData)
    });
    setScanCompleted(true);
    setShowTitleScan(false);
    
    // If we have a document ID, automatically mark as ownership verified
    if (scannedData.documentId) {
      console.log('Title document uploaded, ownership pre-verified via title scan');
    }
  }, [updateFormData]);

  // Handle URL scraping when import_url changes
  const handleUrlScraping = useCallback(async (url: string) => {
    if (!url || url === lastScrapedUrl) return;

    // Check if it's a supported URL
    const supportedSites = [
      'bringatrailer.com',
      'hagerty.com',
      'classic.com',
      'cars.com',
      'autotrader.com',
      'facebook.com/marketplace',
      'craigslist.org'
    ];

    const isSupported = supportedSites.some(site => url.includes(site));
    if (!isSupported) {
      setScrapingError(`Supported sites: ${supportedSites.join(', ')}`);
      return;
    }

    try {
      setIsScrapingUrl(true);
      setScrapingError(null);
      setLastScrapedUrl(url);

      // URL DEDUPLICATION CHECK - prevent redundant imports
      const { data: existingVehicle, error: dupError } = await supabase
        .from('vehicles')
        .select('id, make, model, year, discovered_by')
        .eq('discovery_url', url)
        .single();

      if (existingVehicle && !dupError) {
        // This URL was already imported!
        
        // Count existing discoverers
        const { count: discovererCount } = await supabase
          .from('user_contributions')
          .select('id', { count: 'exact', head: true })
          .eq('vehicle_id', existingVehicle.id)
          .eq('contribution_type', 'discovery');

        const yourRank = (discovererCount || 0) + 1;

        // Credit this user as additional discoverer
        if (user?.id) {
          await supabase.from('user_contributions').insert({
            user_id: user.id,
            vehicle_id: existingVehicle.id,
            contribution_type: 'discovery',
            metadata: { 
              discovery_url: url,
              discovery_rank: yourRank,
              discovered_at: new Date().toISOString()
            }
          });
        }

        // Show notification and navigate to existing vehicle
        alert(`This vehicle is already in our system!

${existingVehicle.year} ${existingVehicle.make} ${existingVehicle.model}

You're discoverer #${yourRank}! 🎉
Redirecting to vehicle profile...`);

        setIsScrapingUrl(false);
        
        // Navigate to existing vehicle or close modal
        if (mode === 'modal' && onClose) {
          onClose();
        }
        navigate(`/vehicle/${existingVehicle.id}`);
        return;
      }

      // URL is new - proceed with scraping
      console.log('New URL - scraping data:', url);

      // Call Supabase Edge Function (scrape-vehicle)
      const { data: result, error: fnError } = await (supabase as any).functions.invoke('scrape-vehicle', {
        body: { url }
      });
      if (fnError) {
        throw new Error(`Scraping failed: ${fnError.message || fnError}`);
      }

      if (result.success && result.data) {
        const scrapedData = result.data;

        // Map scraped data to form fields
        const updates: Partial<VehicleFormData> = {};

        if (scrapedData.make) updates.make = scrapedData.make;
        if (scrapedData.model) updates.model = scrapedData.model;
        if (scrapedData.year) updates.year = parseInt(scrapedData.year);
        if (scrapedData.vin) updates.vin = scrapedData.vin;
        if (scrapedData.mileage) updates.mileage = parseInt(scrapedData.mileage.replace(/,/g, ''));
        if (scrapedData.color) updates.color = scrapedData.color;
        if (scrapedData.transmission) updates.transmission = scrapedData.transmission;
        if (scrapedData.engine_size) updates.engine_size = scrapedData.engine_size;
        if (scrapedData.sale_price) updates.sale_price = scrapedData.sale_price;

        // BAT specific fields
        updates.bat_auction_url = url;
        updates.source = 'Bring a Trailer';
        updates.discovery_source = 'user_import';
        updates.discovery_url = url;
        if (scrapedData.title) updates.bat_listing_title = scrapedData.title;

        // Set relationship as discovered since importing from external source
        updates.relationship_type = 'discovered';

        // Add acquisition context for business users
        if (scrapedData.sale_price || scrapedData.asking_price) {
          updates.target_acquisition = true;
          updates.acquisition_notes = `Discovered on ${scrapedData.source || 'marketplace'} - potential acquisition candidate`;
        }

        console.log('Updating form with scraped data:', updates);
        updateFormData(updates);

        // Set success message
        setScrapingError(null);

      } else {
        throw new Error(result.error || 'Failed to extract data from URL');
      }

    } catch (error: any) {
      console.error('URL scraping error:', error);
      setScrapingError(error.message || 'Failed to import from URL');
    } finally {
      setIsScrapingUrl(false);
    }
  }, [updateFormData, lastScrapedUrl]);

  // Watch for import_url changes
  React.useEffect(() => {
    if (formData.import_url) {
      // Debounce URL scraping
      const timeoutId = setTimeout(() => {
        handleUrlScraping(formData.import_url);
      }, 1000);
      return () => clearTimeout(timeoutId);
    }
  }, [formData.import_url, handleUrlScraping]);

  // Handle submission - no validation, accept anything
  const handleShowPreview = (e: React.FormEvent) => {
    e.preventDefault();
    
    // NO VALIDATION - accept whatever user provides
    // Algorithm will calculate completion % based on what data exists
    
    setShowPreview(true);
  };

  // Handle final submission after preview
  const handleSubmit = async () => {

    if (!user) {
      setSubmitError('You must be logged in to add a vehicle');
      return;
    }

    try {
      setSubmitting(true);
      setSubmitError(null);

      // Whitelist of valid vehicles table columns
      const validColumns = [
        'make', 'model', 'year', 'vin', 'color', 'mileage', 'fuel_type', 'transmission',
        'engine_size', 'horsepower', 'torque', 'drivetrain', 'body_style', 'doors', 'seats',
        'weight_lbs', 'length_inches', 'width_inches', 'height_inches', 'wheelbase_inches',
        'fuel_capacity_gallons', 'mpg_city', 'mpg_highway', 'mpg_combined', 'msrp',
        'current_value', 'purchase_price', 'purchase_date', 'purchase_location',
        'previous_owners', 'is_modified', 'modification_details', 'condition_rating',
        'maintenance_notes', 'insurance_company', 'insurance_policy_number',
        'registration_state', 'registration_expiry', 'inspection_expiry', 'is_public',
        'notes', 'sale_price', 'auction_end_date', 'bid_count', 'view_count',
        'auction_source', 'ownership_verified', 'bat_auction_url', 'bat_sold_price',
        'bat_sale_date', 'bat_bid_count', 'bat_view_count', 'is_daily_driver',
        'is_weekend_car', 'is_track_car', 'is_show_car', 'is_project_car', 'is_garage_kept',
        'discovered_by', 'discovery_source', 'discovery_url', 'bat_listing_title',
        'bat_bids', 'bat_comments', 'bat_views', 'bat_location', 'bat_seller',
        'sale_status', 'sale_date', 'status', 'completion_percentage', 'displacement',
        'interior_color', 'is_for_sale', 'is_draft', 'entry_type', 'verification_status',
        'confidence_score', 'source', 'import_source', 'import_metadata'
      ];
      
      // Filter formData to only include valid columns
      const vehicleData: any = {
        // Don't explicitly set user_id - let RLS/auth handle it
        // user_id is set by the database through auth context
        discovered_by: formData.import_url ? user.id : undefined,
        discovery_source: formData.import_url ? (formData.import_url.includes('craigslist.org') ? 'Craigslist' : 'External URL') : undefined,
        discovery_url: formData.import_url || undefined
      };
      
      validColumns.forEach(col => {
        if (formData[col as keyof typeof formData] !== undefined) {
          vehicleData[col] = formData[col as keyof typeof formData];
        }
      });

      // Insert vehicle directly into Supabase
      const { data: vehicle, error: insertError } = await supabase
        .from('vehicles')
        .insert([vehicleData])
        .select()
        .single();

      if (insertError) {
        throw new Error(insertError.message);
      }

      if (vehicle) {
        const vehicleId = vehicle.id;
        
        // Create timeline event for vehicle creation or discovery
        try {
          await TimelineEventService.createVehicleCreationEvent(
            vehicleId,
            vehicle,
            extractedImages.map(f => f.name)
          );
          // Record discovery event when created from URL without EXIF time
          if (formData.import_url) {
            await supabase.from('vehicle_timeline_events').insert({
              vehicle_id: vehicleId,
              user_id: user.id,
              event_type: 'discovery',
              event_date: new Date().toISOString().split('T')[0],
              description: `Discovered on ${formData.import_url.includes('craigslist.org') ? 'Craigslist' : 'External site'}`,
              source_type: 'external_listing',
              confidence_score: 70
            });
          }
        } catch (error) {
          console.error('Failed to create vehicle creation timeline event:', error);
        }
        
        // If we have a title document from scanning, save it and check ownership
        const formDataAny = formData as any;
        if (formDataAny.documentId) {
          // Save title document
          const { data: docData } = await supabase
            .from('vehicle_documents')
            .insert([{
              vehicle_id: vehicleId,
              document_type: 'title',
              title: 'Vehicle Title',
              description: 'Scanned vehicle title document',
              file_url: formDataAny.documentId,
              privacy_level: 'private',
              contains_pii: true,
              uploaded_by: user.id
            }])
            .select()
            .single();
          
          // Check if user has verified legal ID on profile
          const { data: profile } = await supabase
            .from('profiles')
            .select('full_name, legal_id_verified')
            .eq('id', user.id)
            .single();
          
          // If user has verified legal ID and title has owner name, check for match
          if (profile?.legal_id_verified && formDataAny.owner_name && docData) {
            const titleName = formDataAny.owner_name.toLowerCase().trim();
            const profileName = profile.full_name?.toLowerCase().trim();
            
            // Simple name match (you can enhance this logic)
            if (profileName && titleName.includes(profileName)) {
              // Auto-approve ownership since ID and title match
              await supabase
                .from('ownership_verifications')
                .insert([{
                  vehicle_id: vehicleId,
                  user_id: user.id,
                  status: 'approved',
                  verification_type: 'title_and_id',
                  document_id: docData.id,
                  submitted_at: new Date().toISOString(),
                  reviewed_at: new Date().toISOString(),
                  auto_verified: true
                }]);
            } else {
              // Names don't match - create pending verification for manual review
              await supabase
                .from('ownership_verifications')
                .insert([{
                  vehicle_id: vehicleId,
                  user_id: user.id,
                  status: 'pending',
                  verification_type: 'title_and_id',
                  document_id: docData.id,
                  submitted_at: new Date().toISOString()
                }]);
            }
          }
        }
        
        // Add images to global upload queue for persistent, resumable uploads
        if (extractedImages.length > 0) {
          const vehicleName = `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim() || 'Vehicle';
          console.log(`Adding ${extractedImages.length} images to global upload queue...`);
          uploadQueue.addFiles(vehicleId, vehicleName, extractedImages);
        }
        
        // Clear autosave data
        clearAutosave();

        // Call success callback (for modal mode)
        if (onSuccess) {
          onSuccess(vehicleId);
        }

        // Close modal or navigate
        if (mode === 'modal' && onClose) {
          onClose();
        } else {
          // Navigate immediately - uploads continue in background
          navigate(`/vehicle/${vehicleId}`);
        }
      } else {
        throw new Error('Failed to create vehicle - no data returned');
      }
    } catch (error: any) {
      console.error('Error creating vehicle:', error);
      setSubmitError(error.message || 'Failed to create vehicle. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Process images (from drag-drop or file picker)
  const processImages = useCallback(async (files: File[]) => {
    const imageFiles = files.filter(file => file.type.startsWith('image/'));

    if (imageFiles.length === 0) {
      alert('No image files detected. Please select image files (JPG, PNG, etc.)');
      return;
    }

    // Limit to 300 images total - will process and upload in background
    const MAX_IMAGES = 300;
    const currentCount = extractedImages.length;
    const newTotal = currentCount + imageFiles.length;
    
    if (newTotal > MAX_IMAGES) {
      alert(`Adding ${imageFiles.length} images would exceed the ${MAX_IMAGES} image limit.\n\nYou currently have ${currentCount} images. You can add ${MAX_IMAGES - currentCount} more images.`);
      return;
    }

    try {
      setExtracting(true);
      
      // Append new images to existing ones
      const allImages = [...extractedImages, ...imageFiles];
      setExtractedImages(allImages);

      // Extract metadata from images in batches to avoid memory issues
      const BATCH_SIZE = 10;
      const metadataResults: ImageMetadata[] = [];
      
      for (let i = 0; i < imageFiles.length; i += BATCH_SIZE) {
        const batch = imageFiles.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(extractImageMetadata));
        metadataResults.push(...batchResults);
      }
      
      // Store metadata keyed by filename (merge with existing metadata)
      const metadataMap = new Map<string, ImageMetadata>(imageMetadata);
      imageFiles.forEach((file, index) => {
        if (metadataResults[index]) {
          metadataMap.set(file.name, metadataResults[index]);
        }
      });
      setImageMetadata(metadataMap);

      // Process the metadata to update form fields
      // Note: We extract date/location but DON'T auto-fill purchase_date
      // Image dates are just timeline events, not purchase confirmation
      const eventLocation = await getEventLocationFromImages(metadataResults);

      const updates: Partial<VehicleFormData> = {};

      // Only auto-fill location if not set (photos taken at purchase location is common)
      if (eventLocation && !formData.purchase_location) {
        updates.purchase_location = eventLocation;
      }

      if (Object.keys(updates).length > 0) {
        updateFormData(updates);
      }

    } catch (error) {
      console.error('Error processing images:', error);
    } finally {
      setExtracting(false);
    }
  }, [formData.purchase_date, formData.purchase_location, updateFormData]);

  // Handle drag and drop
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    await processImages(files);
  }, [processImages]);

  // Handle file input selection
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      await processImages(files);
      // Reset input so same files can be selected again
      e.target.value = '';
    }
  }, [processImages]);

  // Early return if not authenticated
  if (!user) {
    const authContent = (
      <div className="container">
        <div className="section">
          <div className="card">
            <div className="card-body text-center">
              <h2 className="text font-bold mb-4">Authentication Required</h2>
              <p className="text-muted mb-4">
                You must be logged in to add a vehicle to the database.
              </p>
              <button
                onClick={() => navigate('/login')}
                className="button button-primary"
              >
                Sign In
              </button>
            </div>
          </div>
        </div>
      </div>
    );

    return mode === 'modal' ? (
      <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg max-w-md w-full p-6">
          {authContent}
        </div>
      </div>
    ) : (
      authContent
    );
  }

  // Main form content
  const formContent = (
    <>
      {/* Verification Progress Bar */}
      <div style={{
        position: 'sticky',
        top: '56px',
        zIndex: 90,
        backgroundColor: 'var(--grey-50)',
        padding: '6px 0',
        margin: 0,
        borderTop: 'none',
        borderBottom: '1px solid var(--border-light)'
      }}>
        <div className="container">
          <VerificationProgress progress={verificationProgress} />
        </div>
      </div>

      <div className="container">
        <div className="section" style={{ marginTop: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
            {/* Left Column - Form Fields */}
            <div>
              <form onSubmit={handleShowPreview}>
                <div className="card">
                  <div className="card-header">
                    <h2 className="text font-bold">Vehicle Information</h2>
                    <div className="flex gap-2" style={{ marginTop: 'var(--space-1)' }}>
                      <select
                        value={detailLevel}
                        onChange={(e) => setDetailLevel(e.target.value as DetailLevel)}
                        style={{ 
                          fontSize: '8pt',
                          padding: '2px 4px',
                          border: '1px solid var(--border-medium)',
                          backgroundColor: 'var(--grey-100)'
                        }}
                      >
                        <option value="basic">Basic</option>
                        <option value="detailed">Detailed</option>
                        <option value="professional">Pro</option>
                        <option value="expert">Expert</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => setShowTitleScan(true)}
                        className="button button-secondary"
                        style={{ fontSize: '8pt', padding: '2px 6px' }}
                      >
                        📄 Scan Title
                      </button>
                    </div>
                  </div>

                  <div className="card-body">
                    {/* Success/Error Messages */}
                    {scanCompleted && (
                      <div className="alert alert-success mb-4">
                        <div className="text-small">
                          ✓ Title scan completed successfully. Ownership pre-certified via title document. Review and modify the extracted data below.
                        </div>
                      </div>
                    )}

                    {/* URL Scraping Status */}
                    {isScrapingUrl && (
                      <div className="alert alert-info mb-4">
                        <div className="text-small">
                          🔍 Importing vehicle data from URL...
                        </div>
                      </div>
                    )}

                    {scrapingError && (
                      <div className="alert alert-error mb-4">
                        <div className="text-small">❌ {scrapingError}</div>
                      </div>
                    )}

                    {lastScrapedUrl && !isScrapingUrl && !scrapingError && formData.bat_auction_url && (
                      <div className="alert alert-success mb-4">
                        <div className="text-small">
                          ✓ Successfully imported vehicle data from Bring a Trailer listing
                        </div>
                      </div>
                    )}

                    {(formError || submitError) && (
                      <div className="alert alert-error mb-4">
                        <div className="text-small">{formError || submitError}</div>
                      </div>
                    )}

                    {/* Autosave Notification */}
                    {autoSaveState.lastSaved && (
                      <div className="alert alert-info mb-4">
                        <div className="flex justify-between items-center">
                          <div className="text-small">
                            💾 Form automatically saved {new Date(autoSaveState.lastSaved).toLocaleTimeString()}
                          </div>
                          <button
                            type="button"
                            onClick={clearAutosave}
                            className="button button-small button-secondary"
                          >
                            Clear Draft
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Form Fields */}
                    <VehicleFormFields
                      formData={formData}
                      detailLevel={detailLevel}
                      onFieldChange={updateField}
                    />

                    {/* Submit Button */}
                    <div className="form-actions">
                      <button
                        type="submit"
                        disabled={submitting}
                        className="button button-primary button-large"
                      >
                        {submitting ? 'Creating Vehicle...' : 'Review Draft →'}
                      </button>
                    </div>
                  </div>
                </div>
              </form>
            </div>

            {/* Right Column - Image Upload */}
            <div>
              <div className="card" style={{ 
                position: 'sticky', 
                top: '90px',
                alignSelf: 'flex-start'
              }}>
                <div className="card-header">
                  <h3 className="text font-bold">Vehicle Images</h3>
                  <p className="text-small text-muted">
                    {extractedImages.length > 0 
                      ? `${extractedImages.length}/300 images ready` 
                      : 'Add up to 300 images'}
                  </p>
                </div>
                <div className="card-body">
                  {/* Add/Upload Button */}
                  <button
                    type="button"
                    onClick={() => setShowImageUpload(!showImageUpload)}
                    className="button button-primary w-full mb-3"
                    style={{ fontSize: '9pt' }}
                  >
                    {extractedImages.length > 0 
                      ? `Add More Images (${extractedImages.length}/300)` 
                      : '📷 Upload Images'}
                  </button>

                  {/* Image thumbnails - smaller size */}
                  {extractedImages.length > 0 && (
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
                      gap: 'var(--space-1)',
                      marginBottom: 'var(--space-2)',
                      maxHeight: '60vh',
                      overflowY: 'auto'
                    }}>
                      {extractedImages.map((file, index) => (
                        <div key={index} style={{
                          border: '1px solid var(--border-medium)',
                          padding: '2px',
                          backgroundColor: 'var(--grey-100)'
                        }}>
                          <img
                            src={URL.createObjectURL(file)}
                            alt={file.name}
                            style={{
                              width: '100%',
                              height: '60px',
                              objectFit: 'cover',
                              border: '1px solid var(--border-dark)'
                            }}
                          />
                          <div style={{ fontSize: '7pt', textAlign: 'center', marginTop: '2px' }}>
                            {(() => {
                              const metadata = imageMetadata.get(file.name);
                              const dateTaken = metadata?.dateTaken;
                              return dateTaken ? (
                                <div className="text-muted">
                                  {dateTaken.toLocaleDateString('en-US', { 
                                    month: 'short', 
                                    day: 'numeric'
                                  })}
                                </div>
                              ) : null;
                            })()}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Drop Zone */}
                  {showImageUpload && (
                    <>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={handleFileSelect}
                        style={{ display: 'none' }}
                      />
                      <div
                        className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                          extracting ? 'border-primary bg-primary bg-opacity-10' : 'border-grey-300 hover:border-primary hover:bg-grey-50 cursor-pointer'
                        }`}
                        onDrop={handleDrop}
                        onDragOver={(e) => e.preventDefault()}
                        onDragEnter={(e) => e.preventDefault()}
                        onDragLeave={(e) => e.preventDefault()}
                        onClick={() => !extracting && fileInputRef.current?.click()}
                        style={{ marginTop: 'var(--space-2)' }}
                      >
                        {extracting ? (
                          <div className="flex flex-col items-center">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-2"></div>
                            <p className="text-small font-bold text-primary">Processing...</p>
                          </div>
                        ) : (
                          <div>
                            <div className="text font-medium text-grey-900 mb-1">
                              Drop or Click
                            </div>
                            <p className="text-small text-muted">
                              Max 300 images total
                            </p>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Title Scanner Modal */}
      {showTitleScan && (
        <div className="modal-overlay">
          <div className="modal-content">
            <TitleScan
              onComplete={handleTitleScanComplete}
              onCancel={() => setShowTitleScan(false)}
            />
          </div>
        </div>
      )}

      {/* Preview/Review Modal */}
      {showPreview && (
        <div className="modal-overlay" onClick={() => setShowPreview(false)}>
          <div className="modal-content" style={{ 
            maxWidth: '900px', 
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column'
          }} onClick={(e) => e.stopPropagation()}>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div className="card-header">
                <h2 className="text font-bold">Review Vehicle Information</h2>
                <p className="text-small text-muted">Please review all information before submitting. You can go back to make edits.</p>
              </div>
              <div className="card-body" style={{ 
                overflowY: 'auto',
                flex: 1,
                paddingBottom: 'var(--space-2)'
              }}>
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: 'repeat(2, 1fr)', 
                  gap: 'var(--space-3)',
                  fontSize: '8pt'
                }}>
                  <div>
                    <div className="text-small text-muted font-bold">Basic Information</div>
                    <div style={{ marginTop: 'var(--space-2)' }}>
                      <div><strong>Make:</strong> {formData.make || 'Not specified'}</div>
                      <div><strong>Model:</strong> {formData.model || 'Not specified'}</div>
                      <div><strong>Year:</strong> {formData.year || 'Not specified'}</div>
                      <div><strong>VIN:</strong> {formData.vin || 'Not specified'}</div>
                      <div><strong>Relationship:</strong> {formData.relationship_type || 'Not specified'}</div>
                    </div>
                  </div>
                  <div>
                    <div className="text-small text-muted font-bold">Specifications</div>
                    <div style={{ marginTop: 'var(--space-2)' }}>
                      <div><strong>Color:</strong> {formData.color || 'Not specified'}</div>
                      <div><strong>Mileage:</strong> {formData.mileage ? `${formData.mileage.toLocaleString()} mi` : 'Not specified'}</div>
                      <div><strong>Doors:</strong> {formData.doors || 'Not specified'}</div>
                      <div><strong>Seats:</strong> {formData.seats || 'Not specified'}</div>
                      {formData.sale_price && <div><strong>Price:</strong> ${formData.sale_price.toLocaleString()}</div>}
                    </div>
                  </div>
                </div>
                
                {extractedImages.length > 0 && (
                  <div style={{ marginTop: 'var(--space-3)' }}>
                    <div className="text-small text-muted font-bold">Vehicle Images ({extractedImages.length})</div>
                    <div className="text-small text-muted" style={{ fontSize: '8pt', marginTop: 'var(--space-1)' }}>
                      Images will upload in the background after vehicle creation. You can navigate the site while uploads continue.
                    </div>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
                      gap: 'var(--space-2)',
                      marginTop: 'var(--space-2)'
                    }}>
                      {extractedImages.map((file, index) => {
                        const metadata = imageMetadata.get(file.name);
                        const dateTaken = metadata?.dateTaken;
                        return (
                          <div key={index} style={{
                            border: '1px solid var(--border-medium)',
                            padding: 'var(--space-1)',
                            backgroundColor: 'var(--grey-100)'
                          }}>
                            <img
                              src={URL.createObjectURL(file)}
                              alt={file.name}
                              style={{
                                width: '100%',
                                height: '60px',
                                objectFit: 'cover',
                                border: '1px solid var(--border-dark)',
                                marginBottom: 'var(--space-1)'
                              }}
                            />
                            {dateTaken && (
                              <div className="text-muted" style={{ fontSize: '7pt', textAlign: 'center' }}>
                                {dateTaken.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {formData.notes && (
                  <div style={{ marginTop: 'var(--space-3)' }}>
                    <div className="text-small text-muted font-bold">Notes</div>
                    <div style={{ 
                      marginTop: 'var(--space-1)',
                      padding: 'var(--space-2)',
                      backgroundColor: 'var(--grey-100)',
                      fontSize: '8pt'
                    }}>
                      {formData.notes}
                    </div>
                  </div>
                )}

              </div>
              
              {/* Sticky Action Buttons */}
              <div style={{ 
                borderTop: '1px solid var(--border-medium)',
                padding: 'var(--space-3)',
                backgroundColor: 'var(--background)',
                display: 'flex', 
                gap: 'var(--space-2)',
                justifyContent: 'flex-end'
              }}>
                <button 
                  type="button" 
                  className="button button-secondary"
                  onClick={() => setShowPreview(false)}
                  disabled={submitting}
                >
                  ← Edit Information
                </button>
                <button 
                  type="button" 
                  className="button button-primary"
                  onClick={handleSubmit}
                  disabled={submitting}
                >
                  {submitting 
                    ? (extractedImages.length > 0 
                        ? `Creating Vehicle (${extractedImages.length} images will upload in background)...` 
                        : 'Creating Vehicle...'
                      )
                    : '✓ Confirm & Create Vehicle'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );

  // Render based on mode
  if (mode === 'modal') {
    return (
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget && onClose) {
            onClose();
          }
        }}
      >
        <div 
          className="bg-white rounded-lg max-w-6xl w-full max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal Header */}
          <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between z-10">
            <h2 className="text-xl font-bold">Add Vehicle</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            >
              ×
            </button>
          </div>
          
          {/* Modal Content */}
          <div className="p-6">
            {formContent}
          </div>
        </div>
      </div>
    );
  }

  // Page mode - use AppLayout
  return formContent;
};

export default AddVehicle;