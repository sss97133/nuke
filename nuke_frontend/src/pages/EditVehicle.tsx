import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
// AppLayout now provided globally by App.tsx
import VehicleMakeModelInput from '../components/forms/VehicleMakeModelInput';
import SeriesSelector from '../components/forms/SeriesSelector';
import TrimSelector from '../components/forms/TrimSelector';
import { TimelineEventService } from '../services/timelineEventService';
import '../design-system.css';

type DetailLevel = 'basic' | 'detailed' | 'professional' | 'expert';

interface VehicleFormData {
  // Core Identity
  make: string;
  model: string;
  series?: string;
  trim?: string;
  year?: number;
  vin?: string;
  license_plate?: string;

  // Physical Specifications
  color?: string;
  secondary_color?: string;
  interior_color?: string;
  interior_color_secondary?: string;
  interior_color_tertiary?: string;
  body_style?: string;
  doors?: number;
  seats?: number;
  seat_type?: string;
  seat_material_primary?: string;
  seat_material_secondary?: string;
  interior_material_details?: string;
  
  // Trade information
  received_in_trade?: boolean;
  
  // Trim & Styling
  has_molding?: boolean;
  has_pinstriping?: boolean;
  has_body_kit?: boolean;
  has_racing_stripes?: boolean;
  trim_details?: string;

  // Engine & Performance
  fuel_type?: string;
  transmission?: string;
  transmission_model?: string;
  engine_size?: string;
  displacement?: string;
  horsepower?: number;
  torque?: number;
  drivetrain?: string;

  // Dimensions & Weight
  weight_lbs?: number;
  length_inches?: number;
  width_inches?: number;
  height_inches?: number;
  wheelbase_inches?: number;

  // Fuel Economy
  fuel_capacity_gallons?: number;
  mpg_city?: number;
  mpg_highway?: number;
  mpg_combined?: number;

  // Financial Information
  msrp?: number;
  current_value?: number;
  asking_price?: number;
  purchase_price?: number;
  purchase_date?: string;
  purchase_location?: string;

  // Sale/Auction Information
  is_for_sale?: boolean;
  sale_price?: number;
  auction_source?: string;
  bid_count?: number;
  auction_end_date?: string;

  // Ownership & History
  mileage?: number;
  previous_owners?: number;
  condition_rating?: number;

  // Modifications
  is_modified?: boolean;
  modification_details?: string;

  // Legal & Insurance
  maintenance_notes?: string;
  insurance_company?: string;
  insurance_policy_number?: string;
  registration_state?: string;
  registration_expiry?: string;
  inspection_expiry?: string;

  // System Fields
  is_public?: boolean;
  notes?: string;
  status?: 'draft' | 'active' | 'archived';
}

