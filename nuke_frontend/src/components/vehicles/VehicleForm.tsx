import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import type { vehicleAPI } from '../../services/api';
import type { Vehicle } from '../../types';
import VehicleMakeModelInput from '../forms/VehicleMakeModelInput';

const VehicleForm = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState<boolean>(id ? true : false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  
  // Form state
  const [formData, setFormData] = useState<{
    make: string;
    model: string;
    year: string;
    vin: string;
    license_plate: string;
    color: string;
    mileage: string;
    engine_type: string;
    transmission: string;
    drivetrain: string;
    status: 'active' | 'pending' | 'archived' | 'inactive';
    relationship_type: 'owned' | 'discovered' | 'curated' | 'consigned' | 'previously_owned' | 'interested';
  }>({
    make: '',
    model: '',
    year: new Date().getFullYear().toString(),
    vin: '',
    license_plate: '',
    color: '',
    mileage: '',
    engine_type: '',
    transmission: '',
    drivetrain: '',
    status: 'active',
    relationship_type: 'owned',
  });

  // Fetch vehicle data if editing an existing vehicle
  useEffect(() => {
    const fetchVehicle = async () => {
      if (!id) return;
      
      try {
        setLoading(true);
        const response = await vehicleAPI.getVehicle(id);
        const vehicle = response.data;
        
        // Populate form with vehicle data
        setFormData({
          make: vehicle.make || '',
          model: vehicle.model || '',
          year: vehicle.year?.toString() || '',
          vin: vehicle.vin || '',
          license_plate: vehicle.license_plate || '',
          color: vehicle.color || '',
          mileage: vehicle.mileage?.toString() || '',
          engine_type: vehicle.engine_type || '',
          transmission: vehicle.transmission || '',
          drivetrain: vehicle.drivetrain || '',
          status: vehicle.status || 'active',
          relationship_type: 'owned', // Default for existing vehicles
        });
      } catch (err) {
        console.error('Error fetching vehicle details:', err);
        setError('Failed to load vehicle details. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchVehicle();
    }
  }, [id]);

  // Handle form input changes
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      setSubmitting(true);
      setError(null);
      
      const { relationship_type, ...vehicleData } = {
        ...formData,
        year: parseInt(formData.year) || null,
        mileage: parseInt(formData.mileage) || null,
      };
      
      if (id) {
        // Update existing vehicle
        await vehicleAPI.updateVehicle(id, vehicleData);
        // TODO: Update relationship if changed
      } else {
        // Create new vehicle
        const response = await vehicleAPI.createVehicle(vehicleData);
        
        // Set the relationship for the new vehicle
        if (response.data?.id && relationship_type !== 'owned') {
          // Import supabase here to avoid circular dependency
          const { supabase } = await import('../../lib/supabase');
          const { error: relationshipError } = await supabase.rpc('update_vehicle_relationship', {
            p_vehicle_id: response.data.id,
            p_user_id: (await supabase.auth.getUser()).data.user?.id,
            p_relationship_type: relationship_type
          });
          
          if (relationshipError) {
            console.error('Error setting vehicle relationship:', relationshipError);
          }
        }
      }
      
      // Redirect to vehicles list on success
      navigate('/vehicles');
    } catch (err) {
      console.error('Error saving vehicle:', err);
      setError('Failed to save vehicle. Please check your inputs and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6 flex justify-center items-center min-h-[50vh]">
        <div className="flex flex-col items-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500 mb-4"></div>
          <p className="text-gray-600 font-medium">Loading vehicle data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <Link 
          to="/vehicles" 
          className="text-sm text-gray-600 hover:text-gray-900 flex items-center transition-colors duration-200"
        >
          <svg className="w-4 h-4 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Vehicles
        </Link>
        
        <h1 className="text-2xl font-bold text-gray-900">
          {id ? 'Edit Vehicle' : 'Add New Vehicle'}
        </h1>
      </div>
      
      {/* Error message */}
      {error && (
        <div className="bg-red-50 border-l-4 border-red-500 text-red-700 p-4 mb-6 rounded shadow-sm">
          <div className="flex items-center">
            <svg className="h-5 w-5 text-red-500 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <p>{error}</p>
          </div>
        </div>
      )}
      
      {/* Form */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <form onSubmit={handleSubmit} className="p-6">
          <div className="space-y-6">
            {/* Basic Information Section */}
            <div>
              <h2 className="text-lg font-medium text-gray-900 mb-4">Basic Information</h2>
              <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-6">
                {/* Make/Model with Autocomplete */}
                <div className="sm:col-span-6">
                  <VehicleMakeModelInput
                    make={formData.make}
                    model={formData.model}
                    onMakeChange={(make) => setFormData(prev => ({ ...prev, make }))}
                    onModelChange={(model) => setFormData(prev => ({ ...prev, model }))}
                    required={true}
                    className="grid grid-cols-2 gap-4"
                  />
                </div>
                
                {/* Year */}
                <div className="sm:col-span-2">
                  <label htmlFor="year" className="block text-sm font-medium text-gray-700">
                    Year *
                  </label>
                  <div className="mt-1">
                    <input
                      type="number"
                      name="year"
                      id="year"
                      required
                      min="1900"
                      max={new Date().getFullYear() + 1}
                      value={formData.year}
                      onChange={handleChange}
                      className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md"
                    />
                  </div>
                </div>
                
                {/* VIN */}
                <div className="sm:col-span-4">
                  <label htmlFor="vin" className="block text-sm font-medium text-gray-700">
                    VIN
                  </label>
                  <div className="mt-1">
                    <input
                      type="text"
                      name="vin"
                      id="vin"
                      value={formData.vin}
                      onChange={handleChange}
                      className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md"
                      placeholder="Vehicle Identification Number"
                    />
                  </div>
                </div>
                
                {/* License Plate */}
                <div className="sm:col-span-3">
                  <label htmlFor="license_plate" className="block text-sm font-medium text-gray-700">
                    License Plate
                  </label>
                  <div className="mt-1">
                    <input
                      type="text"
                      name="license_plate"
                      id="license_plate"
                      value={formData.license_plate}
                      onChange={handleChange}
                      className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md"
                    />
                  </div>
                </div>
                
                {/* Color */}
                <div className="sm:col-span-3">
                  <label htmlFor="color" className="block text-sm font-medium text-gray-700">
                    Color
                  </label>
                  <div className="mt-1">
                    <input
                      type="text"
                      name="color"
                      id="color"
                      value={formData.color}
                      onChange={handleChange}
                      className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md"
                      placeholder="e.g., Silver, Black, White"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Relationship Section */}
            <div>
              <h2 className="text-lg font-medium text-gray-900 mb-4">Your Relationship to This Vehicle</h2>
              <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-6">
                <div className="sm:col-span-6">
                  <label htmlFor="relationship_type" className="block text-sm font-medium text-gray-700">
                    Relationship Type *
                  </label>
                  <div className="mt-1">
                    <select
                      name="relationship_type"
                      id="relationship_type"
                      required
                      value={formData.relationship_type}
                      onChange={handleChange}
                      className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md"
                    >
                      <option value="owned">I Own This Vehicle</option>
                      <option value="discovered">I Discovered This Vehicle</option>
                      <option value="curated">I Curate/Research This Vehicle</option>
                      <option value="consigned">I'm Consigning This Vehicle</option>
                      <option value="previously_owned">I Previously Owned This Vehicle</option>
                      <option value="interested">I'm Interested in This Vehicle</option>
                    </select>
                  </div>
                  <p className="mt-2 text-sm text-gray-500">
                    This helps categorize the vehicle correctly in your collection.
                  </p>
                </div>
              </div>
            </div>
            
            {/* Technical Details Section */}
            <div>
              <h2 className="text-lg font-medium text-gray-900 mb-4">Technical Details</h2>
              <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-6">
                {/* Mileage */}
                <div className="sm:col-span-2">
                  <label htmlFor="mileage" className="block text-sm font-medium text-gray-700">
                    Mileage
                  </label>
                  <div className="mt-1">
                    <input
                      type="number"
                      name="mileage"
                      id="mileage"
                      min="0"
                      value={formData.mileage}
                      onChange={handleChange}
                      className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md"
                    />
                  </div>
                </div>
                
                {/* Engine Type */}
                <div className="sm:col-span-4">
                  <label htmlFor="engine_type" className="block text-sm font-medium text-gray-700">
                    Engine Type
                  </label>
                  <div className="mt-1">
                    <input
                      type="text"
                      name="engine_type"
                      id="engine_type"
                      value={formData.engine_type}
                      onChange={handleChange}
                      className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md"
                      placeholder="e.g., 2.0L 4-Cylinder, V6, Electric"
                    />
                  </div>
                </div>
                
                {/* Transmission */}
                <div className="sm:col-span-3">
                  <label htmlFor="transmission" className="block text-sm font-medium text-gray-700">
                    Transmission
                  </label>
                  <div className="mt-1">
                    <select
                      id="transmission"
                      name="transmission"
                      value={formData.transmission}
                      onChange={handleChange}
                      className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md"
                    >
                      <option value="">Select transmission</option>
                      <option value="Automatic">Automatic</option>
                      <option value="Manual">Manual</option>
                      <option value="CVT">CVT</option>
                      <option value="Semi-Automatic">Semi-Automatic</option>
                      <option value="Dual Clutch">Dual Clutch</option>
                    </select>
                  </div>
                </div>
                
                {/* Drivetrain */}
                <div className="sm:col-span-3">
                  <label htmlFor="drivetrain" className="block text-sm font-medium text-gray-700">
                    Drivetrain
                  </label>
                  <div className="mt-1">
                    <select
                      id="drivetrain"
                      name="drivetrain"
                      value={formData.drivetrain}
                      onChange={handleChange}
                      className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md"
                    >
                      <option value="">Select drivetrain</option>
                      <option value="FWD">FWD (Front Wheel Drive)</option>
                      <option value="RWD">RWD (Rear Wheel Drive)</option>
                      <option value="AWD">AWD (All Wheel Drive)</option>
                      <option value="4WD">4WD (Four Wheel Drive)</option>
                    </select>
                  </div>
                </div>
                
                {/* Status */}
                <div className="sm:col-span-3">
                  <label htmlFor="status" className="block text-sm font-medium text-gray-700">
                    Status
                  </label>
                  <div className="mt-1">
                    <select
                      id="status"
                      name="status"
                      value={formData.status}
                      onChange={handleChange}
                      className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md"
                    >
                      <option value="active">Active</option>
                      <option value="pending">Pending</option>
                      <option value="archived">Archived</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Form Actions */}
            <div className="flex justify-end space-x-3 pt-5">
              <Link
                to="/vehicles"
                className="px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={submitting}
                className={`px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 ${
                  submitting ? 'opacity-75 cursor-not-allowed' : ''
                }`}
              >
                {submitting ? (
                  <span className="flex items-center">
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Saving...
                  </span>
                ) : (
                  'Save Vehicle'
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default VehicleForm;
