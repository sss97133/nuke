
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PartItem } from './types';
import { Package, Box } from 'lucide-react';

interface PartsDetailsProps {
  parts: PartItem[];
}

const PartsDetails: React.FC<PartsDetailsProps> = ({ parts }) => {
  if (!parts || parts.length === 0) {
    return (
      <Card className="w-full mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Package className="h-5 w-5 text-muted-foreground" />
            Parts Used
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">No parts were used in this service record.</p>
        </CardContent>
      </Card>
    );
  }

  const totalCost = parts.reduce((sum, part) => sum + (part.cost * part.quantity), 0);

  return (
    <Card className="w-full mt-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Box className="h-5 w-5 text-muted-foreground" />
          Parts Used ({parts.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Part Name</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">Unit Price</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {parts.map((part, index) => (
              <TableRow key={index}>
                <TableCell className="font-medium">{part.name}</TableCell>
                <TableCell className="text-right">{part.quantity}</TableCell>
                <TableCell className="text-right">${part.cost.toFixed(2)}</TableCell>
                <TableCell className="text-right">${(part.cost * part.quantity).toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableRow className="border-t border-t-primary/20">
            <TableCell colSpan={3} className="text-right font-medium">Total Cost:</TableCell>
            <TableCell className="text-right font-bold">${totalCost.toFixed(2)}</TableCell>
          </TableRow>
        </Table>
      </CardContent>
    </Card>
  );
};

export default PartsDetails;
