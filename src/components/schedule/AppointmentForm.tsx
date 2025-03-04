
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AppointmentFormProps } from './types/scheduleTypes';
import { useAppointmentForm } from './appointment-form/useAppointmentForm';
import { AppointmentDetails } from './appointment-form/AppointmentDetails';
import { DateTimeSelector } from './appointment-form/DateTimeSelector';
import { ResourceSelectors } from './appointment-form/ResourceSelectors';
import { FormActions } from './appointment-form/FormActions';

export const AppointmentForm = ({
  appointment,
  onSubmit,
  onCancel,
  vehicles,
  technicians
}: AppointmentFormProps) => {
  const {
    isEditing,
    title,
    setTitle,
    description,
    setDescription,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    selectedVehicle,
    setSelectedVehicle,
    selectedTechnician,
    setSelectedTechnician,
    status,
    setStatus,
    type,
    setType,
    location,
    setLocation,
    notes,
    setNotes,
    prepareFormData
  } = useAppointmentForm(appointment);

  const handleSubmit = () => {
    const formData = prepareFormData();
    // Add the vehicle and technician names before submitting
    formData.vehicleName = vehicles.find(v => v.id === selectedVehicle)?.name;
    formData.technicianName = technicians.find(t => t.id === selectedTechnician)?.name;
    onSubmit(formData);
  };

  return (
    <Dialog open={true} onOpenChange={() => onCancel()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Appointment' : 'Create New Appointment'}</DialogTitle>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <AppointmentDetails
            title={title}
            setTitle={setTitle}
            description={description}
            setDescription={setDescription}
            type={type}
            setType={setType}
            location={location}
            setLocation={setLocation}
            notes={notes}
            setNotes={setNotes}
            status={status}
            setStatus={setStatus}
            isEditing={isEditing}
          />
          
          <DateTimeSelector
            startDate={startDate}
            setStartDate={setStartDate}
            endDate={endDate}
            setEndDate={setEndDate}
          />
          
          <ResourceSelectors
            selectedVehicle={selectedVehicle}
            setSelectedVehicle={setSelectedVehicle}
            selectedTechnician={selectedTechnician}
            setSelectedTechnician={setSelectedTechnician}
            vehicles={vehicles}
            technicians={technicians}
          />
        </div>
        
        <FormActions
          onCancel={onCancel}
          onSubmit={handleSubmit}
          isEditing={isEditing}
        />
      </DialogContent>
    </Dialog>
  );
};