const EditVehicle: React.FC = () => {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [detailLevel, setDetailLevel] = useState<DetailLevel>('detailed');
  const [originalVehicle, setOriginalVehicle] = useState<VehicleFormData | null>(null);
  const [formData, setFormData] = useState<VehicleFormData>({
    make: '',
    model: '',
  });
  const [importUrl, setImportUrl] = useState('');
  const [isScraping, setIsScraping] = useState(false);
  const [scrapingError, setScrapingError] = useState<string | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
    };
    fetchUser();
  }, []);

  useEffect(() => {
    if (user && vehicleId) {
      loadVehicle();
    }
  }, [user, vehicleId]);

  const loadVehicle = async () => {
    if (!vehicleId) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .eq('id', vehicleId)
        .single();

      if (error || !data) {
        setError('Vehicle not found or access denied');
        return;
      }

      // Check if user is owner or has edit permissions
      if (!user || (data.user_id !== user?.id && data.uploaded_by !== user?.id && data.owner_id !== user?.id)) {
        // Check for contributor access via RPC function
        const { data: canEdit, error: permError } = await supabase
          .rpc('user_can_edit_vehicle', {
            p_vehicle_id: vehicleId,
            p_user_id: user?.id || ''
          });
        
        if (permError || !canEdit) {
          console.error('[EditVehicle] Permission denied:', permError, 'canEdit:', canEdit);
          setError('You do not have permission to edit this vehicle');
          return;
        }
      }

      // Map database fields to form fields - only include fields that exist in DB
      const vehicleData: VehicleFormData = {
        make: data.make || '',
        model: data.model || '',
        series: data.series,
        trim: data.trim,
        year: data.year,
        vin: data.vin,
        license_plate: data.license_plate,
        color: data.color,
        secondary_color: data.secondary_color,
        interior_color: data.interior_color,
        interior_color_secondary: data.interior_color_secondary,
        interior_color_tertiary: data.interior_color_tertiary,
        body_style: data.body_style,
        doors: data.doors,
        seats: data.seats,
        seat_type: data.seat_type,
        seat_material_primary: data.seat_material_primary,
        seat_material_secondary: data.seat_material_secondary,
        interior_material_details: data.interior_material_details,
        received_in_trade: data.received_in_trade || false,
        has_molding: data.has_molding,
        has_pinstriping: data.has_pinstriping,
        has_racing_stripes: data.has_racing_stripes,
        has_body_kit: data.has_body_kit,
        trim_details: data.trim_details,
        fuel_type: data.fuel_type,
        transmission: data.transmission,
        transmission_model: data.transmission_model,
        engine_size: data.engine_size,
        displacement: data.displacement,
        horsepower: data.horsepower,
        torque: data.torque,
        drivetrain: data.drivetrain,
        weight_lbs: data.weight_lbs,
        length_inches: data.length_inches,
        width_inches: data.width_inches,
        height_inches: data.height_inches,
        wheelbase_inches: data.wheelbase_inches,
        fuel_capacity_gallons: data.fuel_capacity_gallons,
        mpg_city: data.mpg_city,
        mpg_highway: data.mpg_highway,
        mpg_combined: data.mpg_combined,
        msrp: data.msrp,
        current_value: data.current_value,
        purchase_price: data.purchase_price,
        purchase_date: data.purchase_date,
        purchase_location: data.purchase_location,
        is_for_sale: data.is_for_sale,
        sale_price: data.sale_price,
        auction_source: data.auction_source,
        bid_count: data.bid_count,
        auction_end_date: data.auction_end_date,
        mileage: data.mileage,
        previous_owners: data.previous_owners,
        condition_rating: data.condition_rating,
        is_modified: data.is_modified,
        modification_details: data.modification_details,
        maintenance_notes: data.maintenance_notes,
        insurance_company: data.insurance_company,
        insurance_policy_number: data.insurance_policy_number,
        registration_state: data.registration_state,
        registration_expiry: data.registration_expiry,
        inspection_expiry: data.inspection_expiry,
        is_public: data.is_public,
        notes: data.notes,
        status: data.status,
      };

      setFormData(vehicleData);
      setOriginalVehicle(vehicleData);
    } catch (err: any) {
      setError(err.message || 'Error loading vehicle');
    } finally {
      setLoading(false);
    }
  };

  const handleImportUrl = async () => {
    if (!importUrl.trim()) return;

    const supportedSites = [
      'bringatrailer.com',
      'hagerty.com',
      'classic.com',
      'cars.com',
      'autotrader.com',
      'facebook.com/marketplace',
      'craigslist.org'
    ];

    const isSupported = supportedSites.some(site => importUrl.includes(site));
    if (!isSupported) {
      setScrapingError(`Supported sites: ${supportedSites.join(', ')}`);
      return;
    }

    try {
      setIsScraping(true);
      setScrapingError(null);

      const { data: result, error: fnError } = await supabase.functions.invoke('simple-scraper', {
        body: { url: importUrl }
      });

      if (fnError || !result?.success) {
        throw new Error(fnError?.message || 'Scraping failed');
      }

      const scrapedData = result.data;
      const updates: Partial<VehicleFormData> = {};

      // Map scraped data to form fields
      if (scrapedData.make) updates.make = scrapedData.make;
      if (scrapedData.model) updates.model = scrapedData.model;
      if (scrapedData.series) updates.series = scrapedData.series;
      if (scrapedData.trim) updates.trim = scrapedData.trim;
      if (scrapedData.year) updates.year = parseInt(scrapedData.year);
      if (scrapedData.vin) updates.vin = scrapedData.vin;
      
      if (scrapedData.mileage) {
        const mileageStr = typeof scrapedData.mileage === 'string' 
          ? scrapedData.mileage 
          : String(scrapedData.mileage);
        updates.mileage = parseInt(mileageStr.replace(/,/g, ''));
      }
      
      if (scrapedData.color) updates.color = scrapedData.color;
      if (scrapedData.body_style) updates.body_style = scrapedData.body_style;
      if (scrapedData.transmission) updates.transmission = scrapedData.transmission;
      if (scrapedData.engine_size) updates.engine_size = scrapedData.engine_size;
      if (scrapedData.displacement) updates.displacement = String(scrapedData.displacement);
      if (scrapedData.drivetrain) updates.drivetrain = scrapedData.drivetrain;
      if (scrapedData.fuel_type) updates.fuel_type = scrapedData.fuel_type;
      
      // Pricing - map to asking_price (sale price)
      const parseCurrencyValue = (value: any): number | null => {
        if (!value) return null;
        if (typeof value === 'number') return value;
        const str = String(value).replace(/[^0-9.]/g, '');
        const parsed = parseFloat(str);
        return isNaN(parsed) ? null : parsed;
      };

      const askingPrice = parseCurrencyValue(scrapedData.asking_price ?? scrapedData.price);
      if (askingPrice !== null) {
        // Map to asking_price field (which we renamed from current_value)
        (updates as any).asking_price = askingPrice;
        updates.is_for_sale = true;
      }

      const salePrice = parseCurrencyValue(scrapedData.sale_price);
      if (salePrice !== null) updates.sale_price = salePrice;

      if (scrapedData.trim) (updates as any).trim = scrapedData.trim;
      if (scrapedData.description) updates.notes = scrapedData.description;

      // Update form with scraped data
      setFormData({ ...formData, ...updates });
      setImportUrl('');
      
    } catch (error: any) {
      setScrapingError(error.message || 'Failed to import data');
    } finally {
      setIsScraping(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    let processedValue: any;

    if (type === 'number') {
      // Handle numeric fields - convert empty strings to null for DB
      processedValue = value === '' ? null : parseFloat(value);
      if (processedValue !== null && isNaN(processedValue)) {
        processedValue = null;
      }
    } else if (type === 'checkbox') {
      processedValue = (e.target as HTMLInputElement).checked;
    } else {
      // Handle text fields - convert empty strings to null for optional DB fields
      processedValue = value === '' ? null : value;
    }

    setFormData(prev => ({ ...prev, [name]: processedValue }));
  };

  const handleMakeChange = (make: string) => {
    setFormData(prev => ({ ...prev, make }));
  };

  const handleModelChange = (model: string) => {
    setFormData(prev => ({ ...prev, model }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user || !vehicleId) {
      setError('You must be logged in to edit a vehicle');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // Prepare update data - handle null values properly for DB
      const updateData: any = { ...formData };

      // Remove form-only fields that don't belong in vehicles table
      delete updateData.scanned_fields;
      delete updateData.documentId;

      // Update vehicle directly using Supabase (consistent with other components)
      const { error: updateError } = await supabase
        .from('vehicles')
        .update(updateData)
        .eq('id', vehicleId);

      if (updateError) {
        throw new Error(updateError.message || 'Failed to update vehicle');
      }

      // Create timeline event for the edit
      if (originalVehicle) {
        await TimelineEventService.createVehicleEditEvent(
          vehicleId,
          originalVehicle,
          formData,
          user.id,
          {
            reason: 'Vehicle information updated via edit form',
            source: 'manual_edit'
          }
        );
      }

      setSuccess(true);
      
      // Navigate back to vehicle profile after short delay with state to trigger refresh
      setTimeout(() => {
        navigate(`/vehicle/${vehicleId}`, { state: { fromEdit: true, timestamp: Date.now() } });
      }, 1500);
      
    } catch (err: any) {
      console.error('Error updating vehicle:', err);
      // Provide more helpful error messages
      if (err.message?.includes('network') || err.message?.includes('Network')) {
        setError('Unable to connect to the server. Please check your internet connection and try again.');
      } else if (err.message?.includes('permission') || err.message?.includes('denied')) {
        setError('You do not have permission to edit this vehicle.');
      } else {
      setError(err.message || 'An error occurred while updating the vehicle');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading vehicle...</p>
        </div>
      
    );
  }

  return (
    
      <div className="container">
        <div className="section">
          <header className="card-header mb-4">
            <h1 className="text font-bold">Edit Vehicle</h1>
            <p className="text-small text-muted">
              Update your vehicle's information. All changes are tracked in the vehicle timeline.
            </p>
          </header>

          <div className="card">
            <div className="card-header">
              <h2 className="text font-bold">Vehicle Information</h2>
            </div>

            <div className="card-body">
              {success && (
                <div className="alert alert-success mb-4">
                  <div className="text-small">✓ Vehicle updated successfully! Redirecting...</div>
                </div>
              )}

              {error && (
                <div className="alert alert-error mb-4">
                  <div className="text-small">{error}</div>
                </div>
              )}

              {/* Detail Level Selector */}
              <div className="mb-6">
                <div className="flex space-x-2">
                  <button
                    type="button"
                    onClick={() => setDetailLevel('basic')}
                    className={`button ${detailLevel === 'basic' ? 'button-primary' : 'button-secondary'} button-small`}
                  >
                    Basic
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailLevel('detailed')}
                    className={`button ${detailLevel === 'detailed' ? 'button-primary' : 'button-secondary'} button-small`}
                  >
                    Detailed
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailLevel('professional')}
                    className={`button ${detailLevel === 'professional' ? 'button-primary' : 'button-secondary'} button-small`}
                  >
                    Professional
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailLevel('expert')}
                    className={`button ${detailLevel === 'expert' ? 'button-primary' : 'button-secondary'} button-small`}
                  >
                    Expert
                  </button>
                </div>
              </div>

              {/* URL Import Section */}
              <div className="card" style={{ marginBottom: '24px' }}>
                <div className="card-header">
                  <h3 className="text font-bold">Import Data from URL</h3>
                </div>
                <div className="card-body">
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                    <input
                      type="url"
                      value={importUrl}
                      onChange={(e) => setImportUrl(e.target.value)}
                      placeholder="Paste listing URL (Bring a Trailer, Hagerty, etc.)"
                      className="form-input"
                      style={{ flex: 1 }}
                      disabled={isScraping}
                    />
                    <button
                      type="button"
                      onClick={handleImportUrl}
                      disabled={isScraping || !importUrl.trim()}
                      className="button button-primary"
                    >
                      {isScraping ? 'Importing...' : 'Import'}
                    </button>
                  </div>
                  {scrapingError && (
                    <div style={{ marginTop: '8px', color: '#dc2626', fontSize: '12px' }}>
                      {scrapingError}
                    </div>
                  )}
                </div>
              </div>

              <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-6">
                {/* Core Identity Section */}
                <div className="card">
                  <div className="card-header">
                    <h3 className="text font-bold">Core Identity</h3>
                  </div>
                  <div className="card-body">
                    <div className="space-y-6">
                      {/* Make & Model - Full Width */}
                      <div className="form-group">
                        <label className="form-label">Make & Model</label>
                        <VehicleMakeModelInput
                          make={formData.make}
                          model={formData.model}
                          onMakeChange={handleMakeChange}
                          onModelChange={handleModelChange}
                        />
                      </div>

                      {/* Year, Series, Trim - Grouped together */}
                      <div className="grid grid-cols-3 gap-4">
                        <div className="form-group">
                          <label htmlFor="year" className="form-label">Year</label>
                          <input
                            type="number"
                            id="year"
                            name="year"
                            value={formData.year || ''}
                            onChange={handleInputChange}
                            className="form-input"
                            min="1900"
                            max={new Date().getFullYear() + 1}
                          />
                        </div>

                        <SeriesSelector
                          make={formData.make}
                          model={formData.model}
                          series={formData.series || ''}
                          onSeriesChange={(series) => handleInputChange({ target: { name: 'series', value: series } } as any)}
                        />

                        <div className="form-group">
                          <TrimSelector
                            make={formData.make}
                            model={formData.model}
                            series={formData.series || ''}
                            trim={formData.trim || ''}
                            onTrimChange={(trim) => handleInputChange({ target: { name: 'trim', value: trim } } as any)}
                          />
                        </div>
                      </div>

                      {/* VIN & License Plate - Grouped together */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="form-group">
                          <label htmlFor="vin" className="form-label">VIN</label>
                          <input
                            type="text"
                            id="vin"
                            name="vin"
                            value={formData.vin || ''}
                            onChange={handleInputChange}
                            className="form-input"
                            placeholder="Vehicle Identification Number"
                            maxLength={17}
                          />
                        </div>

                        <div className="form-group">
                          <label htmlFor="license_plate" className="form-label">License Plate</label>
                          <input
                            type="text"
                            id="license_plate"
                            name="license_plate"
                            value={formData.license_plate || ''}
                            onChange={handleInputChange}
                            className="form-input"
                            placeholder="Current license plate"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Physical Specifications */}
                <div className="card">
                  <div className="card-header">
                    <h3 className="text font-bold">Physical Specifications</h3>
                  </div>
                  <div className="card-body">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="form-group">
                        <label htmlFor="color" className="form-label">Primary Exterior Color</label>
                        <input
                          type="text"
                          id="color"
                          name="color"
                          value={formData.color || ''}
                          onChange={handleInputChange}
                          className="form-input"
                          placeholder="e.g., Red, Blue, Silver"
                        />
                      </div>

                      <div className="form-group">
                        <label htmlFor="secondary_color" className="form-label">Secondary Color (if two-tone)</label>
                        <input
                          type="text"
                          id="secondary_color"
                          name="secondary_color"
                          value={formData.secondary_color || ''}
                          onChange={handleInputChange}
                          className="form-input"
                          placeholder="e.g., White, Black, Chrome"
                        />
                      </div>

                      <div className="form-group">
                        <label htmlFor="interior_color" className="form-label">Primary Interior Color</label>
                        <input
                          type="text"
                          id="interior_color"
                          name="interior_color"
                          value={formData.interior_color || ''}
                          onChange={handleInputChange}
                          className="form-input"
                          placeholder="e.g., Black, Tan, Gray"
                        />
                      </div>

                      <div className="form-group">
                        <label htmlFor="interior_color_secondary" className="form-label">Secondary Interior Color</label>
                        <input
                          type="text"
                          id="interior_color_secondary"
                          name="interior_color_secondary"
                          value={formData.interior_color_secondary || ''}
                          onChange={handleInputChange}
                          className="form-input"
                          placeholder="e.g., Door panels, dash"
                        />
                      </div>

                      <div className="form-group">
                        <label htmlFor="interior_color_tertiary" className="form-label">Tertiary Interior Color</label>
                        <input
                          type="text"
                          id="interior_color_tertiary"
                          name="interior_color_tertiary"
                          value={formData.interior_color_tertiary || ''}
                          onChange={handleInputChange}
                          className="form-input"
                          placeholder="e.g., Carpet, headliner"
                        />
                      </div>

                      <div className="form-group">
                        <label htmlFor="seat_type" className="form-label">Seat Type</label>
                        <select
                          id="seat_type"
                          name="seat_type"
                          value={formData.seat_type || ''}
                          onChange={handleInputChange}
                          className="form-select"
                        >
                          <option value="">Select...</option>
                          <option value="bench">Bench</option>
                          <option value="bucket">Bucket</option>
                          <option value="split_bench">Split Bench</option>
                          <option value="bench_bucket_combo">Bench/Bucket Combo</option>
                          <option value="captain_chairs">Captain Chairs</option>
                        </select>
                      </div>

                      <div className="form-group">
                        <label htmlFor="seat_material_primary" className="form-label">Primary Seat Material</label>
                        <select
                          id="seat_material_primary"
                          name="seat_material_primary"
                          value={formData.seat_material_primary || ''}
                          onChange={handleInputChange}
                          className="form-select"
                        >
                          <option value="">Select...</option>
                          <option value="Cloth">Cloth</option>
                          <option value="Vinyl">Vinyl</option>
                          <option value="Leather">Leather</option>
                          <option value="Velour">Velour</option>
                          <option value="Suede">Suede</option>
                          <option value="Alcantara">Alcantara</option>
                          <option value="Nylon">Nylon</option>
                          <option value="Polyester">Polyester</option>
                        </select>
                      </div>

                      <div className="form-group">
                        <label htmlFor="seat_material_secondary" className="form-label">Secondary Seat Material</label>
                        <select
                          id="seat_material_secondary"
                          name="seat_material_secondary"
                          value={formData.seat_material_secondary || ''}
                          onChange={handleInputChange}
                          className="form-select"
                        >
                          <option value="">Select...</option>
                          <option value="Cloth">Cloth</option>
                          <option value="Vinyl">Vinyl</option>
                          <option value="Leather">Leather</option>
                          <option value="Velour">Velour</option>
                          <option value="Suede">Suede</option>
                          <option value="Alcantara">Alcantara</option>
                          <option value="Nylon">Nylon</option>
                          <option value="Polyester">Polyester</option>
                        </select>
                      </div>
                      
                      <div className="form-group">
                        <label className="form-label">Trim & Styling</label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '9pt', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              name="has_molding"
                              checked={formData.has_molding || false}
                              onChange={(e) => setFormData({ ...formData, has_molding: e.target.checked })}
                              style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                            />
                            <span>Has Molding/Trim</span>
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '9pt', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              name="has_pinstriping"
                              checked={formData.has_pinstriping || false}
                              onChange={(e) => setFormData({ ...formData, has_pinstriping: e.target.checked })}
                              style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                            />
                            <span>Has Pinstriping</span>
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '9pt', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              name="has_racing_stripes"
                              checked={formData.has_racing_stripes || false}
                              onChange={(e) => setFormData({ ...formData, has_racing_stripes: e.target.checked })}
                              style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                            />
                            <span>Has Racing Stripes</span>
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '9pt', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              name="has_body_kit"
                              checked={formData.has_body_kit || false}
                              onChange={(e) => setFormData({ ...formData, has_body_kit: e.target.checked })}
                              style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                            />
                            <span>Has Body Kit</span>
                          </label>
                        </div>
                      </div>
                    </div>

                    {/* Trim Details - Full Width */}
                    {(formData.has_molding || formData.has_pinstriping || formData.has_racing_stripes || formData.has_body_kit) && (
                      <div className="form-group" style={{ marginTop: '16px' }}>
                        <label htmlFor="trim_details" className="form-label">Trim Details (optional)</label>
                        <textarea
                          id="trim_details"
                          name="trim_details"
                          value={formData.trim_details || ''}
                          onChange={handleInputChange}
                          className="form-input"
                          rows={3}
                          placeholder="Describe colors, materials, brands, or specific details about the trim/styling..."
                          style={{ resize: 'vertical' }}
                        />
                      </div>
                    )}

                    {/* Interior Material Details - Full Width */}
                    {(formData.seat_type || formData.seat_material_primary || formData.interior_color_secondary || formData.interior_color_tertiary) && (
                      <div className="form-group" style={{ marginTop: '16px' }}>
                        <label htmlFor="interior_material_details" className="form-label">Interior Material Details (optional)</label>
                        <textarea
                          id="interior_material_details"
                          name="interior_material_details"
                          value={formData.interior_material_details || ''}
                          onChange={handleInputChange}
                          className="form-input"
                          rows={3}
                          placeholder="Describe patterns, textures, brands, condition, or specific details about interior materials..."
                          style={{ resize: 'vertical' }}
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                      {(detailLevel === 'detailed' || detailLevel === 'professional' || detailLevel === 'expert') && (
                        <>
                          <div className="form-group">
                            <label htmlFor="body_style" className="form-label">Body Style</label>
                            <select
                              id="body_style"
                              name="body_style"
                              value={formData.body_style || ''}
                              onChange={handleInputChange}
                              className="form-select"
                            >
                              <option value="">Select...</option>
                              <option value="Sedan">Sedan</option>
                              <option value="Coupe">Coupe</option>
                              <option value="Convertible">Convertible</option>
                              <option value="Hatchback">Hatchback</option>
                              <option value="Wagon">Wagon</option>
                              <option value="SUV">SUV</option>
                              <option value="Truck">Truck</option>
                              <option value="Van">Van</option>
                            </select>
                          </div>

                          <div className="form-group">
                            <label htmlFor="doors" className="form-label">Doors</label>
                            <select
                              id="doors"
                              name="doors"
                              value={formData.doors || ''}
                              onChange={handleInputChange}
                              className="form-select"
                            >
                              <option value="">Select...</option>
                              <option value="2">2 Door</option>
                              <option value="3">3 Door</option>
                              <option value="4">4 Door</option>
                              <option value="5">5 Door</option>
                            </select>
                          </div>

                          <div className="form-group">
                            <label htmlFor="seats" className="form-label">Seats</label>
                            <input
                              type="number"
                              id="seats"
                              name="seats"
                              value={formData.seats || ''}
                              onChange={handleInputChange}
                              className="form-input"
                              placeholder="Number of seats"
                              min="1"
                              max="20"
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Engine & Performance */}
                <div className="card">
                  <div className="card-header">
                    <h3 className="text font-bold">Engine & Performance</h3>
                  </div>
                  <div className="card-body">
                    <div className="grid grid-cols-3 gap-4">
                      <div className="form-group">
                        <label htmlFor="engine_size" className="form-label">Engine Size</label>
                        <input
                          type="text"
                          id="engine_size"
                          name="engine_size"
                          value={formData.engine_size || ''}
                          onChange={handleInputChange}
                          className="form-input"
                          placeholder="e.g., 5.7L, 350, V8"
                        />
                      </div>


                      <div className="form-group">
                        <label htmlFor="transmission" className="form-label">Transmission</label>
                        <select
                          id="transmission"
                          name="transmission"
                          value={formData.transmission || ''}
                          onChange={handleInputChange}
                          className="form-select"
                        >
                          <option value="">Select...</option>
                          <option value="Manual">Manual</option>
                          <option value="Automatic">Automatic</option>
                          <option value="CVT">CVT</option>
                          <option value="Semi-Automatic">Semi-Automatic</option>
                        </select>
                      </div>

                      <div className="form-group">
                        <label htmlFor="transmission_model" className="form-label">Transmission Model</label>
                        <input
                          type="text"
                          id="transmission_model"
                          name="transmission_model"
                          value={formData.transmission_model || ''}
                          onChange={handleInputChange}
                          className="form-input"
                          placeholder="e.g., 6L90, 4L60E, TH350, Getrag 260"
                        />
                      </div>

                      <div className="form-group">
                        <label htmlFor="drivetrain" className="form-label">Drivetrain</label>
                        <select
                          id="drivetrain"
                          name="drivetrain"
                          value={formData.drivetrain || ''}
                          onChange={handleInputChange}
                          className="form-select"
                        >
                          <option value="">Select...</option>
                          <option value="FWD">Front-Wheel Drive</option>
                          <option value="RWD">Rear-Wheel Drive</option>
                          <option value="AWD">All-Wheel Drive</option>
                          <option value="4WD">Four-Wheel Drive</option>
                        </select>
                      </div>

                      {(detailLevel === 'professional' || detailLevel === 'expert') && (
                        <>
                          <div className="form-group">
                            <label htmlFor="horsepower" className="form-label">Horsepower</label>
                            <input
                              type="number"
                              id="horsepower"
                              name="horsepower"
                              value={formData.horsepower || ''}
                              onChange={handleInputChange}
                              className="form-input"
                              placeholder="HP at crank"
                              min="0"
                            />
                          </div>

                          <div className="form-group">
                            <label htmlFor="torque" className="form-label">Torque</label>
                            <input
                              type="number"
                              id="torque"
                              name="torque"
                              value={formData.torque || ''}
                              onChange={handleInputChange}
                              className="form-input"
                              placeholder="lb-ft"
                              min="0"
                            />
                          </div>

                          <div className="form-group">
                            <label htmlFor="fuel_type" className="form-label">Fuel Type</label>
                            <select
                              id="fuel_type"
                              name="fuel_type"
                              value={formData.fuel_type || ''}
                              onChange={handleInputChange}
                              className="form-select"
                            >
                              <option value="">Select...</option>
                              <option value="Regular">Regular Gasoline</option>
                              <option value="Premium">Premium Gasoline</option>
                              <option value="Diesel">Diesel</option>
                              <option value="Electric">Electric</option>
                              <option value="Hybrid">Hybrid</option>
                              <option value="E85">E85 Ethanol</option>
                              <option value="CNG">Compressed Natural Gas</option>
                            </select>
                          </div>

                          <div className="form-group">
                            <label htmlFor="displacement" className="form-label">Displacement</label>
                            <input
                              type="text"
                              id="displacement"
                              name="displacement"
                              value={formData.displacement || ''}
                              onChange={handleInputChange}
                              className="form-input"
                              placeholder="e.g., 350 cu in, 5.7L"
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Pricing & Sale Information */}
                <div className="card">
                  <div className="card-header">
                    <h3 className="text font-bold">Pricing & Sale Information</h3>
                  </div>
                  <div className="card-body">
                    {/* For Sale Toggle */}
                    <div className="form-group" style={{ marginBottom: 16 }}>
                      <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          id="is_for_sale"
                          name="is_for_sale"
                          checked={formData.is_for_sale || false}
                          onChange={(e) => setFormData({ ...formData, is_for_sale: e.target.checked })}
                          style={{ width: 20, height: 20 }}
                        />
                        <span>Vehicle is currently for sale</span>
                      </label>
                    </div>

                    <div className="grid grid-cols-2 gap-4">

                      <div className="form-group">
                        <label htmlFor="asking_price" className="form-label">Sale Price</label>
                        <input
                          type="number"
                          id="asking_price"
                          name="asking_price"
                          value={formData.asking_price || ''}
                          onChange={handleInputChange}
                          className="form-input"
                          placeholder="$ Asking price"
                          min="0"
                          step="100"
                        />
                      </div>

                      <div className="form-group">
                        <label htmlFor="purchase_price" className="form-label">Purchase Price (Cash Paid)</label>
                        <input
                          type="number"
                          id="purchase_price"
                          name="purchase_price"
                          value={formData.purchase_price || ''}
                          onChange={handleInputChange}
                          className="form-input"
                          placeholder="$ Cash paid (excluding trade-ins)"
                          min="0"
                          step="100"
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label">Acquisition Method</label>
                        <div style={{ marginTop: '8px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '9pt', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={formData.received_in_trade || false}
                              onChange={(e) => setFormData({ ...formData, received_in_trade: e.target.checked })}
                              style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                            />
                            <span>Vehicle received in trade (including partial trades)</span>
                          </label>
                        </div>
                        {formData.received_in_trade && (
                          <div style={{ 
                            marginTop: '12px', 
                            padding: '12px', 
                            background: '#f9fafb', 
                            border: '2px solid #e5e7eb',
                            borderRadius: '4px'
                          }}>
                            <div style={{ fontSize: '8pt', color: '#6b7280', marginBottom: '8px' }}>
                              Trade details will be managed in the vehicle profile after saving.
                              You'll be able to link the vehicle(s) you traded and specify values.
                            </div>
                            <a 
                              href="#trade-details" 
                              style={{ fontSize: '8pt', color: '#2563eb', textDecoration: 'underline' }}
                              onClick={(e) => {
                                e.preventDefault();
                                alert('Save this vehicle first, then use the "Manage Trade Details" button in the Financial Information section of the vehicle profile.');
                              }}
                            >
                              Learn more about recording trades
                            </a>
                          </div>
                        )}
                      </div>

                      <div className="form-group">
                        <label htmlFor="purchase_date" className="form-label">Acquisition Date</label>
                        <input
                          type="date"
                          id="purchase_date"
                          name="purchase_date"
                          value={formData.purchase_date || ''}
                          onChange={handleInputChange}
                          className="form-input"
                        />
                      </div>

                      <div className="form-group">
                        <label htmlFor="purchase_location" className="form-label">Purchase Location</label>
                        <input
                          type="text"
                          id="purchase_location"
                          name="purchase_location"
                          value={formData.purchase_location || ''}
                          onChange={handleInputChange}
                          className="form-input"
                          placeholder="e.g., Dealer name, City, State"
                        />
                      </div>

                      <div className="form-group">
                        <label htmlFor="msrp" className="form-label">Original MSRP</label>
                        <input
                          type="number"
                          id="msrp"
                          name="msrp"
                          value={formData.msrp || ''}
                          onChange={handleInputChange}
                          className="form-input"
                          placeholder="$ When new"
                          min="0"
                          step="100"
                        />
                      </div>

                      <div className="form-group">
                        <label htmlFor="sale_price" className="form-label">Sale Price (if sold)</label>
                        <input
                          type="number"
                          id="sale_price"
                          name="sale_price"
                          value={formData.sale_price || ''}
                          onChange={handleInputChange}
                          className="form-input"
                          placeholder="$ Final sale price"
                          min="0"
                          step="100"
                        />
                      </div>
                    </div>

                    {/* Auction Information Section */}
                    {(detailLevel === 'professional' || detailLevel === 'expert') && (
                      <>
                        <hr style={{ margin: '20px 0', borderColor: '#e5e7eb' }} />
                        <h4 style={{ marginBottom: 12, fontWeight: 600 }}>Auction Information (if applicable)</h4>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="form-group">
                            <label htmlFor="auction_source" className="form-label">Auction Platform</label>
                            <input
                              type="text"
                              id="auction_source"
                              name="auction_source"
                              value={formData.auction_source || ''}
                              onChange={handleInputChange}
                              className="form-input"
                              placeholder="e.g., Bring a Trailer, Cars & Bids"
                            />
                          </div>


                          <div className="form-group">
                            <label htmlFor="bid_count" className="form-label">Number of Bids</label>
                            <input
                              type="number"
                              id="bid_count"
                              name="bid_count"
                              value={formData.bid_count || ''}
                              onChange={handleInputChange}
                              className="form-input"
                              placeholder="Total bid count"
                              min="0"
                            />
                          </div>

                          <div className="form-group">
                            <label htmlFor="auction_end_date" className="form-label">Auction End Date</label>
                            <input
                              type="datetime-local"
                              id="auction_end_date"
                              name="auction_end_date"
                              value={formData.auction_end_date || ''}
                              onChange={handleInputChange}
                              className="form-input"
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Ownership & History */}
                <div className="card">
                  <div className="card-header">
                    <h3 className="text font-bold">Ownership & History</h3>
                  </div>
                  <div className="card-body">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="form-group">
                        <label htmlFor="mileage" className="form-label">Current Mileage</label>
                        <input
                          type="number"
                          id="mileage"
                          name="mileage"
                          value={formData.mileage || ''}
                          onChange={handleInputChange}
                          className="form-input"
                          placeholder="Current odometer reading"
                          min="0"
                        />
                      </div>

                      {(detailLevel === 'detailed' || detailLevel === 'professional' || detailLevel === 'expert') && (
                        <>
                          <div className="form-group">
                            <label htmlFor="condition_rating" className="form-label">Condition (1-10)</label>
                            <select
                              id="condition_rating"
                              name="condition_rating"
                              value={formData.condition_rating || ''}
                              onChange={handleInputChange}
                              className="form-select"
                            >
                              <option value="">Select...</option>
                              <option value="1">1 - Poor</option>
                              <option value="2">2 - Fair</option>
                              <option value="3">3 - Below Average</option>
                              <option value="4">4 - Average</option>
                              <option value="5">5 - Above Average</option>
                              <option value="6">6 - Good</option>
                              <option value="7">7 - Very Good</option>
                              <option value="8">8 - Excellent</option>
                              <option value="9">9 - Near Perfect</option>
                              <option value="10">10 - Concours</option>
                            </select>
                          </div>

                          <div className="form-group">
                            <label htmlFor="previous_owners" className="form-label">Previous Owners</label>
                            <input
                              type="number"
                              id="previous_owners"
                              name="previous_owners"
                              value={formData.previous_owners || ''}
                              onChange={handleInputChange}
                              className="form-input"
                              placeholder="Number of previous owners"
                              min="0"
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Description */}
                <div className="card">
                  <div className="card-header">
                    <h3 className="text font-bold">Description & Notes</h3>
                  </div>
                  <div className="card-body">

                    <div className="form-group">
                      <label htmlFor="notes" className="form-label">Private Notes</label>
                      <textarea
                        id="notes"
                        name="notes"
                        value={formData.notes || ''}
                        onChange={handleInputChange}
                        className="form-input"
                        rows={3}
                        placeholder="Private notes only visible to you..."
                      />
                    </div>
                  </div>
                </div>

                {/* Submit Buttons */}
                <div className="card-footer">
                  <div className="flex justify-between">
                    <button
                      type="button"
                      onClick={() => navigate(`/vehicles/${vehicleId}`)}
                      className="button button-secondary"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="button button-primary"
                    >
                      {submitting ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    
  );
};

export default EditVehicle;
