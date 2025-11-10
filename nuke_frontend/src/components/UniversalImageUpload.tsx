import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';

interface Photo {
  file: File;
  preview: string;
  timestamp: Date;
  gps?: { lat: number; lng: number };
  exif?: any;
}

interface PhotoSession {
  id: string;
  photos: Photo[];
  startTime: Date;
  endTime: Date;
  location?: string;
  suggestedVehicle?: {
    id: string;
    name: string;
    confidence: number;
  };
  manualVehicleId?: string;
}

interface MobilePhotoDumpProps {
  onClose: () => void;
  session: any;
  vehicleId?: string;  // Pre-select vehicle if on vehicle page
}

export function UniversalImageUpload({ onClose, session, vehicleId }: MobilePhotoDumpProps) {
  const user = session?.user;
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [sessions, setSessions] = useState<PhotoSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [vehicles, setVehicles] = useState<any[]>([]);

  React.useEffect(() => {
    loadVehicles();
  }, []);

  const loadVehicles = async () => {
    const { data } = await supabase
      .from('vehicles')
      .select('id, year, make, model')
      .eq('owner_id', user?.id)
      .order('year', { ascending: false });
    
    if (data) {
      setVehicles(data);
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    setLoading(true);
    setAnalyzing(true);

    try {
      // Extract EXIF data from all photos
      const photoPromises = files.map(async (file) => {
        const preview = URL.createObjectURL(file);
        const exif = await extractEXIF(file);
        
        return {
          file,
          preview,
          timestamp: exif.timestamp || new Date(file.lastModified),
          gps: exif.gps,
          exif,
        };
      });

      const loadedPhotos = await Promise.all(photoPromises);
      setPhotos(loadedPhotos);

      // Cluster into sessions
      const clusteredSessions = await clusterPhotosIntoSessions(loadedPhotos);
      
      // Analyze each session for vehicle matching
      const analyzedSessions = await Promise.all(
        clusteredSessions.map(session => analyzeSession(session))
      );
      
      // If vehicleId provided, auto-assign to that vehicle
      if (vehicleId) {
        analyzedSessions.forEach(s => s.manualVehicleId = vehicleId);
      }

      setSessions(analyzedSessions);
    } catch (error) {
      console.error('Error processing photos:', error);
      alert('Error processing photos. Please try again.');
    } finally {
      setLoading(false);
      setAnalyzing(false);
    }
  };

  const extractEXIF = async (file: File): Promise<any> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          // Simple EXIF extraction - in production, use exif-js library
          const view = new DataView(e.target?.result as ArrayBuffer);
          
          // Basic GPS extraction (simplified)
          // Real implementation would parse full EXIF tags
          resolve({
            timestamp: new Date(file.lastModified),
            gps: null, // Will be populated by full EXIF parser
          });
        } catch (error) {
          resolve({ timestamp: new Date(file.lastModified) });
        }
      };
      reader.readAsArrayBuffer(file.slice(0, 64 * 1024)); // Read first 64KB for EXIF
    });
  };

  const clusterPhotosIntoSessions = async (photos: Photo[]): Promise<PhotoSession[]> => {
    // Sort by timestamp
    const sorted = [...photos].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    const sessions: PhotoSession[] = [];
    let currentSession: Photo[] = [sorted[0]];
    
    for (let i = 1; i < sorted.length; i++) {
      const timeDiff = sorted[i].timestamp.getTime() - sorted[i - 1].timestamp.getTime();
      const thirtyMinutes = 30 * 60 * 1000;
      
      // If photos are within 30 minutes, same session
      if (timeDiff < thirtyMinutes) {
        currentSession.push(sorted[i]);
      } else {
        // Save current session, start new one
        sessions.push({
          id: `session-${sessions.length}`,
          photos: currentSession,
          startTime: currentSession[0].timestamp,
          endTime: currentSession[currentSession.length - 1].timestamp,
        });
        currentSession = [sorted[i]];
      }
    }
    
    // Add last session
    if (currentSession.length > 0) {
      sessions.push({
        id: `session-${sessions.length}`,
        photos: currentSession,
        startTime: currentSession[0].timestamp,
        endTime: currentSession[currentSession.length - 1].timestamp,
      });
    }
    
    return sessions;
  };

  const analyzeSession = async (session: PhotoSession): Promise<PhotoSession> => {
    try {
      // Check GPS locations
      const gpsPhotos = session.photos.filter(p => p.gps);
      
      if (gpsPhotos.length > 0) {
        // Calculate average GPS
        const avgGPS = {
          lat: gpsPhotos.reduce((sum, p) => sum + p.gps!.lat, 0) / gpsPhotos.length,
          lng: gpsPhotos.reduce((sum, p) => sum + p.gps!.lng, 0) / gpsPhotos.length,
        };
        
        // Reverse geocode for location name
        const location = await reverseGeocode(avgGPS.lat, avgGPS.lng);
        session.location = location;
        
        // Find vehicles near this GPS
        const { data: nearbyVehicles } = await supabase.rpc('find_vehicles_near_gps', {
          p_lat: avgGPS.lat,
          p_lng: avgGPS.lng,
          p_radius_meters: 100,
          p_user_id: user?.id,
        });
        
        if (nearbyVehicles && nearbyVehicles.length === 1) {
          session.suggestedVehicle = {
            id: nearbyVehicles[0].id,
            name: `${nearbyVehicles[0].year} ${nearbyVehicles[0].make} ${nearbyVehicles[0].model}`,
            confidence: 95,
          };
        } else if (nearbyVehicles && nearbyVehicles.length > 1) {
          // Multiple matches, lower confidence
          session.suggestedVehicle = {
            id: nearbyVehicles[0].id,
            name: `${nearbyVehicles[0].year} ${nearbyVehicles[0].make} ${nearbyVehicles[0].model}`,
            confidence: 60,
          };
        }
      }
      
      // If no GPS, check user's recent work history
      if (!session.suggestedVehicle) {
        const { data: recentWork } = await supabase
          .from('vehicle_timeline_events')
          .select('vehicle_id, vehicles(year, make, model)')
          .eq('user_id', user?.id)
          .gte('event_date', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
          .order('event_date', { ascending: false })
          .limit(5);
        
        if (recentWork && recentWork.length > 0) {
          // Find most common vehicle
          const vehicleCounts = recentWork.reduce((acc: any, r: any) => {
            acc[r.vehicle_id] = (acc[r.vehicle_id] || 0) + 1;
            return acc;
          }, {});
          
          const mostCommon = Object.entries(vehicleCounts).sort((a: any, b: any) => b[1] - a[1])[0];
          const vehicle = recentWork.find((r: any) => r.vehicle_id === mostCommon[0]);
          
          if (vehicle) {
            session.suggestedVehicle = {
              id: vehicle.vehicle_id,
              name: `${vehicle.vehicles.year} ${vehicle.vehicles.make} ${vehicle.vehicles.model}`,
              confidence: 70,
            };
          }
        }
      }
      
      return session;
    } catch (error) {
      console.error('Error analyzing session:', error);
      return session;
    }
  };

  const reverseGeocode = async (lat: number, lng: number): Promise<string> => {
    try {
      // Use OpenStreetMap Nominatim (free, no API key needed)
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`
      );
      const data = await response.json();
      return data.display_name?.split(',').slice(0, 2).join(',') || 'Unknown location';
    } catch (error) {
      return 'Unknown location';
    }
  };

  const handleVehicleChange = (sessionId: string, vehicleId: string) => {
    setSessions(sessions.map(s => 
      s.id === sessionId 
        ? { ...s, manualVehicleId: vehicleId }
        : s
    ));
  };

  const handleUploadAll = async () => {
    if (!user) return;
    
    setUploading(true);
    setUploadProgress(0);
    
    try {
      let uploadedCount = 0;
      const totalPhotos = photos.length;
      
      for (const session of sessions) {
        const vehicleId = session.manualVehicleId || session.suggestedVehicle?.id;
        
        if (!vehicleId) {
          alert(`Please select a vehicle for session starting at ${formatTime(session.startTime)}`);
          setUploading(false);
          return;
        }
        
        // Upload all photos in this session
        for (const photo of session.photos) {
          try {
            // Upload to storage
            const fileName = `${user.id}/${Date.now()}_${photo.file.name}`;
            const { data: uploadData, error: uploadError } = await supabase.storage
              .from('vehicle-images')
              .upload(fileName, photo.file);
            
            if (uploadError) throw uploadError;
            
            // Get public URL
            const { data: { publicUrl } } = supabase.storage
              .from('vehicle-images')
              .getPublicUrl(fileName);
            
            // Create image record
            const { data: imageData, error: imageError } = await supabase
              .from('vehicle_images')
              .insert({
                vehicle_id: vehicleId,
                image_url: publicUrl,
                uploaded_by: user.id,
                metadata: {
                  gps: photo.gps,
                  timestamp: photo.timestamp.toISOString(),
                  session_id: session.id,
                },
              })
              .select()
              .single();
            
            if (imageError) throw imageError;
            
            // Create timeline event for this photo
            await supabase
              .from('vehicle_timeline_events')
              .insert({
                vehicle_id: vehicleId,
                user_id: user.id,
                event_type: 'image_added',
                title: 'Work Photo',
                event_date: photo.timestamp.toISOString(),
                metadata: {
                  image_id: imageData.id,
                  gps: photo.gps,
                  location: session.location,
                  session_id: session.id,
                },
              });
            
            uploadedCount++;
            setUploadProgress((uploadedCount / totalPhotos) * 100);
          } catch (error) {
            console.error('Error uploading photo:', error);
          }
        }
      }
      
      alert(`Successfully uploaded ${uploadedCount} photos!`);
      onClose();
      window.location.reload(); // Refresh to show new photos
    } catch (error) {
      console.error('Error uploading photos:', error);
      alert('Error uploading photos. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const formatTimeRange = (start: Date, end: Date) => {
    return `${formatTime(start)} - ${formatTime(end)}`;
  };

  return (
    <div className="mobile-photo-dump">
      <div className="header">
        <h2>Photo Dump</h2>
        <button onClick={onClose} className="close-btn">✕</button>
      </div>
      
      <div className="content">
        {photos.length === 0 ? (
          <div className="empty-state">
            <p>Select photos from your camera roll to upload</p>
            <label className="select-button">
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
              Select Photos
            </label>
          </div>
        ) : analyzing ? (
          <div className="analyzing">
            <div className="spinner"></div>
            <p>Analyzing {photos.length} photos...</p>
            <p className="small">Grouping by time and location</p>
          </div>
        ) : (
          <>
            <div className="summary">
              <strong>{photos.length} photos</strong> in {sessions.length} sessions
            </div>
            
            <div className="sessions">
              {sessions.map((session) => (
                <div key={session.id} className="session">
                  <div className="session-header">
                    <div className="session-info">
                      <div className="time">
                        {formatTimeRange(session.startTime, session.endTime)}
                      </div>
                      <div className="count">{session.photos.length} photos</div>
                    </div>
                    {session.location && (
                      <div className="location">📍 {session.location}</div>
                    )}
                  </div>
                  
                  <div className="photo-grid">
                    {session.photos.slice(0, 4).map((photo, idx) => (
                      <img
                        key={idx}
                        src={photo.preview}
                        alt=""
                        className="thumbnail"
                      />
                    ))}
                    {session.photos.length > 4 && (
                      <div className="more-count">
                        +{session.photos.length - 4} more
                      </div>
                    )}
                  </div>
                  
                  <div className="vehicle-selector">
                    <label>Vehicle:</label>
                    <select
                      value={session.manualVehicleId || session.suggestedVehicle?.id || ''}
                      onChange={(e) => handleVehicleChange(session.id, e.target.value)}
                      className={session.suggestedVehicle ? 'has-suggestion' : ''}
                    >
                      <option value="">Select vehicle...</option>
                      {vehicles.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.year} {v.make} {v.model}
                        </option>
                      ))}
                    </select>
                    {session.suggestedVehicle && !session.manualVehicleId && (
                      <div className="confidence">
                        {session.suggestedVehicle.confidence}% confident
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            
            <div className="actions">
              <button
                onClick={handleUploadAll}
                disabled={uploading || sessions.some(s => !s.manualVehicleId && !s.suggestedVehicle)}
                className="upload-button"
              >
                {uploading ? (
                  <>
                    Uploading... {Math.round(uploadProgress)}%
                  </>
                ) : (
                  <>Upload All ({photos.length} photos)</>
                )}
              </button>
            </div>
          </>
        )}
      </div>
      
      <style>{`
        .mobile-photo-dump {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: #000;
          z-index: 9999;
          display: flex;
          flex-direction: column;
        }
        
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px;
          border-bottom: 2px solid #00ff00;
        }
        
        .header h2 {
          margin: 0;
          color: #00ff00;
          font-size: 18px;
        }
        
        .close-btn {
          background: none;
          border: 2px solid #00ff00;
          color: #00ff00;
          font-size: 24px;
          width: 40px;
          height: 40px;
          cursor: pointer;
          padding: 0;
        }
        
        .content {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
        }
        
        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          gap: 24px;
        }
        
        .empty-state p {
          color: #888;
          text-align: center;
        }
        
        .select-button {
          background: #00ff00;
          color: #000;
          padding: 12px 24px;
          border: none;
          font-weight: bold;
          cursor: pointer;
          font-size: 16px;
        }
        
        .analyzing {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          gap: 16px;
        }
        
        .spinner {
          width: 40px;
          height: 40px;
          border: 3px solid #333;
          border-top: 3px solid #00ff00;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        
        .analyzing p {
          color: #00ff00;
          margin: 0;
        }
        
        .analyzing .small {
          color: #888;
          font-size: 14px;
        }
        
        .summary {
          color: #00ff00;
          margin-bottom: 24px;
          padding: 12px;
          background: #111;
          border: 2px solid #00ff00;
        }
        
        .sessions {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        
        .session {
          border: 2px solid #333;
          padding: 16px;
          background: #111;
        }
        
        .session-header {
          margin-bottom: 12px;
        }
        
        .session-info {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }
        
        .time {
          color: #00ff00;
          font-weight: bold;
        }
        
        .count {
          color: #888;
          font-size: 14px;
        }
        
        .location {
          color: #888;
          font-size: 14px;
        }
        
        .photo-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8px;
          margin-bottom: 12px;
          position: relative;
        }
        
        .thumbnail {
          width: 100%;
          aspect-ratio: 1;
          object-fit: cover;
          border: 1px solid #333;
        }
        
        .more-count {
          position: absolute;
          bottom: 8px;
          right: 8px;
          background: rgba(0, 0, 0, 0.8);
          color: #00ff00;
          padding: 4px 8px;
          font-size: 12px;
          border: 1px solid #00ff00;
        }
        
        .vehicle-selector {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        
        .vehicle-selector label {
          color: #888;
          font-size: 14px;
        }
        
        .vehicle-selector select {
          flex: 1;
          background: #000;
          color: #00ff00;
          border: 2px solid #00ff00;
          padding: 8px;
          font-size: 14px;
        }
        
        .vehicle-selector select.has-suggestion {
          border-color: #00ff00;
          background: #001100;
        }
        
        .confidence {
          color: #00ff00;
          font-size: 12px;
          white-space: nowrap;
        }
        
        .actions {
          position: sticky;
          bottom: 0;
          background: #000;
          padding: 16px 0;
          margin-top: 24px;
        }
        
        .upload-button {
          width: 100%;
          background: #00ff00;
          color: #000;
          border: none;
          padding: 16px;
          font-size: 18px;
          font-weight: bold;
          cursor: pointer;
        }
        
        .upload-button:disabled {
          background: #333;
          color: #666;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}

