import { useState, useEffect } from 'react';
import { DataSourceService } from '../services/dataSourceService';
import type { FieldAnnotation } from '../types/dataSource';

export const useVehicleAnnotations = (vehicleId: string, fieldNames: string[]) => {
  const [annotations, setAnnotations] = useState<Record<string, FieldAnnotation>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadAnnotations = async () => {
      if (!vehicleId || fieldNames.length === 0) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        
        const vehicleAnnotations = await DataSourceService.getVehicleAnnotations(vehicleId, fieldNames);
        setAnnotations(vehicleAnnotations);
      } catch (err) {
        console.error('Error loading vehicle annotations:', err);
        setError('Failed to load data source information');
      } finally {
        setLoading(false);
      }
    };

    loadAnnotations();
  }, [vehicleId, fieldNames.join(',')]);

  const refreshAnnotations = async () => {
    if (!vehicleId || fieldNames.length === 0) return;
    
    try {
      const vehicleAnnotations = await DataSourceService.getVehicleAnnotations(vehicleId, fieldNames);
      setAnnotations(vehicleAnnotations);
    } catch (err) {
      console.error('Error refreshing annotations:', err);
    }
  };

  return {
    annotations,
    loading,
    error,
    refreshAnnotations
  };
};
