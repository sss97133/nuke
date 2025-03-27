import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getEnvValue } from '@/utils/env-utils';

interface VehicleData {
  id: string;
  vin: string;
  make: string;
  model: string;
  year: number;
  additional_details?: Record<string, any>;
  last_updated?: string;
  data_source?: string;
  confidence?: number;
}

interface TimelineEvent {
  id: string;
  vehicle_id: string;
  event_type: string;
  event_date: string;
  description: string;
  data_source: string;
  confidence: number;
  details?: Record<string, any>;
}

export default function VehicleDataDemo() {
  const [vehicles, setVehicles] = useState<VehicleData[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null);
  const [connectedSources, setConnectedSources] = useState<string[]>([]);
  const [supabaseStatus, setSupabaseStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');

  // Check Supabase connection
  useEffect(() => {
    const checkConnection = async () => {
      try {
        // Check for required environment variables
        const supabaseUrl = getEnvValue('VITE_SUPABASE_URL');
        const supabaseKey = getEnvValue('VITE_SUPABASE_ANON_KEY');
        
        if (!supabaseUrl || !supabaseKey) {
          setError('Missing Supabase credentials in environment variables');
          setSupabaseStatus('error');
          setLoading(false);
          return;
        }
        
        // Test the connection
        const { data, error } = await supabase.from('test_connection').select('*').limit(1);
        
        if (error) {
          console.error('Supabase connection error:', error);
          setError(`Supabase connection error: ${error.message}`);
          setSupabaseStatus('error');
        } else {
          console.log('Supabase connected successfully');
          setSupabaseStatus('connected');
          // Load real data
          fetchVehicles();
          fetchConnectedSources();
        }
      } catch (err) {
        console.error('Connection check error:', err);
        setError(`Unexpected error checking connection: ${err instanceof Error ? err.message : String(err)}`);
        setSupabaseStatus('error');
        setLoading(false);
      }
    };
    
    checkConnection();
  }, []);
  
  // Fetch vehicles from Supabase
  const fetchVehicles = async () => {
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .order('last_updated', { ascending: false })
        .limit(10);
      
      if (error) {
        throw error;
      }
      
      setVehicles(data || []);
      
      // Select first vehicle by default if available
      if (data && data.length > 0 && !selectedVehicle) {
        setSelectedVehicle(data[0].id);
        fetchVehicleTimeline(data[0].id);
      }
    } catch (err) {
      console.error('Error fetching vehicles:', err);
      setError(`Error fetching vehicles: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };
  
  // Fetch connected data sources
  const fetchConnectedSources = async () => {
    try {
      const { data, error } = await supabase
        .from('data_sources')
        .select('id, name')
        .eq('is_active', true);
        
      if (error) {
        throw error;
      }
      
      if (data) {
        setConnectedSources(data.map(source => source.id));
      }
    } catch (err) {
      console.error('Error fetching data sources:', err);
      // Non-critical error, don't update the main error state
    }
  };
  
  // Fetch timeline for a specific vehicle
  const fetchVehicleTimeline = async (vehicleId: string) => {
    try {
      // This would combine data from multiple tables in a real implementation
      // For now, we'll just show service records as an example
      const { data, error } = await supabase
        .from('service_records')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('service_date', { ascending: false });
      
      if (error) {
        throw error;
      }
      
      // Transform service records into timeline events
      const timelineEvents: TimelineEvent[] = (data || []).map(record => ({
        id: record.id,
        vehicle_id: record.vehicle_id,
        event_type: 'service',
        event_date: record.service_date,
        description: record.description || record.service_type,
        data_source: record.data_source || 'manual',
        confidence: record.confidence || 1.0,
        details: {
          mileage: record.mileage,
          cost: record.cost,
          provider: record.provider
        }
      }));
      
      setTimeline(timelineEvents);
    } catch (err) {
      console.error('Error fetching vehicle timeline:', err);
      setError(`Error fetching timeline: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  
  const handleVehicleSelect = (vehicleId: string) => {
    setSelectedVehicle(vehicleId);
    fetchVehicleTimeline(vehicleId);
  };
  
  // Get the selected vehicle data
  const getSelectedVehicle = () => {
    return vehicles.find(v => v.id === selectedVehicle);
  };
  
  // Render confidence indicator
  const renderConfidence = (confidence: number = 1.0) => {
    let color = 'bg-red-500';
    let label = 'Low';
    
    if (confidence >= 0.9) {
      color = 'bg-green-500';
      label = 'High';
    } else if (confidence >= 0.7) {
      color = 'bg-yellow-500';
      label = 'Medium';
    }
    
    return (
      <span className="flex items-center gap-1 text-xs">
        <span className={`w-2 h-2 rounded-full ${color}`}></span>
        <span>{label} confidence ({Math.round(confidence * 100)}%)</span>
      </span>
    );
  };

  if (supabaseStatus === 'connecting') {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Connecting to Supabase...</p>
        </div>
      </div>
    );
  }
  
  if (supabaseStatus === 'error') {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <div className="bg-red-50 dark:bg-red-900/20 p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold text-red-800 dark:text-red-300 mb-4">Connection Error</h2>
          <p className="text-red-700 dark:text-red-400 mb-4">{error}</p>
          <div className="rounded-md bg-yellow-50 dark:bg-yellow-900/20 p-4 mt-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-300">Environment Configuration</h3>
                <div className="mt-2 text-sm text-yellow-700 dark:text-yellow-400">
                  <p>
                    Please ensure your Supabase credentials are properly set in your environment variables:
                  </p>
                  <ul className="list-disc list-inside mt-2">
                    <li>VITE_SUPABASE_URL</li>
                    <li>VITE_SUPABASE_ANON_KEY</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Vehicle-Centric Data Architecture</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          This demo shows how our platform maintains vehicle as the central identity, with data from multiple sources.
        </p>
        
        <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-md mb-8">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-green-800 dark:text-green-300">Connected to Supabase</h3>
              <div className="mt-2 text-sm text-green-700 dark:text-green-400">
                <p>Working with real data from the database.</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="col-span-1 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Available Vehicles</h2>
            {loading ? (
              <div className="animate-pulse space-y-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-12 bg-gray-200 dark:bg-gray-700 rounded"></div>
                ))}
              </div>
            ) : vehicles.length > 0 ? (
              <div className="space-y-2">
                {vehicles.map(vehicle => (
                  <button
                    key={vehicle.id}
                    onClick={() => handleVehicleSelect(vehicle.id)}
                    className={`w-full text-left p-3 rounded ${
                      selectedVehicle === vehicle.id 
                        ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                        : 'bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600'
                    }`}
                  >
                    <div className="font-medium">{vehicle.year} {vehicle.make} {vehicle.model}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">VIN: {vehicle.vin}</div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                No vehicles found in database.
              </div>
            )}
          </div>
          
          <div className="col-span-2 bg-white dark:bg-gray-800 rounded-lg shadow">
            {loading ? (
              <div className="animate-pulse p-6">
                <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-6"></div>
                <div className="space-y-4">
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6"></div>
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full"></div>
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
                </div>
              </div>
            ) : selectedVehicle ? (
              <div>
                {/* Selected Vehicle Details */}
                {getSelectedVehicle() && (
                  <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex justify-between items-start">
                      <div>
                        <h2 className="text-2xl font-bold">
                          {getSelectedVehicle()?.year} {getSelectedVehicle()?.make} {getSelectedVehicle()?.model}
                        </h2>
                        <div className="mt-1 text-gray-500 dark:text-gray-400">
                          VIN: {getSelectedVehicle()?.vin}
                        </div>
                      </div>
                      <div className="flex flex-col items-end">
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          Source: {getSelectedVehicle()?.data_source || 'Unknown'}
                        </div>
                        {renderConfidence(getSelectedVehicle()?.confidence)}
                      </div>
                    </div>
                    
                    <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="bg-gray-50 dark:bg-gray-700 p-3 rounded">
                        <div className="text-xs text-gray-500 dark:text-gray-400">Last Updated</div>
                        <div>{getSelectedVehicle()?.last_updated ? new Date(getSelectedVehicle()!.last_updated).toLocaleString() : 'Unknown'}</div>
                      </div>
                      
                      {getSelectedVehicle()?.additional_details && Object.keys(getSelectedVehicle()!.additional_details).length > 0 && (
                        Object.entries(getSelectedVehicle()!.additional_details).map(([key, value]) => (
                          <div key={key} className="bg-gray-50 dark:bg-gray-700 p-3 rounded">
                            <div className="text-xs text-gray-500 dark:text-gray-400">{key.replace(/_/g, ' ')}</div>
                            <div>{String(value)}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
                
                {/* Vehicle Timeline */}
                <div className="p-6">
                  <h3 className="text-lg font-semibold mb-4">Vehicle Timeline</h3>
                  
                  {timeline.length > 0 ? (
                    <div className="relative">
                      {/* Timeline connector */}
                      <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-gray-200 dark:bg-gray-700"></div>
                      
                      <div className="space-y-6">
                        {timeline.map((event, index) => (
                          <div key={event.id} className="relative pl-10">
                            {/* Timeline dot */}
                            <div className="absolute left-4 top-1.5 -translate-x-1/2 w-3 h-3 rounded-full bg-blue-500"></div>
                            
                            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                              <div className="flex justify-between">
                                <div className="font-medium">{event.event_type.charAt(0).toUpperCase() + event.event_type.slice(1)}</div>
                                <div className="text-sm text-gray-500 dark:text-gray-400">
                                  {new Date(event.event_date).toLocaleDateString()}
                                </div>
                              </div>
                              
                              <div className="mt-2">{event.description}</div>
                              
                              {event.details && (
                                <div className="mt-3 text-sm">
                                  {event.details.mileage && (
                                    <div>Mileage: {event.details.mileage.toLocaleString()} miles</div>
                                  )}
                                  {event.details.cost && (
                                    <div>Cost: ${event.details.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                  )}
                                  {event.details.provider && (
                                    <div>Provider: {event.details.provider}</div>
                                  )}
                                </div>
                              )}
                              
                              <div className="mt-2 flex justify-between items-center text-xs">
                                <div className="text-gray-500 dark:text-gray-400">
                                  Source: {event.data_source}
                                </div>
                                {renderConfidence(event.confidence)}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                      No timeline events found for this vehicle.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
                Select a vehicle to view details
              </div>
            )}
          </div>
        </div>
        
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Connected Data Sources</h2>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {[
              { id: 'manual_entry', name: 'Manual Data Entry', icon: '🖋️' },
              { id: 'vin_decoder', name: 'VIN Decoder API', icon: '🔍' },
              { id: 'image_analysis', name: 'Image Analysis', icon: '📷' },
              { id: 'service_records', name: 'Service Records', icon: '🔧' },
              { id: 'auction_data', name: 'Auction History', icon: '🔨' },
              { id: 'insurance_claims', name: 'Insurance Claims', icon: '📋' }
            ].map(source => (
              <div 
                key={source.id}
                className={`p-4 rounded-lg border ${
                  connectedSources.includes(source.id)
                    ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                    : 'border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-700'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="text-xl">{source.icon}</div>
                  <div>
                    <div className="font-medium">{source.name}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {connectedSources.includes(source.id) ? 'Connected' : 'Not connected'}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      <div className="bg-blue-50 dark:bg-blue-900/20 p-6 rounded-lg shadow-md">
        <h2 className="text-lg font-semibold text-blue-800 dark:text-blue-300 mb-2">For Design & Corporate Teams</h2>
        <p className="text-blue-700 dark:text-blue-400 mb-4">
          This demo illustrates the key concepts of our vehicle-centric architecture:
        </p>
        <ul className="list-disc list-inside space-y-2 text-blue-700 dark:text-blue-400">
          <li>Vehicles as persistent digital identities</li>
          <li>Timeline-based history aggregation</li>
          <li>Multi-source data with confidence indicators</li>
          <li>Flexible data collection framework</li>
          <li>Standardized data model with extensible fields</li>
        </ul>
        <div className="mt-6">
          <p className="text-blue-700 dark:text-blue-400">
            See the full architecture documentation at:
          </p>
          <ul className="list-disc list-inside mt-2 text-blue-700 dark:text-blue-400">
            <li><code>/docs/vehicle-centric-architecture.md</code></li>
            <li><code>/docs/design-implementation-roadmap.md</code></li>
          </ul>
        </div>
      </div>
    </div>
  );
}
