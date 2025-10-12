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
        return `${baseStyles} bg-green-100 border border-green-400 text-green-700`;
      case 'error':
        return `${baseStyles} bg-red-100 border border-red-400 text-red-700`;
      case 'warning':
        return `${baseStyles} bg-yellow-100 border border-yellow-400 text-yellow-700`;
      case 'info':
        return `${baseStyles} bg-blue-100 border border-blue-400 text-blue-700`;
      default:
        return `${baseStyles} bg-gray-100 border border-gray-400 text-gray-700`;
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
          className="ml-2 text-gray-400 hover:text-gray-600 focus:outline-none text-xs"
        >
          ✕
        </button>
      </div>
    </div>
  );
};

export default Toast;
