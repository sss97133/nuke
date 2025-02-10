
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { VehicleForm } from "@/components/vehicles/VehicleForm";
import { InventoryForm } from "@/components/inventory/InventoryForm";

interface FormDialogsProps {
  showNewVehicleDialog: boolean;
  setShowNewVehicleDialog: (show: boolean) => void;
  showNewInventoryDialog: boolean;
  setShowNewInventoryDialog: (show: boolean) => void;
}

export const FormDialogs = ({
  showNewVehicleDialog,
  setShowNewVehicleDialog,
  showNewInventoryDialog,
  setShowNewInventoryDialog
}: FormDialogsProps) => {
  return (
    <>
      <Dialog open={showNewVehicleDialog} onOpenChange={setShowNewVehicleDialog}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Add New Vehicle</DialogTitle>
          </DialogHeader>
          <VehicleForm onSuccess={() => setShowNewVehicleDialog(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={showNewInventoryDialog} onOpenChange={setShowNewInventoryDialog}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Add New Asset</DialogTitle>
          </DialogHeader>
          <InventoryForm onSuccess={() => setShowNewInventoryDialog(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
};
