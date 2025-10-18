/**
 * VIN Decoder Demo Component
 * 
 * Demonstrates VIN decoding capabilities with live testing interface
 */

import React, { useState } from 'react';
import { useVINDecoder } from '../../hooks/useVINDecoder';

export const VINDecoderDemo: React.FC = () => {
  const [vinInput, setVinInput] = useState('');
  const { decodeVIN, validateVIN, getRecalls, decoding, result, recalls, error } = useVINDecoder();
  
  const handleDecode = async () => {
    if (!vinInput.trim()) return;
    await decodeVIN(vinInput);
    // Also fetch recalls in background
    getRecalls(vinInput).catch(console.error);
  };
  
  const handleValidate = () => {
    const validation = validateVIN(vinInput);
    alert(`Valid: ${validation.valid}\nConfidence: ${validation.confidence}\n${validation.error || ''}`);
  };
  
  // Sample VINs for testing
  const sampleVINs = [
    { vin: '1HGBH41JXMN109186', desc: '2021 Honda Accord' },
    { vin: '1G1YY23J9P5800001', desc: '1993 Chevrolet Corvette' },
    { vin: 'WBADT43452G965922', desc: '2002 BMW 330i' },
    { vin: 'JM1BL1S58A1361246', desc: '2010 Mazda 3' },
  ];
  
  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '1rem' }}>VIN Decoder Test Interface</h1>
      
      {/* Input Section */}
      <div style={{ marginBottom: '2rem', padding: '1.5rem', border: '1px solid #ddd', borderRadius: '8px' }}>
        <h2>Decode a VIN</h2>
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
          <input
            type="text"
            value={vinInput}
            onChange={(e) => setVinInput(e.target.value.toUpperCase())}
            placeholder="Enter 17-character VIN"
            maxLength={17}
            style={{
              flex: 1,
              padding: '0.75rem',
              fontSize: '1.1rem',
              fontFamily: 'monospace',
              border: '2px solid #ccc',
              borderRadius: '4px'
            }}
          />
          <button
            onClick={handleDecode}
            disabled={decoding || vinInput.length !== 17}
            style={{
              padding: '0.75rem 2rem',
              background: decoding ? '#999' : '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: decoding ? 'not-allowed' : 'pointer',
              fontWeight: 'bold'
            }}
          >
            {decoding ? 'Decoding...' : 'Decode VIN'}
          </button>
          <button
            onClick={handleValidate}
            disabled={!vinInput}
            style={{
              padding: '0.75rem 1.5rem',
              background: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Validate
          </button>
        </div>
        
        {/* Sample VINs */}
        <div style={{ marginTop: '1rem' }}>
          <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '0.5rem' }}>
            Sample VINs (click to test):
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {sampleVINs.map((sample) => (
              <button
                key={sample.vin}
                onClick={() => setVinInput(sample.vin)}
                style={{
                  padding: '0.5rem 1rem',
                  background: '#f8f9fa',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.85rem'
                }}
                title={sample.desc}
              >
                {sample.vin.slice(0, 8)}... ({sample.desc})
              </button>
            ))}
          </div>
        </div>
      </div>
      
      {/* Error Display */}
      {error && (
        <div style={{
          padding: '1rem',
          background: '#f8d7da',
          color: '#721c24',
          borderRadius: '4px',
          marginBottom: '1rem'
        }}>
          <strong>Error:</strong> {error}
        </div>
      )}
      
      {/* Results Display */}
      {result && (
        <div style={{ marginBottom: '2rem' }}>
          <h2>Decode Results</h2>
          
          {/* Basic Info */}
          <div style={{ 
            padding: '1.5rem', 
            background: result.valid ? '#d4edda' : '#f8d7da', 
            border: `1px solid ${result.valid ? '#c3e6cb' : '#f5c6cb'}`,
            borderRadius: '8px',
            marginBottom: '1rem'
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
              <div>
                <strong>VIN:</strong> {result.normalized_vin}
              </div>
              <div>
                <strong>Valid:</strong> {result.valid ? '✅ Yes' : '❌ No'}
              </div>
              <div>
                <strong>Confidence:</strong> {(result.confidence * 100).toFixed(0)}%
              </div>
            </div>
            {result.error_message && (
              <div style={{ marginTop: '1rem', color: '#721c24' }}>
                <strong>Error:</strong> {result.error_message}
              </div>
            )}
          </div>
          
          {result.valid && (
            <>
              {/* Vehicle Info */}
              <div style={{ 
                padding: '1.5rem', 
                border: '1px solid #ddd', 
                borderRadius: '8px',
                marginBottom: '1rem'
              }}>
                <h3 style={{ marginTop: 0 }}>Vehicle Information</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
                  <div>
                    <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '0.25rem' }}>
                      Year Make Model
                    </label>
                    <div>{result.year} {result.make} {result.model}</div>
                  </div>
                  <div>
                    <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '0.25rem' }}>
                      Trim
                    </label>
                    <div>{result.trim || 'N/A'}</div>
                  </div>
                  <div>
                    <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '0.25rem' }}>
                      Body Type
                    </label>
                    <div>{result.body_type || 'N/A'}</div>
                  </div>
                  <div>
                    <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '0.25rem' }}>
                      Doors / Seats
                    </label>
                    <div>{result.doors || '?'} doors / {result.seats || '?'} seats</div>
                  </div>
                </div>
              </div>
              
              {/* Engine & Drivetrain */}
              <div style={{ 
                padding: '1.5rem', 
                border: '1px solid #ddd', 
                borderRadius: '8px',
                marginBottom: '1rem'
              }}>
                <h3 style={{ marginTop: 0 }}>Engine & Drivetrain</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
                  <div>
                    <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '0.25rem' }}>
                      Engine Size
                    </label>
                    <div>{result.engine_size || 'N/A'}</div>
                  </div>
                  <div>
                    <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '0.25rem' }}>
                      Cylinders
                    </label>
                    <div>{result.engine_cylinders || 'N/A'}</div>
                  </div>
                  <div>
                    <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '0.25rem' }}>
                      Fuel Type
                    </label>
                    <div>{result.fuel_type || 'N/A'}</div>
                  </div>
                  <div>
                    <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '0.25rem' }}>
                      Drivetrain
                    </label>
                    <div>{result.drivetrain || 'N/A'}</div>
                  </div>
                  <div>
                    <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '0.25rem' }}>
                      Transmission
                    </label>
                    <div>{result.transmission || 'N/A'}</div>
                  </div>
                </div>
              </div>
              
              {/* Manufacturing Info */}
              {(result.manufacturer || result.plant_city || result.plant_country) && (
                <div style={{ 
                  padding: '1.5rem', 
                  border: '1px solid #ddd', 
                  borderRadius: '8px',
                  marginBottom: '1rem'
                }}>
                  <h3 style={{ marginTop: 0 }}>Manufacturing</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
                    <div>
                      <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '0.25rem' }}>
                        Manufacturer
                      </label>
                      <div>{result.manufacturer || 'N/A'}</div>
                    </div>
                    <div>
                      <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '0.25rem' }}>
                        Plant Location
                      </label>
                      <div>
                        {result.plant_city && result.plant_country 
                          ? `${result.plant_city}, ${result.plant_country}`
                          : 'N/A'
                        }
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
          
          {/* Metadata */}
          <div style={{ 
            padding: '1rem', 
            background: '#f8f9fa', 
            borderRadius: '4px',
            fontSize: '0.85rem',
            color: '#666'
          }}>
            <strong>Provider:</strong> {result.provider.toUpperCase()} | 
            <strong> Decoded:</strong> {new Date(result.decoded_at).toLocaleString()}
          </div>
        </div>
      )}
      
      {/* Recalls Display */}
      {recalls && (
        <div style={{ marginTop: '2rem' }}>
          <h2>Safety Recalls</h2>
          {recalls.recall_count === 0 ? (
            <div style={{
              padding: '1.5rem',
              background: '#d4edda',
              color: '#155724',
              borderRadius: '8px'
            }}>
              ✅ No open recalls found for this vehicle
            </div>
          ) : (
            <div style={{
              padding: '1.5rem',
              background: '#fff3cd',
              color: '#856404',
              border: '1px solid #ffeeba',
              borderRadius: '8px'
            }}>
              <p style={{ marginTop: 0, fontWeight: 'bold' }}>
                ⚠️ {recalls.recall_count} open recall(s) found:
              </p>
              {recalls.recalls.map((recall, idx) => (
                <div key={idx} style={{ 
                  marginTop: '1rem', 
                  paddingTop: '1rem', 
                  borderTop: idx > 0 ? '1px solid #ddd' : 'none' 
                }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>
                    Campaign: {recall.campaign_number} - {recall.component}
                  </div>
                  <div style={{ marginBottom: '0.5rem' }}>
                    <strong>Summary:</strong> {recall.summary}
                  </div>
                  <div style={{ marginBottom: '0.5rem' }}>
                    <strong>Consequence:</strong> {recall.consequence}
                  </div>
                  <div>
                    <strong>Remedy:</strong> {recall.remedy}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      
      {/* Info Footer */}
      <div style={{
        marginTop: '3rem',
        padding: '1.5rem',
        background: '#e7f3ff',
        borderRadius: '8px',
        fontSize: '0.9rem'
      }}>
        <h3 style={{ marginTop: 0 }}>About This Tool</h3>
        <p>
          This VIN decoder uses the free NHTSA VPIC API to decode vehicle information. 
          Data is cached for 7 days to improve performance.
        </p>
        <ul>
          <li>✅ Supports all US market vehicles (1981+)</li>
          <li>✅ ~150 data points available</li>
          <li>✅ Recalls checked automatically</li>
          <li>✅ No API key required</li>
        </ul>
        <p style={{ marginBottom: 0 }}>
          For commercial APIs with enhanced data (title history, accidents, etc.), 
          see <code>/docs/VIN_API_INTEGRATION.md</code>
        </p>
      </div>
    </div>
  );
};

export default VINDecoderDemo;

