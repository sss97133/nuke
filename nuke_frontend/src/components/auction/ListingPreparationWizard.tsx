/**
 * Listing Preparation Wizard
 * Helps users prepare their vehicle listing for submission to multiple platforms
 * Supports: N-Zero (internal), BaT, eBay, Craigslist, Cars.com, etc.
 */

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import '../../design-system.css';

interface VehicleData {
  id: string;
  year: number;
  make: string;
  model: string;
  trim: string | null;
  vin: string | null;
  mileage: number | null;
  primary_image_url: string | null;
  description: string | null;
}

type Platform = 'nzero' | 'bat' | 'ebay' | 'craigslist' | 'carscom' | 'facebook';

interface ListingPackage {
  platform: Platform;
  title: string;
  description: string;
  price: number;
  images: string[];
  keywords: string[];
  export_format: 'json' | 'csv' | 'html' | 'text';
}

interface ListingPreparationWizardProps {
  vehicleId?: string;
  onComplete?: (packages: ListingPackage[]) => void;
}

export default function ListingPreparationWizard({ vehicleId: propVehicleId, onComplete }: ListingPreparationWizardProps) {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const vehicleId = propVehicleId || searchParams.get('vehicle') || '';
  
  const [step, setStep] = useState(1);
  const [vehicle, setVehicle] = useState<VehicleData | null>(null);
  const [images, setImages] = useState<any[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>([]);
  const [customDescription, setCustomDescription] = useState('');
  const [askingPrice, setAskingPrice] = useState('');
  const [reservePrice, setReservePrice] = useState('');
  const [generatedPackages, setGeneratedPackages] = useState<ListingPackage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (vehicleId) {
      loadVehicleData();
    }
  }, [vehicleId]);

  const loadVehicleData = async () => {
    // Load vehicle details
    const { data: vehicleData, error: vehicleError } = await supabase
      .from('vehicles')
      .select('*')
      .eq('id', vehicleId)
      .single();

    if (vehicleError) {
      console.error('Error loading vehicle:', vehicleError);
      return;
    }

    setVehicle(vehicleData);
    setCustomDescription(vehicleData.description || '');

    // Load images
    const { data: imagesData, error: imagesError } = await supabase
      .from('vehicle_images')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('display_order', { ascending: true });

    if (!imagesError && imagesData) {
      setImages(imagesData);
    }
  };

  const platformInfo: Record<Platform, { name: string; description: string; icon: string }> = {
    nzero: {
      name: 'N-Zero Auction',
      description: 'List on our marketplace with real-time bidding',
      icon: '🏠'
    },
    bat: {
      name: 'Bring a Trailer',
      description: 'Premium classic car auction platform (we help prepare)',
      icon: '🏁'
    },
    ebay: {
      name: 'eBay Motors',
      description: 'Largest online vehicle marketplace',
      icon: '🔨'
    },
    craigslist: {
      name: 'Craigslist',
      description: 'Local classifieds listing',
      icon: '📰'
    },
    carscom: {
      name: 'Cars.com',
      description: 'National vehicle listing platform',
      icon: '🚗'
    },
    facebook: {
      name: 'Facebook Marketplace',
      description: 'Social marketplace with local reach',
      icon: '📱'
    }
  };

  const togglePlatform = (platform: Platform) => {
    if (selectedPlatforms.includes(platform)) {
      setSelectedPlatforms(selectedPlatforms.filter(p => p !== platform));
    } else {
      setSelectedPlatforms([...selectedPlatforms, platform]);
    }
  };

  const generateListingDescription = async (platform: Platform): Promise<string> => {
    if (!vehicle) return '';

    // Base description
    let description = customDescription || '';

    // Platform-specific formatting
    switch (platform) {
      case 'bat':
        // BaT prefers detailed, story-driven descriptions
        description = `This ${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ''} ${
          vehicle.mileage ? `has ${vehicle.mileage.toLocaleString()} miles` : 'mileage available upon request'
        }.\n\n${description}\n\nVIN: ${vehicle.vin || 'Available to serious buyers'}`;
        break;

      case 'ebay':
        // eBay needs HTML-friendly, detailed specs
        description = `<h2>${vehicle.year} ${vehicle.make} ${vehicle.model}</h2>\n${description}\n\n<h3>Specifications:</h3>\n<ul>\n<li>Year: ${vehicle.year}</li>\n<li>Make: ${vehicle.make}</li>\n<li>Model: ${vehicle.model}</li>\n${vehicle.mileage ? `<li>Mileage: ${vehicle.mileage.toLocaleString()}</li>` : ''}\n${vehicle.vin ? `<li>VIN: ${vehicle.vin}</li>` : ''}\n</ul>`;
        break;

      case 'craigslist':
        // Craigslist prefers concise, plain text
        description = `${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ''}\n${vehicle.mileage ? `${vehicle.mileage.toLocaleString()} miles\n` : ''}${description}\n\nSerious inquiries only.`;
        break;

      case 'carscom':
      case 'facebook':
        // Standard format
        description = `${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ''}\n\n${description}`;
        break;

      case 'nzero':
        // Keep original description for internal listing
        description = customDescription;
        break;
    }

    return description;
  };

  const generateTitle = (platform: Platform): string => {
    if (!vehicle) return '';

    switch (platform) {
      case 'bat':
        return `${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ''}`;
      
      case 'ebay':
        return `${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` - ${vehicle.trim}` : ''} - ${vehicle.mileage ? `${vehicle.mileage.toLocaleString()} Miles` : 'Low Miles'}`;
      
      case 'craigslist':
        return `${vehicle.year} ${vehicle.make} ${vehicle.model} - $${askingPrice}`;
      
      default:
        return `${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ''}`;
    }
  };

  const generatePackages = async () => {
    if (!vehicle) return;

    setLoading(true);
    const packages: ListingPackage[] = [];

    for (const platform of selectedPlatforms) {
      const description = await generateListingDescription(platform);
      const title = generateTitle(platform);

      packages.push({
        platform,
        title,
        description,
        price: parseFloat(askingPrice) || 0,
        images: images.slice(0, platform === 'bat' ? 50 : 24).map(img => img.image_url),
        keywords: [
          vehicle.year.toString(),
          vehicle.make,
          vehicle.model,
          vehicle.trim || '',
          'classic car',
          'collector car'
        ].filter(Boolean),
        export_format: platform === 'ebay' ? 'html' : platform === 'craigslist' ? 'text' : 'json'
      });
    }

    setGeneratedPackages(packages);
    setLoading(false);
    setStep(4);
  };

  const downloadPackage = (pkg: ListingPackage) => {
    let content = '';
    let filename = `${pkg.platform}_${vehicle?.year}_${vehicle?.make}_${vehicle?.model}`;

    switch (pkg.export_format) {
      case 'json':
        content = JSON.stringify(pkg, null, 2);
        filename += '.json';
        break;
      
      case 'html':
        content = `<!DOCTYPE html>
<html>
<head><title>${pkg.title}</title></head>
<body>
  <h1>${pkg.title}</h1>
  <p><strong>Price:</strong> $${pkg.price.toLocaleString()}</p>
  <div>${pkg.description}</div>
  <h2>Images</h2>
  ${pkg.images.map(url => `<img src="${url}" style="max-width: 800px; margin: 10px 0;" />`).join('\n  ')}
</body>
</html>`;
        filename += '.html';
        break;
      
      case 'text':
        content = `${pkg.title}\n\nPrice: $${pkg.price.toLocaleString()}\n\n${pkg.description}\n\nImages:\n${pkg.images.join('\n')}`;
        filename += '.txt';
        break;
      
      case 'csv':
        content = `Title,Price,Description,Images\n"${pkg.title}","${pkg.price}","${pkg.description.replace(/"/g, '""')}","${pkg.images.join('|')}"`;
        filename += '.csv';
        break;
    }

    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const submitToNZero = async () => {
    const nzeroPackage = generatedPackages.find(p => p.platform === 'nzero');
    if (!nzeroPackage || !user) return;

    // Create auction listing on N-Zero
    const { data, error } = await supabase
      .from('vehicle_listings')
      .insert({
        vehicle_id: vehicleId,
        seller_id: user.id,
        sale_type: 'auction',
        list_price_cents: Math.floor(nzeroPackage.price * 100),
        reserve_price_cents: reservePrice ? Math.floor(parseFloat(reservePrice) * 100) : null,
        auction_duration_minutes: 7 * 24 * 60, // 7 days
        status: 'draft',
        description: nzeroPackage.description,
        metadata: {
          prepared_via_wizard: true,
          prepared_at: new Date().toISOString()
        }
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating listing:', error);
      alert('Failed to create listing');
    } else {
      alert('Listing created successfully! You can activate it from the dashboard.');
      if (onComplete) onComplete(generatedPackages);
    }
  };

  if (!vehicle) {
    return <div className="p-6 text-center">Loading vehicle data...</div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Progress Steps */}
      <div className="mb-8">
        <div className="flex justify-between items-center">
          {[1, 2, 3, 4].map((s) => (
            <div key={s} className="flex items-center flex-1">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                  step >= s ? 'bg-blue-600 text-white' : 'bg-gray-300 text-gray-600'
                }`}
              >
                {s}
              </div>
              {s < 4 && (
                <div
                  className={`flex-1 h-1 mx-2 ${step > s ? 'bg-blue-600' : 'bg-gray-300'}`}
                />
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-between mt-2 text-xs text-gray-600">
          <span>Vehicle Info</span>
          <span>Select Platforms</span>
          <span>Customize</span>
          <span>Export</span>
        </div>
      </div>

      {/* Step 1: Vehicle Info */}
      {step === 1 && (
        <div className="space-y-6">
          <h2 className="text-2xl font-bold">Vehicle Information</h2>
          
          <div className="bg-white p-6 rounded-lg border border-gray-200">
            <div className="flex gap-6">
              {vehicle.primary_image_url && (
                <img
                  src={vehicle.primary_image_url}
                  alt="Vehicle"
                  className="w-48 h-36 object-cover rounded"
                />
              )}
              <div className="flex-1">
                <h3 className="text-xl font-bold mb-2">
                  {vehicle.year} {vehicle.make} {vehicle.model} {vehicle.trim}
                </h3>
                {vehicle.vin && <p className="text-sm text-gray-600">VIN: {vehicle.vin}</p>}
                {vehicle.mileage && (
                  <p className="text-sm text-gray-600">
                    Mileage: {vehicle.mileage.toLocaleString()}
                  </p>
                )}
                <p className="text-sm text-gray-600 mt-2">
                  {images.length} images available
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={() => setStep(2)}
            className="w-full py-3 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors font-medium"
          >
            Continue to Platform Selection
          </button>
        </div>
      )}

      {/* Step 2: Platform Selection */}
      {step === 2 && (
        <div className="space-y-6">
          <h2 className="text-2xl font-bold">Select Listing Platforms</h2>
          <p className="text-gray-600">
            Choose where you want to list this vehicle. We'll prepare optimized listings for each platform.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(Object.keys(platformInfo) as Platform[]).map((platform) => {
              const info = platformInfo[platform];
              const isSelected = selectedPlatforms.includes(platform);

              return (
                <button
                  key={platform}
                  onClick={() => togglePlatform(platform)}
                  className={`p-6 rounded-lg border-2 text-left transition-all ${
                    isSelected
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div className="text-3xl">{info.icon}</div>
                    <div className="flex-1">
                      <h3 className="font-bold text-lg mb-1">{info.name}</h3>
                      <p className="text-sm text-gray-600">{info.description}</p>
                    </div>
                    {isSelected && (
                      <div className="text-blue-600 font-bold text-xl">✓</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex gap-4">
            <button
              onClick={() => setStep(1)}
              className="flex-1 py-3 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors font-medium"
            >
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={selectedPlatforms.length === 0}
              className="flex-1 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors font-medium disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              Continue to Customization
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Customize Listing */}
      {step === 3 && (
        <div className="space-y-6">
          <h2 className="text-2xl font-bold">Customize Your Listing</h2>

          <div className="bg-white p-6 rounded-lg border border-gray-200 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Asking Price ($)
              </label>
              <input
                type="number"
                value={askingPrice}
                onChange={(e) => setAskingPrice(e.target.value)}
                placeholder="50000"
                className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {selectedPlatforms.includes('nzero') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Reserve Price (Optional, for N-Zero auction)
                </label>
                <input
                  type="number"
                  value={reservePrice}
                  onChange={(e) => setReservePrice(e.target.value)}
                  placeholder="45000"
                  className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Description
              </label>
              <textarea
                value={customDescription}
                onChange={(e) => setCustomDescription(e.target.value)}
                placeholder="Describe your vehicle's condition, history, modifications, and unique features..."
                rows={10}
                className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                We'll optimize this description for each platform
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <button
              onClick={() => setStep(2)}
              className="flex-1 py-3 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors font-medium"
            >
              Back
            </button>
            <button
              onClick={generatePackages}
              disabled={!askingPrice || loading}
              className="flex-1 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors font-medium disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {loading ? 'Generating...' : 'Generate Listing Packages'}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Export */}
      {step === 4 && generatedPackages.length > 0 && (
        <div className="space-y-6">
          <h2 className="text-2xl font-bold">Your Listing Packages Are Ready</h2>
          <p className="text-gray-600">
            Download packages for external platforms or submit directly to N-Zero.
          </p>

          <div className="space-y-4">
            {generatedPackages.map((pkg) => {
              const info = platformInfo[pkg.platform];

              return (
                <div key={pkg.platform} className="bg-white p-6 rounded-lg border border-gray-200">
                  <div className="flex items-start gap-4">
                    <div className="text-3xl">{info.icon}</div>
                    <div className="flex-1">
                      <h3 className="font-bold text-lg mb-1">{info.name}</h3>
                      <p className="text-sm text-gray-600 mb-2">{pkg.title}</p>
                      <p className="text-sm text-gray-500 mb-3 line-clamp-2">
                        {pkg.description}
                      </p>
                      <div className="flex gap-2">
                        {pkg.platform === 'nzero' ? (
                          <button
                            onClick={submitToNZero}
                            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors text-sm"
                          >
                            Submit to N-Zero
                          </button>
                        ) : (
                          <button
                            onClick={() => downloadPackage(pkg)}
                            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm"
                          >
                            Download {pkg.export_format.toUpperCase()}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <button
            onClick={() => {
              if (onComplete) onComplete(generatedPackages);
            }}
            className="w-full py-3 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors font-medium"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}

