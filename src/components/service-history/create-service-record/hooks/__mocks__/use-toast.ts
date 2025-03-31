/**
 * Mock implementation of the toast hook for service history components
 * This allows for isolated testing and development of service record features
 */

export interface ToastProps {
  title?: string;
  description?: string;
  variant?: 'default' | 'destructive' | 'success';
}

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export const useToast = () => {
  const toast = (props: ToastProps) => {
    console.log('TOAST:', props.title, props.description);
    return { id: 'mock-toast-id' };
  };

  return { toast };
};

// Static methods for global use
export const toast = (props: ToastProps) => {
  console.log('Global toast:', props.title, props.description);
  return { id: 'mock-toast-id' };
};

export const success = (props: Omit<ToastProps, 'variant'>) => {
  return toast({ ...props, variant: 'success' });
};

export const error = (props: Omit<ToastProps, 'variant'>) => {
  return toast({ ...props, variant: 'destructive' });
};

export const warning = (props: ToastProps) => {
  return toast(props);
};

export const info = (props: ToastProps) => {
  return toast(props);
};

export const dismiss = (toastId?: string) => {
  console.log('Dismissing toast:', toastId);
};
