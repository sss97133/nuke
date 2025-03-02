
import React from 'react';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Volume2, Play } from "lucide-react";

const OutputTab = () => {
  return (
    <Card className="border overflow-hidden">
      <div className="aspect-video relative bg-black rounded-md overflow-hidden">
        <img 
          src="/lovable-uploads/4b9269d1-9638-4eb3-8139-c63f53e73d75.png" 
          alt="IEEE Floating Point Visualization" 
          className="w-full h-full object-contain"
        />
        <div className="absolute bottom-4 right-4 flex gap-2">
          <Button size="icon" variant="secondary" className="rounded-full h-10 w-10 bg-black/70 backdrop-blur">
            <Volume2 className="h-5 w-5" />
          </Button>
          <Button size="icon" variant="secondary" className="rounded-full h-10 w-10 bg-black/70 backdrop-blur">
            <Play className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </Card>
  );
};

export default OutputTab;
