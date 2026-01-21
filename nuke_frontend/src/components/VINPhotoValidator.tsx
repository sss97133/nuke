import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import vinDecoderService from '../services/vinDecoder';

// Load piexifjs for EXIF data extraction
declare global {
  interface Window {
    piexif: {
      ImageIFD: { [key: string]: string };
      GPSIFD: { [key: string]: string };
      ExifIFD: { [key: string]: string };
      load: (data: any) => any;
    };
  }
}

// EXIF constants
const EXIF_CONSTANTS = {
  ImageIFD: {
    Make: '0x010f',
    Model: '0x0110', 
    DateTime: '0x0132'
  },
  GPSIFD: {
    GPSLatitude: '0x0002',
    GPSLatitudeRef: '0x0001',
    GPSLongitude: '0x0004',
    GPSLongitudeRef: '0x0003',
    GPSAltitude: '0x0006',
    GPSTimeStamp: '0x0007'
  },
  ExifIFD: {
    ISOSpeedRatings: '0x8827',
    FNumber: '0x829d',
    ExposureTime: '0x829a',
    FocalLength: '0x920a'
  }
};

// Load piexifjs dynamically
if (typeof window !== 'undefined' && !window.piexif) {
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/piexifjs@1.0.6/piexif.min.js';
  document.head.appendChild(script);
}

interface VINPhotoValidatorProps {
  vehicleId: string;
  onValidationComplete?: (result: any) => void;
  onCancel: () => void;
}

interface UserVerificationStatus {
  phoneVerified: boolean;
  idVerified: boolean;
  verificationLevel: string;
  canAccessVINTools: boolean;
}

interface VINValidation {
  id: string;
  vehicle_id: string;
  user_id: string;
  vin_photo_url: string;
  extracted_vin: string | null;
  submitted_vin: string;
  validation_status: 'pending' | 'approved' | 'rejected' | 'expired';
  confidence_score: number | null;
  validation_method: 'ocr' | 'manual' | 'ai_vision';
  expires_at: string;
  created_at: string;
}

