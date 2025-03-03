
import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Info } from "lucide-react";
import { MaintenanceItem } from "@/components/maintenance/types";

interface BulkEntryFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (items: MaintenanceItem[]) => void;
}

const BulkEntryForm: React.FC<BulkEntryFormProps> = ({
  isOpen,
  onClose,
  onSubmit
}) => {
  const [bulkText, setBulkText] = useState('');
  const [separator, setSeparator] = useState(',');
  const [duplicates, setDuplicates] = useState<MaintenanceItem[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsedItems, setParsedItems] = useState<MaintenanceItem[]>([]);

  const handleParse = () => {
    setParseError(null);
    setDuplicates([]);
    
    if (!bulkText.trim()) {
      setParseError('Please enter some data');
      return;
    }

    try {
      // Split by newlines to get rows
      const rows = bulkText.split('\n').filter(row => row.trim().length > 0);
      
      const items: MaintenanceItem[] = [];
      const foundTitles = new Set<string>();
      const newDuplicates: MaintenanceItem[] = [];

      rows.forEach((row, index) => {
        // Split row by separator
        const parts = row.split(separator).map(part => part.trim());
        
        // Require at least a title and vehicle
        if (parts.length < 2) {
          throw new Error(`Row ${index + 1} doesn't have enough data (need at least title and vehicle)`);
        }

        const [title, vehicle] = parts;
        const date = parts[2] || new Date().toLocaleDateString();
        const status = parts[3]?.toLowerCase() as "upcoming" | "completed" | "overdue" || "upcoming";
        
        // Check for duplicates based on title and vehicle
        const key = `${title.toLowerCase()}-${vehicle.toLowerCase()}`;
        if (foundTitles.has(key)) {
          const duplicate = {
            title,
            vehicle,
            date,
            status,
            id: Math.random().toString(36).substring(2, 11)
          };
          newDuplicates.push(duplicate);
        } else {
          foundTitles.add(key);
          items.push({
            title,
            vehicle, 
            date,
            status,
            id: Math.random().toString(36).substring(2, 11)
          });
        }
      });

      setParsedItems(items);
      setDuplicates(newDuplicates);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : 'Failed to parse input');
    }
  };

  const handleSubmit = () => {
    onSubmit(parsedItems);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Create Maintenance Tasks</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="separator">Field Separator</Label>
              <Input 
                id="separator" 
                value={separator} 
                onChange={e => setSeparator(e.target.value)}
                placeholder="," 
                className="w-20"
              />
            </div>
            <Button onClick={handleParse} type="button">Parse Data</Button>
          </div>
          
          <div>
            <Label htmlFor="bulk-text">
              Enter data in format: Title, Vehicle, Date (optional), Status (optional)
            </Label>
            <Textarea
              id="bulk-text"
              value={bulkText}
              onChange={e => setBulkText(e.target.value)}
              placeholder="Oil Change, 2018 Honda Civic, 10/15/2023, upcoming
Tire Rotation, 2018 Honda Civic, 10/22/2023
Brake Inspection, 2020 Toyota RAV4, 11/5/2023"
              className="h-40"
            />
          </div>

          {parseError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{parseError}</AlertDescription>
            </Alert>
          )}

          {duplicates.length > 0 && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                Found {duplicates.length} duplicate entries that will be skipped.
                {duplicates.map((dupe, i) => (
                  <div key={i} className="text-xs mt-1">
                    • {dupe.title} for {dupe.vehicle}
                  </div>
                ))}
              </AlertDescription>
            </Alert>
          )}

          {parsedItems.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2">Preview ({parsedItems.length} items):</h3>
              <div className="border rounded-md p-2 max-h-40 overflow-y-auto">
                {parsedItems.map((item, i) => (
                  <div key={i} className="text-xs py-1 border-b last:border-0">
                    <strong>{item.title}</strong> • {item.vehicle} • {item.date} • {item.status}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={parsedItems.length === 0}
          >
            Create {parsedItems.length} Tasks
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BulkEntryForm;
