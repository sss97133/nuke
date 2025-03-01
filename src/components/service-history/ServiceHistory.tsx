
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ServiceRecord, parsePartsUsed } from './types';
import LoadingState from './LoadingState';
import ErrorState from './ErrorState';
import EmptyState from './EmptyState';
import ServiceTabs from './ServiceTabs';

const ServiceHistory = () => {
  const { data: serviceRecords, isLoading, error } = useQuery({
    queryKey: ['service-history'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('service_tickets')
        .select(`
          id,
          description,
          status,
          service_date,
          completion_date,
          service_type,
          technician_notes,
          labor_hours,
          parts_used,
          vehicle_id,
          vehicles:vehicle_id (make, model, year)
        `)
        .order('service_date', { ascending: false });
        
      if (error) throw error;
      
      // Transform the data to match our ServiceRecord interface
      return data.map(record => ({
        ...record,
        vehicle: record.vehicles, // Map 'vehicles' property to 'vehicle'
        parts_used: parsePartsUsed(record.parts_used) // Parse the JSON parts data
      })) as ServiceRecord[];
    }
  });

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <h1 className="text-3xl font-bold mb-6">Service History</h1>
        <LoadingState />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="text-3xl font-bold mb-6">Service History</h1>
        <ErrorState error={error} />
      </div>
    );
  }

  if (!serviceRecords || serviceRecords.length === 0) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="text-3xl font-bold mb-6">Service History</h1>
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Service History</h1>
      </div>
      
      <ServiceTabs serviceRecords={serviceRecords} />
    </div>
  );
};

export default ServiceHistory;
