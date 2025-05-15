import React from 'react';
import { Logo } from '@/components/common/Logo';

interface ModernAuthLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}

export const ModernAuthLayout: React.FC<ModernAuthLayoutProps> = ({
  children,
  title,
  subtitle
}) => {
  return (
    <div className="min-h-screen w-full flex flex-col md:flex-row">
      {/* Brand section - left side on desktop, top on mobile */}
      <div className="bg-gradient-to-br from-blue-600 to-indigo-800 md:w-1/2 py-8 px-6 md:p-12 flex flex-col">
        <div className="mb-8 flex items-center">
          <Logo size="large" variant="light" />
        </div>
        
        <div className="hidden md:flex flex-col justify-center flex-grow">
          <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-6">
            Vehicle-centric digital identity platform
          </h1>
          <p className="text-blue-100 text-lg md:text-xl max-w-md">
            The complete solution for vehicle history, ownership, and management in the digital age.
          </p>
          
          <div className="mt-12">
            <div className="flex items-center space-x-4">
              <div className="flex -space-x-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="w-10 h-10 rounded-full border-2 border-white bg-blue-400 flex items-center justify-center text-white font-medium">
                    {['JD', 'SK', 'MR'][i-1]}
                  </div>
                ))}
              </div>
              <p className="text-blue-100">
                Joined by 2,000+ vehicle owners &amp; businesses
              </p>
            </div>
          </div>
        </div>
      </div>
      
      {/* Auth form section - right side on desktop, bottom on mobile */}
      <div className="md:w-1/2 p-6 md:p-12 lg:p-16 flex items-center justify-center bg-white">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900">{title}</h2>
            {subtitle && <p className="text-gray-600 mt-2">{subtitle}</p>}
          </div>
          
          {children}
          
          <div className="mt-8 text-center text-sm text-gray-500">
            <p>
              By continuing, you agree to Nuke's{' '}
              <a href="#" className="text-blue-600 hover:underline">Terms of Service</a>{' '}
              and{' '}
              <a href="#" className="text-blue-600 hover:underline">Privacy Policy</a>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
