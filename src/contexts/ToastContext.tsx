import React, { createContext, useContext, ReactNode } from 'react';
import { useToast, ToastProps } from '@/hooks/use-toast';
import { ToastContainer } from '@/components/ui/toast';

// Create a context for the toast functions
interface ToastContextType {
  toast: (props: ToastProps) => string;
  success: (props: Omit<ToastProps, 'variant'>) => string;
  error: (props: Omit<ToastProps, 'variant'>) => string;
  warning: (props: Omit<ToastProps, 'variant'>) => string;
  info: (props: Omit<ToastProps, 'variant'>) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

/**
 * ToastProvider component
 * 
 * This component provides toast functionality to the entire app.
 * Wrap your application with this provider to use toast notifications.
 * 
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <ToastProvider>
 *       <YourApp />
 *     </ToastProvider>
 *   );
 * }
 * ```
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { toast, dismiss, toasts, success, error, warning, info } = useToast();

  // The value that will be given to the context
  const contextValue: ToastContextType = {
    toast,
    success,
    error,
    warning,
    info,
    dismiss
  };

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/**
 * useToastContext hook
 * 
 * This hook allows you to use toast notifications in your components.
 * It must be used within a component that is a child of ToastProvider.
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { toast, success, error } = useToastContext();
 *   
 *   const handleClick = () => {
 *     success({ title: 'Operation successful!' });
 *   };
 *   
 *   return <button onClick={handleClick}>Click me</button>;
 * }
 * ```
 */
export function useToastContext(): ToastContextType {
  const context = useContext(ToastContext);
  
  if (context === undefined) {
    throw new Error('useToastContext must be used within a ToastProvider');
  }
  
  return context;
}
