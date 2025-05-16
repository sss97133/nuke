import { useState, useEffect } from 'react';

interface NetworkSpeed {
  download: number;
  upload: number;
}

interface NetworkInformation extends EventTarget {
  readonly connection: {
    readonly effectiveType: string;
    readonly rtt: number;
    readonly downlink: number;
    readonly saveData: boolean;
  };
}

export const useNetworkSpeed = () => {
  const [speeds, setSpeeds] = useState<NetworkSpeed>({ download: 0, upload: 0 });

  useEffect(() => {
    const updateSpeeds = async () => {
      if ('connection' in navigator && (navigator as NetworkInformation).connection) {
        const connection = (navigator as NetworkInformation).connection;
        // Convert to Mbps
        const downloadSpeed = connection.downlink;
        // Estimate upload speed as 1/3 of download (common ratio)
        const uploadSpeed = downloadSpeed / 3;
        
        setSpeeds({
          download: Math.round(downloadSpeed * 10) / 10,
          upload: Math.round(uploadSpeed * 10) / 10
        });
      }
    };

    updateSpeeds();
    const interval = setInterval(updateSpeeds, 1000);

    return () => clearInterval(interval);
  }, []);

  return speeds;
};