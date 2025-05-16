
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from '@/components/ui/skeleton';

const LoadingState = () => {
  return (
    <Card className="border-2 hover:border-primary/20 transition-all duration-300">
      <CardHeader>
        <CardTitle>Portfolio Statistics</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-24 rounded-md pulse" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default LoadingState;
