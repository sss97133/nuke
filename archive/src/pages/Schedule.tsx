
import { useState } from 'react';
import { ScheduleHeader } from '@/components/schedule/ScheduleHeader';
import { ScheduleSummaryCards } from '@/components/schedule/ScheduleSummaryCards';
import { ScheduleFilters } from '@/components/schedule/ScheduleFilters';
import { ScheduleContent } from '@/components/schedule/ScheduleContent';
import { AppointmentForm } from '@/components/schedule/AppointmentForm';
import { useScheduleData } from '@/components/schedule/hooks/useScheduleData';

const Schedule = () => {
  // Mock data for vehicles and technicians
  const vehicles = [
    { id: '1', name: '2019 Toyota Camry' },
    { id: '2', name: '2020 Honda CR-V' },
    { id: '3', name: '2018 Ford F-150' },
  ];

  const technicians = [
    { id: '1', name: 'Alex Johnson' },
    { id: '2', name: 'Maria Garcia' },
    { id: '3', name: 'Sam Wilson' },
  ];

  const {
    filteredAppointments,
    selectedAppointment,
    isFormOpen,
    calendarView,
    currentDate,
    isFilterOpen,
    setIsFormOpen,
    setIsFilterOpen,
    setSelectedAppointment,
    handleAppointmentClick,
    handleDateSelect,
    handleFormSubmit,
    handleFilterChange,
    setCalendarView
  } = useScheduleData({ vehicles, technicians });

  const handleAddAppointment = () => {
    setSelectedAppointment(undefined);
    setIsFormOpen(true);
  };

  const handleToggleFilters = () => {
    setIsFilterOpen(!isFilterOpen);
  };

  return (
    <div className="container mx-auto py-6">
      <ScheduleHeader 
        onAddAppointment={handleAddAppointment}
        onToggleFilters={handleToggleFilters}
        isFilterOpen={isFilterOpen}
      />

      <ScheduleSummaryCards 
        appointments={filteredAppointments}
        techniciansCount={technicians.length}
        vehiclesCount={vehicles.length}
      />

      {isFilterOpen && (
        <div className="mb-6 p-4 border rounded-md">
          <ScheduleFilters
            onFilterChange={handleFilterChange}
            currentFilters={{}}
            availableVehicles={vehicles}
            availableTechnicians={technicians}
          />
        </div>
      )}

      <ScheduleContent 
        appointments={filteredAppointments}
        onAppointmentClick={handleAppointmentClick}
        onDateSelect={handleDateSelect}
        calendarView={calendarView}
        currentDate={currentDate}
        onViewChange={setCalendarView}
      />

      {isFormOpen && (
        <AppointmentForm
          appointment={selectedAppointment}
          onSubmit={handleFormSubmit}
          onCancel={() => {
            setIsFormOpen(false);
            setSelectedAppointment(undefined);
          }}
          vehicles={vehicles}
          technicians={technicians}
        />
      )}
    </div>
  );
};

export default Schedule;
