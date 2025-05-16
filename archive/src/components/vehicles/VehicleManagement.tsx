import { useState } from "react";
import { VehicleList } from "@/components/inventory/VehicleList";
import { VehicleForm } from "./VehicleForm";
import { ImportVehicles } from "./import/ImportVehicles";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

const downloadCsvTemplate = () => {
  // Define the CSV headers based on required vehicle fields
  const headers = ["make,model,year,vin,notes"];
  
  // Add an example row to help users understand the format
  const exampleRow = ["Toyota,Camry,2020,1HGCM82633A123456,Regular maintenance up to date"];
  
  // Combine headers and example
  const csvContent = [headers, exampleRow].join('\n');
  
  // Create a Blob with the CSV content
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  
  // Create a download link and trigger it
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', 'vehicle_import_template.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const VehicleManagement = () => {
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-sm font-mono text-[#283845] tracking-tight uppercase">Vehicle Registry</h2>
          <p className="text-xs text-[#666] font-mono mt-1">Asset Documentation System</p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={downloadCsvTemplate}
            variant="outline"
            size="sm"
            className="font-mono text-sm"
          >
            <Download className="w-4 h-4 mr-2" />
            Template CSV
          </Button>
          <ImportVehicles />
          <Button
            onClick={() => setShowForm(!showForm)}
            className="bg-[#283845] hover:bg-[#1a2830] text-white font-mono text-sm"
          >
            {showForm ? "View Registry" : "Register Vehicle"}
          </Button>
        </div>
      </div>

      {showForm ? <VehicleForm /> : <VehicleList />}
    </div>
  );
};