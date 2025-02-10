
import { ReactNode, useEffect, useState } from "react";

interface ClassicWindowProps {
  title: string;
  children: ReactNode;
}

export const ClassicWindow = ({ title, children }: ClassicWindowProps) => {
  const [angle, setAngle] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setAngle((prev) => (prev + 2) % 360);
    }, 50);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-secondary dark:bg-secondary-dark border border-border dark:border-border-dark shadow-classic dark:shadow-classic-dark">
      <div className="flex items-center justify-between border-b border-border dark:border-border-dark p-2">
        <div className="flex items-center relative w-[60px] h-[12px]">
          {/* Nucleus (center dot) */}
          <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 w-2 h-2 bg-destructive rounded-full" />
          
          {/* First electron orbit */}
          <div 
            className="absolute left-1/2 top-1/2 w-3 h-3"
            style={{
              transform: `translate(-50%, -50%) rotate(${angle}deg)`,
            }}
          >
            <div className="absolute -left-1 -top-1 w-2 h-2 bg-accent rounded-full" />
          </div>

          {/* Second electron orbit */}
          <div 
            className="absolute left-1/2 top-1/2 w-4 h-4"
            style={{
              transform: `translate(-50%, -50%) rotate(${-angle * 1.5}deg)`,
            }}
          >
            <div className="absolute -left-1 -top-1 w-2 h-2 bg-muted rounded-full" />
          </div>
        </div>
        <div className="text-center text-sm font-system">{title}</div>
        <div className="w-12" />
      </div>
      <div className="p-6">
        {children}
      </div>
    </div>
  );
};
