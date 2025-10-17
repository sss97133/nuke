import React from 'react';

interface BlueGlowIconProps {
  size?: number;
  style?: React.CSSProperties;
  className?: string;
}

const BlueGlowIcon: React.FC<BlueGlowIconProps> = ({ 
  size = 16, 
  style = {}, 
  className = '' 
}) => {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 32 32" 
      xmlns="http://www.w3.org/2000/svg"
      style={style}
      className={className}
    >
      <defs>
        <radialGradient id="blueGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" style={{stopColor:'#3b82f6',stopOpacity:1}} />
          <stop offset="70%" style={{stopColor:'#1d4ed8',stopOpacity:0.8}} />
          <stop offset="100%" style={{stopColor:'#1e3a8a',stopOpacity:0.4}} />
        </radialGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
          <feMerge> 
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      <circle cx="16" cy="16" r="12" fill="url(#blueGlow)" filter="url(#glow)"/>
      <circle cx="16" cy="16" r="8" fill="#3b82f6" opacity="0.9"/>
      <circle cx="16" cy="16" r="4" fill="#60a5fa" opacity="0.8"/>
    </svg>
  );
};

export default BlueGlowIcon;


