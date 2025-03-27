
import type { Database } from '../types';
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ServiceRecord, parsePartsUsed, ServiceStatus } from '../types';
import { format, parseISO, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import { useToast } from '@/components/ui/use-toast';

export const useServiceHistory = () => {
  const [records, setRecords] = useState<ServiceRecord[]>([]);
  const [filteredRecords, setFilteredRecords] = useState<ServiceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
          vehicles!vehicle_id (
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
        // Ensure service_date is never null - use creation date as fallback
        service_date: record.service_date || record.created_at || new Date().toISOString(),
        completion_date: record.completion_date || undefined,
        service_type: record.service_type || undefined,
        // Ensure status is never null - use 'pending' as default
        status: record.status || 'pending',
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

  const tabCounts = useMemo(() => ({
    all: records.length,
    completed: records.filter(r => r.status === 'completed').length,
    'in-progress': records.filter(r => r.status === 'in-progress').length,
    pending: records.filter(r => r.status === 'pending').length,
  }), [records]);

  const handleRecordAdded = () => {
    fetchServiceRecords();
    toast({
      title: "Service Record Added",
      description: "The service record has been successfully created.",
    });
  };

  return {
    records,
    filteredRecords,
    isLoading,
    error,
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    sortOption,
    setSortOption,
    dateRange,
    setDateRange,
    tabCounts,
    fetchServiceRecords,
    handleRecordAdded
  };
};
