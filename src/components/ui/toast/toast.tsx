"use client";

import React from 'react';
import { XCircle, CheckCircle, AlertTriangle, Info, X } from 'lucide-react';
import { ToastProps, ToastVariant } from './toast-context';

interface ToastComponentProps extends ToastProps {
  onDismiss: (id: string) => void;
}

// The main Toast component
export function Toast({
  id,
  title,
  description,
  variant = 'default',
  visible,
  onDismiss,
  action
}: ToastComponentProps) {
  // Get styling based on variant
  const getVariantStyles = () => {
    switch (variant) {
      case 'destructive':
        return 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800';
      case 'success':
        return 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800';
      case 'warning':
        return 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800';
      case 'info':
        return 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800';
      default:
        return 'bg-white border-gray-200 dark:bg-gray-800 dark:border-gray-700';
    }
  };

  const getIconColor = () => {
    switch (variant) {
      case 'destructive':
        return 'text-red-500 dark:text-red-400';
      case 'success':
        return 'text-green-500 dark:text-green-400';
      case 'warning':
        return 'text-yellow-500 dark:text-yellow-400';
      case 'info':
        return 'text-blue-500 dark:text-blue-400';
      default:
        return 'text-gray-500 dark:text-gray-400';
    }
  };

  const getIcon = () => {
    switch (variant) {
      case 'destructive':
        return <XCircle className="h-5 w-5" />;
      case 'success':
        return <CheckCircle className="h-5 w-5" />;
      case 'warning':
        return <AlertTriangle className="h-5 w-5" />;
      case 'info':
        return <Info className="h-5 w-5" />;
      default:
        return <Info className="h-5 w-5" />;
    }
  };

  const getTitleColor = () => {
    switch (variant) {
      case 'destructive':
        return 'text-red-800 dark:text-red-300';
      case 'success':
        return 'text-green-800 dark:text-green-300';
      case 'warning':
        return 'text-yellow-800 dark:text-yellow-300';
      case 'info':
        return 'text-blue-800 dark:text-blue-300';
      default:
        return 'text-gray-900 dark:text-gray-100';
    }
  };

  // Get button styling based on variant
  const getActionButtonStyles = () => {
    switch (variant) {
      case 'destructive':
        return 'text-red-600 hover:text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/20';
      case 'success':
        return 'text-green-600 hover:text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/20';
      case 'warning':
        return 'text-yellow-600 hover:text-yellow-700 dark:text-yellow-400 hover:bg-yellow-100 dark:hover:bg-yellow-900/20';
      case 'info':
        return 'text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/20';
      default:
        return 'text-primary hover:text-primary-dark hover:bg-gray-100 dark:hover:bg-gray-700';
    }
  };

  return (
    <div
      className={`
        ${getVariantStyles()}
        rounded-md border p-4 shadow-lg 
        transition-all duration-300 ease-in-out
        ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}
        transform 
      `}
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      <div className="flex items-start">
        <div className={`flex-shrink-0 ${getIconColor()}`}>
          {getIcon()}
        </div>
        <div className="ml-3 flex-1">
          <h3 className={`text-sm font-medium ${getTitleColor()}`}>
            {title}
          </h3>
          {description && (
            <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {description}
            </div>
          )}
          {action && (
            <div className="mt-3">
              <button
                type="button"
                onClick={action.onClick}
                className={`
                  rounded-md text-sm font-medium px-2 py-1
                  ${getActionButtonStyles()}
                `}
              >
                {action.label}
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          className="ml-2 inline-flex text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary"
          onClick={() => onDismiss(id)}
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

// Title component for customization
export function ToastTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-medium">{children}</h3>;
}

// Description component for customization
export function ToastDescription({ children }: { children: React.ReactNode }) {
  return <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">{children}</div>;
}

// Close button component
export function ToastClose({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ml-2 inline-flex text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary"
      aria-label="Close"
    >
      <X className="h-5 w-5" />
    </button>
  );
}

// Empty component that serves as the container area for toasts
export function ToastViewport() {
  return null;
}
