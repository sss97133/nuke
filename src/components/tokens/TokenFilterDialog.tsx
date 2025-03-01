
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface TokenFilterDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  showOnlyActive: boolean;
  setShowOnlyActive: (show: boolean) => void;
}

export const TokenFilterDialog = ({ 
  isOpen, 
  onOpenChange, 
  showOnlyActive, 
  setShowOnlyActive 
}: TokenFilterDialogProps) => {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Filter Tokens</DialogTitle>
          <DialogDescription>
            Customize your token view with filters
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4 space-y-4">
          <div className="flex items-center space-x-2">
            <Switch
              id="active-only"
              checked={showOnlyActive}
              onCheckedChange={setShowOnlyActive}
            />
            <Label htmlFor="active-only">Show active tokens only</Label>
          </div>
        </div>
        
        <DialogFooter>
          <Button 
            variant="secondary" 
            onClick={() => {
              setShowOnlyActive(false);
              onOpenChange(false);
            }}
          >
            Reset
          </Button>
          <Button onClick={() => onOpenChange(false)}>Apply Filters</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
