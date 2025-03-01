
interface Window {
  ethereum?: {
    isMetaMask?: boolean;
    request: (request: { method: string; params?: any[] }) => Promise<any>;
    on: (eventName: string, callback: any) => void;
    removeListener: (eventName: string, callback: any) => void;
    selectedAddress?: string;
    chainId?: string;
    isConnected?: () => boolean;
  };
}
