
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useServiceRecordForm } from './useServiceRecordForm';
import BasicInformation from './sections/BasicInformation';
import ServiceDetails from './sections/ServiceDetails';
import PartsSection from './sections/PartsSection';

interface CreateServiceRecordProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const CreateServiceRecord: React.FC<CreateServiceRecordProps> = ({ isOpen, onClose, onSuccess }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  
  const { 
    formState,
    resetForm,
    updateVehicle,
    updateDescription,
    updateServiceType,
    updateStatus,
    updateTechnicianNotes,
    updateLaborHours,
    addPart,
    removePart,
    updateNewPart,
    newPart,
    vehicles,
    validateForm
  } = useServiceRecordForm();

  // Reset form when dialog opens
  React.useEffect(() => {
    if (isOpen) {
      resetForm();
      setError(null);
    }
  }, [isOpen, resetForm]);

  const handleSubmit = async () => {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const { error: insertError } = await supabase
        .from('service_tickets')
        .insert({
          description: formState.description,
          vehicle_id: formState.vehicleId,
          service_type: formState.serviceType,
          status: formState.status,
          technician_notes: formState.technicianNotes || null,
          labor_hours: formState.laborHours || 0,
          parts_used: formState.parts.length > 0 ? formState.parts : null,
          service_date: new Date().toISOString(),
        });

      if (insertError) throw insertError;
      
      onSuccess();
    } catch (err: any) {
      console.error('Error creating service record:', err);
      setError(err.message || 'Failed to create service record');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Service Record</DialogTitle>
        </DialogHeader>

        {error && (
          <div className="bg-destructive/15 text-destructive p-3 rounded-md mb-4">
            {error}
          </div>
        )}

        <div className="grid gap-4 py-4">
          <BasicInformation 
            vehicleId={formState.vehicleId}
            description={formState.description}
            vehicles={vehicles}
            onVehicleChange={updateVehicle}
            onDescriptionChange={updateDescription}
          />

          <ServiceDetails 
            serviceType={formState.serviceType}
            status={formState.status}
            laborHours={formState.laborHours}
            technicianNotes={formState.technicianNotes}
            onServiceTypeChange={updateServiceType}
            onStatusChange={updateStatus}
            onLaborHoursChange={updateLaborHours}
            onTechnicianNotesChange={updateTechnicianNotes}
          />

          <PartsSection 
            parts={formState.parts}
            newPart={newPart}
            onNewPartChange={updateNewPart}
            onAddPart={addPart}
            onRemovePart={removePart}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save Service Record'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreateServiceRecord;
