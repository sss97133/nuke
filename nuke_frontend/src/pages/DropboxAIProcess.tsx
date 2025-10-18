import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import AppLayout from '../components/layout/AppLayout';
import '../design-system.css';

interface VehicleData {
  vehicleName: string;
  folderPath: string;
  images: Array<{
    name: string;
    downloadUrl: string;
    metadata?: any;
  }>;
}

interface AIAnalysisResult {
  vehicleName: string;
  confidence: number;
  extractedData: {
    year?: number;
    make?: string;
    model?: string;
    color?: string;
    condition?: string;
    bodyStyle?: string;
    mileage?: number;
    vin?: string;
  };
  primaryImageUrl: string;
  allImages: string[];
  rawAnalysis: string;
}

const DropboxAIProcess: React.FC = () => {
  const [vehicles, setVehicles] = useState<VehicleData[]>([]);
  const [processing, setProcessing] = useState(false);
  const [currentVehicle, setCurrentVehicle] = useState<string>('');
  const [results, setResults] = useState<AIAnalysisResult[]>([]);
  const [approvedResults, setApprovedResults] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    // Load selected vehicles from localStorage
    const selectedVehicles = localStorage.getItem('dropbox_selected_vehicles');
    if (selectedVehicles) {
      setVehicles(JSON.parse(selectedVehicles));
    } else {
      navigate('/dropbox-import');
    }
  }, [navigate]);

  const analyzeVehicleImages = async (vehicle: VehicleData): Promise<AIAnalysisResult> => {
    const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    // Use the first image as primary for analysis
    const primaryImage = vehicle.images[0];
    if (!primaryImage) {
      throw new Error(`No images found for vehicle: ${vehicle.vehicleName}`);
    }

    const prompt = `Analyze this vehicle image taken by a professional photographer and extract the following information in JSON format:
    {
      "year": estimated year (number),
      "make": vehicle manufacturer,
      "model": vehicle model,
      "color": primary exterior color,
      "condition": overall condition assessment (excellent/good/fair/poor),
      "bodyStyle": body style (sedan/coupe/suv/truck/convertible/etc),
      "confidence": confidence level (0-1)
    }
    
    Context:
    - Vehicle folder name: "${vehicle.vehicleName}"
    - Images were taken by an anonymous professional photographer for inventory purposes
    - Focus on accurate identification over speed
    - If folder name contains vehicle info, use it to validate your analysis
    
    Please be as accurate as possible and indicate your confidence level. If the folder name suggests specific year/make/model, verify this matches what you see in the image.`;

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4-vision-preview',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image_url',
                  image_url: { url: primaryImage.downloadUrl }
                }
              ]
            }
          ],
          max_tokens: 1000
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }

      const data = await response.json();
      const analysisText = data.choices[0]?.message?.content || '';
      
      // Try to extract JSON from the response
      let extractedData = {};
      let confidence = 0.5;
      
      try {
        const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          extractedData = parsed;
          confidence = parsed.confidence || 0.5;
        }
      } catch (parseError) {
        console.error('Error parsing AI response:', parseError);
        // Fallback: try to extract data from text
        extractedData = extractDataFromText(analysisText, vehicle.vehicleName);
      }

      return {
        vehicleName: vehicle.vehicleName,
        confidence,
        extractedData,
        primaryImageUrl: primaryImage.downloadUrl,
        allImages: vehicle.images.map(img => img.downloadUrl),
        rawAnalysis: analysisText
      };
    } catch (error) {
      console.error(`Error analyzing ${vehicle.vehicleName}:`, error);
      throw error;
    }
  };

  const extractDataFromText = (text: string, folderName: string) => {
    // Enhanced folder name parsing for "year make model" format
    const data: any = {};
    
    // Parse folder name first (more reliable than AI text)
    const folderParts = folderName.trim().split(/\s+/);
    
    // Extract year (4 digits, typically 1900-2030)
    const yearMatch = folderName.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      data.year = parseInt(yearMatch[0]);
    }
    
    // Comprehensive car manufacturers list
    const makes = [
      'Acura', 'Alfa Romeo', 'Aston Martin', 'Audi', 'Bentley', 'BMW', 'Buick', 'Cadillac', 
      'Chevrolet', 'Chevy', 'Chrysler', 'Dodge', 'Ferrari', 'Fiat', 'Ford', 'Genesis', 
      'GMC', 'Honda', 'Hyundai', 'Infiniti', 'Jaguar', 'Jeep', 'Kia', 'Lamborghini', 
      'Land Rover', 'Lexus', 'Lincoln', 'Maserati', 'Mazda', 'McLaren', 'Mercedes', 
      'Mercedes-Benz', 'Mini', 'Mitsubishi', 'Nissan', 'Porsche', 'Ram', 'Rolls-Royce', 
      'Subaru', 'Tesla', 'Toyota', 'Volkswagen', 'VW', 'Volvo'
    ];
    
    // Find make in folder name (case insensitive)
    for (const make of makes) {
      const makeRegex = new RegExp(`\\b${make.replace('-', '[-\\s]?')}\\b`, 'i');
      if (makeRegex.test(folderName)) {
        data.make = make === 'Chevy' ? 'Chevrolet' : make === 'VW' ? 'Volkswagen' : make;
        break;
      }
    }
    
    // Extract model (everything after make, excluding year)
    if (data.make && data.year) {
      const makeIndex = folderName.toLowerCase().indexOf(data.make.toLowerCase());
      const yearStr = data.year.toString();
      let modelPart = folderName.substring(makeIndex + data.make.length).trim();
      modelPart = modelPart.replace(yearStr, '').trim();
      if (modelPart) {
        data.model = modelPart;
      }
    }
    
    // Fallback: try AI text analysis
    if (!data.year) {
      const textYearMatch = text.match(/\b(19|20)\d{2}\b/);
      if (textYearMatch) data.year = parseInt(textYearMatch[0]);
    }
    
    if (!data.make) {
      for (const make of makes) {
        if (text.toLowerCase().includes(make.toLowerCase())) {
          data.make = make;
          break;
        }
      }
    }
    
    return data;
  };

  const processAllVehicles = async () => {
    setProcessing(true);
    setError(null);
    const processedResults: AIAnalysisResult[] = [];

    for (const vehicle of vehicles) {
      try {
        setCurrentVehicle(vehicle.vehicleName);
        const result = await analyzeVehicleImages(vehicle);
        processedResults.push(result);
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Failed to process ${vehicle.vehicleName}:`, error);
        setError(`Failed to process ${vehicle.vehicleName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    setResults(processedResults);
    setCurrentVehicle('');
    setProcessing(false);
  };

  const toggleApproval = (vehicleName: string) => {
    const newApproved = new Set(approvedResults);
    if (newApproved.has(vehicleName)) {
      newApproved.delete(vehicleName);
    } else {
      newApproved.add(vehicleName);
    }
    setApprovedResults(newApproved);
  };

  const approveAll = () => {
    setApprovedResults(new Set(results.map(r => r.vehicleName)));
  };

  const clearApprovals = () => {
    setApprovedResults(new Set());
  };

  const saveApprovedVehicles = async () => {
    const approvedVehicles = results.filter(result => 
      approvedResults.has(result.vehicleName)
    );

    if (approvedVehicles.length === 0) {
      setError('Please approve at least one vehicle to save');
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      for (const result of approvedVehicles) {
        const vehicleData = {
          id: crypto.randomUUID(),
          year: result.extractedData.year || 0,
          make: result.extractedData.make || '',
          model: result.extractedData.model || '',
          color: result.extractedData.color || null,
          vin: result.extractedData.vin || null,
          mileage: result.extractedData.mileage || null,
          body_style: result.extractedData.bodyStyle || null,
          condition: result.extractedData.condition || null,
          description: `Imported from Dropbox folder: ${result.vehicleName}. Images taken by professional photographer for inventory purposes.`,
          is_public: true,
          user_id: session?.user?.id || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          // Metadata for provenance tracking
          import_source: 'dropbox',
          import_folder: result.vehicleName,
          photographer_type: 'anonymous_professional',
          ai_confidence: result.confidence,
          total_images: result.allImages.length
        };

        if (session?.user?.id) {
          // Save to Supabase for authenticated users
          const { error } = await supabase.from('vehicles').insert([vehicleData]);
          if (error) {
            console.error('Error saving vehicle to Supabase:', error);
          }
        } else {
          // Save to localStorage for anonymous users
          const existingVehicles = JSON.parse(localStorage.getItem('anonymousVehicles') || '[]');
          existingVehicles.push({ ...vehicleData, isPublic: true, isAnonymous: true });
          localStorage.setItem('anonymousVehicles', JSON.stringify(existingVehicles));
        }
      }

      // Clean up
      localStorage.removeItem('dropbox_selected_vehicles');
      
      // Navigate to vehicles page
      navigate('/vehicles');
    } catch (error) {
      console.error('Error saving vehicles:', error);
      setError('Failed to save vehicles. Please try again.');
    }
  };

  return (
    <AppLayout
      title="AI Vehicle Analysis"
      showBackButton={true}
      breadcrumbs={[
        { label: "Dashboard", path: "/dashboard" },
        { label: "Import from Dropbox", path: "/dropbox-import" },
        { label: "AI Analysis" }
      ]}
    >
      <div className="fade-in">
        {/* Processing Status */}
        {processing && (
          <section className="section">
            <div className="card">
              <div className="card-body text-center">
                <div className="loading-spinner mb-4"></div>
                <h3 className="text font-bold mb-2">Processing Vehicles with AI</h3>
                <p className="text-small text-muted mb-2">
                  Analyzing images and extracting vehicle information...
                </p>
                {currentVehicle && (
                  <p className="text-small">
                    Currently processing: <strong>{currentVehicle}</strong>
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Error Display */}
        {error && (
          <section className="section">
            <div className="alert alert-error">
              {error}
            </div>
          </section>
        )}

        {/* Start Processing */}
        {!processing && results.length === 0 && vehicles.length > 0 && (
          <section className="section">
            <div className="card">
              <div className="card-header">Ready to Process {vehicles.length} Vehicles</div>
              <div className="card-body text-center">
                <p className="text mb-4">
                  AI will analyze images from each vehicle folder to extract make, model, year, and other details.
                </p>
                <button 
                  className="button button-primary"
                  onClick={processAllVehicles}
                >
                  Start AI Analysis
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Results */}
        {results.length > 0 && (
          <>
            <section className="section">
              <div className="card">
                <div className="card-header">
                  <div className="flex items-center justify-between">
                    <span>AI Analysis Results ({results.length} vehicles)</span>
                    <div className="flex gap-2">
                      <button 
                        className="button button-small button-secondary"
                        onClick={approveAll}
                      >
                        Approve All
                      </button>
                      <button 
                        className="button button-small button-secondary"
                        onClick={clearApprovals}
                      >
                        Clear All
                      </button>
                    </div>
                  </div>
                </div>
                <div className="card-body">
                  <div className="space-y-4">
                    {results.map((result) => (
                      <div 
                        key={result.vehicleName}
                        className={`card cursor-pointer ${
                          approvedResults.has(result.vehicleName) ? 'border-primary' : ''
                        }`}
                        onClick={() => toggleApproval(result.vehicleName)}
                      >
                        <div className="card-body">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <input 
                                type="checkbox"
                                checked={approvedResults.has(result.vehicleName)}
                                onChange={() => toggleApproval(result.vehicleName)}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <div>
                                <h3 className="text font-bold">{result.vehicleName}</h3>
                                <div className="flex items-center gap-2">
                                  <span className={`badge ${
                                    result.confidence > 0.8 ? 'badge-primary' : 
                                    result.confidence > 0.6 ? 'badge-secondary' : 'badge-warning'
                                  }`}>
                                    {Math.round(result.confidence * 100)}% confidence
                                  </span>
                                </div>
                              </div>
                            </div>
                            <img 
                              src={result.primaryImageUrl}
                              alt={result.vehicleName}
                              className="w-20 h-20 object-cover rounded"
                            />
                          </div>
                          
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-small">
                            <div>
                              <span className="text-muted">Year:</span>
                              <div className="font-medium">{result.extractedData.year || 'Unknown'}</div>
                            </div>
                            <div>
                              <span className="text-muted">Make:</span>
                              <div className="font-medium">{result.extractedData.make || 'Unknown'}</div>
                            </div>
                            <div>
                              <span className="text-muted">Model:</span>
                              <div className="font-medium">{result.extractedData.model || 'Unknown'}</div>
                            </div>
                            <div>
                              <span className="text-muted">Color:</span>
                              <div className="font-medium">{result.extractedData.color || 'Unknown'}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* Save Button */}
            {approvedResults.size > 0 && (
              <section className="section">
                <div className="card">
                  <div className="card-body text-center">
                    <p className="text mb-4">
                      {approvedResults.size} vehicle{approvedResults.size !== 1 ? 's' : ''} approved for import
                    </p>
                    <button 
                      className="button button-primary"
                      onClick={saveApprovedVehicles}
                    >
                      Import Approved Vehicles
                    </button>
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
};

export default DropboxAIProcess;
