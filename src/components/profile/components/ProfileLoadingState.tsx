
import React from 'react';
import { Skeleton } from "@/components/ui/skeleton";

export const ProfileLoadingState = () => {
  return (
    <div className="space-y-4">
      <div className="bg-background p-4 border rounded-lg shadow-sm">
        <div className="flex items-start gap-4 mb-6">
          <Skeleton className="h-20 w-20 rounded-full" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-16 w-full mt-4" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-6">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-[200px] w-full" />
      </div>
    </div>
  );
};
