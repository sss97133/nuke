
export type ToastVariant = "default" | "destructive" | "success";

export interface ToastOptions {
  title?: string;
  description?: string;
  variant?: ToastVariant;
}

// Define a type for the toast function
export type ToastFunction = (options: ToastOptions | string) => void;
