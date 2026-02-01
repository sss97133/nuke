import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { generateTimelineEventDescription } from '../services/intelligentEventDescription';
import type { IntelligentDescription } from '../services/intelligentEventDescription';
import { EventFinancialService } from '../services/eventFinancialService';
import type { 
  EventFinancialSummary, 
  PartDetail, 
  ToolDetail,
  KnowledgeDetail 
} from '../services/eventFinancialService';

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
  const [intelligentDescription, setIntelligentDescription] = useState<IntelligentDescription | null>(null);
  const [loadingDescription, setLoadingDescription] = useState(false);
  
  // Financial data
  const [financialSummary, setFinancialSummary] = useState<EventFinancialSummary | null>(null);
  const [partDetails, setPartDetails] = useState<PartDetail[]>([]);
  const [toolDetails, setToolDetails] = useState<ToolDetail[]>([]);
  const [knowledgeDetails, setKnowledgeDetails] = useState<KnowledgeDetail[]>([]);
  const [loadingFinancials, setLoadingFinancials] = useState(false);
  const [showFinancials, setShowFinancials] = useState(false);
  const [generatingInvoice, setGeneratingInvoice] = useState(false);

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
    
    // Load intelligent description
    if (currentEvent) {
      setLoadingDescription(true);
      generateTimelineEventDescription(
        currentEvent.id,
        currentEvent.vehicle_id,
        currentEvent.event_date
      ).then(desc => {
        setIntelligentDescription(desc);
        setLoadingDescription(false);
      }).catch(err => {
        console.error('Error loading intelligent description:', err);
        setLoadingDescription(false);
      });
    }
  }, [currentEvent]);
  
  // Load financial data for current event
  useEffect(() => {
    if (!currentEvent) return;
    
    const loadFinancialData = async () => {
      setLoadingFinancials(true);
      try {
        const [summary, parts, tools, knowledge] = await Promise.all([
          EventFinancialService.getEventFinancialSummary(currentEvent.id),
          EventFinancialService.getEventParts(currentEvent.id),
          EventFinancialService.getEventTools(currentEvent.id),
          EventFinancialService.getEventKnowledge(currentEvent.id)
        ]);
        
        setFinancialSummary(summary);
        setPartDetails(parts);
        setToolDetails(tools);
        setKnowledgeDetails(knowledge);
      } catch (error) {
        console.error('Error loading financial data:', error);
      } finally {
        setLoadingFinancials(false);
      }
    };
    
    loadFinancialData();
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
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50
      }}
      onClick={onClose}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <div 
        style={{ 
          background: 'var(--surface)',
          maxWidth: '1200px',
          maxHeight: '90vh',
          width: '100%',
          margin: '0 16px',
          display: 'flex',
          flexDirection: 'column',
          border: '2px solid var(--border)',
          borderRadius: 'var(--radius)',
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ 
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-2)', 
          borderBottom: '2px solid var(--border)',
          background: 'var(--bg)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <button
              onClick={() => onNavigate('prev')}
              disabled={selectedEventIndex === 0}
              style={{
                padding: '4px 8px',
                border: '2px solid var(--border)',
                background: selectedEventIndex === 0 ? 'var(--surface-hover)' : 'var(--surface)',
                borderRadius: 'var(--radius)',
                fontSize: '10px',
                cursor: selectedEventIndex === 0 ? 'not-allowed' : 'pointer',
                color: 'var(--text)',
                opacity: selectedEventIndex === 0 ? 0.5 : 1,
                transition: 'var(--transition)'
              }}
              title="Previous event (←)"
            >
              PREV
            </button>
            
            <div>
              <h2 style={{ 
                fontSize: '10px', 
                fontWeight: 700, 
                margin: 0,
                color: 'var(--text)'
              }}>
                {currentEvent.title}
              </h2>
              <p style={{ 
                fontSize: '9px', 
                margin: 0,
                color: 'var(--text-secondary)'
              }}>
                {formatDate(currentEvent.event_date)}
              </p>
            </div>
            
            <button
              onClick={() => onNavigate('next')}
              disabled={selectedEventIndex === events.length - 1}
              style={{
                padding: '4px 8px',
                border: '2px solid var(--border)',
                background: selectedEventIndex === events.length - 1 ? 'var(--surface-hover)' : 'var(--surface)',
                borderRadius: 'var(--radius)',
                fontSize: '10px',
                cursor: selectedEventIndex === events.length - 1 ? 'not-allowed' : 'pointer',
                color: 'var(--text)',
                opacity: selectedEventIndex === events.length - 1 ? 0.5 : 1,
                transition: 'var(--transition)'
              }}
              title="Next event (→)"
            >
              NEXT
            </button>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span style={{ 
              fontSize: '9px', 
              color: 'var(--text-secondary)'
            }}>
              {selectedEventIndex + 1} of {events.length}
            </span>
            <button
              onClick={onClose}
              style={{
                padding: '4px 12px',
                border: '2px solid var(--border)',
                background: 'var(--surface)',
                borderRadius: 'var(--radius)',
                fontSize: '10px',
                cursor: 'pointer',
                color: 'var(--text)',
                fontWeight: 700,
                transition: 'var(--transition)'
              }}
              title="Close (Esc)"
            >
              CLOSE
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
          {/* Images Section */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {loading ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>Loading images...</div>
              </div>
            ) : eventImages.length > 0 ? (
              <>
                {/* Main Image */}
                <div style={{ flex: 1, position: 'relative', background: 'var(--bg)' }}>
                  <img
                    src={eventImages[selectedImageIndex]?.image_url}
                    alt={`Photo ${selectedImageIndex + 1}`}
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                  
                  {/* Image Navigation */}
                  {eventImages.length > 1 && (
                    <>
                      <button
                        onClick={() => setSelectedImageIndex(Math.max(0, selectedImageIndex - 1))}
                        disabled={selectedImageIndex === 0}
                        style={{
                          position: 'absolute',
                          left: '8px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          padding: '8px 12px',
                          background: 'rgba(42, 42, 42, 0.85)',
                          color: '#ffffff',
                          border: '2px solid rgba(255, 255, 255, 0.3)',
                          borderRadius: 'var(--radius)',
                          fontSize: '10px',
                          fontWeight: 700,
                          cursor: selectedImageIndex === 0 ? 'not-allowed' : 'pointer',
                          opacity: selectedImageIndex === 0 ? 0.3 : 1,
                          transition: 'var(--transition)'
                        }}
                      >
                        PREV
                      </button>
                      
                      <button
                        onClick={() => setSelectedImageIndex(Math.min(eventImages.length - 1, selectedImageIndex + 1))}
                        disabled={selectedImageIndex === eventImages.length - 1}
                        style={{
                          position: 'absolute',
                          right: '8px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          padding: '8px 12px',
                          background: 'rgba(42, 42, 42, 0.85)',
                          color: '#ffffff',
                          border: '2px solid rgba(255, 255, 255, 0.3)',
                          borderRadius: 'var(--radius)',
                          fontSize: '10px',
                          fontWeight: 700,
                          cursor: selectedImageIndex === eventImages.length - 1 ? 'not-allowed' : 'pointer',
                          opacity: selectedImageIndex === eventImages.length - 1 ? 0.3 : 1,
                          transition: 'var(--transition)'
                        }}
                      >
                        NEXT
                      </button>
                      
                      <div style={{
                        position: 'absolute',
                        bottom: '8px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        background: 'rgba(42, 42, 42, 0.85)',
                        color: '#ffffff',
                        padding: '4px 8px',
                        borderRadius: 'var(--radius)',
                        fontSize: '9px',
                        fontWeight: 700
                      }}>
                        {selectedImageIndex + 1} / {eventImages.length}
                      </div>
                    </>
                  )}
                </div>
                
                {/* Image Thumbnails */}
                {eventImages.length > 1 && (
                  <div style={{ padding: 'var(--space-2)', borderTop: '2px solid var(--border)', background: 'var(--bg)' }}>
                    <div style={{ display: 'flex', gap: 'var(--space-2)', overflowX: 'auto' }}>
                      {eventImages.map((image, index) => (
                        <button
                          key={image.id}
                          onClick={() => setSelectedImageIndex(index)}
                          style={{
                            flexShrink: 0,
                            width: '64px',
                            height: '64px',
                            borderRadius: 'var(--radius)',
                            border: index === selectedImageIndex ? '2px solid var(--text)' : '2px solid var(--border)',
                            overflow: 'hidden',
                            cursor: 'pointer',
                            transition: 'var(--transition)'
                          }}
                        >
                          <img
                            src={image.image_url}
                            alt={`Thumbnail ${index + 1}`}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', marginTop: '8px' }}>No photos found for this date</div>
                </div>
              </div>
            )}
          </div>

          {/* Details Sidebar */}
          <div style={{ 
            width: '384px',
            borderLeft: '2px solid var(--border)',
            background: 'var(--surface)',
            padding: 'var(--space-3)',
            fontSize: '9px',
            overflowY: 'auto'
          }}>
            {/* WORK ORDER HEADER */}
            <div style={{
              borderBottom: '2px solid var(--border)',
              paddingBottom: 'var(--space-2)',
              marginBottom: 'var(--space-3)'
            }}>
              <div style={{ fontSize: '11px', fontWeight: 700, marginBottom: '2px', color: 'var(--text)' }}>
                WORK ORDER
              </div>
              <div style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>
                {formatDate(currentEvent.event_date)}
                {(currentEvent as any).mileage_at_event && ` • ${(currentEvent as any).mileage_at_event.toLocaleString()} mi`}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {/* Work Session Analysis */}
              {(() => {
                const workSession = calculateWorkSession(eventImages);
                return workSession && (
                  <div style={{ 
                    border: '2px solid var(--border)',
                    background: 'var(--bg)',
                    padding: 'var(--space-2)',
                    borderRadius: 'var(--radius)'
                  }}>
                    <h3 style={{ 
                      fontSize: '10px', 
                      fontWeight: 700,
                      margin: '0 0 var(--space-2) 0',
                      color: 'var(--text)'
                    }}>
                      Work Session
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '9px' }}>
                      <div>
                        <span style={{ fontWeight: 700, color: 'var(--text)' }}>Duration:</span>
                        <span style={{ marginLeft: 'var(--space-1)', color: 'var(--text-secondary)' }}>{workSession.duration.toFixed(1)} hours</span>
                      </div>
                      <div>
                        <span style={{ fontWeight: 700, color: 'var(--text)' }}>Type:</span>
                        <span style={{ marginLeft: 'var(--space-1)', color: 'var(--text-secondary)' }}>{workSession.sessionType}</span>
                      </div>
                      <div>
                        <span style={{ fontWeight: 700, color: 'var(--text)' }}>Started:</span>
                        <span style={{ marginLeft: 'var(--space-1)', color: 'var(--text-secondary)' }}>{workSession.startTime.toLocaleTimeString()}</span>
                      </div>
                      <div>
                        <span style={{ fontWeight: 700, color: 'var(--text)' }}>Ended:</span>
                        <span style={{ marginLeft: 'var(--space-1)', color: 'var(--text-secondary)' }}>{workSession.endTime.toLocaleTimeString()}</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Location Analysis */}
              {eventImages.length > 0 && eventImages[selectedImageIndex]?.exif_data?.gps && (
                <div>
                  <h3 style={{ fontSize: '10px', fontWeight: 700, marginBottom: 'var(--space-2)', color: 'var(--text)' }}>Location</h3>
                  {(() => {
                    const location = identifyLocation(eventImages[selectedImageIndex].exif_data);
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '9px' }}>
                        <div>
                          <span style={{ fontWeight: 700, color: 'var(--text)' }}>Type:</span>
                          <span style={{
                            marginLeft: 'var(--space-2)',
                            padding: '2px 6px',
                            borderRadius: 'var(--radius)',
                            fontSize: '8px',
                            background: location.type === 'professional' ? 'var(--success-dim)' : 
                                       location.type === 'home' ? 'var(--bg)' : 
                                       'var(--surface)',
                            color: location.type === 'professional' ? 'var(--success)' : 'var(--text)',
                            border: '1px solid var(--border)'
                          }}>
                            {location.description}
                          </span>
                        </div>
                        <div>
                          <span style={{ fontWeight: 700, color: 'var(--text)' }}>Coordinates:</span>
                          <span style={{ marginLeft: 'var(--space-2)', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{location.coordinates}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Technician/Contributor Info */}
              <div>
                <h3 style={{ fontSize: '10px', fontWeight: 700, marginBottom: 'var(--space-2)', color: 'var(--text)' }}>Contributor</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '9px' }}>
                  <div>
                    <span style={{ fontWeight: 700, color: 'var(--text)' }}>Role:</span>
                    <span style={{ marginLeft: 'var(--space-2)', color: 'var(--text-secondary)' }}>
                      {eventImages.some(img => img.exif_data?.gps && identifyLocation(img.exif_data).type === 'professional') 
                        ? 'Professional Technician' 
                        : 'Enthusiast/Owner'}
                    </span>
                  </div>
                  <div>
                    <span style={{ fontWeight: 700, color: 'var(--text)' }}>Session ID:</span>
                    <span style={{ marginLeft: 'var(--space-2)', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{currentEvent.id.slice(0, 8)}</span>
                  </div>
                  <button
                    onClick={() => setShowTechnicianForm(true)}
                    style={{
                      marginTop: 'var(--space-1)',
                      padding: '4px 8px',
                      border: '2px solid var(--border)',
                      background: 'var(--surface)',
                      color: 'var(--text)',
                      fontSize: '9px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      borderRadius: 'var(--radius)',
                      transition: 'var(--transition)'
                    }}
                  >
                    Add Technician Details
                  </button>
                </div>
              </div>

              {/* Intelligent Description */}
              {intelligentDescription && (
                <div style={{ 
                  border: '2px solid var(--border)',
                  background: 'var(--bg)',
                  padding: 'var(--space-2)',
                  borderRadius: 'var(--radius)'
                }}>
                  <h3 style={{ 
                    fontSize: '10px', 
                    fontWeight: 700,
                    margin: '0 0 var(--space-2) 0',
                    color: 'var(--text)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-1)'
                  }}>
                    AI Analysis
                    <span style={{ 
                      fontSize: '8px',
                      fontWeight: 600,
                      color: intelligentDescription.quality === 'high' ? 'var(--success)' : 
                              intelligentDescription.quality === 'medium' ? 'var(--warning)' : 'var(--error)',
                      marginLeft: 'auto'
                    }}>
                      {intelligentDescription.quality.toUpperCase()}
                    </span>
                  </h3>
                  <p style={{ 
                    fontSize: '9px',
                    margin: '0 0 var(--space-2) 0',
                    color: 'var(--text)',
                    lineHeight: '1.4'
                  }}>
                    {intelligentDescription.summary}
                  </p>
                  {intelligentDescription.details.length > 0 && (
                    <div style={{ marginTop: 'var(--space-2)' }}>
                      {intelligentDescription.details.map((detail, idx) => (
                        <div key={idx} style={{ 
                          fontSize: '8px',
                          color: 'var(--text-secondary)',
                          marginBottom: '2px',
                          paddingLeft: 'var(--space-2)',
                          position: 'relative'
                        }}>
                          <span style={{ position: 'absolute', left: 0 }}>-</span>
                          {detail}
                        </div>
                      ))}
                    </div>
                  )}
                  {intelligentDescription.detectedFeatures.length > 0 && (
                    <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
                      {intelligentDescription.detectedFeatures.slice(0, 5).map((feature, idx) => (
                        <span key={idx} style={{
                          fontSize: '8px',
                          padding: '2px 6px',
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius)',
                          color: 'var(--text-secondary)',
                          fontWeight: 600
                        }}>
                          {feature}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {loadingDescription && (
                <div style={{ 
                  padding: 'var(--space-2)',
                  textAlign: 'center',
                  color: 'var(--text-secondary)',
                  fontSize: '9px'
                }}>
                  Analyzing images...
                </div>
              )}

              {/* Event Details */}
              <div>
                <h3 style={{ fontSize: '10px', fontWeight: 700, marginBottom: 'var(--space-2)', color: 'var(--text)' }}>Event Details</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '9px' }}>
                  <div>
                    <span style={{ fontWeight: 700, color: 'var(--text)' }}>Type:</span>
                    <span style={{ marginLeft: 'var(--space-2)', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
                      {currentEvent.event_type.replace('_', ' ')}
                    </span>
                  </div>
                  {currentEvent.description && (
                    <div>
                      <span style={{ fontWeight: 700, color: 'var(--text)' }}>Description:</span>
                      <p style={{ marginLeft: 'var(--space-2)', marginTop: 'var(--space-1)', color: 'var(--text-secondary)' }}>
                        {currentEvent.description}
                      </p>
                    </div>
                  )}
                  {currentEvent.metadata?.count && (
                    <div>
                      <span style={{ fontWeight: 700, color: 'var(--text)' }}>Photos:</span>
                      <span style={{ marginLeft: 'var(--space-2)', color: 'var(--text-secondary)' }}>
                        {currentEvent.metadata.count} images
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Photo Details */}
              {eventImages.length > 0 && eventImages[selectedImageIndex] && (
                <div>
                  <h3 style={{ fontSize: '10px', fontWeight: 700, marginBottom: 'var(--space-2)', color: 'var(--text)' }}>Photo Details</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '9px' }}>
                    {getCameraInfo(eventImages[selectedImageIndex].exif_data) && (
                      <div>
                        <span style={{ fontWeight: 700, color: 'var(--text)' }}>Camera:</span>
                        <span style={{ marginLeft: 'var(--space-2)', color: 'var(--text-secondary)' }}>
                          {getCameraInfo(eventImages[selectedImageIndex].exif_data)}
                        </span>
                      </div>
                    )}
                    {eventImages[selectedImageIndex].exif_data?.dateTimeOriginal && (
                      <div>
                        <span style={{ fontWeight: 700, color: 'var(--text)' }}>Taken:</span>
                        <span style={{ marginLeft: 'var(--space-2)', color: 'var(--text-secondary)' }}>
                          {formatExifDateTime(eventImages[selectedImageIndex].exif_data.dateTimeOriginal)}
                        </span>
                      </div>
                    )}
                    {eventImages[selectedImageIndex].exif_data?.fNumber && (
                      <div>
                        <span style={{ fontWeight: 700, color: 'var(--text)' }}>Settings:</span>
                        <span style={{ marginLeft: 'var(--space-2)', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                          {eventImages[selectedImageIndex].exif_data.fNumber} • 
                          {eventImages[selectedImageIndex].exif_data.exposureTime} • 
                          ISO {eventImages[selectedImageIndex].exif_data.iso}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Financial Summary Toggle */}
              <div>
                <button
                  onClick={() => setShowFinancials(!showFinancials)}
                  style={{
                    width: '100%',
                    padding: '6px var(--space-2)',
                    border: '2px solid var(--border)',
                    background: showFinancials ? 'var(--text)' : 'var(--surface)',
                    color: showFinancials ? 'var(--surface)' : 'var(--text)',
                    fontSize: '10px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    borderRadius: 'var(--radius)',
                    transition: 'var(--transition)'
                  }}
                >
                  {showFinancials ? 'HIDE FINANCIAL DATA' : 'SHOW FINANCIAL DATA'}
                </button>
              </div>

              {/* Financial Data Sections */}
              {showFinancials && financialSummary && (
                <>
                  {/* Client Info */}
                  {financialSummary.clientDisplayName && (
                    <div style={{ 
                      border: '2px solid var(--border)',
                      background: 'var(--bg)',
                      padding: 'var(--space-2)',
                      borderRadius: 'var(--radius)'
                    }}>
                      <div style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>
                        Client: <span style={{ fontWeight: 700, color: 'var(--text)' }}>
                          {financialSummary.clientDisplayName}
                        </span>
                        {financialSummary.isPrivate && (
                          <span style={{ 
                            marginLeft: 'var(--space-1)', 
                            fontSize: '8px',
                            color: 'var(--warning)',
                            border: '1px solid var(--warning)',
                            padding: '1px 4px',
                            borderRadius: '2px'
                          }}>
                            PRIVATE
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  
                  {/* TCI Breakdown */}
                  {financialSummary.tciTotal > 0 && (
                    <div style={{ 
                      border: '2px solid var(--border)',
                      background: 'var(--bg)',
                      padding: 'var(--space-2)',
                      borderRadius: 'var(--radius)'
                    }}>
                      <h3 style={{ fontSize: '10px', fontWeight: 700, marginBottom: 'var(--space-2)', color: 'var(--text)' }}>
                        TCI (Total Cost Involved)
                      </h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '9px' }}>
                        {financialSummary.laborCost > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>Labor:</span>
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                              {EventFinancialService.formatCurrency(financialSummary.laborCost)}
                            </span>
                          </div>
                        )}
                        {financialSummary.partsCost > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>Parts:</span>
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                              {EventFinancialService.formatCurrency(financialSummary.partsCost)}
                            </span>
                          </div>
                        )}
                        {financialSummary.suppliesCost > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>Supplies:</span>
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                              {EventFinancialService.formatCurrency(financialSummary.suppliesCost)}
                            </span>
                          </div>
                        )}
                        {financialSummary.overheadCost > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>Overhead:</span>
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                              {EventFinancialService.formatCurrency(financialSummary.overheadCost)}
                            </span>
                          </div>
                        )}
                        {financialSummary.toolDepreciationCost > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>Tools:</span>
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                              {EventFinancialService.formatCurrency(financialSummary.toolDepreciationCost)}
                            </span>
                          </div>
                        )}
                        {financialSummary.totalShopFees > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>Shop Fees:</span>
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                              {EventFinancialService.formatCurrency(financialSummary.totalShopFees)}
                            </span>
                          </div>
                        )}
                        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '4px', marginTop: '4px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                            <span style={{ color: 'var(--text)' }}>TOTAL:</span>
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                              {EventFinancialService.formatCurrency(financialSummary.tciTotal)}
                            </span>
                          </div>
                        </div>
                        {financialSummary.customerPrice > 0 && (
                          <>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: 'var(--text-secondary)' }}>Customer:</span>
                              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                                {EventFinancialService.formatCurrency(financialSummary.customerPrice)}
                              </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                              <span style={{ color: financialSummary.profitMargin >= 0 ? 'var(--success)' : 'var(--error)' }}>
                                Profit:
                              </span>
                              <span style={{ 
                                fontFamily: 'var(--font-mono)', 
                                color: financialSummary.profitMargin >= 0 ? 'var(--success)' : 'var(--error)'
                              }}>
                                {EventFinancialService.formatCurrency(financialSummary.profitMargin)}
                                {financialSummary.profitMarginPercent > 0 && (
                                  <span style={{ fontSize: '8px', marginLeft: '4px' }}>
                                    ({financialSummary.profitMarginPercent.toFixed(1)}%)
                                  </span>
                                )}
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                  
                  {/* Parts with Supplier Ratings */}
                  {partDetails.length > 0 && (
                    <div style={{ 
                      border: '2px solid var(--border)',
                      background: 'var(--bg)',
                      padding: 'var(--space-2)',
                      borderRadius: 'var(--radius)'
                    }}>
                      <h3 style={{ fontSize: '10px', fontWeight: 700, marginBottom: 'var(--space-2)', color: 'var(--text)' }}>
                        Parts & Suppliers
                      </h3>
                      {partDetails.map(part => (
                        <div key={part.id} style={{ marginBottom: 'var(--space-2)', fontSize: '9px' }}>
                          <div style={{ fontWeight: 700, color: 'var(--text)' }}>
                            {part.partName}
                            {part.partNumber && (
                              <span style={{ fontWeight: 400, color: 'var(--text-secondary)', marginLeft: 'var(--space-1)' }}>
                                #{part.partNumber}
                              </span>
                            )}
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8px', color: 'var(--text-secondary)' }}>
                            <span>
                              {EventFinancialService.formatCurrency(part.costPrice)} → {EventFinancialService.formatCurrency(part.retailPrice)}
                              {part.markupPercent > 0 && (
                                <span style={{ marginLeft: '4px' }}>({part.markupPercent.toFixed(1)}%)</span>
                              )}
                            </span>
                          </div>
                          {part.supplierName && (
                            <div style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>
                              {part.supplierName}
                              {part.supplierRating && (
                                <span style={{ marginLeft: 'var(--space-1)', color: part.supplierRating >= 95 ? 'var(--success)' : part.supplierRating >= 85 ? 'var(--warning)' : 'var(--error)' }}>
                                  {EventFinancialService.formatStars(part.supplierRating)} {part.supplierRating.toFixed(1)}%
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* Social Value */}
                  {financialSummary.totalSocialValue > 0 && (
                    <div style={{ 
                      border: '2px solid var(--border)',
                      background: 'var(--bg)',
                      padding: 'var(--space-2)',
                      borderRadius: 'var(--radius)'
                    }}>
                      <h3 style={{ fontSize: '10px', fontWeight: 700, marginBottom: 'var(--space-2)', color: 'var(--text)' }}>
                        Social Value
                      </h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '9px' }}>
                        {financialSummary.views > 0 && (
                          <div style={{ fontSize: '8px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                            {financialSummary.views.toLocaleString()} views • {financialSummary.engagementRate.toFixed(2)}% engagement
                          </div>
                        )}
                        {financialSummary.partnershipRevenue > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>Partnerships:</span>
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                              {EventFinancialService.formatCurrency(financialSummary.partnershipRevenue)}
                            </span>
                          </div>
                        )}
                        {financialSummary.sponsorshipRevenue > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>Sponsorships:</span>
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                              {EventFinancialService.formatCurrency(financialSummary.sponsorshipRevenue)}
                            </span>
                          </div>
                        )}
                        {financialSummary.viewerRevenue > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>Viewer Tips:</span>
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                              {EventFinancialService.formatCurrency(financialSummary.viewerRevenue)}
                            </span>
                          </div>
                        )}
                        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '4px', marginTop: '4px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                            <span style={{ color: 'var(--text)' }}>Total Social:</span>
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--success)' }}>
                              {EventFinancialService.formatCurrency(financialSummary.totalSocialValue)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* Combined Profit */}
                  {financialSummary.combinedProfit > 0 && (
                    <div style={{ 
                      border: '2px solid var(--success)',
                      background: 'var(--success-dim)',
                      padding: 'var(--space-2)',
                      borderRadius: 'var(--radius)'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', fontWeight: 700 }}>
                        <span style={{ color: 'var(--success)' }}>COMBINED PROFIT:</span>
                        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--success)' }}>
                          {EventFinancialService.formatCurrency(financialSummary.combinedProfit)}
                        </span>
                      </div>
                      {financialSummary.customerPrice > 0 && (
                        <div style={{ fontSize: '8px', color: 'var(--success)', marginTop: '2px' }}>
                          {((financialSummary.combinedProfit / financialSummary.customerPrice) * 100).toFixed(1)}% margin
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Turnaround Metrics */}
                  {financialSummary.totalTurnaroundHours && (
                    <div style={{ 
                      border: '2px solid var(--border)',
                      background: 'var(--bg)',
                      padding: 'var(--space-2)',
                      borderRadius: 'var(--radius)'
                    }}>
                      <h3 style={{ fontSize: '10px', fontWeight: 700, marginBottom: 'var(--space-2)', color: 'var(--text)' }}>
                        Turnaround: {financialSummary.totalTurnaroundHours.toFixed(1)}hrs
                      </h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '8px', color: 'var(--text-secondary)' }}>
                        {financialSummary.orderToDeliveryHours && (
                          <div>Order→Delivery: {financialSummary.orderToDeliveryHours.toFixed(1)}hrs</div>
                        )}
                        {financialSummary.deliveryToInstallHours && (
                          <div>Delivery→Install: {financialSummary.deliveryToInstallHours.toFixed(1)}hrs</div>
                        )}
                        {financialSummary.workDurationHours && (
                          <div>Work Duration: {financialSummary.workDurationHours.toFixed(1)}hrs</div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Action Buttons */}
              <div style={{ 
                paddingTop: 'var(--space-2)', 
                borderTop: '2px solid var(--border)'
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                  {financialSummary && financialSummary.tciTotal > 0 && (
                    <button
                      onClick={async () => {
                        setGeneratingInvoice(true);
                        try {
                          const invoiceId = await EventFinancialService.generateInvoice(currentEvent.id);
                          if (invoiceId) {
                            alert('Invoice generated! ID: ' + invoiceId);
                          }
                        } catch (err) {
                          console.error('Error generating invoice:', err);
                          alert('Failed to generate invoice');
                        } finally {
                          setGeneratingInvoice(false);
                        }
                      }}
                      disabled={generatingInvoice}
                      style={{
                        width: '100%',
                        padding: '6px var(--space-2)',
                        border: '2px solid var(--text)',
                        background: 'var(--text)',
                        color: 'var(--surface)',
                        fontSize: '9px',
                        fontWeight: 700,
                        cursor: generatingInvoice ? 'wait' : 'pointer',
                        borderRadius: 'var(--radius)',
                        transition: 'var(--transition)',
                        opacity: generatingInvoice ? 0.6 : 1
                      }}
                    >
                      {generatingInvoice ? 'GENERATING...' : 'GENERATE INVOICE'}
                    </button>
                  )}
                  <button
                    onClick={() => setShowWorkDetailsForm(true)}
                    style={{
                      width: '100%',
                      padding: '4px 8px',
                      border: '2px solid var(--border)',
                      background: 'var(--surface)',
                      color: 'var(--text)',
                      fontSize: '9px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      borderRadius: 'var(--radius)',
                      transition: 'var(--transition)'
                    }}
                  >
                    Add Work Details
                  </button>
                  <button
                    onClick={() => setShowCorrectionForm(true)}
                    style={{
                      width: '100%',
                      padding: '4px 8px',
                      border: '2px solid var(--border)',
                      background: 'var(--surface)',
                      color: 'var(--text)',
                      fontSize: '9px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      borderRadius: 'var(--radius)',
                      transition: 'var(--transition)'
                    }}
                  >
                    Correct Information
                  </button>
                  <button
                    onClick={() => setShowTaggingForm(true)}
                    style={{
                      width: '100%',
                      padding: '4px 8px',
                      border: '2px solid var(--border)',
                      background: 'var(--surface)',
                      color: 'var(--text)',
                      fontSize: '9px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      borderRadius: 'var(--radius)',
                      transition: 'var(--transition)'
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
          padding: 'var(--space-2)',
          borderTop: '2px solid var(--border)',
          background: 'var(--bg)',
          textAlign: 'center',
          fontSize: '9px',
          color: 'var(--text-secondary)'
        }}>
          Use arrow keys to navigate between events • ESC to close
        </div>
      </div>

      {/* Modal Forms */}
      {showTechnicianForm && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 60
        }}>
          <div style={{
            background: 'var(--surface)',
            padding: 'var(--space-4)',
            borderRadius: 'var(--radius)',
            maxWidth: '400px',
            width: '100%',
            margin: '0 16px',
            border: '2px solid var(--border)'
          }}>
            <h3 style={{ fontSize: '11px', fontWeight: 700, marginBottom: 'var(--space-3)', color: 'var(--text)' }}>
              Add Technician Details
            </h3>
            <form onSubmit={(e) => {
              e.preventDefault();
              console.log('Technician data:', technicianData);
              setShowTechnicianForm(false);
              setTechnicianData({ name: '', certification: '', shopName: '' });
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '9px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--text)' }}>
                    Technician Name
                  </label>
                  <input
                    type="text"
                    value={technicianData.name}
                    onChange={(e) => setTechnicianData({...technicianData, name: e.target.value})}
                    style={{
                      width: '100%',
                      padding: 'var(--space-2)',
                      border: '2px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      fontSize: '9px',
                      background: 'var(--bg)',
                      color: 'var(--text)'
                    }}
                    required
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '9px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--text)' }}>
                    Certification/License
                  </label>
                  <input
                    type="text"
                    value={technicianData.certification}
                    onChange={(e) => setTechnicianData({...technicianData, certification: e.target.value})}
                    style={{
                      width: '100%',
                      padding: 'var(--space-2)',
                      border: '2px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      fontSize: '9px',
                      background: 'var(--bg)',
                      color: 'var(--text)'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '9px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--text)' }}>
                    Shop/Business Name
                  </label>
                  <input
                    type="text"
                    value={technicianData.shopName}
                    onChange={(e) => setTechnicianData({...technicianData, shopName: e.target.value})}
                    style={{
                      width: '100%',
                      padding: 'var(--space-2)',
                      border: '2px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      fontSize: '9px',
                      background: 'var(--bg)',
                      color: 'var(--text)'
                    }}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
                <button type="submit" style={{
                  flex: 1,
                  padding: '6px 12px',
                  border: '2px solid var(--text)',
                  background: 'var(--text)',
                  color: 'var(--surface)',
                  borderRadius: 'var(--radius)',
                  fontSize: '9px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'var(--transition)'
                }}>
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setShowTechnicianForm(false)}
                  style={{
                    flex: 1,
                    padding: '6px 12px',
                    border: '2px solid var(--border)',
                    background: 'var(--surface)',
                    color: 'var(--text)',
                    borderRadius: 'var(--radius)',
                    fontSize: '9px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'var(--transition)'
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showWorkDetailsForm && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 60
        }}>
          <div style={{
            background: 'var(--surface)',
            padding: 'var(--space-4)',
            borderRadius: 'var(--radius)',
            maxWidth: '400px',
            width: '100%',
            margin: '0 16px',
            border: '2px solid var(--border)'
          }}>
            <h3 style={{ fontSize: '11px', fontWeight: 700, marginBottom: 'var(--space-3)', color: 'var(--text)' }}>
              Add Work Details
            </h3>
            <form onSubmit={(e) => {
              e.preventDefault();
              console.log('Work details:', workDetails);
              setShowWorkDetailsForm(false);
              setWorkDetails({ workType: '', description: '', partsUsed: '', laborHours: '' });
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '9px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--text)' }}>
                    Work Type
                  </label>
                  <select
                    value={workDetails.workType}
                    onChange={(e) => setWorkDetails({...workDetails, workType: e.target.value})}
                    style={{
                      width: '100%',
                      padding: 'var(--space-2)',
                      border: '2px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      fontSize: '9px',
                      background: 'var(--bg)',
                      color: 'var(--text)'
                    }}
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
                  <label style={{ display: 'block', fontSize: '9px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--text)' }}>
                    Description
                  </label>
                  <textarea
                    value={workDetails.description}
                    onChange={(e) => setWorkDetails({...workDetails, description: e.target.value})}
                    style={{
                      width: '100%',
                      padding: 'var(--space-2)',
                      border: '2px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      fontSize: '9px',
                      background: 'var(--bg)',
                      color: 'var(--text)',
                      fontFamily: 'var(--font-family)',
                      resize: 'vertical'
                    }}
                    rows={3}
                    required
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '9px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--text)' }}>
                    Parts Used
                  </label>
                  <textarea
                    value={workDetails.partsUsed}
                    onChange={(e) => setWorkDetails({...workDetails, partsUsed: e.target.value})}
                    style={{
                      width: '100%',
                      padding: 'var(--space-2)',
                      border: '2px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      fontSize: '9px',
                      background: 'var(--bg)',
                      color: 'var(--text)',
                      fontFamily: 'var(--font-family)',
                      resize: 'vertical'
                    }}
                    rows={2}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '9px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--text)' }}>
                    Labor Hours
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={workDetails.laborHours}
                    onChange={(e) => setWorkDetails({...workDetails, laborHours: e.target.value})}
                    style={{
                      width: '100%',
                      padding: 'var(--space-2)',
                      border: '2px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      fontSize: '9px',
                      background: 'var(--bg)',
                      color: 'var(--text)'
                    }}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
                <button type="submit" style={{
                  flex: 1,
                  padding: '6px 12px',
                  border: '2px solid var(--text)',
                  background: 'var(--text)',
                  color: 'var(--surface)',
                  borderRadius: 'var(--radius)',
                  fontSize: '9px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'var(--transition)'
                }}>
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setShowWorkDetailsForm(false)}
                  style={{
                    flex: 1,
                    padding: '6px 12px',
                    border: '2px solid var(--border)',
                    background: 'var(--surface)',
                    color: 'var(--text)',
                    borderRadius: 'var(--radius)',
                    fontSize: '9px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'var(--transition)'
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCorrectionForm && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 60
        }}>
          <div style={{
            background: 'var(--surface)',
            padding: 'var(--space-4)',
            borderRadius: 'var(--radius)',
            maxWidth: '400px',
            width: '100%',
            margin: '0 16px',
            border: '2px solid var(--border)'
          }}>
            <h3 style={{ fontSize: '11px', fontWeight: 700, marginBottom: 'var(--space-3)', color: 'var(--text)' }}>
              Correct Information
            </h3>
            <form onSubmit={(e) => {
              e.preventDefault();
              console.log('Correction data:', correctionData);
              setShowCorrectionForm(false);
              setCorrectionData({ field: '', currentValue: '', correctedValue: '', reason: '' });
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '9px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--text)' }}>
                    Field to Correct
                  </label>
                  <select
                    value={correctionData.field}
                    onChange={(e) => setCorrectionData({...correctionData, field: e.target.value})}
                    style={{
                      width: '100%',
                      padding: 'var(--space-2)',
                      border: '2px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      fontSize: '9px',
                      background: 'var(--bg)',
                      color: 'var(--text)'
                    }}
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
                  <label style={{ display: 'block', fontSize: '9px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--text)' }}>
                    Current Value
                  </label>
                  <input
                    type="text"
                    value={correctionData.currentValue}
                    onChange={(e) => setCorrectionData({...correctionData, currentValue: e.target.value})}
                    style={{
                      width: '100%',
                      padding: 'var(--space-2)',
                      border: '2px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      fontSize: '9px',
                      background: 'var(--bg)',
                      color: 'var(--text)'
                    }}
                    required
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '9px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--text)' }}>
                    Corrected Value
                  </label>
                  <input
                    type="text"
                    value={correctionData.correctedValue}
                    onChange={(e) => setCorrectionData({...correctionData, correctedValue: e.target.value})}
                    style={{
                      width: '100%',
                      padding: 'var(--space-2)',
                      border: '2px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      fontSize: '9px',
                      background: 'var(--bg)',
                      color: 'var(--text)'
                    }}
                    required
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '9px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--text)' }}>
                    Reason for Correction
                  </label>
                  <textarea
                    value={correctionData.reason}
                    onChange={(e) => setCorrectionData({...correctionData, reason: e.target.value})}
                    style={{
                      width: '100%',
                      padding: 'var(--space-2)',
                      border: '2px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      fontSize: '9px',
                      background: 'var(--bg)',
                      color: 'var(--text)',
                      fontFamily: 'var(--font-family)',
                      resize: 'vertical'
                    }}
                    rows={2}
                    required
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
                <button type="submit" style={{
                  flex: 1,
                  padding: '6px 12px',
                  border: '2px solid var(--text)',
                  background: 'var(--text)',
                  color: 'var(--surface)',
                  borderRadius: 'var(--radius)',
                  fontSize: '9px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'var(--transition)'
                }}>
                  Submit Correction
                </button>
                <button
                  type="button"
                  onClick={() => setShowCorrectionForm(false)}
                  style={{
                    flex: 1,
                    padding: '6px 12px',
                    border: '2px solid var(--border)',
                    background: 'var(--surface)',
                    color: 'var(--text)',
                    borderRadius: 'var(--radius)',
                    fontSize: '9px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'var(--transition)'
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showTaggingForm && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 60
        }}>
          <div style={{
            background: 'var(--surface)',
            padding: 'var(--space-4)',
            borderRadius: 'var(--radius)',
            maxWidth: '400px',
            width: '100%',
            margin: '0 16px',
            border: '2px solid var(--border)'
          }}>
            <h3 style={{ fontSize: '11px', fontWeight: 700, marginBottom: 'var(--space-3)', color: 'var(--text)' }}>
              Tag People
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div>
                <label style={{ display: 'block', fontSize: '9px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--text)' }}>
                  Add Person
                </label>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <input
                    type="text"
                    value={newPersonName}
                    onChange={(e) => setNewPersonName(e.target.value)}
                    placeholder="Enter name"
                    style={{
                      flex: 1,
                      padding: 'var(--space-2)',
                      border: '2px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      fontSize: '9px',
                      background: 'var(--bg)',
                      color: 'var(--text)'
                    }}
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
                    style={{
                      padding: '6px 12px',
                      border: '2px solid var(--text)',
                      background: 'var(--text)',
                      color: 'var(--surface)',
                      borderRadius: 'var(--radius)',
                      fontSize: '9px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'var(--transition)'
                    }}
                  >
                    Add
                  </button>
                </div>
              </div>

              {taggedPeople.length > 0 && (
                <div>
                  <label style={{ display: 'block', fontSize: '9px', fontWeight: 700, marginBottom: 'var(--space-2)', color: 'var(--text)' }}>
                    Tagged People
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                    {taggedPeople.map((person, index) => (
                      <div key={index} style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: 'var(--bg)',
                        padding: 'var(--space-2)',
                        borderRadius: 'var(--radius)',
                        border: '1px solid var(--border)'
                      }}>
                        <span style={{ fontSize: '9px', color: 'var(--text)' }}>{person}</span>
                        <button
                          type="button"
                          onClick={() => setTaggedPeople(taggedPeople.filter((_, i) => i !== index))}
                          style={{
                            fontSize: '9px',
                            color: 'var(--error)',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            fontWeight: 600
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
              <button
                onClick={() => {
                  console.log('Tagged people:', taggedPeople);
                  setShowTaggingForm(false);
                  setTaggedPeople([]);
                  setNewPersonName('');
                }}
                style={{
                  flex: 1,
                  padding: '6px 12px',
                  border: '2px solid var(--text)',
                  background: 'var(--text)',
                  color: 'var(--surface)',
                  borderRadius: 'var(--radius)',
                  fontSize: '9px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'var(--transition)'
                }}
              >
                Save Tags
              </button>
              <button
                onClick={() => {
                  setShowTaggingForm(false);
                  setTaggedPeople([]);
                  setNewPersonName('');
                }}
                style={{
                  flex: 1,
                  padding: '6px 12px',
                  border: '2px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  borderRadius: 'var(--radius)',
                  fontSize: '9px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'var(--transition)'
                }}
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
