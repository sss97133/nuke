import React from "react";

interface LogoProps {
  className?: string;
}

export const NukeLogo: React.FC<LogoProps> = ({ className }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      className={className}
      aria-label="Nuke Logo"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="50" cy="50" r="40" className="fill-primary/10 stroke-primary" />
      <path 
        d="M30 30 L30 70 M30 30 L70 70 M70 30 L70 70" 
        strokeWidth="4"
        className="stroke-primary"
      />
    </svg>
  );
};

export default NukeLogo;
