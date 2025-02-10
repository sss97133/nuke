
import { Button } from "@/components/ui/button";

interface DataManagementProps {
  onResetPreferences: () => void;
  onClearData: () => void;
}

export const DataManagement = ({
  onResetPreferences,
  onClearData,
}: DataManagementProps) => {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Data Management</h2>
      <div className="space-x-4">
        <Button variant="outline" onClick={onResetPreferences}>
          Reset to Defaults
        </Button>
        <Button variant="destructive" onClick={onClearData}>
          Clear All Data
        </Button>
      </div>
    </div>
  );
};
