
import { useState, useEffect } from 'react';
import { Wifi, WifiOff } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

export function NetworkStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [hasShownOfflineToast, setHasShownOfflineToast] = useState(false);
  const [hasShownOnlineToast, setHasShownOnlineToast] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      
      // Show online toast only if we previously showed an offline toast
      if (hasShownOfflineToast && !hasShownOnlineToast) {
        toast({
          title: "Back Online",
          description: "Your connection has been restored.",
          variant: "default",
        });
        setHasShownOnlineToast(true);
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      
      // Show offline toast only once
      if (!hasShownOfflineToast) {
        toast({
          title: "You are offline",
          description: "Some features may be limited until connection is restored.",
          variant: "destructive",
          duration: 5000,
        });
        setHasShownOfflineToast(true);
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [hasShownOfflineToast, hasShownOnlineToast, toast]);

  // Don't show anything if online
  if (isOnline) return null;

  // Show offline indicator
  return (
    <div className="fixed bottom-4 right-4 bg-destructive text-destructive-foreground p-2 rounded-full shadow-lg animate-pulse z-50">
      <WifiOff size={16} />
    </div>
  );
}
