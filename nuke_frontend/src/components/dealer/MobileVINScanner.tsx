/**
 * Mobile VIN Scanner for Dealers
 * Quick workflow: Snap VIN plate → OCR → Match vehicle → Update profile
 * Optimized for iPhone / fast field data entry
 */

import React, { useState, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import Tesseract from 'tesseract.js';

interface MobileVINScannerProps {
  organizationId: string;
  onVehicleUpdated?: (vehicleId: string, vin: string) => void;
}

export const MobileVINScanner: React.FC<MobileVINScannerProps> = ({ 
  organizationId,
  onVehicleUpdated 
}) => {
  const [scanning, setScanning] = useState(false);
  const [extractedVIN, setExtractedVIN] = useState('');
  const [matchedVehicle, setMatchedVehicle] = useState<any>(null);
  const [candidateVehicles, setCandidateVehicles] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const extractVINFromText = (text: string): string | null => {
    // VIN pattern: 17 alphanumeric (no I, O, Q)
    const vinPattern = /\b[A-HJ-NPR-Z0-9]{17}\b/g;
    const matches = text.toUpperCase().match(vinPattern);
    return matches ? matches[0] : null;
  };

  const handleImageCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanning(true);
    setMatchedVehicle(null);
    setCandidateVehicles([]);

    try {
      // OCR the VIN plate image
      console.log('OCR: Extracting text from VIN plate...');
      const { data: { text } } = await Tesseract.recognize(file, 'eng', {
        logger: m => console.log(m)
      });

      console.log('OCR Result:', text);

      // Extract VIN
      const vin = extractVINFromText(text);
      
      if (!vin) {
        alert('No VIN found in image. Please try again or enter manually.');
        setScanning(false);
        return;
      }

      setExtractedVIN(vin);
      console.log('Extracted VIN:', vin);

      // Find vehicles in this organization's inventory that don't have a proper VIN
      const { data: orgVehicles } = await supabase
        .from('organization_vehicles')
        .select(`
          vehicle_id,
          vehicles!inner(
            id,
            year,
            make,
            model,
            trim,
            vin
          )
        `)
        .eq('organization_id', organizationId)
        .or('vin.is.null,vin.like.VIVA-%', { foreignTable: 'vehicles' });

      if (orgVehicles && orgVehicles.length > 0) {
        const candidates = orgVehicles.map((ov: any) => ov.vehicles);
        setCandidateVehicles(candidates);
        
        if (candidates.length === 1) {
          setMatchedVehicle(candidates[0]);
        }
      }

    } catch (error: any) {
      console.error('VIN scan error:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setScanning(false);
    }
  };

  const updateVehicleVIN = async (vehicleId: string) => {
    try {
      const { error } = await supabase
        .from('vehicles')
        .update({ vin: extractedVIN })
        .eq('id', vehicleId);

      if (error) throw error;

      alert(`VIN updated successfully!\n${extractedVIN}`);
      
      // Reset
      setExtractedVIN('');
      setMatchedVehicle(null);
      setCandidateVehicles([]);
      
      if (onVehicleUpdated) {
        onVehicleUpdated(vehicleId, extractedVIN);
      }

    } catch (error: any) {
      alert(`Error updating VIN: ${error.message}`);
    }
  };

  const handleManualVINEntry = async () => {
    const manualVIN = prompt('Enter VIN manually (17 characters):');
    if (!manualVIN || manualVIN.length !== 17) {
      alert('VIN must be exactly 17 characters');
      return;
    }

    setExtractedVIN(manualVIN.toUpperCase());

    // Find candidates
    const { data: orgVehicles } = await supabase
      .from('organization_vehicles')
      .select(`
        vehicle_id,
        vehicles!inner(
          id,
          year,
          make,
          model,
          trim,
          vin
        )
      `)
      .eq('organization_id', organizationId)
      .or('vin.is.null,vin.like.VIVA-%', { foreignTable: 'vehicles' });

    if (orgVehicles && orgVehicles.length > 0) {
      const candidates = orgVehicles.map((ov: any) => ov.vehicles);
      setCandidateVehicles(candidates);
    }
  };

  return (
    <div className="card" style={{ maxWidth: '600px', margin: '0 auto' }}>
      <div className="card-header">
        <h3>VIN Plate Scanner</h3>
      </div>
      <div className="card-body">
        {/* Camera Input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleImageCapture}
          style={{ display: 'none' }}
        />

        <div className="space-y-3">
          {/* Scan Button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={scanning}
            className="button button-primary"
            style={{ width: '100%', padding: '16px', fontSize: '11pt' }}
          >
            {scanning ? 'SCANNING...' : 'SCAN VIN PLATE'}
          </button>

          {/* Manual Entry Button */}
          <button
            onClick={handleManualVINEntry}
            className="button button-secondary"
            style={{ width: '100%' }}
          >
            ENTER VIN MANUALLY
          </button>

          {/* Extracted VIN Display */}
          {extractedVIN && (
            <div style={{
              padding: '12px',
              background: 'var(--success-bg)',
              border: '2px solid var(--success)',
              borderRadius: '4px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '4px' }}>
                Extracted VIN:
              </div>
              <div style={{ 
                fontSize: '12pt', 
                fontWeight: 700, 
                fontFamily: 'monospace',
                letterSpacing: '2px'
              }}>
                {extractedVIN}
              </div>
            </div>
          )}

          {/* Candidate Vehicles */}
          {candidateVehicles.length > 0 && (
            <div>
              <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '8px' }}>
                Select vehicle to update:
              </div>
              <div className="space-y-2">
                {candidateVehicles.map(vehicle => (
                  <div
                    key={vehicle.id}
                    onClick={() => setMatchedVehicle(vehicle)}
                    className="card"
                    style={{
                      cursor: 'pointer',
                      border: matchedVehicle?.id === vehicle.id ? '2px solid var(--primary)' : undefined,
                      background: matchedVehicle?.id === vehicle.id ? 'var(--primary-bg)' : undefined
                    }}
                  >
                    <div className="card-body">
                      <div style={{ fontSize: '10pt', fontWeight: 700 }}>
                        {vehicle.year} {vehicle.make} {vehicle.model} {vehicle.trim || ''}
                      </div>
                      <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
                        Current VIN: {vehicle.vin || 'NONE'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Update Button */}
          {matchedVehicle && extractedVIN && (
            <button
              onClick={() => updateVehicleVIN(matchedVehicle.id)}
              className="button button-primary"
              style={{ width: '100%', padding: '16px', fontSize: '11pt' }}
            >
              UPDATE VIN ON {matchedVehicle.year} {matchedVehicle.make} {matchedVehicle.model}
            </button>
          )}

          {/* Instructions */}
          <div style={{ 
            fontSize: '9pt', 
            color: 'var(--text-muted)',
            textAlign: 'center',
            marginTop: '16px'
          }}>
            <p>Snap a clear photo of the VIN plate (usually on driver's door jamb or dashboard)</p>
            <p style={{ marginTop: '4px' }}>The VIN will be automatically extracted and matched to your inventory</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MobileVINScanner;

