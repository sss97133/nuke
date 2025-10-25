import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface TimelineEvent {
  id: string;
  vehicle_id: string;
  title: string;
  description?: string;
  event_type: string;
  event_date: string;
  metadata?: any;
}

interface EventImage {
  id: string;
  image_url: string;
  exif_data?: any;
}

interface TimelineEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  events: TimelineEvent[];
  selectedEventIndex: number;
  onNavigate: (direction: 'prev' | 'next') => void;
}

const TimelineEventModal: React.FC<TimelineEventModalProps> = ({
  isOpen,
  onClose,
  events,
  selectedEventIndex,
  onNavigate
}) => {
  const [eventImages, setEventImages] = useState<EventImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [showTechnicianForm, setShowTechnicianForm] = useState(false);
  const [showWorkDetailsForm, setShowWorkDetailsForm] = useState(false);
  const [showCorrectionForm, setShowCorrectionForm] = useState(false);
  const [showTaggingForm, setShowTaggingForm] = useState(false);
  const [technicianData, setTechnicianData] = useState({ name: '', certification: '', shopName: '' });
  const [workDetails, setWorkDetails] = useState({ workType: '', description: '', partsUsed: '', laborHours: '' });
  const [correctionData, setCorrectionData] = useState({ field: '', currentValue: '', correctedValue: '', reason: '' });
  const [taggedPeople, setTaggedPeople] = useState<string[]>([]);
  const [newPersonName, setNewPersonName] = useState('');

  const currentEvent = events[selectedEventIndex];

  // Load images for the current event date
  useEffect(() => {
    if (!currentEvent) return;

    const loadEventImages = async () => {
      setLoading(true);
      try {
        // Get images taken on this date
        const { data: images, error } = await supabase
          .from('vehicle_images')
          .select('id, image_url, exif_data')
          .eq('vehicle_id', currentEvent.vehicle_id)
          .not('exif_data', 'is', null);

        if (error) throw error;

        // Filter images by dateTaken persisted in exif_data (preferred)
        const eventDate = currentEvent.event_date;
        const filteredImages = (images || [])
          .filter(img => {
            const exif = img.exif_data || {};

            // Check DateTimeOriginal (stored by ImageUploadService as ISO string)
            if (exif.DateTimeOriginal) {
              const isoDate = exif.DateTimeOriginal;
              if (typeof isoDate === 'string' && isoDate.length >= 10) {
                return isoDate.slice(0, 10) === eventDate;
              }
            }

            // Legacy fallback to raw EXIF date strings for older data
            if (exif?.dateTimeOriginal || exif?.dateTime) {
              const dt = parseExifDate(exif.dateTimeOriginal || exif.dateTime);
              return dt === eventDate;
            }

            return false;
          });

        setEventImages(filteredImages);
        setSelectedImageIndex(0);
      } catch (error) {
        console.error('Error loading event images:', error);
        setEventImages([]);
      } finally {
        setLoading(false);
      }
    };

    loadEventImages();
  }, [currentEvent]);

  const parseExifDate = (exifDateString: string): string | null => {
    if (!exifDateString) return null;
    const parts = exifDateString.split(':');
    if (parts.length < 3) return null;
    const cleanDate = `${parts[0]}-${parts[1]}-${parts.slice(2).join(':')}`;
    const date = new Date(cleanDate);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().split('T')[0];
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft' && selectedEventIndex > 0) {
      onNavigate('prev');
    } else if (e.key === 'ArrowRight' && selectedEventIndex < events.length - 1) {
      onNavigate('next');
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  // If images' actual capture dates don't match the event_date, compute a hint range
  const captureDateHint = (() => {
    if (!eventImages || eventImages.length === 0) return null;
    const dates: number[] = [];
    for (const img of eventImages) {
      const exif = img.exif_data || {};
      let iso = exif.DateTimeOriginal as string | undefined;
      if (!iso && (exif.dateTimeOriginal || exif.dateTime)) {
        iso = parseExifDate(exif.dateTimeOriginal || exif.dateTime) || undefined;
      }
      if (iso) {
        const t = new Date(iso).getTime();
        if (!isNaN(t)) dates.push(t);
      }
    }
    if (dates.length === 0) return null;
    dates.sort((a,b) => a - b);
    const min = new Date(dates[0]);
    const max = new Date(dates[dates.length - 1]);
    const eventDt = new Date(currentEvent.event_date).getTime();
    if (isNaN(eventDt)) return null;
    // Only show hint if the event_date is not within [min,max]
    if (eventDt < dates[0] || eventDt > dates[dates.length - 1]) {
      const sameDay = dates.length === 1;
      return sameDay
        ? `Captured on ${min.toLocaleDateString()}`
        : `Captured ${min.toLocaleDateString()} – ${max.toLocaleDateString()}`;
    }
    return null;
  })();

  const getCameraInfo = (exifData: any) => {
    if (!exifData) return null;
    const parts = [];
    if (exifData.make) parts.push(exifData.make);
    if (exifData.model) parts.push(exifData.model);
    return parts.length > 0 ? parts.join(' ') : null;
  };

  const formatExifDateTime = (exifDateString: string) => {
    if (!exifDateString) return null;
    // EXIF format: "YYYY:MM:DD HH:MM:SS"
    const parts = exifDateString.split(':');
    if (parts.length < 3) return null;
    const cleanDate = `${parts[0]}-${parts[1]}-${parts.slice(2).join(':')}`;
    const date = new Date(cleanDate);
    if (isNaN(date.getTime())) return null;
    return date.toLocaleString();
  };

  const calculateWorkSession = (images: EventImage[]) => {
    if (images.length < 2) return null;
    
    const timestamps = images
      .map(img => {
        const exif = img.exif_data;
        const dateStr = exif?.dateTimeOriginal || exif?.dateTime;
        if (!dateStr) return null;
        const parts = dateStr.split(':');
        if (parts.length < 3) return null;
        const cleanDate = `${parts[0]}-${parts[1]}-${parts.slice(2).join(':')}`;
        const date = new Date(cleanDate);
        return isNaN(date.getTime()) ? null : date;
      })
      .filter(Boolean)
      .sort((a, b) => a!.getTime() - b!.getTime());

    if (timestamps.length < 2) return null;

    const startTime = timestamps[0]!;
    const endTime = timestamps[timestamps.length - 1]!;
    const durationMs = endTime.getTime() - startTime.getTime();
    const hours = durationMs / (1000 * 60 * 60);

    return {
      startTime,
      endTime,
      duration: hours,
      sessionType: hours > 4 ? 'Full Day' : hours > 2 ? 'Half Day' : 'Quick Session'
    };
  };

  const identifyLocation = (exifData: any) => {
    if (!exifData?.gps) return { type: 'unknown', description: 'Location not available' };
    
    // Simple heuristic based on GPS precision and common shop locations
    // In a real app, you'd use reverse geocoding API
    const lat = exifData.gps.latitude;
    const lng = exifData.gps.longitude;
    
    // Check if coordinates are very precise (likely professional shop)
    const precision = (lat.toString().split('.')[1]?.length || 0) + (lng.toString().split('.')[1]?.length || 0);
    
    if (precision > 10) {
      return { 
        type: 'professional', 
        description: 'Professional Shop/Garage',
        coordinates: `${lat.toFixed(4)}, ${lng.toFixed(4)}`
      };
    } else {
      return { 
        type: 'home', 
        description: 'Home Garage/Driveway',
        coordinates: `${lat.toFixed(4)}, ${lng.toFixed(4)}`
      };
    }
  };

  if (!isOpen || !currentEvent) return null;

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50"
      onClick={onClose}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <div 
        className="bg-white max-w-4xl max-h-[90vh] w-full mx-4 flex flex-col"
        style={{ 
          fontFamily: 'Arial, sans-serif',
          border: '1px solid #bdbdbd',
          borderRadius: '2px'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b" style={{ 
          padding: '8px', 
          borderBottom: '1px solid #e0e0e0',
          backgroundColor: '#f5f5f5'
        }}>
          <div className="flex items-center" style={{ gap: '8px' }}>
            <button
              onClick={() => onNavigate('prev')}
              disabled={selectedEventIndex === 0}
              style={{
                padding: '4px',
                border: '1px solid #bdbdbd',
                backgroundColor: selectedEventIndex === 0 ? '#eeeeee' : '#ffffff',
                borderRadius: '2px',
                fontSize: '10px',
                cursor: selectedEventIndex === 0 ? 'not-allowed' : 'pointer'
              }}
              title="Previous event (←)"
            >
              ←
            </button>
            
            <div>
              <h2 style={{ 
                fontSize: '9pt', 
                fontWeight: 'bold', 
                margin: '0',
                color: '#000000'
              }}>
                {currentEvent.title}
              </h2>
              <p style={{ 
                fontSize: '8pt', 
                margin: '0',
                color: '#424242'
              }}>
                {formatDate(currentEvent.event_date)}
              </p>
            </div>
            
            <button
              onClick={() => onNavigate('next')}
              disabled={selectedEventIndex === events.length - 1}
              style={{
                padding: '4px',
                border: '1px solid #bdbdbd',
                backgroundColor: selectedEventIndex === events.length - 1 ? '#eeeeee' : '#ffffff',
                borderRadius: '2px',
                fontSize: '10px',
                cursor: selectedEventIndex === events.length - 1 ? 'not-allowed' : 'pointer'
              }}
              title="Next event (→)"
            >
              →
            </button>
          </div>
          
          <div className="flex items-center" style={{ gap: '8px' }}>
            <span style={{ 
              fontSize: '10px', 
              color: '#424242' 
            }}>
              {selectedEventIndex + 1} of {events.length}
            </span>
            <button
              onClick={onClose}
              style={{
                padding: '4px 8px',
                border: '1px solid #bdbdbd',
                backgroundColor: '#ffffff',
                borderRadius: '2px',
                fontSize: '10px',
                cursor: 'pointer'
              }}
              title="Close (Esc)"
            >
              ×
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
          {/* Images Section */}
          <div className="flex-1 flex flex-col">
            {loading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-gray-500">Loading images...</div>
              </div>
            ) : eventImages.length > 0 ? (
              <>
                {/* Main Image */}
                <div className="flex-1 relative bg-gray-100">
                  <img
                    src={eventImages[selectedImageIndex]?.image_url}
                    alt={`Photo ${selectedImageIndex + 1}`}
                    className="w-full h-full object-contain"
                  />
                  
                  {/* Image Navigation */}
                  {eventImages.length > 1 && (
                    <>
                      <button
                        onClick={() => setSelectedImageIndex(Math.max(0, selectedImageIndex - 1))}
                        disabled={selectedImageIndex === 0}
                        className="absolute left-2 top-1/2 transform -translate-y-1/2 p-2 bg-black bg-opacity-50 text-white rounded-full hover:bg-opacity-75 disabled:opacity-25"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                      
                      <button
                        onClick={() => setSelectedImageIndex(Math.min(eventImages.length - 1, selectedImageIndex + 1))}
                        disabled={selectedImageIndex === eventImages.length - 1}
                        className="absolute right-2 top-1/2 transform -translate-y-1/2 p-2 bg-black bg-opacity-50 text-white rounded-full hover:bg-opacity-75 disabled:opacity-25"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                      
                      <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-sm">
                        {selectedImageIndex + 1} / {eventImages.length}
                      </div>
                    </>
                  )}
                </div>
                
                {/* Image Thumbnails */}
                {eventImages.length > 1 && (
                  <div className="p-2 border-t bg-gray-50">
                    <div className="flex gap-2 overflow-x-auto">
                      {eventImages.map((image, index) => (
                        <button
                          key={image.id}
                          onClick={() => setSelectedImageIndex(index)}
                          className={`flex-shrink-0 w-16 h-16 rounded border-2 overflow-hidden ${
                            index === selectedImageIndex ? 'border-blue-500' : 'border-gray-300'
                          }`}
                        >
                          <img
                            src={image.image_url}
                            alt={`Thumbnail ${index + 1}`}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-500">
                <div className="text-center">
                  <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p>No photos found for this date</p>
                </div>
              </div>
            )}
          </div>

          {/* Details Sidebar - Receipt Style */}
          <div className="w-96 border-l overflow-y-auto" style={{ 
            borderLeft: '2px solid #bdbdbd',
            backgroundColor: '#ffffff',
            padding: '12px',
            fontSize: '8pt'
          }}>
            {/* WORK ORDER / RECEIPT HEADER */}
            <div style={{
              borderBottom: '2px solid #000',
              paddingBottom: '8px',
              marginBottom: '12px'
            }}>
              <div style={{ fontSize: '11pt', fontWeight: 700, marginBottom: '2px' }}>
                WORK ORDER
              </div>
              <div style={{ fontSize: '8pt', color: 'var(--text-secondary)' }}>
                {formatDate(currentEvent.event_date)}
                {currentEvent.mileage_at_event && ` • ${currentEvent.mileage_at_event.toLocaleString()} mi`}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Work Session Analysis */}
              {(() => {
                const workSession = calculateWorkSession(eventImages);
                return workSession && (
                  <div style={{ 
                    border: '1px solid #e0e0e0',
                    backgroundColor: '#ffffff',
                    padding: '6px'
                  }}>
                    <h3 style={{ 
                      fontSize: '9pt', 
                      fontWeight: 'bold',
                      margin: '0 0 4px 0',
                      color: '#000000'
                    }}>
                      Work Session
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <div>
                        <span style={{ fontWeight: 'bold', color: '#000000' }}>Duration:</span>
                        <span style={{ marginLeft: '4px' }}>{workSession.duration.toFixed(1)} hours</span>
                      </div>
                      <div>
                        <span style={{ fontWeight: 'bold', color: '#000000' }}>Type:</span>
                        <span style={{ marginLeft: '4px' }}>{workSession.sessionType}</span>
                      </div>
                      <div>
                        <span style={{ fontWeight: 'bold', color: '#000000' }}>Started:</span>
                        <span style={{ marginLeft: '4px' }}>{workSession.startTime.toLocaleTimeString()}</span>
                      </div>
                      <div>
                        <span style={{ fontWeight: 'bold', color: '#000000' }}>Ended:</span>
                        <span style={{ marginLeft: '4px' }}>{workSession.endTime.toLocaleTimeString()}</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Location Analysis */}
              {eventImages.length > 0 && eventImages[selectedImageIndex]?.exif_data?.gps && (
                <div>
                  <h3 className="font-semibold text-gray-900 mb-2" style={{ fontSize: '9pt' }}>Location</h3>
                  {(() => {
                    const location = identifyLocation(eventImages[selectedImageIndex].exif_data);
                    return (
                      <div className="space-y-1">
                        <div>
                          <span className="font-medium text-gray-600">Type:</span>
                          <span className={`ml-2 px-2 py-1 rounded text-xs ${
                            location.type === 'professional' ? 'bg-blue-100 text-blue-800' : 
                            location.type === 'home' ? 'bg-green-100 text-green-800' : 
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {location.description}
                          </span>
                        </div>
                        <div>
                          <span className="font-medium text-gray-600">Coordinates:</span>
                          <span className="ml-2 font-mono">{location.coordinates}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Technician/Contributor Info */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-2" style={{ fontSize: '9pt' }}>Contributor</h3>
                <div className="space-y-1">
                  <div>
                    <span className="font-medium text-gray-600">Role:</span>
                    <span className="ml-2">
                      {eventImages.some(img => img.exif_data?.gps && identifyLocation(img.exif_data).type === 'professional') 
                        ? 'Professional Technician' 
                        : 'Enthusiast/Owner'}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-600">Session ID:</span>
                    <span className="ml-2 font-mono">{currentEvent.id.slice(0, 8)}</span>
                  </div>
                  <button
                    onClick={() => setShowTechnicianForm(true)}
                    style={{
                      marginTop: '4px',
                      padding: '2px 6px',
                      border: '1px outset #bdbdbd',
                      backgroundColor: '#f5f5f5',
                      color: '#000000',
                      fontSize: '8pt',
                      cursor: 'pointer'
                    }}
                  >
                    Add Technician Details
                  </button>
                </div>
              </div>

              {/* Event Details */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-2" style={{ fontSize: '9pt' }}>Event Details</h3>
                <div className="space-y-1">
                  <div>
                    <span className="font-medium text-gray-600">Type:</span>
                    <span className="ml-2 capitalize">{currentEvent.event_type.replace('_', ' ')}</span>
                  </div>
                  {currentEvent.description && (
                    <div>
                      <span className="font-medium text-gray-600">Description:</span>
                      <p className="ml-2 mt-1">{currentEvent.description}</p>
                    </div>
                  )}
                  {currentEvent.metadata?.count && (
                    <div>
                      <span className="font-medium text-gray-600">Photos:</span>
                      <span className="ml-2">{currentEvent.metadata.count} images</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Photo Details */}
              {eventImages.length > 0 && eventImages[selectedImageIndex] && (
                <div>
                  <h3 className="font-semibold text-gray-900 mb-2" style={{ fontSize: '9pt' }}>Photo Details</h3>
                  <div className="space-y-1">
                    {getCameraInfo(eventImages[selectedImageIndex].exif_data) && (
                      <div>
                        <span className="font-medium text-gray-600">Camera:</span>
                        <span className="ml-2">{getCameraInfo(eventImages[selectedImageIndex].exif_data)}</span>
                      </div>
                    )}
                    {eventImages[selectedImageIndex].exif_data?.dateTimeOriginal && (
                      <div>
                        <span className="font-medium text-gray-600">Taken:</span>
                        <span className="ml-2">
                          {formatExifDateTime(eventImages[selectedImageIndex].exif_data.dateTimeOriginal)}
                        </span>
                      </div>
                    )}
                    {eventImages[selectedImageIndex].exif_data?.fNumber && (
                      <div>
                        <span className="font-medium text-gray-600">Settings:</span>
                        <span className="ml-2 font-mono">
                          {eventImages[selectedImageIndex].exif_data.fNumber} • 
                          {eventImages[selectedImageIndex].exif_data.exposureTime} • 
                          ISO {eventImages[selectedImageIndex].exif_data.iso}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div style={{ 
                paddingTop: '6px', 
                borderTop: '1px solid #e0e0e0' 
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <button
                    onClick={() => setShowWorkDetailsForm(true)}
                    style={{
                      width: '100%',
                      padding: '4px 6px',
                      border: '1px outset #bdbdbd',
                      backgroundColor: '#f5f5f5',
                      color: '#000000',
                      fontSize: '8pt',
                      cursor: 'pointer'
                    }}
                  >
                    Add Work Details
                  </button>
                  <button
                    onClick={() => setShowCorrectionForm(true)}
                    style={{
                      width: '100%',
                      padding: '4px 6px',
                      border: '1px outset #bdbdbd',
                      backgroundColor: '#f5f5f5',
                      color: '#000000',
                      fontSize: '8pt',
                      cursor: 'pointer'
                    }}
                  >
                    Correct Information
                  </button>
                  <button
                    onClick={() => setShowTaggingForm(true)}
                    style={{
                      width: '100%',
                      padding: '4px 6px',
                      border: '1px outset #bdbdbd',
                      backgroundColor: '#f5f5f5',
                      color: '#000000',
                      fontSize: '8pt',
                      cursor: 'pointer'
                    }}
                  >
                    Tag People
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '6px',
          borderTop: '1px solid #e0e0e0',
          backgroundColor: '#f5f5f5',
          textAlign: 'center',
          fontSize: '8pt',
          color: '#424242'
        }}>
          Use ← → arrow keys to navigate between events • ESC to close
        </div>
      </div>

      {/* Modal Forms */}
      {showTechnicianForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-60">
          <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Add Technician Details</h3>
            <form onSubmit={(e) => {
              e.preventDefault();
              console.log('Technician data:', technicianData);
              setShowTechnicianForm(false);
              setTechnicianData({ name: '', certification: '', shopName: '' });
            }}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Technician Name</label>
                  <input
                    type="text"
                    value={technicianData.name}
                    onChange={(e) => setTechnicianData({...technicianData, name: e.target.value})}
                    className="w-full p-2 border rounded"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Certification/License</label>
                  <input
                    type="text"
                    value={technicianData.certification}
                    onChange={(e) => setTechnicianData({...technicianData, certification: e.target.value})}
                    className="w-full p-2 border rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Shop/Business Name</label>
                  <input
                    type="text"
                    value={technicianData.shopName}
                    onChange={(e) => setTechnicianData({...technicianData, shopName: e.target.value})}
                    className="w-full p-2 border rounded"
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-6">
                <button type="submit" className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setShowTechnicianForm(false)}
                  className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showWorkDetailsForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-60">
          <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Add Work Details</h3>
            <form onSubmit={(e) => {
              e.preventDefault();
              console.log('Work details:', workDetails);
              setShowWorkDetailsForm(false);
              setWorkDetails({ workType: '', description: '', partsUsed: '', laborHours: '' });
            }}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Work Type</label>
                  <select
                    value={workDetails.workType}
                    onChange={(e) => setWorkDetails({...workDetails, workType: e.target.value})}
                    className="w-full p-2 border rounded"
                    required
                  >
                    <option value="">Select work type</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="repair">Repair</option>
                    <option value="modification">Modification</option>
                    <option value="inspection">Inspection</option>
                    <option value="restoration">Restoration</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Description</label>
                  <textarea
                    value={workDetails.description}
                    onChange={(e) => setWorkDetails({...workDetails, description: e.target.value})}
                    className="w-full p-2 border rounded"
                    rows={3}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Parts Used</label>
                  <textarea
                    value={workDetails.partsUsed}
                    onChange={(e) => setWorkDetails({...workDetails, partsUsed: e.target.value})}
                    className="w-full p-2 border rounded"
                    rows={2}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Labor Hours</label>
                  <input
                    type="number"
                    step="0.5"
                    value={workDetails.laborHours}
                    onChange={(e) => setWorkDetails({...workDetails, laborHours: e.target.value})}
                    className="w-full p-2 border rounded"
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-6">
                <button type="submit" className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setShowWorkDetailsForm(false)}
                  className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCorrectionForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-60">
          <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Correct Information</h3>
            <form onSubmit={(e) => {
              e.preventDefault();
              console.log('Correction data:', correctionData);
              setShowCorrectionForm(false);
              setCorrectionData({ field: '', currentValue: '', correctedValue: '', reason: '' });
            }}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Field to Correct</label>
                  <select
                    value={correctionData.field}
                    onChange={(e) => setCorrectionData({...correctionData, field: e.target.value})}
                    className="w-full p-2 border rounded"
                    required
                  >
                    <option value="">Select field</option>
                    <option value="date">Date</option>
                    <option value="location">Location</option>
                    <option value="description">Description</option>
                    <option value="work_type">Work Type</option>
                    <option value="technician">Technician</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Current Value</label>
                  <input
                    type="text"
                    value={correctionData.currentValue}
                    onChange={(e) => setCorrectionData({...correctionData, currentValue: e.target.value})}
                    className="w-full p-2 border rounded"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Corrected Value</label>
                  <input
                    type="text"
                    value={correctionData.correctedValue}
                    onChange={(e) => setCorrectionData({...correctionData, correctedValue: e.target.value})}
                    className="w-full p-2 border rounded"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Reason for Correction</label>
                  <textarea
                    value={correctionData.reason}
                    onChange={(e) => setCorrectionData({...correctionData, reason: e.target.value})}
                    className="w-full p-2 border rounded"
                    rows={2}
                    required
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-6">
                <button type="submit" className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
                  Submit Correction
                </button>
                <button
                  type="button"
                  onClick={() => setShowCorrectionForm(false)}
                  className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showTaggingForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-60">
          <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Tag People</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Add Person</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newPersonName}
                    onChange={(e) => setNewPersonName(e.target.value)}
                    placeholder="Enter name"
                    className="flex-1 p-2 border rounded"
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && newPersonName.trim()) {
                        setTaggedPeople([...taggedPeople, newPersonName.trim()]);
                        setNewPersonName('');
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newPersonName.trim()) {
                        setTaggedPeople([...taggedPeople, newPersonName.trim()]);
                        setNewPersonName('');
                      }
                    }}
                    className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                  >
                    Add
                  </button>
                </div>
              </div>

              {taggedPeople.length > 0 && (
                <div>
                  <label className="block text-sm font-medium mb-2">Tagged People</label>
                  <div className="space-y-1">
                    {taggedPeople.map((person, index) => (
                      <div key={index} className="flex items-center justify-between bg-gray-100 p-2 rounded">
                        <span>{person}</span>
                        <button
                          type="button"
                          onClick={() => setTaggedPeople(taggedPeople.filter((_, i) => i !== index))}
                          className="text-red-500 hover:text-red-700"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-6">
              <button
                onClick={() => {
                  console.log('Tagged people:', taggedPeople);
                  setShowTaggingForm(false);
                  setTaggedPeople([]);
                  setNewPersonName('');
                }}
                className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
              >
                Save Tags
              </button>
              <button
                onClick={() => {
                  setShowTaggingForm(false);
                  setTaggedPeople([]);
                  setNewPersonName('');
                }}
                className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TimelineEventModal;
