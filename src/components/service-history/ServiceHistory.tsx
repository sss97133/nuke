
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import ServiceTabs from './ServiceTabs';
import ServiceFilters from './ServiceFilters';
import LoadingState from './LoadingState';
import ErrorState from './ErrorState';
import EmptyState from './EmptyState';
import ServiceRecordCard from './ServiceRecordCard';
import CreateServiceRecord from './create-service-record/CreateServiceRecord';
import { useServiceHistory } from './hooks/useServiceHistory';
import { DateRange } from 'react-day-picker';

const ServiceHistory = () => {
  const [showAddRecord, setShowAddRecord] = useState(false);
  const { 
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
  } = useServiceHistory();

  const handleAddServiceRecord = () => {
    setShowAddRecord(true);
  };

  return (
    <div className="container mx-auto py-3 sm:py-4 md:py-6 px-3 sm:px-4 md:px-6 max-w-5xl">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 sm:gap-3 mb-3 sm:mb-4 md:mb-6">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold">Service History</h1>
        <Button onClick={handleAddServiceRecord} className="w-full sm:w-auto flex gap-1 justify-center">
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
        dateRange={dateRange as DateRange | undefined}
        onDateRangeChange={(range) => setDateRange(range || {})}
      />

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState 
          error={error} 
          onRetry={fetchServiceRecords} 
        />
      ) : filteredRecords.length === 0 ? (
        <EmptyState 
          message={
            tabCounts.all > 0 
              ? "No matching service records found. Try adjusting your filters."
              : "No service records found. Add your first service record."
          }
          actionLabel={tabCounts.all > 0 ? undefined : "Add Service Record"}
          onAction={tabCounts.all > 0 ? undefined : handleAddServiceRecord}
        />
      ) : (
        <div className="space-y-3 sm:space-y-4 mt-3 sm:mt-4">
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
