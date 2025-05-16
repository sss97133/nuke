
import { useState, useEffect } from 'react';
import { Appointment } from '../types/scheduleTypes';

export const useAppointmentForm = (appointment: Appointment | undefined) => {
  const isEditing = !!appointment;
  const [title, setTitle] = useState(appointment?.title || '');
  const [description, setDescription] = useState(appointment?.description || '');
  const [startDate, setStartDate] = useState<Date>(appointment?.startTime || new Date());
  const [endDate, setEndDate] = useState<Date>(appointment?.endTime || new Date());
  const [selectedVehicle, setSelectedVehicle] = useState(appointment?.vehicleId || '');
  const [selectedTechnician, setSelectedTechnician] = useState(appointment?.technicianId || '');
  const [status, setStatus] = useState<'scheduled' | 'in-progress' | 'completed' | 'cancelled'>(
    appointment?.status || 'scheduled'
  );
  const [type, setType] = useState<'maintenance' | 'repair' | 'inspection' | 'other'>(
    appointment?.type || 'maintenance'
  );
  const [location, setLocation] = useState(appointment?.location || '');
  const [notes, setNotes] = useState(appointment?.notes || '');

  // Auto-calculate end time (1 hour after start time) for new appointments
  useEffect(() => {
    if (!appointment) {
      const newEndDate = new Date(startDate);
      newEndDate.setHours(newEndDate.getHours() + 1);
      setEndDate(newEndDate);
    }
  }, [startDate, appointment]);

  const prepareFormData = (): Appointment => {
    return {
      id: appointment?.id || '',
      title,
      description,
      startTime: startDate,
      endTime: endDate,
      vehicleId: selectedVehicle,
      vehicleName: undefined, // This will be set by the parent component
      technicianId: selectedTechnician,
      technicianName: undefined, // This will be set by the parent component
      status,
      type,
      location,
      notes,
      color: appointment?.color || '#2196F3'
    };
  };

  return {
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
  };
};
