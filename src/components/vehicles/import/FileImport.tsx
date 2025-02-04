import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { Vehicle } from "@/types/inventory";
import { Loader2 } from "lucide-react";

interface FileImportProps {
  onNormalizedData: (vehicles: Vehicle[]) => void;
}

export const FileImport = ({ onNormalizedData }: FileImportProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    try {
      const fileType = file.name.split('.').pop()?.toLowerCase();
      const allowedTypes = ['csv', 'xlsx', 'xls', 'numbers', 'pdf'];
      
      if (!fileType || !allowedTypes.includes(fileType)) {
        throw new Error('Unsupported file type. Please use CSV, Excel, Numbers, or PDF files.');
      }

      const reader = new FileReader();
      reader.onload = async (e) => {
        const content = e.target?.result;
        
        const { data, error } = await supabase.functions.invoke('process-vehicle-import', {
          body: { data: content, fileType }
        });

        if (error) throw error;
        
        onNormalizedData(data.vehicles);
      };

      if (fileType === 'pdf') {
        reader.readAsArrayBuffer(file);
      } else {
        reader.readAsText(file);
      }
    } catch (error: any) {
      toast({
        title: "Import Error",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <div className="text-sm text-muted-foreground">
        Supported formats: CSV, Excel, Numbers, PDF
      </div>
      
      <div className="flex items-center gap-4">
        <Input
          type="file"
          accept=".csv,.xlsx,.xls,.numbers,.pdf"
          onChange={handleFileChange}
          disabled={isLoading}
        />
        
        {isLoading && (
          <Loader2 className="h-4 w-4 animate-spin" />
        )}
      </div>
    </div>
  );
};