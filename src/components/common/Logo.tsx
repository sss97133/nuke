import React from 'react';

interface LogoProps {
  size?: 'small' | 'medium' | 'large';
  variant?: 'light' | 'dark';
}

export const Logo: React.FC<LogoProps> = ({
  size = 'medium',
  variant = 'dark'
}) => {
  const textSizeClasses = {
    small: 'text-xl font-bold',
    medium: 'text-2xl font-bold',
    large: 'text-3xl font-bold',
  };
  
  const textColorClasses = {
    light: 'text-white',
    dark: 'text-gray-900',
  };
  
  const iconSizeClasses = {
    small: 'w-6 h-6',
    medium: 'w-8 h-8',
    large: 'w-10 h-10',
  };

  return (
    <div className="flex items-center space-x-2">
      <div className={`relative ${iconSizeClasses[size]}`}>
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full"></div>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`${variant === 'light' ? 'text-white' : 'text-white'} font-bold`}>
            N
          </span>
        </div>
      </div>
      <span className={`${textSizeClasses[size]} ${textColorClasses[variant]}`}>
        Nuke
      </span>
    </div>
  );
};
