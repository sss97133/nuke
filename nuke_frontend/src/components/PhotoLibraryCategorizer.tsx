import React, { useState, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { visionAPI } from '../api/visionAPI';
import type { DropboxService } from '../services/dropboxService';
import type { VehicleImportPipeline } from '../services/vehicleImportPipeline';
import type { Camera, MapPin, Calendar, Car, Upload, Check, X, Plus, Eye, Trash2, FolderPlus, Cloud } from 'lucide-react';
import * as exifr from 'exifr';

// Simple auth hook to work with existing session-based auth
const useAuth = () => {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user || null);
      setLoading(false);
    };
    
    checkAuth();
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user || null);
      setLoading(false);
    });
    
    return () => subscription.unsubscribe();
  }, []);
  
  return { user, loading };
};

interface PhotoItem {
  id: string;
  file: File;
  preview: string;
  name?: string;
  dropboxPath?: string;
  timestamp?: Date;
  exifData?: {
    camera?: string;
    gps?: {
      latitude: number;
      longitude: number;
    };
    location?: string;
    business?: string;
    authorshipScore?: number;
  };
  aiAnalysis?: {
    isVehicle: boolean;
    vehicleDetails?: {
      make?: string;
      model?: string;
      year?: string;
      color?: string;
      confidence: number;
    };
    suggestedVehicleId?: string;
    suggestedVehicleName?: string;
  };
  assignedVehicleId?: string;
  assignedVehicleName?: string;
}

interface VehicleCluster {
  id: string;
  vehicleDetails: {
    make: string;
    model: string;
    year?: string;
    color: string;
    confidence: number;
  };
  photos: PhotoItem[];
  representativePhoto: PhotoItem;
}

