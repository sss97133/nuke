
import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sliders } from 'lucide-react';

export const EditTab: React.FC = () => {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-center p-10">
          <Sliders className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-xl font-medium mb-2">Video Editor</h3>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            Edit your recorded videos, add overlays, trim content, and prepare for publishing
          </p>
          <div className="flex justify-center gap-4">
            <Button>Open Editor</Button>
            <Button variant="outline">Recent Projects</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
