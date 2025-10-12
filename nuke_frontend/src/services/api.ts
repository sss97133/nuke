import axios from 'axios';
import { supabase } from '../lib/supabase';

// Create an Axios instance for API requests
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests automatically
api.interceptors.request.use(async (config) => {
  const session = supabase.auth.getSession();
  const token = (await session).data.session?.access_token;

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  } else {
    // For public routes, allow requests without authentication
    // The backend will return limited/public data or 401 errors
    console.log('Making unauthenticated API request to:', config.url);
  }

  return config;
});

// API functions for vehicles
export const vehicleAPI = {
  // Get all vehicles
  getVehicles: async () => {
    const response = await api.get('/vehicles');
    return response.data;
  },
  
  // Get a specific vehicle
  getVehicle: async (id: string, params: any = {}) => {
    const searchParams = new URLSearchParams(params).toString();
    const url = `/vehicles/${id}${searchParams ? `?${searchParams}` : ''}`;
    const response = await api.get(url);
    return response.data;
  },
  
  // Create a new vehicle
  createVehicle: async (vehicleData: any) => {
    const response = await api.post('/vehicles', { vehicle: vehicleData });
    return response.data;
  },
  
  // Update a vehicle
  updateVehicle: async (id: string, vehicleData: any) => {
    const response = await api.put(`/vehicles/${id}`, { vehicle: vehicleData });
    return response.data;
  },
  
  // Archive a vehicle (not delete, following vehicle-centric principles)
  archiveVehicle: async (id: string) => {
    const response = await api.delete(`/vehicles/${id}`);
    return response.data;
  }
};

// API functions for timeline events
export const timelineAPI = {
  // Get timeline events for a vehicle
  getTimelineEvents: async (vehicleId: string) => {
    const response = await api.get(`/vehicles/${vehicleId}/timeline`);
    return response.data;
  },
  
  // Create a timeline event
  createTimelineEvent: async (vehicleId: string, eventData: any) => {
    const response = await api.post(`/vehicles/${vehicleId}/timeline`, { timeline: eventData });
    return response.data;
  },
  
  // Verify a timeline event
  verifyTimelineEvent: async (eventId: string) => {
    const response = await api.post(`/timeline/${eventId}/verify`);
    return response.data;
  }
};

// API functions for vehicle images
export const imageAPI = {
  // Get images for a vehicle
  getVehicleImages: async (vehicleId: string) => {
    const response = await api.get(`/vehicles/${vehicleId}/images`);
    return response.data;
  },
  
  // Upload a new image
  uploadImage: async (vehicleId: string, imageData: any) => {
    const response = await api.post(`/vehicles/${vehicleId}/images`, { image: imageData });
    return response.data;
  },
  
  // Set an image as primary
  setPrimaryImage: async (vehicleId: string, imageId: string) => {
    const response = await api.post(`/images/${imageId}/set-primary`);
    return response.data;
  },
  
  // Verify an image
  verifyImage: async (imageId: string) => {
    const response = await api.post(`/images/${imageId}/verify`);
    return response.data;
  },

  // Upload a vehicle image using FormData (for file uploads)
  uploadVehicleImage: async (formData: FormData) => {
    const response = await api.post('/images/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  }
};

// API functions for document uploads
export const documentAPI = {
  // Upload a document (for ownership verification, etc.)
  uploadDocument: async (formData: FormData) => {
    const response = await api.post('/documents/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  // Get documents for a vehicle
  getVehicleDocuments: async (vehicleId: string) => {
    const response = await api.get(`/vehicles/${vehicleId}/documents`);
    return response.data;
  }
};
