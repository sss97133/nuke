import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useEffect, useState } from "react";

export const StatusBar = () => {
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex items-center gap-2 ml-2">
      <ThemeToggle />
      <span className="text-[10px] text-foreground">Battery: 100%</span>
      <span className="text-[10px] text-foreground">{currentTime}</span>
    </div>
  );
};