
import React from 'react';
import { CarouselPrevious, CarouselNext } from "@/components/ui/carousel";
import { type CarouselApi } from "@/components/ui/carousel";

interface CarouselNavigationProps {
  steps: any[];
  current: number;
  api: CarouselApi | null;
}

export const CarouselNavigation: React.FC<CarouselNavigationProps> = ({ 
  steps, 
  current, 
  api 
}) => {
  return (
    <div className="flex justify-center mt-8">
      <CarouselPrevious className="relative inline-flex static mr-2" />
      <div className="px-4 py-2 flex items-center gap-1">
        {steps.map((_, i) => (
          <button
            key={i}
            className={`h-2 w-2 rounded-full transition-colors ${
              current === i ? 'bg-primary' : 'bg-muted'
            }`}
            onClick={() => api?.scrollTo(i)}
            aria-label={`Go to step ${i + 1}`}
          />
        ))}
      </div>
      <CarouselNext className="relative inline-flex static ml-2" />
    </div>
  );
};
