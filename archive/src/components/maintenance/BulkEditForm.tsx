
import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { MaintenanceItem } from "@/components/maintenance/types";

interface BulkEditFormProps {
  isOpen: boolean;
  onClose: () => void;
  items: MaintenanceItem[];
  onUpdate: (items: MaintenanceItem[]) => void;
}

const BulkEditForm: React.FC<BulkEditFormProps> = ({
  isOpen,
  onClose,
  items,
  onUpdate
}) => {
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [editedItems, setEditedItems] = useState<MaintenanceItem[]>(items);
  const [selectAll, setSelectAll] = useState(false);
  
  // Handle select all checkbox
  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedItems([]);
    } else {
      setSelectedItems(items.map(item => item.id));
    }
    setSelectAll(!selectAll);
  };

  // Toggle individual item selection
  const toggleItemSelection = (id: string) => {
    setSelectedItems(prev => 
      prev.includes(id) 
        ? prev.filter(itemId => itemId !== id)
        : [...prev, id]
    );
  };

  // Handle field updates
  const updateItemField = (id: string, field: keyof MaintenanceItem, value: string) => {
    setEditedItems(prev => 
      prev.map(item => 
        item.id === id 
          ? { ...item, [field]: value }
          : item
      )
    );
  };

  // Handle bulk update for selected items
  const bulkUpdateField = (field: keyof MaintenanceItem, value: string) => {
    if (value && selectedItems.length > 0) {
      setEditedItems(prev => 
        prev.map(item => 
          selectedItems.includes(item.id)
            ? { ...item, [field]: value }
            : item
        )
      );
    }
  };

  // Handle save
  const handleSave = () => {
    onUpdate(editedItems);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Edit Maintenance Tasks</DialogTitle>
        </DialogHeader>

        <div className="py-4">
          {/* Bulk update controls */}
          <div className="flex items-center gap-4 mb-4 p-2 bg-muted/50 rounded-md">
            <div className="flex-1">
              <span className="text-sm font-medium">Bulk update {selectedItems.length} selected items:</span>
            </div>
            
            <div className="flex items-center gap-2">
              <Select onValueChange={(value) => bulkUpdateField('status', value)}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Update status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="upcoming">Upcoming</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                </SelectContent>
              </Select>
              
              <Input 
                placeholder="Update date"
                type="date"
                className="w-40"
                onChange={(e) => bulkUpdateField('date', e.target.value)}
              />
            </div>
          </div>

          {/* Table of items */}
          <div className="border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox 
                      checked={selectAll} 
                      onCheckedChange={handleSelectAll} 
                    />
                  </TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {editedItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Checkbox 
                        checked={selectedItems.includes(item.id)}
                        onCheckedChange={() => toggleItemSelection(item.id)}
                      />
                    </TableCell>
                    <TableCell>
                      <Input 
                        value={item.title} 
                        onChange={(e) => updateItemField(item.id, 'title', e.target.value)}
                      />
                    </TableCell>
                    <TableCell>
                      <Input 
                        value={item.vehicle} 
                        onChange={(e) => updateItemField(item.id, 'vehicle', e.target.value)}
                      />
                    </TableCell>
                    <TableCell>
                      <Input 
                        type="date"
                        value={new Date(item.date).toISOString().split('T')[0]}
                        onChange={(e) => updateItemField(item.id, 'date', e.target.value)}
                      />
                    </TableCell>
                    <TableCell>
                      <Select 
                        value={item.status}
                        onValueChange={(value: "upcoming" | "completed" | "overdue") => 
                          updateItemField(item.id, 'status', value)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="upcoming">Upcoming</SelectItem>
                          <SelectItem value="completed">Completed</SelectItem>
                          <SelectItem value="overdue">Overdue</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BulkEditForm;
