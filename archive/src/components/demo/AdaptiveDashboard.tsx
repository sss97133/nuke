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
 * A vehicle-centric dashboard that adapts to user interactions and preferences.
 * Features:
 * - Vehicle selection and detailed information display
 * - Timeline of vehicle events with confidence scoring
 * - Adaptive UI based on user interactions
 */
export default function AdaptiveDashboard() {
  const { trackUIInteraction, userPreferences } = useAdaptiveUI();
  
  // Vehicle state
  const [vehicles, setVehicles] = useState<VehicleData[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineEventData[]>([]);
  
  // UI state
  const [activeTab, setActiveTab] = useState('info');
  const [dataDensity, setDataDensity] = useState<'compact' | 'normal' | 'detailed'>(
    userPreferences.dataDensity || 'normal'
  );
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(
    userPreferences.defaultViewMode || 'grid'
  );
  
  // Loading and error states
  const [isLoadingVehicles, setIsLoadingVehicles] = useState(false);
  const [isLoadingTimeline, setIsLoadingTimeline] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [vehiclesError, setVehiclesError] = useState<string | null>(null);
  
  // Get currently selected vehicle data
  const currentVehicle = vehicles.find(v => v.id === selectedVehicle);
  
  // Mock data sources (would come from a hook in production)
  const [dataSources] = useState<DataSourceInfo[]>([
    { id: 'manual_entry', name: 'Manual Data Entry', isConnected: true, icon: '🖋️' },
    { id: 'vin_decoder', name: 'VIN Decoder API', isConnected: true, icon: '🔍' },
    { id: 'bat_connector', name: 'Bring-a-Trailer', isConnected: true, icon: '🔨' },
    { id: 'service_records', name: 'Service Records', isConnected: true, icon: '🔧' },
    { id: 'nhtsa_data', name: 'NHTSA Database', isConnected: true, icon: '🏛️' },
    { id: 'insurance_claims', name: 'Insurance Claims', isConnected: false, icon: '📋' }
  ]);

  // Fetch timeline for a specific vehicle
  const fetchVehicleTimeline = async (vehicleId: string) => {
    try {
      setIsLoadingTimeline(true);
      
      // Track this interaction
      trackUIInteraction({
        elementId: 'vehicle-timeline',
        elementType: 'data',
        actionType: 'fetch',
        metadata: { vehicleId }
      });
      
      // Get timeline events from Supabase
      const { data, error } = await supabase
        .from('timeline_events')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('event_date', { ascending: false });
      
      if (error) {
        throw error;
      }
      
      // Use the timeline data if available, otherwise create demo events
      if (data && data.length > 0) {
        setTimeline(data);
      } else {
        // For demo purposes only - create sample timeline
        // Note: Respecting user preference to avoid mock data in production
        const demoEvents: TimelineEventData[] = [
          {
            id: 'event1',
            vehicle_id: vehicleId,
            event_type: 'maintenance',
            event_date: '2023-06-15T14:30:00Z',
            description: 'Routine oil change and inspection',
            data_source: 'service_records',
            confidence: 0.95
          },
          {
            id: 'event2',
            vehicle_id: vehicleId,
            event_type: 'ownership',
            event_date: '2023-01-10T09:00:00Z',
            description: 'Vehicle purchased from previous owner',
            data_source: 'bat_connector',
            confidence: 0.88
          },
          {
            id: 'event3',
            vehicle_id: vehicleId,
            event_type: 'recall',
            event_date: '2022-11-05T11:15:00Z',
            description: 'Manufacturer recall addressed',
            data_source: 'nhtsa_data',
            confidence: 0.99
          }
        ];
        setTimeline(demoEvents);
      }
    } catch (err) {
      console.error('Error fetching timeline:', err);
      setErrorMessage(`Error fetching timeline: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoadingTimeline(false);
    }
  };

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
            event_type: 'maintenance',
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
  }, [fetchVehicleTimeline, trackUIInteraction]);
  
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
  
  // Handle vehicle selection
  const handleVehicleSelect = (vehicleId: string) => {
    setSelectedVehicle(vehicleId);
    
    // Track this interaction
    trackUIInteraction({
      elementId: 'vehicle-select',
      elementType: 'control',
      actionType: 'select',
      metadata: { vehicleId }
    });
    
    // Load timeline for the selected vehicle
    fetchVehicleTimeline(vehicleId);
  };
  
  // Handle tab change
  const handleTabChange = (tabName: string) => {
    setActiveTab(tabName);
    
    // Track this interaction
    trackUIInteraction({
      elementId: 'dashboard-tab',
      elementType: 'control',
      actionType: 'select',
      metadata: { tabName }
    });
  };
  
  // Handle view mode change
  const handleViewModeChange = (mode: 'list' | 'grid') => {
    setViewMode(mode);
    
    // Track this interaction
    trackUIInteraction({
      elementId: 'view-mode',
      elementType: 'control',
      actionType: 'change',
      metadata: { mode }
    });
  };
  
  // Handle data density change
  const handleDataDensityChange = (density: 'compact' | 'normal' | 'detailed') => {
    setDataDensity(density);
    
    // Track this interaction
    trackUIInteraction({
      elementId: 'data-density',
      elementType: 'control',
      actionType: 'change',
      metadata: { density }
    });
  };
  
  // Get appropriate data source info
  const getDataSourceInfo = (sourceId: string) => {
    return dataSources.find(ds => ds.id === sourceId) || {
      id: sourceId,
      name: sourceId.replace('_', ' '),
      isConnected: true,
      icon: '❓'
    };
  };
  
  // Render error state
  if (errorMessage) {
    return (
      <div className="p-4">
        <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-md">
          <h3 className="text-lg font-medium">Error</h3>
          <p>{errorMessage}</p>
          <button 
            className="mt-2 px-4 py-2 bg-red-600 text-white rounded-md"
            onClick={() => {
              setErrorMessage('');
              fetchVehicles();
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
  
  return (
    <div className="bg-gray-50 dark:bg-gray-900 min-h-screen p-4">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Vehicle Dashboard</h1>
          <p className="text-gray-600 dark:text-gray-300">
            View and manage vehicle information from multiple sources
          </p>
          
          {/* Controls for adaptive UI */}
          <div className="flex items-center space-x-4 mt-4">
            <div className="flex items-center">
              <span className="text-sm text-gray-600 dark:text-gray-300 mr-2">View:</span>
              <div className="flex bg-white dark:bg-gray-800 rounded-md p-1 shadow-sm">
                <button
                  className={`px-3 py-1 text-sm rounded-md ${
                    viewMode === 'grid'
                      ? 'bg-blue-100 dark:bg-blue-800/30 text-blue-800 dark:text-blue-200'
                      : 'text-gray-600 dark:text-gray-300'
                  }`}
                  onClick={() => handleViewModeChange('grid')}
                >
                  Grid
                </button>
                <button
                  className={`px-3 py-1 text-sm rounded-md ${
                    viewMode === 'list'
                      ? 'bg-blue-100 dark:bg-blue-800/30 text-blue-800 dark:text-blue-200'
                      : 'text-gray-600 dark:text-gray-300'
                  }`}
                  onClick={() => handleViewModeChange('list')}
                >
                  List
                </button>
              </div>
            </div>
            
            <div className="flex items-center">
              <span className="text-sm text-gray-600 dark:text-gray-300 mr-2">Density:</span>
              <div className="flex bg-white dark:bg-gray-800 rounded-md p-1 shadow-sm">
                <button
                  className={`px-3 py-1 text-sm rounded-md ${
                    dataDensity === 'compact'
                      ? 'bg-blue-100 dark:bg-blue-800/30 text-blue-800 dark:text-blue-200'
                      : 'text-gray-600 dark:text-gray-300'
                  }`}
                  onClick={() => handleDataDensityChange('compact')}
                >
                  Compact
                </button>
                <button
                  className={`px-3 py-1 text-sm rounded-md ${
                    dataDensity === 'normal'
                      ? 'bg-blue-100 dark:bg-blue-800/30 text-blue-800 dark:text-blue-200'
                      : 'text-gray-600 dark:text-gray-300'
                  }`}
                  onClick={() => handleDataDensityChange('normal')}
                >
                  Normal
                </button>
                <button
                  className={`px-3 py-1 text-sm rounded-md ${
                    dataDensity === 'detailed'
                      ? 'bg-blue-100 dark:bg-blue-800/30 text-blue-800 dark:text-blue-200'
                      : 'text-gray-600 dark:text-gray-300'
                  }`}
                  onClick={() => handleDataDensityChange('detailed')}
                >
                  Detailed
                </button>
              </div>
            </div>
          </div>
        </header>
        
        {isLoadingVehicles ? (
          <div className="p-8 text-center">
            <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto"></div>
            <p className="mt-4 text-gray-600 dark:text-gray-300">Loading vehicles...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Vehicle selection sidebar */}
            <div className="lg:col-span-1 space-y-4">
              <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">Vehicles</h2>
              
              <div className="space-y-3">
                {vehicles.map(vehicle => (
                  <VehicleCard
                    key={vehicle.id}
                    isSelected={vehicle.id === selectedVehicle}
                    onClick={() => handleVehicleSelect(vehicle.id)}
                    title={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                    subtitle={vehicle.vin || 'No VIN'}
                    imageUrl={`https://via.placeholder.com/300x200?text=${vehicle.make}+${vehicle.model}`}
                    badgeContent={
                      <div className="flex space-x-1">
                        <DataSourceBadge
                          source={getDataSourceInfo(vehicle.data_source || 'manual_entry')}
                        />
                        <ConfidenceBadge confidence={vehicle.confidence || 0.5} />
                      </div>
                    }
                  />
                ))}
              </div>
            </div>
            
            {/* Main content area */}
            <div className="lg:col-span-2 space-y-6">
              {currentVehicle ? (
                <>
                  {/* Vehicle detail card */}
                  <AdaptiveCard
                    title={`${currentVehicle.year} ${currentVehicle.make} ${currentVehicle.model}`}
                    subtitleRight={
                      <div className="flex space-x-2">
                        <DataSourceBadge
                          source={getDataSourceInfo(currentVehicle.data_source || 'manual_entry')}
                        />
                        <ConfidenceBadge confidence={currentVehicle.confidence || 0.5} />
                      </div>
                    }
                  >
                    <VehicleDetail
                      vehicle={currentVehicle}
                      dataDensity={dataDensity}
                      sourceBadges
                    />
                  </AdaptiveCard>
                  
                  {/* Tab navigation for timeline/etc */}
                  <div className="border-b border-gray-200 dark:border-gray-700">
                    <nav className="flex space-x-8">
                      <button
                        className={`py-4 px-1 border-b-2 font-medium text-sm ${
                          activeTab === 'info'
                            ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                            : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                        }`}
                        onClick={() => handleTabChange('info')}
                      >
                        Info
                      </button>
                      <button
                        className={`py-4 px-1 border-b-2 font-medium text-sm ${
                          activeTab === 'timeline'
                            ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                            : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                        }`}
                        onClick={() => handleTabChange('timeline')}
                      >
                        Timeline
                      </button>
                      <button
                        className={`py-4 px-1 border-b-2 font-medium text-sm ${
                          activeTab === 'records'
                            ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                            : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                        }`}
                        onClick={() => handleTabChange('records')}
                      >
                        Records
                      </button>
                    </nav>
                  </div>
                  
                  {/* Tab content */}
                  <div className="py-4">
                    {activeTab === 'timeline' && (
                      <div className="space-y-4">
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                          Vehicle Timeline
                        </h3>
                        
                        {isLoadingTimeline ? (
                          <div className="p-4 text-center">
                            <div className="animate-spin w-6 h-6 border-3 border-blue-500 border-t-transparent rounded-full mx-auto"></div>
                            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                              Loading timeline...
                            </p>
                          </div>
                        ) : timeline.length > 0 ? (
                          <Timeline>
                            {timeline.map(event => (
                              <TimelineEvent
                                key={event.id}
                                title={event.description}
                                date={new Date(event.event_date)}
                                type={event.event_type}
                                details={event.details}
                                source={getDataSourceInfo(event.data_source)}
                                confidence={event.confidence}
                              />
                            ))}
                          </Timeline>
                        ) : (
                          <p className="text-gray-500 dark:text-gray-400">
                            No timeline events found for this vehicle.
                          </p>
                        )}
                      </div>
                    )}
                    
                    {activeTab === 'info' && (
                      <div className="space-y-4">
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                          Vehicle Information
                        </h3>
                        <p className="text-gray-500 dark:text-gray-400">
                          Detailed vehicle information is displayed in the card above.
                        </p>
                      </div>
                    )}
                    
                    {activeTab === 'records' && (
                      <div className="space-y-4">
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                          Service Records
                        </h3>
                        <p className="text-gray-500 dark:text-gray-400">
                          Service records will be displayed here in a future update.
                        </p>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 text-center">
                  <p className="text-gray-500 dark:text-gray-400">
                    Select a vehicle to view details
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Types
interface VehicleData {
  id: string;
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
  vin?: string;
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
