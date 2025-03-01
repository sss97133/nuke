
import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

const ErrorState = ({ error }: { error: Error | unknown }) => {
  return (
    <Card className="border-destructive/50">
      <CardContent className="pt-6">
        <div className="flex flex-col items-center justify-center p-6 text-center">
          <AlertCircle className="h-12 w-12 text-destructive mb-4" />
          <h3 className="text-xl font-medium mb-2">Unable to load service history</h3>
          <p className="text-muted-foreground mb-4">
            There was an error fetching your service records. Please try again later.
          </p>
          <p className="text-xs text-muted-foreground border p-2 rounded bg-muted">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

export default ErrorState;
