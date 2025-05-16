import { useEffect, useState } from "react";
import { getSystemMetrics, type SystemMetrics } from "@/utils/systemMetrics";

export const SystemStatus = () => {
  const [metrics, setMetrics] = useState<SystemMetrics>({
    connectionStatus: 'INACTIVE',
    latency: 0,
    uptime: 0
  });

  useEffect(() => {
    const updateMetrics = async () => {
      const newMetrics = await getSystemMetrics();
      setMetrics(newMetrics);
    };

    // Initial update
    updateMetrics();

    // Update metrics every 10 seconds
    const interval = setInterval(updateMetrics, 10000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="border border-gov-blue p-2">
      <div className="text-tiny text-[#666] border-b border-gov-blue pb-1 mb-1">
        SYS_STATUS
      </div>
      <div className="grid grid-cols-2 gap-1 text-tiny">
        <span>CONN:</span>
        <span className={metrics.connectionStatus === 'ACTIVE' ? 'text-green-600' : 'text-red-600'}>
          {metrics.connectionStatus}
        </span>
        <span>LATENCY:</span>
        <span>{metrics.latency}ms</span>
        <span>UPTIME:</span>
        <span>{metrics.uptime}%</span>
      </div>
    </div>
  );
};