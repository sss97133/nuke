import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BookOpen, Library } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

export const ResourceCurator = () => {
  const { toast } = useToast();

  const handleCurate = () => {
    toast({
      title: "Resource Curation",
      description: "Finding personalized learning resources...",
    });
  };

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Learning Resource Curator</CardTitle>
        <BookOpen className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Discover curated learning resources tailored to your goals.
          </p>
          <Button 
            onClick={handleCurate}
            className="w-full"
            variant="outline"
          >
            <Library className="mr-2 h-4 w-4" />
            Find Resources
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};