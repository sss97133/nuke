"use client";

import React from "react";
import { useToast } from "./toast-context";
import { Toast } from "./toast";

export function Toaster() {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-0 right-0 z-50 p-4 max-w-sm space-y-4 w-full sm:w-auto">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          {...toast}
          onDismiss={dismiss}
        />
      ))}
    </div>
  );
}
