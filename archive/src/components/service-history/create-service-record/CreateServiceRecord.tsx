
import React, { useMemo } from 'react';
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
import TotalCost from './sections/TotalCost';
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
    vehiclesLoading,
    newPart,
    updateNewPart,
    addPart,
    removePart,
    isSubmitting,
    submitError,
    handleSubmit,
    calculateTotalCost
  } = useServiceRecordForm(onClose, onSuccess);

  const totalCost = useMemo(() => calculateTotalCost(), [formState.parts, formState.laborHours]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[95vw] sm:max-w-2xl max-h-[85vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Add Service Record</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6 py-2 sm:py-4">
          <fieldset disabled={isSubmitting} className="space-y-4 sm:space-y-6">
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

            <TotalCost totalCost={totalCost} />
          </fieldset>

          {submitError && (
            <div className="text-sm text-destructive">{submitError}</div>
          )}

          <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={isSubmitting || !formState.vehicleId || !formState.description || vehiclesLoading}
              className="w-full sm:w-auto"
            >
              {isSubmitting ? "Saving..." : "Save Record"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CreateServiceRecord;