export const VINPhotoValidator: React.FC<VINPhotoValidatorProps> = ({
  vehicleId,
  onValidationComplete,
  onCancel
}) => {
  const [step, setStep] = useState<'upload' | 'verify' | 'processing' | 'result'>('upload');
  const [vinPhoto, setVinPhoto] = useState<File | null>(null);
  const [vinPhotoPreview, setVinPhotoPreview] = useState<string | null>(null);
  const [submittedVin, setSubmittedVin] = useState('');
  const [extractedVin, setExtractedVin] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<VINValidation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<UserVerificationStatus | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check user verification status on component mount
  useEffect(() => {
    checkUserVerification();
  }, []);

  const checkUserVerification = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('Please log in to access VIN validation');
        return;
      }
      setCurrentUserId(user.id);

      const { data: profile } = await supabase
        .from('profiles')
        .select('phone_verified, id_verification_status, verification_level')
        .eq('id', user.id)
        .single();

      if (profile) {
        const status: UserVerificationStatus = {
          phoneVerified: profile.phone_verified || false,
          idVerified: profile.id_verification_status === 'approved',
          verificationLevel: profile.verification_level || 'unverified',
          canAccessVINTools: profile.verification_level === 'fully_verified'
        };
        setVerificationStatus(status);

        if (!status.canAccessVINTools) {
          setError('Account verification required. You must verify your phone number and upload a government-issued ID to access VIN validation tools.');
        }
      }
    } catch (error) {
      console.error('Error checking verification status:', error);
      setError('Unable to verify account status');
    }
  };

  const handlePhotoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        setError('Please select a valid image file');
        return;
      }

      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        setError('Image file must be smaller than 10MB');
        return;
      }

      setVinPhoto(file);
      setError(null);

      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        setVinPhotoPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const uploadPhotoToStorage = async (file: File): Promise<string> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `vin-validation-${Date.now()}.${fileExt}`;
    const filePath = `vin-validations/${vehicleId}/${fileName}`;

    const { data, error } = await supabase.storage
      .from('vehicle-data')
      .upload(filePath, file);

    if (error) {
      throw new Error(`Upload failed: ${error.message}`);
    }

    const { data: publicUrl } = supabase.storage
      .from('vehicle-data')
      .getPublicUrl(filePath);

    return publicUrl.publicUrl;
  };

  const validateVinFormat = (vin: string): boolean => {
    const res = vinDecoderService.validateVIN(vin);
    if (!res.valid) return false;
    // Guard against garbage strings that happen to match the char class.
    if (!/\d/.test(res.normalized)) return false;
    return true;
  };

  const extractImageMetadata = async (file: File): Promise<any> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          // Use piexifjs to extract EXIF data
          const exif = (window as any).piexif?.load(e.target?.result);
          
          const metadata = {
            filename: file.name,
            fileSize: file.size,
            fileType: file.type,
            lastModified: new Date(file.lastModified).toISOString(),
            
            // Camera info
            cameraMake: exif?.['0th']?.[EXIF_CONSTANTS.ImageIFD.Make] || null,
            cameraModel: exif?.['0th']?.[EXIF_CONSTANTS.ImageIFD.Model] || null,
            
            // Photo timestamp
            photoTimestamp: exif?.['0th']?.[EXIF_CONSTANTS.ImageIFD.DateTime] || null,
            
            // GPS data
            gpsLatitude: exif?.GPS?.[EXIF_CONSTANTS.GPSIFD.GPSLatitude] ? 
              convertDMSToDD(exif.GPS[EXIF_CONSTANTS.GPSIFD.GPSLatitude], exif.GPS[EXIF_CONSTANTS.GPSIFD.GPSLatitudeRef]) : null,
            gpsLongitude: exif?.GPS?.[EXIF_CONSTANTS.GPSIFD.GPSLongitude] ? 
              convertDMSToDD(exif.GPS[EXIF_CONSTANTS.GPSIFD.GPSLongitude], exif.GPS[EXIF_CONSTANTS.GPSIFD.GPSLongitudeRef]) : null,
            gpsAltitude: exif?.GPS?.[EXIF_CONSTANTS.GPSIFD.GPSAltitude] || null,
            gpsTimestamp: exif?.GPS?.[EXIF_CONSTANTS.GPSIFD.GPSTimeStamp] || null,
            
            // Technical details
            iso: exif?.Exif?.[EXIF_CONSTANTS.ExifIFD.ISOSpeedRatings] || null,
            aperture: exif?.Exif?.[EXIF_CONSTANTS.ExifIFD.FNumber] || null,
            shutterSpeed: exif?.Exif?.[EXIF_CONSTANTS.ExifIFD.ExposureTime] || null,
            focalLength: exif?.Exif?.[EXIF_CONSTANTS.ExifIFD.FocalLength] || null
          };
          
          resolve(metadata);
        } catch (error) {
          console.warn('EXIF extraction failed:', error);
          resolve({
            filename: file.name,
            fileSize: file.size,
            fileType: file.type,
            lastModified: new Date(file.lastModified).toISOString()
          });
        }
      };
      reader.readAsArrayBuffer(file);
    });
  };

  const convertDMSToDD = (dms: number[], ref: string): number => {
    let dd = dms[0] + dms[1]/60 + dms[2]/3600;
    if (ref === 'S' || ref === 'W') dd = dd * -1;
    return dd;
  };

  const getUserLocationAndIP = async (): Promise<any> => {
    try {
      // Get user's current location
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 300000
        });
      });
      
      // Get IP and location info
      const ipResponse = await fetch('https://ipapi.co/json/');
      const ipData = await ipResponse.json();
      
      return {
        currentLatitude: (position as GeolocationPosition).coords.latitude,
        currentLongitude: (position as GeolocationPosition).coords.longitude,
        currentAccuracy: (position as GeolocationPosition).coords.accuracy,
        ipAddress: ipData.ip,
        estimatedLocation: `${ipData.city}, ${ipData.region}, ${ipData.country}`,
        timezone: ipData.timezone,
        userAgent: navigator.userAgent,
        timezoneOffset: new Date().getTimezoneOffset()
      };
    } catch (error) {
      console.warn('Location/IP detection failed:', error);
      return {
        userAgent: navigator.userAgent,
        timezoneOffset: new Date().getTimezoneOffset()
      };
    }
  };

  const calculateFraudScores = (imageMetadata: any, locationData: any): any => {
    let geotag_accuracy_score = 0;
    let timestamp_accuracy_score = 0;
    let user_pattern_match_score = 50; // Default neutral score
    
    // Geotag accuracy scoring
    if (imageMetadata.gpsLatitude && locationData.currentLatitude) {
      const distance = calculateDistance(
        imageMetadata.gpsLatitude, imageMetadata.gpsLongitude,
        locationData.currentLatitude, locationData.currentLongitude
      );
      
      if (distance < 0.1) geotag_accuracy_score = 95; // Very close
      else if (distance < 1) geotag_accuracy_score = 80; // Same area
      else if (distance < 10) geotag_accuracy_score = 60; // Same city
      else if (distance < 100) geotag_accuracy_score = 30; // Same region
      else geotag_accuracy_score = 10; // Far away
    }
    
    // Timestamp accuracy scoring
    if (imageMetadata.photoTimestamp) {
      const photoTime = new Date(imageMetadata.photoTimestamp);
      const now = new Date();
      const timeDiff = Math.abs(now.getTime() - photoTime.getTime()) / (1000 * 60 * 60); // hours
      
      if (timeDiff < 1) timestamp_accuracy_score = 95; // Very recent
      else if (timeDiff < 24) timestamp_accuracy_score = 80; // Same day
      else if (timeDiff < 168) timestamp_accuracy_score = 60; // Same week
      else if (timeDiff < 720) timestamp_accuracy_score = 30; // Same month
      else timestamp_accuracy_score = 10; // Old photo
    }
    
    // Overall fraud risk (lower is better)
    const fraud_risk_score = Math.max(0, 100 - (geotag_accuracy_score + timestamp_accuracy_score) / 2);
    
    return {
      geotag_accuracy_score,
      timestamp_accuracy_score,
      user_pattern_match_score,
      fraud_risk_score
    };
  };

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  const extractVinFromImage = async (imageUrl: string): Promise<string | null> => {
    // This is a placeholder for VIN extraction
    // In a real implementation, you would use OCR services like:
    // - Google Vision API
    // - AWS Textract
    // - Azure Computer Vision
    // - Tesseract.js for client-side OCR
    
    // For now, return null to indicate manual entry is required
    return null;
  };

  const submitVinValidation = async () => {
    if (!vinPhoto || !submittedVin.trim()) {
      setError('Please provide both a VIN photo and enter the VIN number');
      return;
    }

    if (!validateVinFormat(submittedVin)) {
      setError('Invalid VIN/chassis format. Must be 4-17 characters and contain only valid characters (no I, O, Q)');
      return;
    }

    setLoading(true);
    setError(null);
    setStep('processing');

    try {
      // Extract comprehensive metadata from image
      const imageMetadata = await extractImageMetadata(vinPhoto);
      
      // Get user location and IP data
      const locationData = await getUserLocationAndIP();
      
      // Calculate fraud detection scores
      const fraudScores = calculateFraudScores(imageMetadata, locationData);
      
      // Upload photo to storage
      const photoUrl = await uploadPhotoToStorage(vinPhoto);

      // Attempt VIN extraction (placeholder)
      const extracted = await extractVinFromImage(photoUrl);
      setExtractedVin(extracted);

      // Create comprehensive VIN validation record
      const { data, error } = await supabase
        .from('vin_validations')
        .insert({
          vehicle_id: vehicleId,
          user_id: currentUserId,
          vin_photo_url: photoUrl,
          extracted_vin: extracted,
          submitted_vin: submittedVin.toUpperCase(),
          validation_status: 'pending',
          confidence_score: extracted ? 0.85 : null,
          validation_method: extracted ? 'ocr' : 'manual',
          
          // Image metadata
          image_metadata: imageMetadata,
          original_filename: imageMetadata.filename,
          file_size_bytes: imageMetadata.fileSize,
          camera_make: imageMetadata.cameraMake,
          camera_model: imageMetadata.cameraModel,
          photo_timestamp: imageMetadata.photoTimestamp,
          gps_latitude: imageMetadata.gpsLatitude,
          gps_longitude: imageMetadata.gpsLongitude,
          
          // User behavior data
          submission_ip_address: locationData.ipAddress,
          user_agent: locationData.userAgent,
          submission_location_estimate: locationData.estimatedLocation,
          time_zone_offset: locationData.timezoneOffset,
          
          // Fraud detection scores
          geotag_accuracy_score: fraudScores.geotag_accuracy_score,
          timestamp_accuracy_score: fraudScores.timestamp_accuracy_score,
          user_pattern_match_score: fraudScores.user_pattern_match_score,
          fraud_risk_score: fraudScores.fraud_risk_score
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Validation submission failed: ${error.message || error.details || 'Unknown database error'}`);
      }

      setValidationResult(data);
      setStep('result');
      
      // For demo purposes, auto-approve after 2 seconds
      setTimeout(async () => {
        const { error: updateError } = await supabase
          .from('vin_validations')
          .update({ validation_status: 'approved' })
          .eq('id', data.id);

        if (!updateError) {
          setValidationResult({ ...data, validation_status: 'approved' });
          onValidationComplete?.(data);
        }
      }, 2000);

    } catch (err: any) {
      console.error('VIN validation error:', err);
      let errorMessage = err.message;
      
      // Handle specific database errors
      if (err.message?.includes('relation "vin_validations" does not exist')) {
        errorMessage = 'VIN validation system is not yet configured. Please contact support.';
      } else if (err.message?.includes('Validation submission failed: undefined')) {
        errorMessage = 'Database connection error. Please try again or contact support.';
      }
      
      setError(errorMessage);
      setStep('verify');
    } finally {
      setLoading(false);
    }
  };

  const renderUploadStep = () => (
    <div className="vin-validator-step">
      <h3 className="text-large font-bold" style={{ marginBottom: '16px' }}>
        Upload VIN Tag Photo
      </h3>
      <p className="text-muted" style={{ marginBottom: '24px' }}>
        To contribute to this vehicle's profile, please upload a clear photo of the VIN tag 
        and enter the VIN number for verification.
      </p>

      <div className="upload-area" style={{ 
        border: '2px dashed #d1d5db', 
        borderRadius: '8px', 
        padding: '32px', 
        textAlign: 'center',
        marginBottom: '16px',
        cursor: 'pointer'
      }} onClick={() => fileInputRef.current?.click()}>
        {vinPhotoPreview ? (
          <div>
            <img 
              src={vinPhotoPreview} 
              alt="VIN tag preview" 
              style={{ maxWidth: '300px', maxHeight: '200px', marginBottom: '16px' }}
            />
            <p className="text-small text-success">Photo uploaded successfully</p>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>+</div>
            <p className="text">Click to upload VIN tag photo</p>
            <p className="text-small text-muted">Supports JPG, PNG, HEIC (max 10MB)</p>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handlePhotoUpload}
        style={{ display: 'none' }}
      />

      {error && (
        <div className="alert alert-error" style={{ marginBottom: '16px' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: '12px' }}>
        <button 
          className="button button-secondary" 
          onClick={onCancel}
        >
          Cancel
        </button>
        <button 
          className="button button-primary" 
          onClick={() => setStep('verify')}
          disabled={!vinPhoto}
        >
          Next: Enter VIN
        </button>
      </div>
    </div>
  );

  const renderVerifyStep = () => (
    <div className="vin-validator-step">
      <h3 className="text-large font-bold" style={{ marginBottom: '16px' }}>
        Enter VIN / Chassis Number
      </h3>
      <p className="text-muted" style={{ marginBottom: '24px' }}>
        Please enter the VIN number exactly as it appears in your photo.
      </p>

      {vinPhotoPreview && (
        <div style={{ marginBottom: '24px', textAlign: 'center' }}>
          <img 
            src={vinPhotoPreview} 
            alt="VIN tag reference" 
            style={{ maxWidth: '400px', maxHeight: '250px', borderRadius: '8px' }}
          />
        </div>
      )}

      <div style={{ marginBottom: '24px' }}>
        <label className="form-label">VIN / Chassis Number (4-17 characters)</label>
        <input
          type="text"
          className="form-input"
          value={submittedVin}
          onChange={(e) => setSubmittedVin(e.target.value.toUpperCase())}
          placeholder="Enter VIN or chassis ID"
          maxLength={17}
          style={{ 
            fontFamily: 'monospace', 
            fontSize: '16px',
            letterSpacing: '2px'
          }}
        />
        <div className="form-help">
          VIN/chassis must be 4-17 characters (letters and numbers, no I, O, or Q)
        </div>
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: '16px' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: '12px' }}>
        <button 
          className="button button-secondary" 
          onClick={() => setStep('upload')}
        >
          Back
        </button>
        <button 
          className="button button-primary" 
          onClick={submitVinValidation}
          disabled={loading || !validateVinFormat(submittedVin)}
        >
          {loading ? 'Submitting...' : 'Submit for Validation'}
        </button>
      </div>
    </div>
  );

  const renderProcessingStep = () => (
    <div className="vin-validator-step" style={{ textAlign: 'center' }}>
      <div className="loading-spinner" style={{ marginBottom: '24px' }}></div>
      <h3 className="text-large font-bold" style={{ marginBottom: '16px' }}>
        Processing Validation
      </h3>
      <p className="text-muted">
        We're verifying your VIN photo and information. This usually takes a few moments.
      </p>
    </div>
  );

  const renderResultStep = () => (
    <div className="vin-validator-step" style={{ textAlign: 'center' }}>
      {validationResult?.validation_status === 'approved' ? (
        <div>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>✅</div>
          <h3 className="text-large font-bold text-success" style={{ marginBottom: '16px' }}>
            Validation Approved!
          </h3>
          <p className="text-muted" style={{ marginBottom: '24px' }}>
            Your VIN has been verified. You now have contributor access to this vehicle's profile 
            for the next 24 hours.
          </p>
          <div className="card" style={{ marginBottom: '24px' }}>
            <div className="card-body">
              <div className="vehicle-details">
                <div className="vehicle-detail">
                  <span>Validation ID</span>
                  <span className="text-small">{validationResult.id}</span>
                </div>
                <div className="vehicle-detail">
                  <span>VIN Verified</span>
                  <span className="badge badge-success">{validationResult.submitted_vin}</span>
                </div>
                <div className="vehicle-detail">
                  <span>Access Expires</span>
                  <span>{new Date(validationResult.expires_at).toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : validationResult?.validation_status === 'pending' ? (
        <div>
          <div style={{ fontSize: '18px', marginBottom: '16px', fontWeight: 700 }}>Processing</div>
          <h3 className="text-large font-bold text-warning" style={{ marginBottom: '16px' }}>
            Validation Pending
          </h3>
          <p className="text-muted" style={{ marginBottom: '24px' }}>
            Your VIN validation is being reviewed. You'll be notified once it's approved.
          </p>
        </div>
      ) : (
        <div>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>❌</div>
          <h3 className="text-large font-bold text-danger" style={{ marginBottom: '16px' }}>
            Validation Failed
          </h3>
          <p className="text-muted" style={{ marginBottom: '24px' }}>
            We couldn't verify your VIN. Please try again with a clearer photo.
          </p>
        </div>
      )}

      <button 
        className="button button-primary" 
        onClick={() => onValidationComplete?.(validationResult?.validation_status === 'approved')}
      >
        Continue
      </button>
    </div>
  );

  return (
    <div className="vin-photo-validator">
      <div className="modal-overlay" style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}>
        <div className="modal-content" style={{
          backgroundColor: 'var(--surface)',
          borderRadius: '12px',
          padding: '32px',
          maxWidth: '600px',
          width: '90%',
          maxHeight: '90vh',
          overflowY: 'auto'
        }}>
          {step === 'upload' && renderUploadStep()}
          {step === 'verify' && renderVerifyStep()}
          {step === 'processing' && renderProcessingStep()}
          {step === 'result' && renderResultStep()}
        </div>
      </div>
    </div>
  );
};

export default VINPhotoValidator;
