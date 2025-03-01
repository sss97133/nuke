
import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import BasicInformation from './sections/BasicInformation';
import ServiceDetails from './sections/ServiceDetails';
import PartsSection from './sections/PartsSection';
import { useServiceRecordForm } from './useServiceRecordForm';

interface CreateServiceRecordProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const CreateServiceRecord: React.FC<CreateServiceRecordProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const {
    formState,
    updateFormState,
    vehicles,
    newPart,
    updateNewPart,
    addPart,
    removePart,
    isSubmitting,
    submitError,
    handleSubmit,
    vehiclesLoading
  } = useServiceRecordForm(onClose, onSuccess);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Service Record</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 py-4">
          <fieldset disabled={isSubmitting} className="space-y-6">
            <BasicInformation
              vehicleId={formState.vehicleId}
              description={formState.description}
              vehicles={vehicles}
              onVehicleChange={(id) => updateFormState('vehicleId', id)}
              onDescriptionChange={(desc) => updateFormState('description', desc)}
            />

            <Separator />

            <ServiceDetails
              serviceType={formState.serviceType}
              status={formState.status}
              laborHours={formState.laborHours}
              technicianNotes={formState.technicianNotes}
              onServiceTypeChange={(type) => updateFormState('serviceType', type)}
              onStatusChange={(status) => updateFormState('status', status)}
              onLaborHoursChange={(hours) => updateFormState('laborHours', hours)}
              onTechnicianNotesChange={(notes) => updateFormState('technicianNotes', notes)}
            />

            <Separator />

            <PartsSection
              parts={formState.parts}
              newPart={newPart}
              onNewPartChange={updateNewPart}
              onAddPart={addPart}
              onRemovePart={removePart}
            />
          </fieldset>

          {submitError && (
            <div className="text-sm text-destructive">{submitError}</div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !formState.vehicleId || !formState.description || vehiclesLoading}>
              {isSubmitting ? "Saving..." : "Save Record"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CreateServiceRecord;
