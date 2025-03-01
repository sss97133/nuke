
import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ServiceRecord, parsePartsUsed } from './types';
import LoadingState from './LoadingState';
import ErrorState from './ErrorState';
import EmptyState from './EmptyState';
import ServiceTabs from './ServiceTabs';
import ServiceFilters from './ServiceFilters';
import { parseISO, isAfter, subDays, subMonths, subYears } from 'date-fns';

const ServiceHistory = () => {
  // Filter and sort states
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('date-newest');
  const [dateRange, setDateRange] = useState('all');

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

  // Filtering and sorting logic
  const filteredAndSortedRecords = useMemo(() => {
    if (!serviceRecords) return [];

    // First, filter by date range
    let filtered = [...serviceRecords];
    
    if (dateRange !== 'all') {
      const now = new Date();
      const filterDate = 
        dateRange === 'last-30' ? subDays(now, 30) :
        dateRange === 'last-90' ? subDays(now, 90) :
        dateRange === 'last-year' ? subYears(now, 1) : null;
      
      if (filterDate) {
        filtered = filtered.filter(record => {
          const recordDate = parseISO(record.service_date);
          return isAfter(recordDate, filterDate);
        });
      }
    }

    // Then, filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(record => 
        record.description.toLowerCase().includes(query) ||
        record.vehicle.make.toLowerCase().includes(query) ||
        record.vehicle.model.toLowerCase().includes(query) ||
        (record.technician_notes && record.technician_notes.toLowerCase().includes(query)) ||
        (record.service_type && record.service_type.toLowerCase().includes(query))
      );
    }

    // Finally, sort the records
    return filtered.sort((a, b) => {
      switch (sortBy) {
        case 'date-newest':
          return new Date(b.service_date).getTime() - new Date(a.service_date).getTime();
        case 'date-oldest':
          return new Date(a.service_date).getTime() - new Date(b.service_date).getTime();
        case 'status':
          return a.status.localeCompare(b.status);
        case 'type':
          return (a.service_type || '').localeCompare(b.service_type || '');
        default:
          return 0;
      }
    });
  }, [serviceRecords, searchQuery, sortBy, dateRange]);

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
      
      <ServiceFilters 
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        sortBy={sortBy}
        setSortBy={setSortBy}
        dateRange={dateRange}
        setDateRange={setDateRange}
      />
      
      {filteredAndSortedRecords.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-muted-foreground">No matching service records found. Try adjusting your filters.</p>
        </div>
      ) : (
        <ServiceTabs serviceRecords={filteredAndSortedRecords} />
      )}
    </div>
  );
};

export default ServiceHistory;
