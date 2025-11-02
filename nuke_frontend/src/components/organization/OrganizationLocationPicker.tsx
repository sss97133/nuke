/**
 * GPS Location Picker for Organizations
 * Interactive map with draggable marker for precise location setting
 */

import React, { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { supabase } from '../../lib/supabase';

// Fix Leaflet default icon paths
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface LocationPickerProps {
  organizationId: string;
  organizationName: string;
  currentLat?: number | null;
  currentLng?: number | null;
  currentAddress?: string | null;
  onSaved: () => void;
  onClose: () => void;
}

export const OrganizationLocationPicker: React.FC<LocationPickerProps> = ({
  organizationId,
  organizationName,
  currentLat,
  currentLng,
  currentAddress,
  onSaved,
  onClose
}) => {
  const [latitude, setLatitude] = useState(currentLat?.toString() || '');
  const [longitude, setLongitude] = useState(currentLng?.toString() || '');
  const [address, setAddress] = useState(currentAddress || '');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Default center: current location or Boulder City, NV
    const defaultLat = currentLat || 35.9785;
    const defaultLng = currentLng || -114.8329;

    // Create map
    const map = L.map(mapContainerRef.current).setView([defaultLat, defaultLng], 15);

    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(map);

    // Add draggable marker
    const marker = L.marker([defaultLat, defaultLng], {
      draggable: true,
      autoPan: true
    }).addTo(map);

    // Update coordinates when marker is dragged
    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      setLatitude(pos.lat.toFixed(6));
      setLongitude(pos.lng.toFixed(6));
    });

    // Allow clicking on map to move marker
    map.on('click', (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng);
      setLatitude(e.latlng.lat.toFixed(6));
      setLongitude(e.latlng.lng.toFixed(6));
    });

    mapRef.current = map;
    markerRef.current = marker;

    // Set initial coordinates if provided
    if (currentLat && currentLng) {
      setLatitude(currentLat.toFixed(6));
      setLongitude(currentLng.toFixed(6));
    }

    // Cleanup on unmount
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update marker position when coordinates change (from geocoding or manual input)
  useEffect(() => {
    if (!markerRef.current || !mapRef.current) return;

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      markerRef.current.setLatLng([lat, lng]);
      mapRef.current.setView([lat, lng], mapRef.current.getZoom());
    }
  }, [latitude, longitude]);

  // Geocode address to get coordinates
  const geocodeAddress = async () => {
    if (!address && !city) {
      alert('Please enter an address or city');
      return;
    }

    setGeocoding(true);
    try {
      const query = [address, city, state, zipCode].filter(Boolean).join(', ');
      
      // Use Nominatim (OpenStreetMap) free geocoding
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`,
        {
          headers: {
            'User-Agent': 'Nuke-Platform/1.0'
          }
        }
      );

      const results = await response.json();
      
      if (results.length === 0) {
        alert('Address not found. Try a different search or enter coordinates manually.');
        return;
      }

      const result = results[0];
      setLatitude(result.lat);
      setLongitude(result.lon);
      
      // Update address fields from result
      if (result.display_name) {
        const parts = result.display_name.split(', ');
        if (!address && parts[0]) setAddress(parts[0]);
        if (!city && parts.length > 2) setCity(parts[parts.length - 3]);
        if (!state && parts.length > 1) setState(parts[parts.length - 2]);
      }

    } catch (error) {
      console.error('Geocoding error:', error);
      alert('Failed to geocode address. Please try again or enter coordinates manually.');
    } finally {
      setGeocoding(false);
    }
  };

  const handleSave = async () => {
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lng)) {
      alert('Invalid coordinates. Please enter valid latitude and longitude.');
      return;
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      alert('Coordinates out of range. Latitude: -90 to 90, Longitude: -180 to 180');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('businesses')
        .update({
          latitude: lat,
          longitude: lng,
          address: address || null,
          city: city || null,
          state: state || null,
          zip_code: zipCode || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', organizationId);

      if (error) throw error;

      alert('Location saved! GPS-based work order linking is now active.');
      onSaved();
      onClose();
    } catch (error: any) {
      console.error('Error saving location:', error);
      alert(`Failed to save: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{
          width: '100%',
          maxWidth: '600px',
          maxHeight: '90vh',
          overflow: 'auto'
        }}
      >
        <div className="card-header">
          <h3 style={{ fontSize: '11pt', fontWeight: 700, margin: 0 }}>
            Set GPS Location for {organizationName}
          </h3>
        </div>
        <div className="card-body">
          <div style={{ marginBottom: '16px', fontSize: '8pt', color: 'var(--text-muted)' }}>
            Set the GPS coordinates for this location to enable automatic work order linking.
            When vehicle images are taken at this location, timeline events will automatically link to this organization.
          </div>

          {/* Address Search */}
          <div style={{ marginBottom: '16px', padding: '12px', background: 'var(--grey-100)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '9pt', fontWeight: 600, marginBottom: '8px' }}>
              Search by Address
            </div>
            <div style={{ display: 'grid', gap: '8px' }}>
              <input
                type="text"
                placeholder="Street address"
                className="form-input"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                style={{ fontSize: '9pt' }}
              />
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="City"
                  className="form-input"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  style={{ fontSize: '9pt' }}
                />
                <input
                  type="text"
                  placeholder="State"
                  className="form-input"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  style={{ fontSize: '9pt', textTransform: 'uppercase' }}
                  maxLength={2}
                />
                <input
                  type="text"
                  placeholder="ZIP"
                  className="form-input"
                  value={zipCode}
                  onChange={(e) => setZipCode(e.target.value)}
                  style={{ fontSize: '9pt' }}
                  maxLength={10}
                />
              </div>
              <button
                className="button button-primary"
                onClick={geocodeAddress}
                disabled={geocoding || (!address && !city)}
                style={{ fontSize: '9pt' }}
              >
                {geocoding ? 'Searching...' : 'Find Coordinates'}
              </button>
            </div>
          </div>

          {/* Manual Coordinates */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '9pt', fontWeight: 600, marginBottom: '8px' }}>
              GPS Coordinates (Decimal Degrees)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div>
                <label style={{ fontSize: '8pt', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Latitude (-90 to 90)
                </label>
                <input
                  type="number"
                  step="0.000001"
                  placeholder="35.972000"
                  className="form-input"
                  value={latitude}
                  onChange={(e) => setLatitude(e.target.value)}
                  style={{ fontSize: '9pt' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '8pt', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Longitude (-180 to 180)
                </label>
                <input
                  type="number"
                  step="0.000001"
                  placeholder="-114.854200"
                  className="form-input"
                  value={longitude}
                  onChange={(e) => setLongitude(e.target.value)}
                  style={{ fontSize: '9pt' }}
                />
              </div>
            </div>
          </div>

          {/* Interactive Map */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '9pt', fontWeight: 600, marginBottom: '8px' }}>
              Interactive Map - Click or drag marker to set location
            </div>
            <div 
              ref={mapContainerRef}
              style={{ 
                width: '100%', 
                height: '400px', 
                border: '2px solid var(--border)', 
                borderRadius: '4px',
                position: 'relative',
                zIndex: 1
              }}
            />
            <div style={{ marginTop: '8px', fontSize: '8pt', color: 'var(--text-muted)' }}>
              Drag the marker or click anywhere on the map to set precise GPS coordinates.
              {latitude && longitude && (
                <>
                  {' | '}
                  <a 
                    href={`https://www.google.com/maps?q=${latitude},${longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--accent)' }}
                  >
                    View in Google Maps
                  </a>
                </>
              )}
            </div>
          </div>

          {/* Help Text */}
          <div style={{ marginBottom: '16px', padding: '12px', background: 'var(--info-dim)', border: '1px solid var(--info)', borderRadius: '4px' }}>
            <div style={{ fontSize: '8pt', fontWeight: 600, marginBottom: '4px', color: 'var(--info)' }}>
              How to get coordinates:
            </div>
            <ul style={{ fontSize: '8pt', margin: 0, paddingLeft: '20px', color: 'var(--text-secondary)' }}>
              <li>Use the address search above (easiest)</li>
              <li>Right-click on Google Maps → "What's here?" → Copy coordinates</li>
              <li>On mobile: Long-press location → Dropped pin shows coordinates</li>
              <li>GPS from your phone camera's EXIF data (if photos were taken there)</li>
            </ul>
          </div>
        </div>

        <div className="card-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            className="button button-secondary"
            onClick={onClose}
            style={{ fontSize: '9pt' }}
          >
            Cancel
          </button>
          <button
            className="button button-primary"
            onClick={handleSave}
            disabled={saving || !latitude || !longitude}
            style={{ fontSize: '9pt' }}
          >
            {saving ? 'Saving...' : 'Save Location'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OrganizationLocationPicker;

