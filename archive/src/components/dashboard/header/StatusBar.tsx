
import { useEffect, useState } from "react";
import { useNetworkSpeed } from "@/hooks/useNetworkSpeed";
import { ArrowDown, ArrowUp } from "lucide-react";

export const StatusBar = () => {
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());
  const { download, upload } = useNetworkSpeed();

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex items-center gap-2 ml-2">
      <div className="flex items-center gap-1 text-[10px] text-foreground">
        <ArrowDown className="h-3 w-3" />
        <span>{download}Mbps</span>
        <ArrowUp className="h-3 w-3 ml-1" />
        <span>{upload}Mbps</span>
      </div>
      <span className="text-[10px] text-foreground">{currentTime}</span>
    </div>
  );
};
