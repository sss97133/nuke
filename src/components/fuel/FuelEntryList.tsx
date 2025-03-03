
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pencil, Trash2, Calendar, DropletFilled, DollarSign, Car } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface FuelEntry {
  id: string;
  date: string;
  vehicleName: string;
  amount: number;
  price: number;
  total: number;
  odometer: number;
  fuelType: string;
}

export const FuelEntryList = ({ refreshTrigger }: { refreshTrigger: number }) => {
  const [entries, setEntries] = useState<FuelEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchEntries = async () => {
      setLoading(true);
      try {
        // This would normally fetch from Supabase
        // For now, let's use mock data
        const mockEntries: FuelEntry[] = [
          {
            id: "1",
            date: "2023-09-15",
            vehicleName: "2019 Toyota Camry",
            amount: 12.5,
            price: 3.49,
            total: 43.63,
            odometer: 45230,
            fuelType: "regular"
          },
          {
            id: "2",
            date: "2023-09-02",
            vehicleName: "2019 Toyota Camry",
            amount: 11.2,
            price: 3.59,
            total: 40.21,
            odometer: 44950,
            fuelType: "regular"
          }
        ];
        
        setEntries(mockEntries);
      } catch (error) {
        console.error("Error fetching fuel entries:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchEntries();
  }, [refreshTrigger]);

  const handleEdit = (id: string) => {
    // Would open edit form in a real implementation
    console.log(`Edit entry ${id}`);
  };

  const handleDelete = (id: string) => {
    // Would delete entry in a real implementation
    console.log(`Delete entry ${id}`);
  };

  if (loading) {
    return <div className="p-4 text-center">Loading entries...</div>;
  }

  if (entries.length === 0) {
    return <div className="p-4 text-center text-muted-foreground">No fuel entries found. Add your first entry above.</div>;
  }

  // For mobile view, we'll show cards instead of a table
  const renderMobileView = () => {
    return (
      <div className="space-y-4 md:hidden">
        {entries.map((entry) => (
          <Card key={entry.id} className="p-4">
            <div className="flex justify-between items-start">
              <div className="flex items-center space-x-2 mb-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{entry.date}</span>
              </div>
              <div className="flex space-x-1">
                <Button variant="ghost" size="icon" onClick={() => handleEdit(entry.id)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => handleDelete(entry.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            
            <div className="flex items-center space-x-2 mb-2 text-sm">
              <Car className="h-4 w-4 text-muted-foreground" />
              <span>{entry.vehicleName}</span>
            </div>
            
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div className="flex items-center space-x-2">
                <DropletFilled className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{entry.amount.toFixed(2)} gal</span>
              </div>
              <div className="flex items-center space-x-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">${entry.price.toFixed(2)}/gal</span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Total:</span>
                <span className="text-sm font-medium ml-2">${entry.total.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Odometer:</span>
                <span className="text-sm font-medium ml-2">{entry.odometer.toLocaleString()}</span>
              </div>
            </div>
          </Card>
        ))}
      </div>
    );
  };

  // For desktop view, we'll show the table
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
                <TableCell className="space-x-2">
                  <Button variant="ghost" size="icon" onClick={() => handleEdit(entry.id)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(entry.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
