import { useState } from 'react';
import axios from 'axios';

// Types from our Firecrawl MCP
interface MaintenanceDoc {
  title: string;
  content: string;
  vehicle: {
    make: string;
    model: string;
    years: number[];
  };
  sourceUrl: string;
  scrapedAt: string;
}

interface VehicleSpec {
  make: string;
  model: string;
  year: number;
  specs: Record<string, any>;
  sourceUrl: string;
}

interface RecallInfo {
  title: string;
  description: string;
  date: string;
  sourceUrl: string;
}

interface ServiceBulletin {
  id: string;
  title: string;
  content: string;
  issueDate: string;
  sourceUrl: string;
}

// Result states for API calls
interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * Hook for accessing vehicle documentation from the Firecrawl MCP
 * This uses the API endpoint to access the MCP while keeping API keys secure
 */
export function useVehicleDocs() {
  // State for maintenance documentation
  const [maintenanceDocs, setMaintenanceDocs] = useState<ApiState<MaintenanceDoc[]>>({
    data: null,
    loading: false,
    error: null
  });
  
  // State for vehicle specifications
  const [vehicleSpecs, setVehicleSpecs] = useState<ApiState<VehicleSpec>>({
    data: null,
    loading: false,
    error: null
  });
  
  // State for recall information
  const [recallInfo, setRecallInfo] = useState<ApiState<RecallInfo[]>>({
    data: null,
    loading: false,
    error: null
  });
  
  // State for service bulletins
  const [serviceBulletins, setServiceBulletins] = useState<ApiState<ServiceBulletin[]>>({
    data: null,
    loading: false,
    error: null
  });
  
  // State for vehicle enrichment
  const [enrichmentStatus, setEnrichmentStatus] = useState<ApiState<{success: boolean, message: string}>>({
    data: null,
    loading: false,
    error: null
  });
  
  /**
   * Fetch maintenance documentation for a specific vehicle
   */
  const findMaintenanceDocs = async (
    make: string,
    model: string,
    year?: number,
    topic?: string
  ): Promise<MaintenanceDoc[]> => {
    setMaintenanceDocs({ data: null, loading: true, error: null });
    
    try {
      const response = await axios.post<{ data: MaintenanceDoc[] }>('/api/vehicle-docs', {
        action: 'findMaintenanceDocs',
        params: { make, model, year, topic }
      });
      
      setMaintenanceDocs({
        data: response.data.data,
        loading: false,
        error: null
      });
      
      return response.data.data;
    } catch (err: unknown) {
      let errorMessage = 'Error fetching maintenance docs';
      if (
        typeof err === 'object' &&
        err !== null &&
        'response' in err &&
        typeof err.response === 'object' &&
        err.response !== null &&
        'data' in err.response &&
        typeof err.response.data === 'object' &&
        err.response.data !== null &&
        'message' in err.response.data &&
        typeof err.response.data.message === 'string'
      ) {
        errorMessage = err.response.data.message;
      } else if (err instanceof Error) {
        errorMessage = err.message;
      }
      setMaintenanceDocs({
        data: null,
        loading: false,
        error: errorMessage
      });
      throw err;
    }
  };
  
  /**
   * Get vehicle specifications from manufacturer websites
   */
  const getVehicleSpecs = async (
    make: string,
    model: string,
    year: number
  ): Promise<VehicleSpec> => {
    setVehicleSpecs({ data: null, loading: true, error: null });
    
    try {
      const response = await axios.post<{ data: VehicleSpec }>('/api/vehicle-docs', {
        action: 'getVehicleSpecs',
        params: { make, model, year }
      });
      
      setVehicleSpecs({
        data: response.data.data,
        loading: false,
        error: null
      });
      
      return response.data.data;
    } catch (err: unknown) {
      let errorMessage = 'Error fetching vehicle specs';
      if (
        typeof err === 'object' && err !== null && 'response' in err &&
        typeof err.response === 'object' && err.response !== null && 'data' in err.response &&
        typeof err.response.data === 'object' && err.response.data !== null &&
        'message' in err.response.data && typeof err.response.data.message === 'string'
      ) {
        errorMessage = err.response.data.message;
      } else if (err instanceof Error) {
        errorMessage = err.message;
      }
      setVehicleSpecs({
        data: null,
        loading: false,
        error: errorMessage
      });
      throw err;
    }
  };
  
  /**
   * Find recall information for a specific vehicle
   */
  const findRecallInformation = async (
    make: string,
    model: string,
    year: number
  ): Promise<RecallInfo[]> => {
    setRecallInfo({ data: null, loading: true, error: null });
    
    try {
      const response = await axios.post<{ data: RecallInfo[] }>('/api/vehicle-docs', {
        action: 'findRecallInformation',
        params: { make, model, year }
      });
      
      setRecallInfo({
        data: response.data.data,
        loading: false,
        error: null
      });
      
      return response.data.data;
    } catch (err: unknown) {
      let errorMessage = 'Error fetching recall information';
      if (
        typeof err === 'object' && err !== null && 'response' in err &&
        typeof err.response === 'object' && err.response !== null && 'data' in err.response &&
        typeof err.response.data === 'object' && err.response.data !== null &&
        'message' in err.response.data && typeof err.response.data.message === 'string'
      ) {
        errorMessage = err.response.data.message;
      } else if (err instanceof Error) {
        errorMessage = err.message;
      }
      setRecallInfo({
        data: null,
        loading: false,
        error: errorMessage
      });
      throw err;
    }
  };
  
  /**
   * Get service bulletins for a specific vehicle
   */
  const getServiceBulletins = async (
    make: string,
    model: string,
    year: number
  ): Promise<ServiceBulletin[]> => {
    setServiceBulletins({ data: null, loading: true, error: null });
    
    try {
      const response = await axios.post<{ data: ServiceBulletin[] }>('/api/vehicle-docs', {
        action: 'getServiceBulletins',
        params: { make, model, year }
      });
      
      setServiceBulletins({
        data: response.data.data,
        loading: false,
        error: null
      });
      
      return response.data.data;
    } catch (err: unknown) {
      let errorMessage = 'Error fetching service bulletins';
      if (
        typeof err === 'object' && err !== null && 'response' in err &&
        typeof err.response === 'object' && err.response !== null && 'data' in err.response &&
        typeof err.response.data === 'object' && err.response.data !== null &&
        'message' in err.response.data && typeof err.response.data.message === 'string'
      ) {
        errorMessage = err.response.data.message;
      } else if (err instanceof Error) {
        errorMessage = err.message;
      }
      setServiceBulletins({
        data: null,
        loading: false,
        error: errorMessage
      });
      throw err;
    }
  };
  
  /**
   * Enrich a vehicle record with manufacturer data
   */
  const enrichVehicleRecord = async (
    vehicleId: string,
    includeRecalls: boolean = true,
    includeBulletins: boolean = true
  ): Promise<{success: boolean, message: string}> => {
    setEnrichmentStatus({ data: null, loading: true, error: null });
    
    try {
      const response = await axios.post<{ data: {success: boolean, message: string} }>('/api/vehicle-docs', {
        action: 'enrichVehicleRecord',
        params: { vehicleId, includeRecalls, includeBulletins }
      });
      
      setEnrichmentStatus({
        data: response.data.data,
        loading: false,
        error: null
      });
      
      return response.data.data;
    } catch (err: unknown) {
      let errorMessage = 'Error enriching vehicle record';
      if (
        typeof err === 'object' && err !== null && 'response' in err &&
        typeof err.response === 'object' && err.response !== null && 'data' in err.response &&
        typeof err.response.data === 'object' && err.response.data !== null &&
        'message' in err.response.data && typeof err.response.data.message === 'string'
      ) {
        errorMessage = err.response.data.message;
      } else if (err instanceof Error) {
        errorMessage = err.message;
      }
      setEnrichmentStatus({
        data: null,
        loading: false,
        error: errorMessage
      });
      throw err;
    }
  };
  
  return {
    // Actions
    findMaintenanceDocs,
    getVehicleSpecs,
    findRecallInformation,
    getServiceBulletins,
    enrichVehicleRecord,
    
    // States
    maintenanceDocs,
    vehicleSpecs,
    recallInfo,
    serviceBulletins,
    enrichmentStatus
  };
}
