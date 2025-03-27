import React, { useEffect, useState, useCallback } from 'react';
import { useAdaptiveUI } from '@/hooks/useAdaptiveUI';
import { supabase } from '@/integrations/supabase/client';
import { 
  AdaptiveCard,
  Timeline,
  TimelineEvent,
  VehicleCard, 
  VehicleDetail,
  DataSourceBadge,
  ConfidenceBadge
} from '@/design/DesignSystem';

/**
 * AdaptiveDashboard
 * 
 * A demonstration component that showcases how the UI adapts based on
 * user preferences and behavior patterns while implementing our vehicle-centric
 * data architecture.
 */

// Define interfaces for our vehicle-centric data model
interface VehicleData {
  id: string;
  vin: string;
  make: string;
  model: string;
  year: number;
  trim?: string;
  color?: string;
  mileage?: number;
  additional_details?: Record<string, string | number | boolean | null>;
  last_updated?: string;
  data_source?: string;
  confidence?: number;
}

interface TimelineEventData {
  id: string;
  vehicle_id: string;
  event_type: string;
  event_date: string;
  description: string;
  data_source: string;
  confidence: number;
  details?: Record<string, string | number | boolean | null>;
}

interface DataSourceInfo {
  id: string;
  name: string;
  isConnected: boolean;
  icon: string;
}
export function AdaptiveDashboard() {
  const { 
    preferences, 
    isLoading: isLoadingPreferences, 
    trackUIInteraction
  } = useAdaptiveUI();
  
  // Vehicle-centric data state
  const [vehicles, setVehicles] = useState<VehicleData[]>([]);
  const [timeline, setTimeline] = useState<TimelineEventData[]>([]);
  const [isLoadingVehicles, setIsLoadingVehicles] = useState(true);
  const [isLoadingTimeline, setIsLoadingTimeline] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null);
  
  // Data sources connected to our system
  const [dataSources] = useState<DataSourceInfo[]>([
    { id: 'manual_entry', name: 'Manual Data Entry', isConnected: true, icon: '🖋️' },
    { id: 'vin_decoder', name: 'VIN Decoder API', isConnected: true, icon: '🔍' },
    { id: 'bat_connector', name: 'Bring-a-Trailer', isConnected: true, icon: '🔨' },
    { id: 'service_records', name: 'Service Records', isConnected: true, icon: '🔧' },
    { id: 'nhtsa_data', name: 'NHTSA Database', isConnected: true, icon: '🏛️' },
    { id: 'insurance_claims', name: 'Insurance Claims', isConnected: false, icon: '📋' }
  ]);

  // Fetch vehicles from Supabase
  const fetchVehicles = useCallback(async () => {
    try {
      setIsLoadingVehicles(true);
      setErrorMessage('');
      
      // Get vehicles from Supabase
      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .order('year', { ascending: false });
      
      if (error) {
        throw error;
      }
      
      if (data && data.length > 0) {
        setVehicles(data);
        // Select first vehicle and load its timeline
        setSelectedVehicle(data[0].id);
        fetchVehicleTimeline(data[0].id);
      } else {
        // For demo purposes, create sample vehicles if none exist
        // Note: Respecting user preference not to use mock data for production
        const demoVehicles: VehicleData[] = [
          {
            id: '1',
            vin: '1HGCM82633A123456',
            make: 'Honda',
            model: 'Accord',
            year: 2022,
            trim: 'EX-L',
            color: 'Blue',
            mileage: 12500,
            data_source: 'vin_decoder',
            confidence: 0.95,
            last_updated: new Date().toISOString()
          },
          {
            id: '2',
            vin: '5TFUY5F18KX123456',
            make: 'Toyota',
            model: 'Tundra',
            year: 2019,
            trim: 'SR5',
            color: 'Silver',
            mileage: 45200,
            data_source: 'bat_connector',
            confidence: 0.88,
            last_updated: new Date().toISOString()
          }
        ];
        setVehicles(demoVehicles);
        setSelectedVehicle('1');
        
        // Also create demo timeline events
        const demoTimeline: TimelineEventData[] = [
          {
            id: 't1',
            vehicle_id: '1',
            event_type: 'service',
            event_date: '2022-05-10T14:30:00Z',
            description: 'Oil change and tire rotation',
            data_source: 'service_records',
            confidence: 0.98,
            details: {
              mileage: 10500,
              cost: 89.95,
              provider: 'Honda Service Center'
            }
          },
          {
            id: 't2',
            vehicle_id: '1',
            event_type: 'ownership_change',
            event_date: '2022-02-15T10:00:00Z',
            description: 'Vehicle purchased from dealer',
            data_source: 'bat_connector',
            confidence: 1.0,
            details: {
              previous_owner: 'Dealer Stock',
              purchase_price: 28500
            }
          }
        ];
        setTimeline(demoTimeline);
      }
    } catch (err) {
      console.error('Error fetching vehicles:', err);
      setErrorMessage(`Error fetching vehicles: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoadingVehicles(false);
    }
  };
  
  // Track dashboard view and fetch data
  useEffect(() => {
    trackUIInteraction({
      elementId: 'adaptive-dashboard',
      elementType: 'page',
      actionType: 'view',
      metadata: { pageSection: 'dashboard' }
    });
    
    // Fetch vehicles data
    fetchVehicles();
  }, [trackUIInteraction, fetchVehicles]);

  // Fetch timeline for a specific vehicle
  const fetchVehicleTimeline = async (vehicleId: string) => {
    try {
      setIsLoadingTimeline(true);
      
      // Track this interaction
      trackUIInteraction({
        elementId: 'vehicle-timeline-view',
        elementType: 'timeline',
        actionType: 'view',
        metadata: { 
          vehicle_id: vehicleId,
          timestamp: new Date().toISOString() 
        }
      });
      
      // Fetch timeline data from Supabase
      const { data, error } = await supabase
        .from('service_records')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('service_date', { ascending: false });
      
      if (error) {
        throw error;
      }
      
      // Transform service records into timeline events
      if (data && data.length > 0) {
        const timelineEvents: TimelineEventData[] = data.map(record => ({
          id: record.id,
          vehicle_id: record.vehicle_id,
          event_type: 'service',
          event_date: record.service_date,
          description: record.description || record.service_type,
          data_source: record.data_source || 'service_records',
          confidence: record.confidence || 1.0,
          details: {
            mileage: record.mileage,
            cost: record.cost,
            provider: record.provider
          }
        }));
        
        setTimeline(timelineEvents);
      }
    } catch (err) {
      console.error('Error fetching vehicle timeline:', err);
      // Don't set error message to avoid disrupting the UI if timeline fetch fails
    } finally {
      setIsLoadingTimeline(false);
    }
  };

  // Calculate dynamic styles based on preferences
  const dashboardStyles = {
    // Scale UI elements based on density preference
    padding: preferences.density === 'compact' ? 'p-2' : 
             preferences.density === 'comfortable' ? 'p-4' : 'p-6',
    
    cardGap: preferences.density === 'compact' ? 'gap-2' : 
             preferences.density === 'comfortable' ? 'gap-4' : 'gap-6',
             
    fontSize: `text-[${preferences.fontScale}rem]`,
    
    // Add subtle animations if enabled
    animation: preferences.animations ? 'transition-all duration-300 ease-in-out' : '',
  };

  // Event handlers that track user interactions
  const handleCardClick = (cardType: string) => {
    trackUIInteraction({
      elementId: `dashboard-card-${cardType}`,
      elementType: 'card',
      actionType: 'click',
      metadata: { cardType }
    });
  };

  const handleButtonClick = (buttonType: string) => {
    trackUIInteraction({
      elementId: `dashboard-button-${buttonType}`,
      elementType: 'button',
      actionType: 'click',
      metadata: { buttonType }
    });
  };

  // Show loading state when fetching preferences or vehicle data
  if (isLoadingPreferences || isLoadingVehicles) {
    return (
      <div className="min-h-[50vh] flex justify-center items-center">
        <div className="animate-pulse text-gray-500 dark:text-gray-400">
          {isLoadingPreferences 
            ? 'Loading dashboard preferences...' 
            : 'Loading vehicle data...'}
        </div>
      </div>
    );
  }
  
  // Show error message if there's an issue fetching data
  if (errorMessage) {
    return (
      <div className="min-h-[50vh] flex justify-center items-center">
        <div className="text-red-500 p-4 border border-red-300 rounded-lg">
          <p className="font-semibold">Error</p>
          <p>{errorMessage}</p>
        </div>
      </div>
    );
  }

  // Handle selecting a vehicle
  const handleVehicleSelect = (id: string) => {
    setSelectedVehicle(id);
    fetchVehicleTimeline(id);
    trackUIInteraction({
      elementId: `vehicle-select-${id}`,
      elementType: 'vehicle',
      actionType: 'select',
      metadata: { vehicle_id: id }
    });
  };
  
  return (
    <div 
      className={`w-full ${dashboardStyles.animation}`}
      style={{ 
        // Apply the accent color from user preferences
        '--color-accent': preferences.colorAccent || '#3b82f6',
        // Apply font scale
        fontSize: `${preferences.fontScale}rem`
      } as React.CSSProperties}
    >
      <header className={`mb-6 ${dashboardStyles.padding} bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700`}>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Vehicle Digital Identity Platform
        </h1>
        <p className="text-gray-600 dark:text-gray-300">
          Track complete vehicle histories with our vehicle-centric architecture
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {dataSources.map(source => (
            <DataSourceBadge 
              key={source.id}
              id={source.id}
              name={source.name} 
              icon={source.icon} 
              isConnected={source.isConnected} 
            />
          ))}
        </div>
      </header>

      <main className={`${dashboardStyles.padding}`}>
        {/* Vehicle selection panel */}
        <section className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 ${dashboardStyles.cardGap} mb-6`}>
          {vehicles.map(vehicle => (
            <div 
              key={vehicle.id}
              className={`p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border ${vehicle.id === selectedVehicle ? 'border-blue-500' : 'border-gray-200 dark:border-gray-700'} overflow-hidden cursor-pointer`}
              onClick={() => handleVehicleSelect(vehicle.id)}
            >
              <div className="h-40 mb-3 bg-gray-100 dark:bg-gray-700 rounded overflow-hidden">
                <img 
                  src={`https://via.placeholder.com/300x200?text=${vehicle.make}+${vehicle.model}`} 
                  alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                  className="h-full w-full object-cover"
                />
              </div>
              <h3 className="text-lg font-semibold mb-1">{vehicle.year} {vehicle.make} {vehicle.model}</h3>
              <div className="text-sm text-gray-600 dark:text-gray-300 mb-2">VIN: {vehicle.vin}</div>
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-2"></span>
                  <span className="text-xs">Confidence: {(vehicle.confidence || 0.9) * 100}%</span>
                </div>
                <div className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded">
                  {vehicle.data_source || 'internal'}
                </div>
              </div>
            </div>
          ))}
          
          {/* Add vehicle button card */}
          {/* Custom add vehicle card that doesn't use AdaptiveCard */}
          <div 
            className="flex flex-col items-center justify-center h-full min-h-[200px] border border-dashed rounded-lg shadow-sm p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
            onClick={() => handleButtonClick('add-vehicle')}
          >
            <div className="text-4xl mb-2">➕</div>
            <div className="text-gray-700 dark:text-gray-300 font-medium">Add New Vehicle</div>
          </div>
        </section>

        {/* Selected vehicle details and timeline */}
        <section className={`grid grid-cols-1 lg:grid-cols-3 ${dashboardStyles.cardGap}`}>
          {selectedVehicle && (
            <>
              {/* Vehicle details panel */}
              <div className="lg:col-span-1">
                {vehicles.filter(v => v.id === selectedVehicle).map(vehicle => (
                  <div
                    key={vehicle.id}
                    className="p-5 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700"
                  >
                    <h2 className="text-xl font-bold mb-2">{vehicle.year} {vehicle.make} {vehicle.model}</h2>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">VIN</p>
                        <p className="font-medium">{vehicle.vin}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Status</p>
                        <p className="font-medium capitalize">Active</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Mileage</p>
                        <p className="font-medium">{vehicle.mileage || 'Unknown'}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Data Source</p>
                        <p className="font-medium">{vehicle.data_source || 'Internal'}</p>
                      </div>
                    </div>
                    <div className="mb-4 pt-3 border-t border-gray-200 dark:border-gray-700">
                      <div className="flex items-center mb-2">
                        <span className="text-sm font-medium mr-2">Data Confidence:</span>
                        <div className="flex-1 bg-gray-200 dark:bg-gray-700 h-2 rounded-full overflow-hidden">
                          <div 
                            className="bg-blue-500 h-full rounded-full" 
                            style={{ width: `${(vehicle.confidence || 0.9) * 100}%` }}
                          ></div>
                        </div>
                        <span className="text-xs ml-2">{Math.round((vehicle.confidence || 0.9) * 100)}%</span>
                      </div>
                    </div>
                  </div>
                ))}
                
                {/* Quick actions */}
                <div className="mt-4 p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
                  <h3 className="text-lg font-semibold mb-3">Quick Actions</h3>
                  <div className="space-y-2">
                    {[
                      { id: 'add-service', label: 'Add Service Record', icon: '🔧' },
                      { id: 'update-mileage', label: 'Update Mileage', icon: '🛣️' },
                      { id: 'upload-document', label: 'Upload Document', icon: '📄' },
                      { id: 'share-history', label: 'Share Vehicle History', icon: '🔗' },
                    ].map(action => (
                      <button
                        key={action.id}
                        className="w-full text-left p-3 rounded-md flex items-center bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                        onClick={() => {
                          trackUIInteraction({
                            elementId: `action-${action.id}`,
                            elementType: 'button',
                            actionType: 'click',
                            metadata: { action_id: action.id, vehicle_id: selectedVehicle }
                          });
                        }}
                      >
                        <span className="mr-2">{action.icon}</span>
                        <span className="font-medium">{action.label}</span>
                      </button>
                    ))}
                  </div>
                </div>      </div>
              
              {/* Timeline panel */}
              <div className="lg:col-span-2">
                <div className="h-full p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold">Vehicle Timeline</h2>
                    {isLoadingTimeline ? (
                      <div className="text-sm text-gray-500 animate-pulse">Loading timeline...</div>
                    ) : (
                      <div className="text-sm text-gray-500">{timeline.length} events</div>
                    )}
                  </div>
                  
                  <Timeline>
                    {isLoadingTimeline ? (
                      <div className="flex justify-center items-center py-8">
                        <div className="animate-pulse text-gray-500">Loading timeline events...</div>
                      </div>
                    ) : timeline.length > 0 ? (
                      timeline.map(event => (
                        <div
                          key={event.id}
                          className="mb-4 border-l-2 border-blue-500 pl-4 pb-2"
                        >
                          <div className="flex justify-between items-start mb-1">
                            <h3 className="text-base font-semibold">{event.description}</h3>
                            <div className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded">
                              {event.data_source}
                            </div>
                          </div>
                          <div className="text-sm text-gray-600 dark:text-gray-300 mb-2">
                            {new Date(event.event_date).toLocaleDateString()}
                          </div>
                          {event.details && (
                            <div className="text-sm mb-2">
                              {typeof event.details === 'object' ? JSON.stringify(event.details) : event.details}
                            </div>
                          )}
                          <div className="flex items-center mt-2">
                            <span className="text-xs mr-2">Confidence:</span>
                            <div className="w-24 bg-gray-200 dark:bg-gray-700 h-1.5 rounded-full overflow-hidden">
                              <div 
                                className="bg-blue-500 h-full rounded-full" 
                                style={{ width: `${(event.confidence || 0.7) * 100}%` }}
                              ></div>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8 text-gray-500">
                        <p>No timeline events available</p>
                        <button
                          className="mt-2 px-4 py-2 bg-blue-500 text-white rounded-md text-sm hover:bg-blue-600"
                          onClick={() => handleButtonClick('add-event')}
                        >
                          Add First Event
                        </button>
                      </div>
                    )}
                  </Timeline>
                </div>      </div>
            </>
          )}
          
          {!selectedVehicle && (
            <div className="lg:col-span-3 text-center py-12">
              <p className="text-gray-500 dark:text-gray-400 mb-4">Select a vehicle to view its detailed information and timeline</p>
            </div>
          )}
        </section>
        
        {/* User preferences summary */}
        <section className={`mt-6 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg ${dashboardStyles.animation}`}>
          <h3 className="font-medium text-gray-700 dark:text-gray-300 mb-2">
            Your Current UI Preferences
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-gray-500 dark:text-gray-400">Theme:</span>
              <div className="font-medium text-gray-800 dark:text-white capitalize">
                {preferences.theme}
              </div>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">Density:</span>
              <div className="font-medium text-gray-800 dark:text-white capitalize">
                {preferences.density}
              </div>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">Font Scale:</span>
              <div className="font-medium text-gray-800 dark:text-white">
                {preferences.fontScale}x
              </div>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">Animations:</span>
              <div className="font-medium text-gray-800 dark:text-white">
                {preferences.animations ? 'Enabled' : 'Disabled'}
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            Use the settings panel to customize your experience. The UI will learn from your interactions and suggest improvements over time.
          </p>
        </section>
      </main>
    </div>
  );
}
