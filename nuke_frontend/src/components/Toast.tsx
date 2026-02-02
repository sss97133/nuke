import React, { useEffect, useState } from 'react';

interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  duration?: number;
  onClose: () => void;
}

const Toast: React.FC<ToastProps> = ({ message, type, duration = 5000, onClose }) => {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onClose, 300); // Allow fade out animation
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const getToastStyles = () => {
    const baseStyles = "fixed top-4 right-4 z-[9999] p-2 rounded shadow-md max-w-xs transition-all duration-300";
    
    switch (type) {
      case 'success':
        return `${baseStyles} bg-green-100 dark:bg-green-900/50 border border-green-400 dark:border-green-600 text-green-700 dark:text-green-300`;
      case 'error':
        return `${baseStyles} bg-red-100 dark:bg-red-900/50 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-300`;
      case 'warning':
        return `${baseStyles} bg-yellow-100 dark:bg-yellow-900/50 border border-yellow-400 dark:border-yellow-600 text-yellow-700 dark:text-yellow-300`;
      case 'info':
        return `${baseStyles} bg-blue-100 dark:bg-blue-900/50 border border-blue-400 dark:border-blue-600 text-blue-700 dark:text-blue-300`;
      default:
        return `${baseStyles} bg-gray-100 dark:bg-gray-800 border border-gray-400 dark:border-gray-600 text-gray-700 dark:text-gray-300`;
    }
  };

  const getIcon = () => {
    switch (type) {
      case 'success':
        return '✓';
      case 'error':
        return '✕';
      case 'warning':
        return '⚠';
      case 'info':
        return 'ℹ';
      default:
        return '';
    }
  };

  return (
    <div 
      className={`${getToastStyles()} ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <span className="mr-1 text-xs">{getIcon()}</span>
          <span className="text-xs">{message}</span>
        </div>
        <button
          onClick={() => {
            setIsVisible(false);
            setTimeout(onClose, 300);
          }}
          className="ml-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 focus:outline-none text-xs"
        >
          ✕
        </button>
      </div>
    </div>
  );
};

export default Toast;
