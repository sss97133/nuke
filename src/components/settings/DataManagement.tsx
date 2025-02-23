
import { LoggedButton } from "@/components/ui/logged-button";

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
        <LoggedButton 
          variant="outline" 
          onClick={onResetPreferences}
          logId="reset-preferences"
        >
          Reset to Defaults
        </LoggedButton>
        <LoggedButton 
          variant="destructive" 
          onClick={onClearData}
          logId="clear-all-data"
        >
          Clear All Data
        </LoggedButton>
      </div>
    </div>
  );
};

