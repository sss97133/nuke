
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pencil, Trash2, Calendar, Droplet, DollarSign, Car, AlertCircle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFuelData } from "@/hooks/fuel/useFuelData";
import { useToast } from "@/hooks/use-toast";
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface FuelEntryListProps {
  vehicleId?: string;
  onEdit?: (id: string) => void;
}

export const FuelEntryList = ({ vehicleId, onEdit }: FuelEntryListProps) => {
  const { toast } = useToast();
  const { entries, isLoading, error, deleteFuelEntry } = useFuelData(vehicleId);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteInProgress, setDeleteInProgress] = useState(false);

  const handleEdit = (id: string) => {
    if (onEdit) {
      onEdit(id);
    } else {
      toast({
        title: "Edit functionality",
        description: "Edit functionality is not yet implemented for this view.",
      });
    }
  };

  const openDeleteDialog = (id: string) => {
    setDeleteId(id);
  };

  const closeDeleteDialog = () => {
    setDeleteId(null);
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    
    try {
      setDeleteInProgress(true);
      await deleteFuelEntry(deleteId);
      
      toast({
        title: "Entry deleted",
        description: "Fuel entry has been successfully deleted.",
      });
    } catch (err) {
      console.error("Error deleting entry:", err);
      toast({
        title: "Delete failed",
        description: "There was an error deleting the fuel entry. Please try again.",
        variant: "destructive",
      });
    } finally {
      setDeleteInProgress(false);
      closeDeleteDialog();
    }
  };

  if (isLoading) {
    return <div className="p-3 sm:p-4 text-center">Loading entries...</div>;
  }

  if (error) {
    return (
      <div className="p-3 sm:p-4 text-center text-destructive">
        <div className="flex justify-center mb-2">
          <AlertCircle className="h-5 w-5" />
        </div>
        <p>Error loading fuel entries. Please try again later.</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return <div className="p-3 sm:p-4 text-center text-muted-foreground text-sm">No fuel entries found. Add your first entry above.</div>;
  }

  const renderMobileView = () => {
    return (
      <div className="space-y-3 md:hidden">
        {entries.map((entry) => (
          <Card key={entry.id} className="p-3">
            <div className="flex justify-between items-start">
              <div className="flex items-center space-x-1.5 mb-2">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium">{entry.date}</span>
              </div>
              <div className="flex space-x-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(entry.id)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openDeleteDialog(entry.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            
            <div className="flex items-center space-x-1.5 mb-2 text-xs">
              <Car className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{entry.vehicleName}</span>
            </div>
            
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div className="flex items-center space-x-1.5">
                <Droplet className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs">{entry.amount.toFixed(2)} gal</span>
              </div>
              <div className="flex items-center space-x-1.5">
                <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs">${entry.price.toFixed(2)}/gal</span>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground">Total:</span>
                <span className="text-xs font-medium ml-1.5">${entry.total.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground">Odometer:</span>
                <span className="text-xs font-medium ml-1.5">{entry.odometer.toLocaleString()}</span>
              </div>
            </div>
            
            {entry.notes && (
              <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
                {entry.notes}
              </div>
            )}
          </Card>
        ))}
      </div>
    );
  };

  return (
    <div>
      {renderMobileView()}
      
      <div className="overflow-x-auto hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Vehicle</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Odometer</TableHead>
              <TableHead>Fuel Type</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell>{entry.date}</TableCell>
                <TableCell>{entry.vehicleName}</TableCell>
                <TableCell>{entry.amount.toFixed(2)} gal</TableCell>
                <TableCell>${entry.price.toFixed(2)}</TableCell>
                <TableCell>${entry.total.toFixed(2)}</TableCell>
                <TableCell>{entry.odometer.toLocaleString()}</TableCell>
                <TableCell className="capitalize">{entry.fuelType}</TableCell>
                <TableCell className="space-x-2">
                  <Button variant="ghost" size="icon" onClick={() => handleEdit(entry.id)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => openDeleteDialog(entry.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      
      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={closeDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this fuel entry. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteInProgress}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmDelete} 
              className="bg-destructive hover:bg-destructive/90"
              disabled={deleteInProgress}
            >
              {deleteInProgress ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
