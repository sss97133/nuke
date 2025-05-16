import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Logo } from "@/components/common/Logo";


interface NewAuthLayoutProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  showBranding?: boolean;
  subtitle?: string;
}

export function NewAuthLayout({ 
  title, 
  description, 
  children, 
  footer,
  showBranding = true,
  subtitle = "Everything you need to manage your vehicle in one place."
}: NewAuthLayoutProps) {
  const navigate = useNavigate();
  
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Branding Panel */}
      {showBranding && (
        <div className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white p-8 flex flex-col justify-center items-center md:w-2/5">
          <div className="max-w-md mx-auto text-center">
            <div className="mb-6">
              <Logo size="large" variant="light" />
            </div>
            <h1 className="text-3xl font-bold mb-6">
              {title}
            </h1>
            <p className="text-xl mb-8">
              {subtitle}
            </p>
            <div className="text-sm opacity-80">
              Joined by 12,000+ vehicle owners & businesses
            </div>
            
            {/* Optional background pattern or vehicle imagery */}
            <div className="mt-12 hidden md:block">
              <div className="h-32 w-32 mx-auto bg-white/10 rounded-full"></div>
            </div>
          </div>
        </div>
      )}

      {/* Auth Form Panel */}
      <div className="flex-1 flex justify-center items-center p-4 sm:p-8 bg-background">
        <div className="w-full max-w-md">
          {description && (
            <h2 className="text-2xl font-semibold mb-4 text-center">{description}</h2>
          )}
          {children}
          {footer && <div className="mt-6">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

export default NewAuthLayout;
