import { createContext } from 'react';

export interface ToastContextType {
  toast: (message: { title: string; description?: string; variant?: 'default' | 'destructive' }) => void;
}

export const ToastContext = createContext<ToastContextType>({
  toast: ({ title }) => console.log('Toast:', title)
});
