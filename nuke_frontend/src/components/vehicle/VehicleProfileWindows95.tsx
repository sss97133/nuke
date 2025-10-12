import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import '../../design-system.css';

interface Vehicle {
  id: string;
  year: number;
  make: string;
  model: string;
  vin?: string;
  color?: string;
  mileage?: number;
  engine?: string;
  transmission?: string;
  description?: string;
  is_for_sale?: boolean;
  asking_price?: number;
  current_value?: number;
  purchase_price?: number;
  sale_price?: number;
  msrp?: number;
  is_public?: boolean;
  view_count?: number;
  created_at: string;
  updated_at: string;
}

interface TimelineEvent {
  id: string;
  event_type: string;
  title: string;
  description?: string;
  event_date: string;
  image_urls?: string[];
  created_at: string;
}

interface VehicleImage {
  id: string;
  image_url: string;
  is_primary: boolean;
  created_at: string;
}

const VehicleProfileWindows95 = () => {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [vehicleImages, setVehicleImages] = useState<VehicleImage[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewCount, setViewCount] = useState(0);

  useEffect(() => {
    if (vehicleId) {
      loadVehicleData();
    }
  }, [vehicleId]);

  const loadVehicleData = async () => {
    try {
      setLoading(true);

      // Load vehicle details
      const { data: vehicleData, error: vehicleError } = await supabase
        .from('vehicles')
        .select('*')
        .eq('id', vehicleId)
        .single();

      if (vehicleError || !vehicleData) {
        console.error('Vehicle not found:', vehicleError);
        navigate('/vehicles');
        return;
      }

      setVehicle(vehicleData);
      setViewCount(vehicleData.view_count || 0);

      // Load timeline events
      const { data: timelineData } = await supabase
        .from('timeline_events')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('event_date', { ascending: false });

      setTimelineEvents(timelineData || []);

      // Load images
      const { data: imageData } = await supabase
        .from('vehicle_images')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: true });

      setVehicleImages(imageData || []);

      // Set primary image
      const primaryImage = imageData?.find(img => img.is_primary);
      if (primaryImage) {
        setSelectedImage(primaryImage.image_url);
      } else if (imageData && imageData.length > 0) {
        setSelectedImage(imageData[0].image_url);
      }

      // Record view
      await recordView();

    } catch (error) {
      console.error('Error loading vehicle data:', error);
    } finally {
      setLoading(false);
    }
  };

  const recordView = async () => {
    if (!vehicleId) return;

    try {
      await supabase
        .from('vehicle_views')
        .insert({
          vehicle_id: vehicleId,
          user_id: user?.id || null,
          viewed_at: new Date().toISOString()
        });

      setViewCount(prev => prev + 1);
    } catch (error) {
      console.debug('Error recording view:', error);
    }
  };

  const formatPrice = (price?: number) => {
    if (!price) return 'Not specified';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0
    }).format(price);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  if (loading) {
    return (
      <div style={{
        background: '#f5f5f5',
        border: '1px solid #bdbdbd',
        padding: '16px',
        margin: '16px',
        fontFamily: 'Arial, sans-serif',
        textAlign: 'center',
        fontSize: '8pt'
      }}>
        Loading vehicle profile...
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div style={{
        background: '#f5f5f5',
        border: '1px solid #bdbdbd',
        padding: '16px',
        margin: '16px',
        fontFamily: 'Arial, sans-serif',
        textAlign: 'center',
        fontSize: '8pt'
      }}>
        Vehicle not found
      </div>
    );
  }

  return (
    <div style={{
      background: '#f5f5f5',
      padding: '16px',
      fontFamily: 'Arial, sans-serif'
    }}>
      {/* Vehicle Header */}
      <div style={{
        background: '#f5f5f5',
        border: '1px solid #bdbdbd',
        padding: '12px',
        marginBottom: '16px'
      }}>
        <div style={{
          fontSize: '12pt',
          fontWeight: 'bold',
          color: '#424242',
          marginBottom: '4px'
        }}>
          {vehicle.year} {vehicle.make} {vehicle.model}
        </div>

        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          {vehicle.is_for_sale && vehicle.asking_price && (
            <div>
              <div style={{ fontSize: '10pt', fontWeight: 'bold', color: '#166534' }}>
                {formatPrice(vehicle.asking_price)}
              </div>
              <div style={{ fontSize: '7pt', color: '#757575' }}>Asking Price</div>
            </div>
          )}

          {vehicle.current_value && (
            <div>
              <div style={{ fontSize: '10pt', fontWeight: 'bold' }}>
                {formatPrice(vehicle.current_value)}
              </div>
              <div style={{ fontSize: '7pt', color: '#757575' }}>Est. Value</div>
            </div>
          )}

          <div style={{
            background: '#e0e0e0',
            padding: '2px 6px',
            fontSize: '7pt',
            border: '1px solid #bdbdbd'
          }}>
            {viewCount} views
          </div>

          {vehicle.is_for_sale && (
            <div style={{
              background: '#166534',
              color: 'white',
              padding: '2px 6px',
              fontSize: '7pt',
              fontWeight: 'bold',
              border: '1px solid #bdbdbd'
            }}>
              FOR SALE
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* Left Column - Vehicle Details */}
        <div>
          {/* Basic Information */}
          <div style={{
            background: '#f5f5f5',
            border: '1px solid #bdbdbd',
            marginBottom: '16px'
          }}>
            <div style={{
              background: '#e0e0e0',
              padding: '8px 12px',
              borderBottom: '1px solid #bdbdbd',
              fontSize: '8pt',
              fontWeight: 'bold'
            }}>
              Basic Information
            </div>

            <div style={{ padding: '12px' }}>
              {[
                { label: 'Year', value: vehicle.year },
                { label: 'Make', value: vehicle.make },
                { label: 'Model', value: vehicle.model },
                { label: 'VIN', value: vehicle.vin || 'Not provided' },
                { label: 'Color', value: vehicle.color || 'Not specified' },
                { label: 'Mileage', value: vehicle.mileage ? `${vehicle.mileage.toLocaleString()} mi` : 'Not specified' },
                { label: 'Engine', value: vehicle.engine || 'Not specified' },
                { label: 'Transmission', value: vehicle.transmission || 'Not specified' }
              ].map(({ label, value }) => (
                <div key={label} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '4px 0',
                  borderBottom: '1px solid #e0e0e0',
                  fontSize: '8pt'
                }}>
                  <span>{label}:</span>
                  <span style={{ fontWeight: 'bold' }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Description */}
          {vehicle.description && (
            <div style={{
              background: '#f5f5f5',
              border: '1px solid #bdbdbd',
              marginBottom: '16px'
            }}>
              <div style={{
                background: '#e0e0e0',
                padding: '8px 12px',
                borderBottom: '1px solid #bdbdbd',
                fontSize: '8pt',
                fontWeight: 'bold'
              }}>
                Description
              </div>
              <div style={{ padding: '12px', fontSize: '8pt' }}>
                {vehicle.description}
              </div>
            </div>
          )}

          {/* Timeline Events */}
          <div style={{
            background: '#f5f5f5',
            border: '1px solid #bdbdbd'
          }}>
            <div style={{
              background: '#e0e0e0',
              padding: '8px 12px',
              borderBottom: '1px solid #bdbdbd',
              fontSize: '8pt',
              fontWeight: 'bold'
            }}>
              Timeline ({timelineEvents.length} events)
            </div>

            <div style={{ padding: '12px', maxHeight: '400px', overflowY: 'auto' }}>
              {timelineEvents.length === 0 ? (
                <div style={{ fontSize: '8pt', color: '#757575', textAlign: 'center' }}>
                  No timeline events yet
                </div>
              ) : (
                timelineEvents.map(event => (
                  <div key={event.id} style={{
                    background: 'white',
                    border: '1px solid #bdbdbd',
                    padding: '8px',
                    marginBottom: '8px',
                    fontSize: '8pt'
                  }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                      {event.title}
                    </div>
                    <div style={{ fontSize: '7pt', color: '#757575', marginBottom: '4px' }}>
                      {formatDate(event.event_date)} • {event.event_type}
                    </div>
                    {event.description && (
                      <div style={{ marginBottom: '4px' }}>
                        {event.description}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column - Images */}
        <div>
          {/* Main Image */}
          {selectedImage && (
            <div style={{
              background: 'white',
              border: '1px solid #bdbdbd',
              marginBottom: '16px'
            }}>
              <img
                src={selectedImage}
                alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                style={{
                  width: '100%',
                  height: '400px',
                  objectFit: 'cover',
                  border: 'none'
                }}
              />
            </div>
          )}

          {/* Image Gallery */}
          {vehicleImages.length > 0 && (
            <div style={{
              background: '#f5f5f5',
              border: '1px solid #bdbdbd'
            }}>
              <div style={{
                background: '#e0e0e0',
                padding: '8px 12px',
                borderBottom: '1px solid #bdbdbd',
                fontSize: '8pt',
                fontWeight: 'bold'
              }}>
                Gallery ({vehicleImages.length} images)
              </div>

              <div style={{
                padding: '12px',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
                gap: '8px',
                maxHeight: '200px',
                overflowY: 'auto'
              }}>
                {vehicleImages.map(image => (
                  <div
                    key={image.id}
                    onClick={() => setSelectedImage(image.image_url)}
                    style={{
                      border: selectedImage === image.image_url ? '2px solid #3b82f6' : '1px solid #bdbdbd',
                      cursor: 'pointer',
                      position: 'relative'
                    }}
                  >
                    <img
                      src={image.image_url}
                      alt="Vehicle"
                      style={{
                        width: '100%',
                        height: '60px',
                        objectFit: 'cover'
                      }}
                    />
                    {image.is_primary && (
                      <div style={{
                        position: 'absolute',
                        top: '2px',
                        left: '2px',
                        background: '#166534',
                        color: 'white',
                        padding: '1px 3px',
                        fontSize: '6pt',
                        fontWeight: 'bold'
                      }}>
                        PRIMARY
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {vehicleImages.length === 0 && (
            <div style={{
              background: '#f5f5f5',
              border: '1px solid #bdbdbd',
              padding: '24px',
              textAlign: 'center',
              fontSize: '8pt',
              color: '#757575'
            }}>
              No images available
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{
        background: '#f5f5f5',
        border: '1px solid #bdbdbd',
        padding: '12px',
        marginTop: '16px',
        display: 'flex',
        gap: '8px',
        justifyContent: 'center'
      }}>
        <button
          onClick={() => navigate('/vehicles')}
          style={{
            background: '#e0e0e0',
            border: '1px solid #bdbdbd',
            borderRadius: '0px',
            padding: '6px 12px',
            fontSize: '8pt',
            cursor: 'pointer'
          }}
        >
          ← Back to Vehicles
        </button>

        {user && (
          <button
            onClick={() => navigate(`/vehicle/${vehicle.id}/edit`)}
            style={{
              background: '#424242',
              color: 'white',
              border: '1px solid #bdbdbd',
              borderRadius: '0px',
              padding: '6px 12px',
              fontSize: '8pt',
              cursor: 'pointer'
            }}
          >
            Edit Vehicle
          </button>
        )}
      </div>
    </div>
  );
};

export default VehicleProfileWindows95;