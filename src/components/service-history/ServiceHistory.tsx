
import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ServiceRecord, parsePartsUsed, ServiceStatus } from './types';
import ServiceTabs from './ServiceTabs';
import ServiceFilters from './ServiceFilters';
import LoadingState from './LoadingState';
import ErrorState from './ErrorState';
import EmptyState from './EmptyState';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import ServiceRecordCard from './ServiceRecordCard';
import CreateServiceRecord from './create-service-record/CreateServiceRecord';
import { useToast } from '@/components/ui/use-toast';
import { format, parseISO, isWithinInterval, startOfDay, endOfDay } from 'date-fns';

const ServiceHistory = () => {
  const [records, setRecords] = useState<ServiceRecord[]>([]);
  const [filteredRecords, setFilteredRecords] = useState<ServiceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddRecord, setShowAddRecord] = useState(false);
  const [activeTab, setActiveTab] = useState<ServiceStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState('date-desc');
  const [dateRange, setDateRange] = useState<{ from?: Date; to?: Date }>({});

  const { toast } = useToast();

  const fetchServiceRecords = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { data, error } = await supabase
        .from('service_tickets')
        .select(`
          *,
          vehicles:vehicle_id (
            make,
            model,
            year
          )
        `)
        .order('service_date', { ascending: false });

      if (error) throw error;

      const formattedRecords: ServiceRecord[] = data.map(record => ({
        id: record.id,
        description: record.description,
        service_date: record.service_date,
        completion_date: record.completion_date || undefined,
        service_type: record.service_type || undefined,
        status: record.status,
        technician_notes: record.technician_notes || undefined,
        labor_hours: record.labor_hours || undefined,
        parts_used: parsePartsUsed(record.parts_used),
        vehicle_id: record.vehicle_id,
        vehicle: {
          make: record.vehicles?.make || 'Unknown',
          model: record.vehicles?.model || 'Unknown',
          year: record.vehicles?.year || 0
        }
      }));

      setRecords(formattedRecords);
      setFilteredRecords(formattedRecords);
    } catch (err: any) {
      console.error('Error fetching service records:', err);
      setError(err.message || 'Failed to load service history');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchServiceRecords();
  }, []);

  useEffect(() => {
    let filtered = [...records];

    // Filter by tab
    if (activeTab !== 'all') {
      filtered = filtered.filter(record => record.status === activeTab);
    }

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(record => 
        record.description.toLowerCase().includes(query) || 
        record.vehicle.make.toLowerCase().includes(query) || 
        record.vehicle.model.toLowerCase().includes(query) ||
        (record.service_type && record.service_type.toLowerCase().includes(query)) ||
        (record.technician_notes && record.technician_notes.toLowerCase().includes(query))
      );
    }

    // Filter by date range
    if (dateRange.from || dateRange.to) {
      filtered = filtered.filter(record => {
        const recordDate = parseISO(record.service_date);
        
        if (dateRange.from && dateRange.to) {
          return isWithinInterval(recordDate, {
            start: startOfDay(dateRange.from),
            end: endOfDay(dateRange.to)
          });
        } else if (dateRange.from) {
          return recordDate >= startOfDay(dateRange.from);
        } else if (dateRange.to) {
          return recordDate <= endOfDay(dateRange.to);
        }
        
        return true;
      });
    }

    // Sort records
    filtered.sort((a, b) => {
      const dateA = new Date(a.service_date).getTime();
      const dateB = new Date(b.service_date).getTime();
      
      switch (sortOption) {
        case 'date-asc':
          return dateA - dateB;
        case 'date-desc':
          return dateB - dateA;
        default:
          return dateB - dateA;
      }
    });

    setFilteredRecords(filtered);
  }, [records, activeTab, searchQuery, sortOption, dateRange]);

  const handleAddServiceRecord = () => {
    setShowAddRecord(true);
  };

  const handleRecordAdded = () => {
    fetchServiceRecords();
    setShowAddRecord(false);
    toast({
      title: "Service Record Added",
      description: "The service record has been successfully created.",
    });
  };

  const tabCounts = {
    all: records.length,
    completed: records.filter(r => r.status === 'completed').length,
    'in-progress': records.filter(r => r.status === 'in-progress').length,
    pending: records.filter(r => r.status === 'pending').length,
  };

  return (
    <div className="container mx-auto py-6 max-w-5xl">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Service History</h1>
        <Button onClick={handleAddServiceRecord} className="flex gap-1">
          <Plus className="h-4 w-4" />
          Add Service Record
        </Button>
      </div>

      <ServiceTabs 
        activeTab={activeTab} 
        onTabChange={setActiveTab} 
        counts={tabCounts} 
      />

      <ServiceFilters 
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        sortOption={sortOption}
        onSortChange={setSortOption}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
      />

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchServiceRecords} />
      ) : filteredRecords.length === 0 ? (
        <EmptyState 
          message={
            records.length > 0 
              ? "No matching service records found. Try adjusting your filters."
              : "No service records found. Add your first service record."
          }
          actionLabel={records.length > 0 ? undefined : "Add Service Record"}
          onAction={records.length > 0 ? undefined : handleAddServiceRecord}
        />
      ) : (
        <div className="space-y-4 mt-4">
          {filteredRecords.map(record => (
            <ServiceRecordCard key={record.id} record={record} />
          ))}
        </div>
      )}

      <CreateServiceRecord
        isOpen={showAddRecord}
        onClose={() => setShowAddRecord(false)}
        onSuccess={handleRecordAdded}
      />
    </div>
  );
};

export default ServiceHistory;
