interface Window {
  ethereum?: {
    isMetaMask?: boolean;
    request: <T>(params: { method: string; params?: unknown[] }) => Promise<T>;
    on: (event: string, callback: (params: unknown[]) => void) => void;
    removeListener: (event: string, callback: (params: unknown[]) => void) => void;
    selectedAddress?: string;
    chainId?: string;
    isConnected?: () => boolean;
  };
}