const PhotoLibraryCategorizer: React.FC = () => {
  const { user } = useAuth();
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<string>('');
  const [userVehicles, setUserVehicles] = useState<any[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [vehicleClusters, setVehicleClusters] = useState<VehicleCluster[]>([]);
  const [showNewVehicleForm, setShowNewVehicleForm] = useState(false);
  const [newVehicleData, setNewVehicleData] = useState({
    make: '', model: '', year: '', color: ''
  });
  const [userCameraPattern] = useState<string>('iPhone 15 Pro'); // User's actual camera
  const [quickAddProgress, setQuickAddProgress] = useState(0);
  const [activeTab, setActiveTab] = useState('categorize');
  const [dropboxConnected, setDropboxConnected] = useState(false);
  const [dropboxLoading, setDropboxLoading] = useState(false);
  const [dropboxVehicles, setDropboxVehicles] = useState<any[]>([]);

  useEffect(() => {
    if (user) {
      loadUserVehicles();
      checkDropboxConnection();
    }
  }, [user]);

  const checkDropboxConnection = () => {
    const accessToken = localStorage.getItem('dropbox_access_token');
    setDropboxConnected(!!accessToken);
  };

  const loadUserVehicles = async () => {
    try {
      const { data: vehicles, error } = await supabase
        .from('vehicles')
        .select('*')
        .eq('user_id', user?.id);

      if (error) throw error;

      const vehiclesWithDisplayName = vehicles?.map(vehicle => ({
        ...vehicle,
        displayName: `${vehicle.year || ''} ${vehicle.make} ${vehicle.model}`.trim()
      })) || [];
      
      setUserVehicles(vehiclesWithDisplayName);
    } catch (error) {
      console.error('Error loading user vehicles:', error);
    }
  };

  // Proper EXIF extraction with real data
  const extractEXIFData = async (file: File): Promise<PhotoItem['exifData']> => {
    try {
      const exif = await exifr.parse(file, {
        gps: true,
        pick: ['Make', 'Model', 'DateTime', 'GPS', 'latitude', 'longitude', 'Software', 'LensModel']
      });
      
      if (!exif) {
        return {};
      }

      const exifData: PhotoItem['exifData'] = {};
      
      // Extract camera info - handle iPhone specifically
      if (exif.Make && exif.Model) {
        exifData.camera = `${exif.Make} ${exif.Model}`;
      } else if (exif.LensModel && exif.LensModel.includes('iPhone')) {
        // Extract iPhone model from lens info
        const match = exif.LensModel.match(/iPhone (\d+(?:\s+Pro)?)/i);
        if (match) {
          exifData.camera = `iPhone ${match[1]}`;
        }
      } else if (exif.Software) {
        // Try to extract from software string
        const iphoneMatch = exif.Software.match(/(\d+\.\d+)/);
        if (iphoneMatch && exif.Software.toLowerCase().includes('ios')) {
          // This is likely an iPhone - use user's known pattern
          exifData.camera = userCameraPattern;
        }
      }
      
      // Extract GPS coordinates - only use real data
      if (exif.latitude && exif.longitude && 
          Math.abs(exif.latitude) > 0.001 && Math.abs(exif.longitude) > 0.001) {
        exifData.gps = {
          latitude: exif.latitude,
          longitude: exif.longitude
        };
        
        // Only do reverse geocoding if we have real GPS data
        exifData.location = await reverseGeocode(exif.latitude, exif.longitude);
      }
      
      // Calculate authorship score based on camera pattern matching
      if (exifData.camera && userCameraPattern) {
        exifData.authorshipScore = exifData.camera.toLowerCase().includes(userCameraPattern.toLowerCase()) ? 0.9 : 0.1;
      }
      
      return exifData;
    } catch (error) {
      console.error('Error extracting EXIF data:', error);
      return {};
    }
  };

  const reverseGeocode = async (lat: number, lng: number): Promise<string> => {
    try {
      const response = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`);
      const data = await response.json();
      return data.locality || data.city || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } catch (error) {
      console.error('Reverse geocoding failed:', error);
      return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
  };

  // Quick Add - simple bulk upload without categorization
  const handleQuickAdd = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    setQuickAddProgress(0);
    const newPhotos: PhotoItem[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const preview = URL.createObjectURL(file);
      const timestamp = new Date(file.lastModified);
      const exifData = await extractEXIFData(file);
      
      const photoItem: PhotoItem = {
        id: `photo-${Date.now()}-${i}`,
        file,
        preview,
        timestamp,
        exifData
      };

      newPhotos.push(photoItem);
      setQuickAddProgress(Math.round(((i + 1) / files.length) * 100));
    }

    setPhotos(prev => [...prev, ...newPhotos]);
    setQuickAddProgress(0);
    
    // Auto-switch to categorize tab if they want to organize
    if (newPhotos.length > 0) {
      setActiveTab('categorize');
    }
  }, [userCameraPattern]);

  // Full analysis workflow (existing functionality)
  const handlePhotoLibraryAccess = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    setIsAnalyzing(true);
    setAnalysisProgress(0);

    const newPhotos: PhotoItem[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const preview = URL.createObjectURL(file);
      const timestamp = new Date(file.lastModified);
      const exifData = await extractEXIFData(file);
      
      const photoItem: PhotoItem = {
        id: `photo-${Date.now()}-${i}`,
        file,
        preview,
        timestamp,
        exifData
      };

      // AI vehicle detection
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });

      try {
        const aiResponse = await visionAPI.analyzeVehicle(base64);
        
        const isVehicle = (aiResponse.confidence || 0) > 0.5;
        const vehicleDetails = isVehicle ? {
          make: aiResponse.identification?.make || '',
          model: aiResponse.identification?.model || '',
          year: aiResponse.identification?.year?.toString() || '',
          color: aiResponse.color || '',
          confidence: aiResponse.confidence || 0
        } : undefined;

        if (isVehicle && vehicleDetails) {
          const matchingVehicle = userVehicles.find(vehicle => {
            const makeMatch = vehicle.make?.toLowerCase() === vehicleDetails.make?.toLowerCase();
            const modelMatch = vehicle.model?.toLowerCase() === vehicleDetails.model?.toLowerCase();
            return makeMatch && modelMatch;
          });

          photoItem.aiAnalysis = {
            isVehicle,
            vehicleDetails,
            suggestedVehicleId: matchingVehicle?.id,
            suggestedVehicleName: matchingVehicle?.displayName
          };
        } else {
          photoItem.aiAnalysis = { isVehicle, vehicleDetails };
        }
      } catch (error) {
        console.error('Error analyzing photo:', error);
        photoItem.aiAnalysis = { isVehicle: false, vehicleDetails: { confidence: 0 } };
      }

      newPhotos.push(photoItem);
      setAnalysisProgress(Math.round(((i + 1) / files.length) * 100));
    }

    setPhotos(newPhotos);
    
    // Auto-cluster photos by vehicle characteristics
    const clusters = await clusterPhotosByVehicle(newPhotos.filter(p => p.aiAnalysis?.isVehicle));
    setVehicleClusters(clusters);
    
    setIsAnalyzing(false);
  }, [userVehicles, userCameraPattern]);

  const clusterPhotosByVehicle = async (vehiclePhotos: PhotoItem[]): Promise<VehicleCluster[]> => {
    const clusters: VehicleCluster[] = [];
    
    for (const photo of vehiclePhotos) {
      if (!photo.aiAnalysis?.vehicleDetails) continue;
      
      const { make, model, color, confidence } = photo.aiAnalysis.vehicleDetails;
      
      if (photo.aiAnalysis.suggestedVehicleId) continue;
      
      let cluster = clusters.find(c => 
        c.vehicleDetails.make?.toLowerCase() === make?.toLowerCase() &&
        c.vehicleDetails.model?.toLowerCase() === model?.toLowerCase() &&
        c.vehicleDetails.color?.toLowerCase() === color?.toLowerCase()
      );
      
      if (!cluster) {
        cluster = {
          id: `cluster-${clusters.length}`,
          vehicleDetails: { make: make || '', model: model || '', color: color || '', confidence },
          photos: [],
          representativePhoto: photo
        };
        clusters.push(cluster);
      }
      
      cluster.photos.push(photo);
      
      if (confidence > (cluster.representativePhoto.aiAnalysis?.vehicleDetails?.confidence || 0)) {
        cluster.representativePhoto = photo;
      }
    }
    
    return clusters.filter(c => c.photos.length > 1);
  };

  const assignPhotoToVehicle = (photoId: string, vehicleId: string, vehicleName: string) => {
    setPhotos(prev => prev.map(photo => 
      photo.id === photoId 
        ? { ...photo, assignedVehicleId: vehicleId, assignedVehicleName: vehicleName }
        : photo
    ));
  };

  const unassignPhoto = (photoId: string) => {
    setPhotos(prev => prev.map(photo => 
      photo.id === photoId 
        ? { ...photo, assignedVehicleId: undefined, assignedVehicleName: undefined }
        : photo
    ));
  };

  const handleDropboxConnect = () => {
    const dropboxClientId = import.meta.env.VITE_DROPBOX_CLIENT_ID;
    if (!dropboxClientId) {
      alert('Dropbox Client ID not configured');
      return;
    }

    const dropboxService = DropboxService.getInstance({ clientId: dropboxClientId });
    const authUrl = dropboxService.generateAuthUrl();
    window.location.href = authUrl;
  };

  const clearDropboxToken = () => {
    localStorage.removeItem('dropbox_access_token');
    setDropboxConnected(false);
    alert('Dropbox token cleared. Click "Connect Dropbox" to re-authorize with updated permissions.');
  };

  const importFromDropbox = () => {
    // Use Dropbox Chooser instead of API calls
    if (typeof window !== 'undefined' && (window as any).Dropbox) {
      (window as any).Dropbox.choose({
        success: (files: any[]) => {
          console.log('Selected files from Dropbox:', files);
          
          const importedPhotos: PhotoItem[] = files
            .filter(file => file.name.match(/\.(jpg|jpeg|png|gif|bmp|webp)$/i))
            .map(file => ({
              id: `dropbox-${file.id}`,
              file: null as any,
              preview: file.link,
              name: file.name,
              dropboxPath: file.name,
              aiAnalysis: { isVehicle: false, vehicleDetails: { confidence: 0 } }
            }));
          
          setPhotos(prev => [...prev, ...importedPhotos]);
          
          if (importedPhotos.length > 0) {
            alert(`Successfully imported ${importedPhotos.length} photos from Dropbox`);
          } else {
            alert('No image files selected');
          }
        },
        cancel: () => {
          console.log('Dropbox chooser cancelled');
        },
        linkType: 'preview',
        multiselect: true,
        extensions: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'],
        folderselect: false
      });
    } else {
      alert('Dropbox Chooser not loaded. Please refresh the page.');
    }
  };

  const extractYearFromFolderName = (folderName: string): string => {
    const yearMatch = folderName.match(/\b(19|20)\d{2}\b/);
    return yearMatch ? yearMatch[0] : '';
  };

  const extractMakeFromFolderName = (folderName: string): string => {
    const makes = [
      'Acura', 'Alfa Romeo', 'Aston Martin', 'Audi', 'Bentley', 'BMW', 'Buick', 'Cadillac', 
      'Chevrolet', 'Chevy', 'Chrysler', 'Dodge', 'Ferrari', 'Fiat', 'Ford', 'Genesis', 
      'GMC', 'Honda', 'Hyundai', 'Infiniti', 'Jaguar', 'Jeep', 'Kia', 'Lamborghini', 
      'Land Rover', 'Lexus', 'Lincoln', 'Maserati', 'Mazda', 'McLaren', 'Mercedes', 
      'Mercedes-Benz', 'Mini', 'Mitsubishi', 'Nissan', 'Porsche', 'Ram', 'Rolls-Royce', 
      'Subaru', 'Tesla', 'Toyota', 'Volkswagen', 'VW', 'Volvo'
    ];
    
    for (const make of makes) {
      const makeRegex = new RegExp(`\\b${make.replace('-', '[-\\s]?')}\\b`, 'i');
      if (makeRegex.test(folderName)) {
        return make === 'Chevy' ? 'Chevrolet' : make === 'VW' ? 'Volkswagen' : make;
      }
    }
    return '';
  };

  const extractModelFromFolderName = (folderName: string): string => {
    const make = extractMakeFromFolderName(folderName);
    const year = extractYearFromFolderName(folderName);
    
    if (make && year) {
      const makeIndex = folderName.toLowerCase().indexOf(make.toLowerCase());
      let modelPart = folderName.substring(makeIndex + make.length).trim();
      modelPart = modelPart.replace(year, '').trim();
      return modelPart;
    }
    return '';
  };

  const renderPhotoGrid = () => {
    return (
      <div className="row">
        {photos.map(photo => {
          const isAssigned = !!photo.assignedVehicleId;
          const hasSuggestion = !!photo.aiAnalysis?.suggestedVehicleId;
          
          return (
            <div key={photo.id} className="col-md-3 mb-3">
              <div className={`card ${isAssigned ? 'border-success' : hasSuggestion ? 'border-warning' : ''}`}>
                <img 
                  src={photo.preview} 
                  className="card-img-top" 
                  style={{ height: '200px', objectFit: 'cover' }}
                  alt="Vehicle"
                />
                <div className="card-body p-2">
                  {photo.aiAnalysis?.isVehicle && (
                    <div className="mb-2">
                      <span className="badge bg-primary me-1">Vehicle</span>
                      <small className="text-muted d-block">
                        <strong>Detected:</strong> {photo.aiAnalysis.vehicleDetails?.make} {photo.aiAnalysis.vehicleDetails?.model}
                        {photo.aiAnalysis.vehicleDetails?.color && ` (${photo.aiAnalysis.vehicleDetails.color})`}
                      </small>
                    </div>
                  )}
                  
                  {photo.exifData && (
                    <div className="mb-2">
                      {photo.exifData.camera && (
                        <small className="text-muted d-block">📷 {photo.exifData.camera}</small>
                      )}
                      {photo.exifData.location && (
                        <small className="text-muted d-block">📍 {photo.exifData.location}</small>
                      )}
                      {photo.exifData.authorshipScore && photo.exifData.authorshipScore > 0.8 && (
                        <small className="text-success d-block">✓ Your photo</small>
                      )}
                    </div>
                  )}
                  
                  {isAssigned ? (
                    <div className="d-flex justify-content-between align-items-center">
                      <small className="text-success">
                        ✓ {photo.assignedVehicleName}
                      </small>
                      <button
                        className="btn btn-sm btn-outline-danger"
                        onClick={() => unassignPhoto(photo.id)}
                      >
                        ✕
                      </button>
                    </div>
                  ) : hasSuggestion ? (
                    <div className="d-grid">
                      <button
                        className="btn btn-sm btn-warning"
                        onClick={() => assignPhotoToVehicle(
                          photo.id, 
                          photo.aiAnalysis!.suggestedVehicleId!, 
                          photo.aiAnalysis!.suggestedVehicleName!
                        )}
                      >
                        → {photo.aiAnalysis?.suggestedVehicleName}
                      </button>
                    </div>
                  ) : (
                    <select 
                      className="form-select form-select-sm"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) {
                          const vehicle = userVehicles.find(v => v.id === e.target.value);
                          assignPhotoToVehicle(photo.id, e.target.value, vehicle?.displayName || '');
                        }
                      }}
                    >
                      <option value="">Assign to vehicle...</option>
                      {userVehicles.map(vehicle => (
                        <option key={vehicle.id} value={vehicle.id}>
                          {vehicle.displayName}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="container-fluid py-4">


      <div className="card mb-4">
          <div className="card-body">
            {/* Upload Options */}
            <div className="row mb-4">
              <div className="col-md-6">
                <div className="border border-dashed border-2 rounded p-4 text-center h-100">
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={handlePhotoLibraryAccess}
                    className="d-none"
                    id="categorize-input"
                  />
                  <label htmlFor="categorize-input" className="cursor-pointer">
                    <Camera size={40} className="text-muted mb-2" />
                  </label>
                </div>
              </div>
              <div className="col-md-6">
                <div className="border border-dashed border-2 rounded p-4 text-center h-100">
                  {!dropboxConnected ? (
                    <div className="cursor-pointer" onClick={handleDropboxConnect}>
                      <Cloud size={40} className="text-muted mb-2" />
                    </div>
                  ) : (
                    <div>
                      <div className="cursor-pointer" onClick={importFromDropbox}>
                        <Cloud size={40} className="text-primary mb-2" />
                      </div>
                      <button 
                        className="btn btn-sm btn-outline-secondary mt-2"
                        onClick={clearDropboxToken}
                        title="Clear token and re-authorize with updated permissions"
                      >
                        ↻
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            {/* Progress Indicators */}
            {isAnalyzing && (
              <div className="mb-3">
                <div className="d-flex justify-content-between mb-1">
                  <span>Analyzing photos with AI...</span>
                  <span>{analysisProgress}%</span>
                </div>
                <div className="progress">
                  <div 
                    className="progress-bar" 
                    style={{width: `${analysisProgress}%`}}
                  ></div>
                </div>
              </div>
            )}

            {dropboxLoading && (
              <div className="mb-3">
                <div className="d-flex justify-content-between mb-1">
                  <span>Importing from Dropbox...</span>
                  <span>Processing</span>
                </div>
                <div className="progress">
                  <div className="progress-bar progress-bar-striped progress-bar-animated" style={{width: '100%'}}></div>
                </div>
              </div>
            )}

          </div>
      </div>

      {/* Photo Grid */}
      {photos.length > 0 && renderPhotoGrid()}

      {/* Auto-Clusters Tab */}
      {activeTab === 'clusters' && vehicleClusters.length > 0 && (
        <div className="mt-4">
          <h4>Auto-Detected Vehicle Clusters</h4>
          {vehicleClusters.map(cluster => (
            <div key={cluster.id} className="card mb-3">
              <div className="card-body">
                <h6 className="card-title">
                  {cluster.vehicleDetails.make} {cluster.vehicleDetails.model}
                  {cluster.vehicleDetails.color && ` (${cluster.vehicleDetails.color})`}
                </h6>
                <p className="card-text">
                  <small className="text-muted">
                    {cluster.photos.length} photos detected • 
                    {Math.round(cluster.vehicleDetails.confidence * 100)}% confidence
                  </small>
                </p>
                <div className="d-flex flex-wrap gap-1 mb-3">
                  {cluster.photos.slice(0, 4).map((photo, idx) => (
                    <img 
                      key={idx}
                      src={photo.preview} 
                      style={{ width: '60px', height: '60px', objectFit: 'cover' }}
                      className="rounded border"
                      alt={`Photo ${idx + 1}`}
                    />
                  ))}
                  {cluster.photos.length > 4 && (
                    <div 
                      className="d-flex align-items-center justify-content-center rounded border bg-light"
                      style={{ width: '60px', height: '60px' }}
                    >
                      +{cluster.photos.length - 4}
                    </div>
                  )}
                </div>
                <button 
                  className="btn btn-primary"
                  onClick={() => {
                    // Create vehicle profile from cluster
                    console.log('Creating vehicle profile for cluster:', cluster);
                  }}
                >
                  Create Vehicle Profile
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PhotoLibraryCategorizer;
export { PhotoLibraryCategorizer };
