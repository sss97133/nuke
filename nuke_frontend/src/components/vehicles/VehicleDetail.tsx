import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import type { vehicleAPI } from '../../services/api';
import { DocumentUploadButton } from '../vehicle/DocumentUploadButton';
import TimelineList from '../timeline/TimelineList';
import ImageGallery from '../images/ImageGallery';
import PricingIntelligence from '../PricingIntelligence';
import type { VehiclePricingWidget } from '../VehiclePricingWidget';
import type { Vehicle } from '../../types';

const VehicleDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'details' | 'timeline' | 'photos' | 'documents' | 'pricing'>('details');

  const fetchVehicle = async () => {
    if (!id) return;

    try {
      setLoading(true);
      // Load vehicle WITH images to ensure primary image works
      const response = await vehicleAPI.getVehicle(id, { include: 'images' });
      setVehicle(response.data);
    } catch (err) {
      console.error('Error fetching vehicle details:', err);
      setError('Failed to load vehicle details. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVehicle();
  }, [id]);

  const handleImagesUpdated = async () => {
    // Refresh vehicle data to ensure primary image is updated
    if (id) {
      try {
        const response = await vehicleAPI.getVehicle(id, { include: 'images' });
        setVehicle(response.data);
      } catch (err) {
        console.error('Error refreshing vehicle after image update:', err);
      }
    }
  };

  const archiveVehicle = async () => {
    if (!vehicle) return;
    
    if (window.confirm("Are you sure you want to archive this vehicle? This action follows vehicle-centric principles and will not delete the vehicle's digital identity.")) {
      try {
        await vehicleAPI.archiveVehicle(vehicle.id);
        navigate('/vehicles');
      } catch (err) {
        console.error('Error archiving vehicle:', err);
        alert('Failed to archive vehicle. Please try again.');
      }
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6 flex justify-center items-center min-h-[50vh]">
        <div className="flex flex-col items-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500 mb-4"></div>
          <p className="text-gray-600 font-medium">Loading vehicle details...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <div className="bg-red-50 border-l-4 border-red-500 text-red-700 p-4 mb-6 rounded shadow-sm">
          <div className="flex items-center">
            <svg className="h-5 w-5 text-red-500 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <p>{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div className="container mx-auto p-6 text-center">
        <div className="bg-yellow-50 border-l-4 border-yellow-500 text-yellow-700 p-4 mb-6 rounded shadow-sm">
          <p>Vehicle not found. The requested vehicle may have been removed or you may not have permission to view it.</p>
        </div>
        <button 
          onClick={() => navigate('/vehicles')} 
          className="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          Return to Vehicles
        </button>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      {/* Header with back button and actions */}
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
        
        <div className="flex space-x-2">
          <button
            onClick={() => setActiveTab('pricing')}
            className="inline-flex items-center px-3 py-2 border border-green-300 shadow-sm text-sm font-medium rounded-md text-green-700 bg-green-50 hover:bg-green-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-colors duration-200"
          >
            <svg className="-ml-0.5 mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
            </svg>
            💰 Get Appraisal
          </button>

          <Link
            to={`/vehicles/${vehicle.id}/edit`}
            className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors duration-200"
          >
            <svg className="-ml-0.5 mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
            Edit Vehicle
          </Link>

          <button
            onClick={archiveVehicle}
            className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors duration-200"
          >
            <svg className="-ml-0.5 mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
            Archive
          </button>
        </div>
      </div>
      
      {/* AI Pricing Intelligence Widget - Prominent placement */}
      <VehiclePricingWidget
        vehicleId={vehicle.id}
        vehicleInfo={{
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          mileage: vehicle.mileage
        }}
        isOwner={true}
        className="mb-6"
      />

      {/* Main content card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-8">
        <div className="flex flex-col lg:flex-row">
          {/* Left column - vehicle image and quick stats */}
          <div className="lg:w-5/12 xl:w-4/12 p-6 border-b lg:border-b-0 lg:border-r border-gray-100">
            {vehicle.images && vehicle.images.length > 0 ? (
              <div className="relative aspect-[4/3] rounded-lg overflow-hidden shadow-md bg-gray-100">
                <img
                  src={(vehicle.images.find(img => img.is_primary) || vehicle.images[0])?.url}
                  alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                  className="absolute inset-0 w-full h-full object-cover"
                />
                {vehicle.images.find(img => img.is_primary) && (
                  <div className="absolute top-2 left-2 bg-blue-500 text-white px-2 py-1 text-xs rounded">
                    PRIMARY
                  </div>
                )}
              </div>
            ) : (
              <div className="aspect-[4/3] bg-gray-100 flex items-center justify-center rounded-lg shadow-sm">
                <div className="text-center p-4">
                  <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="mt-2 text-sm text-gray-500">No Image</p>
                  <p className="mt-1 text-xs text-gray-400">Upload photos in the Photos tab</p>
                </div>
              </div>
            )}
            
            {/* Quick stats grid */}
            <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3">
              {vehicle.vin && (
                <div className="col-span-2">
                  <h3 className="text-xs font-medium uppercase text-gray-500">VIN</h3>
                  <p className="mt-1 text-sm font-medium text-gray-900">{vehicle.vin}</p>
                </div>
              )}
              
              {vehicle.license_plate && (
                <div>
                  <h3 className="text-xs font-medium uppercase text-gray-500">License Plate</h3>
                  <p className="mt-1 text-sm font-medium text-gray-900">{vehicle.license_plate}</p>
                </div>
              )}
              
              {vehicle.color && (
                <div>
                  <h3 className="text-xs font-medium uppercase text-gray-500">Color</h3>
                  <p className="mt-1 text-sm font-medium text-gray-900">{vehicle.color}</p>
                </div>
              )}
              
              {vehicle.mileage !== undefined && (
                <div>
                  <h3 className="text-xs font-medium uppercase text-gray-500">Mileage</h3>
                  <p className="mt-1 text-sm font-medium text-gray-900">{vehicle.mileage.toLocaleString()} miles</p>
                </div>
              )}
              
              {vehicle.engine_type && (
                <div>
                  <h3 className="text-xs font-medium uppercase text-gray-500">Engine</h3>
                  <p className="mt-1 text-sm font-medium text-gray-900">{vehicle.engine_type}</p>
                </div>
              )}
              
              {vehicle.transmission && (
                <div>
                  <h3 className="text-xs font-medium uppercase text-gray-500">Transmission</h3>
                  <p className="mt-1 text-sm font-medium text-gray-900">{vehicle.transmission}</p>
                </div>
              )}
              
              {vehicle.drivetrain && (
                <div>
                  <h3 className="text-xs font-medium uppercase text-gray-500">Drivetrain</h3>
                  <p className="mt-1 text-sm font-medium text-gray-900">{vehicle.drivetrain}</p>
                </div>
              )}
            </div>
          </div>
          
          {/* Right column - main vehicle details and tabs */}
          <div className="lg:w-7/12 xl:w-8/12 p-6">
            <div className="flex flex-col h-full">
              {/* Vehicle title and status */}
              <div className="flex flex-wrap items-start justify-between mb-4">
                <div>
                  <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
                    {vehicle.year} {vehicle.make} {vehicle.model}
                  </h1>
                  <p className="text-sm text-gray-500 mt-1">Added on {new Date(vehicle.inserted_at).toLocaleDateString()}</p>
                </div>
                
                <div className="flex gap-2 mt-2 sm:mt-0">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    vehicle.status === 'active' ? 'bg-green-100 text-green-800' : 
                    vehicle.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 
                    vehicle.status === 'archived' ? 'bg-gray-100 text-gray-800' : 
                    'bg-red-100 text-red-800'
                  }`}>
                    {vehicle.status.toUpperCase()}
                  </span>
                  
                  {vehicle.verified && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      <svg className="-ml-0.5 mr-1.5 h-2 w-2 text-blue-400" fill="currentColor" viewBox="0 0 8 8">
                        <circle cx="4" cy="4" r="3" />
                      </svg>
                      VERIFIED
                    </span>
                  )}
                </div>
              </div>
              
              {/* Tab navigation */}
              <div className="mt-6 flex-grow">
                <div className="border-b border-gray-200">
                  <nav className="-mb-px flex space-x-8">
                    <button
                      onClick={() => setActiveTab('details')}
                      className={`${activeTab === 'details' 
                        ? 'border-indigo-500 text-indigo-600' 
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'} 
                        whitespace-nowrap pb-4 px-1 border-b-2 font-medium text-sm transition-colors duration-200`}
                    >
                      Details
                    </button>
                    
                    <button
                      onClick={() => setActiveTab('timeline')}
                      className={`${activeTab === 'timeline' 
                        ? 'border-indigo-500 text-indigo-600' 
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'} 
                        whitespace-nowrap pb-4 px-1 border-b-2 font-medium text-sm transition-colors duration-200`}
                    >
                      Timeline History
                    </button>
                    
                    <button
                      onClick={() => setActiveTab('photos')}
                      className={`${activeTab === 'photos'
                        ? 'border-indigo-500 text-indigo-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}
                        whitespace-nowrap pb-4 px-1 border-b-2 font-medium text-sm transition-colors duration-200`}
                    >
                      Photos
                    </button>

                    <button
                      onClick={() => setActiveTab('documents')}
                      className={`${activeTab === 'documents'
                        ? 'border-indigo-500 text-indigo-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}
                        whitespace-nowrap pb-4 px-1 border-b-2 font-medium text-sm transition-colors duration-200`}
                    >
                      Documents
                    </button>

                    <button
                      onClick={() => setActiveTab('pricing')}
                      className={`${activeTab === 'pricing'
                        ? 'border-indigo-500 text-indigo-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}
                        whitespace-nowrap pb-4 px-1 border-b-2 font-medium text-sm transition-colors duration-200`}
                    >
                      💰 Pricing Intelligence
                    </button>
                  </nav>
                </div>
                
                {/* Tab content */}
                <div className="py-6">
                  {activeTab === 'details' && (
                    <div className="space-y-8">
                      {/* Basic Information section */}
                      <div>
                        <h3 className="text-lg font-medium text-gray-900 mb-4">Basic Information</h3>
                        <div className="bg-gray-50 rounded-lg overflow-hidden border border-gray-200">
                          <dl className="divide-y divide-gray-200">
                            <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                              <dt className="text-sm font-medium text-gray-500">Make</dt>
                              <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{vehicle.make}</dd>
                            </div>
                            <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                              <dt className="text-sm font-medium text-gray-500">Model</dt>
                              <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{vehicle.model}</dd>
                            </div>
                            <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                              <dt className="text-sm font-medium text-gray-500">Year</dt>
                              <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{vehicle.year}</dd>
                            </div>
                            <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                              <dt className="text-sm font-medium text-gray-500">VIN</dt>
                              <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{vehicle.vin || 'Not specified'}</dd>
                            </div>
                            <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                              <dt className="text-sm font-medium text-gray-500">License Plate</dt>
                              <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{vehicle.license_plate || 'Not specified'}</dd>
                            </div>
                            <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                              <dt className="text-sm font-medium text-gray-500">Status</dt>
                              <dd className="mt-1 text-sm sm:mt-0 sm:col-span-2">
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                  vehicle.status === 'active' ? 'bg-green-100 text-green-800' : 
                                  vehicle.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 
                                  vehicle.status === 'archived' ? 'bg-gray-100 text-gray-800' : 
                                  'bg-red-100 text-red-800'
                                }`}>
                                  {vehicle.status.toUpperCase()}
                                </span>
                              </dd>
                            </div>
                          </dl>
                        </div>
                      </div>
                      
                      {/* Technical Details section */}
                      <div>
                        <h3 className="text-lg font-medium text-gray-900 mb-4">Technical Details</h3>
                        <div className="bg-gray-50 rounded-lg overflow-hidden border border-gray-200">
                          <dl className="divide-y divide-gray-200">
                            <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                              <dt className="text-sm font-medium text-gray-500">Color</dt>
                              <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{vehicle.color || 'Not specified'}</dd>
                            </div>
                            <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                              <dt className="text-sm font-medium text-gray-500">Mileage</dt>
                              <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                                {vehicle.mileage ? `${vehicle.mileage.toLocaleString()} miles` : 'Not specified'}
                              </dd>
                            </div>
                            <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                              <dt className="text-sm font-medium text-gray-500">Engine Type</dt>
                              <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{vehicle.engine_type || 'Not specified'}</dd>
                            </div>
                            <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                              <dt className="text-sm font-medium text-gray-500">Transmission</dt>
                              <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{vehicle.transmission || 'Not specified'}</dd>
                            </div>
                            <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                              <dt className="text-sm font-medium text-gray-500">Drivetrain</dt>
                              <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{vehicle.drivetrain || 'Not specified'}</dd>
                            </div>
                            <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                              <dt className="text-sm font-medium text-gray-500">Date Added</dt>
                              <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                                {new Date(vehicle.inserted_at).toLocaleString()}
                              </dd>
                            </div>
                          </dl>
                        </div>
                      </div>
                      
                      {/* Metadata if present */}
                      {vehicle.metadata && Object.keys(vehicle.metadata).length > 0 && (
                        <div>
                          <h3 className="text-lg font-medium text-gray-900 mb-4">Additional Information</h3>
                          <div className="bg-gray-50 rounded-lg overflow-hidden border border-gray-200 p-4">
                            <pre className="text-sm text-gray-900 whitespace-pre-wrap">
                              {JSON.stringify(vehicle.metadata, null, 2)}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Timeline tab content */}
                  {activeTab === 'timeline' && (
                    <div>
                      <div className="mb-6">
                        <h3 className="text-lg font-medium text-gray-900 mb-2">Timeline History</h3>
                        <p className="text-sm text-gray-500">Timeline events are automatically created when you upload images</p>
                      </div>
                      <TimelineList vehicleId={vehicle.id} />
                    </div>
                  )}
                  
                  {/* Photos tab content */}
                  {activeTab === 'photos' && (
                    <div>
                      <div className="mb-6">
                        <h3 className="text-lg font-medium text-gray-900 mb-2">Vehicle Photos</h3>
                        <p className="text-sm text-gray-500">Upload photos to automatically create timeline events</p>
                      </div>
                      <ImageGallery vehicleId={vehicle.id} onImagesUpdated={handleImagesUpdated} />
                    </div>
                  )}

                  {/* Documents tab content */}
                  {activeTab === 'documents' && (
                    <div>
                      <div className="mb-6">
                        <h3 className="text-lg font-medium text-gray-900 mb-2">Vehicle Documents</h3>
                        <p className="text-sm text-gray-500">Upload receipts, titles, registration, and other official paperwork</p>
                      </div>
                      <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
                        <div className="flex">
                          <div className="ml-3">
                            <p className="text-sm text-yellow-700">
                              <strong>For structured documentation:</strong> Use this for receipts, invoices, titles, registration, insurance documents, and other official paperwork that requires detailed metadata tracking.
                            </p>
                          </div>
                        </div>
                      </div>
                      <DocumentUploadButton
                        vehicleId={vehicle.id}
                        variant="primary"
                        label="🧾 Upload Document"
                      />
                    </div>
                  )}

                  {/* Pricing Intelligence tab content */}
                  {activeTab === 'pricing' && (
                    <div>
                      <div className="mb-6">
                        <h3 className="text-lg font-medium text-gray-900 mb-2">The Ultimate Appraisal Tool</h3>
                        <p className="text-sm text-gray-500">Instant, data-driven vehicle valuations with visual evidence analysis</p>
                      </div>
                      <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mb-6">
                        <div className="flex">
                          <div className="ml-3">
                            <p className="text-sm text-blue-700">
                              <strong>Comprehensive Pricing Intelligence:</strong> This tool analyzes your vehicle's modifications, condition, and market data to provide instant, defensible valuations backed by visual evidence.
                            </p>
                          </div>
                        </div>
                      </div>
                      <PricingIntelligence vehicleId={vehicle.id} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VehicleDetail;
