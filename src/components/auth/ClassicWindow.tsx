
import { ReactNode, useEffect, useState } from "react";

interface ClassicWindowProps {
  title: string;
  children: ReactNode;
}

export const ClassicWindow = ({ title, children }: ClassicWindowProps) => {
  const [angle, setAngle] = useState(0);
  
  // Only log initial mount in development
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log("ClassicWindow mounted with title:", title);
    }
  }, [title]);

  // Animation effect with requestAnimationFrame for better performance
  useEffect(() => {
    let animationFrameId: number;
    let lastTimestamp = 0;
    
    const animate = (timestamp: number) => {
      // Update approximately every 50ms but without causing excessive rerenders
      if (timestamp - lastTimestamp >= 50) {
        setAngle(prev => (prev + 2) % 360); // Limit to 0-359 to prevent large numbers
        lastTimestamp = timestamp;
      }
      animationFrameId = requestAnimationFrame(animate);
    };
    
    animationFrameId = requestAnimationFrame(animate);
    
    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <div className="bg-secondary dark:bg-secondary-dark border border-border dark:border-border-dark shadow-classic dark:shadow-classic-dark">
      <div className="flex items-center justify-between border-b border-border dark:border-border-dark p-2">
        <div className="flex items-center relative w-[60px] h-[12px]">
          {/* Nucleus (center dot) - Red with glow */}
          <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 w-2 h-2 bg-[#ea384c] rounded-full shadow-[0_0_10px_#ea384c]" />
          
          {/* First electron orbit - Blue with glow */}
          <div 
            className="absolute left-1/2 top-1/2 w-3 h-3"
            style={{
              transform: `translate(-50%, -50%) rotate(${angle}deg)`,
            }}
          >
            <div className="absolute -left-1 -top-1 w-2 h-2 bg-[#0FA0CE] rounded-full shadow-[0_0_10px_#0FA0CE]" />
          </div>

          {/* Second electron orbit - Yellow with glow */}
          <div 
            className="absolute left-1/2 top-1/2 w-4 h-4"
            style={{
              transform: `translate(-50%, -50%) rotate(${-angle * 1.5}deg)`,
            }}
          >
            <div className="absolute -left-1 -top-1 w-2 h-2 bg-[#F97316] rounded-full shadow-[0_0_10px_#F97316]" />
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
