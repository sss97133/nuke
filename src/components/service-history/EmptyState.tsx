
import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Wrench } from "lucide-react";

const EmptyState = () => {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-col items-center justify-center p-6 text-center">
          <Wrench className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-xl font-medium mb-2">No service records found</h3>
          <p className="text-muted-foreground">
            You don't have any service records yet. When you create service tickets, they will appear here.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

export default EmptyState;
