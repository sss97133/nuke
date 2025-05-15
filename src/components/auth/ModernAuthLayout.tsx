import React from 'react';
import { Logo } from '@/components/common/Logo';
import { tokens } from '@/styles/design-tokens';
import { cn } from '@/lib/utils';
import { Shield, Key, Fingerprint, CheckCircle2, LockKeyhole } from 'lucide-react';

interface ModernAuthLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  className?: string;
}

type TrustIndicatorProps = {
  level: 'blockchain' | 'professional' | 'physical' | 'smart';
  title: string;
  description: string;
};

const TrustIndicator: React.FC<TrustIndicatorProps> = ({ level, title, description }) => {
  const getIcon = () => {
    switch (level) {
      case 'blockchain':
        return <Shield className="h-6 w-6 text-emerald-500" />;
      case 'professional':
        return <CheckCircle2 className="h-6 w-6 text-blue-500" />;
      case 'physical':
        return <Fingerprint className="h-6 w-6 text-purple-500" />;
      case 'smart':
        return <Key className="h-6 w-6 text-amber-500" />;
      default:
        return <LockKeyhole className="h-6 w-6 text-gray-500" />;
    }
  };

  return (
    <div className="flex items-start space-x-3 mb-4">
      <div className="mt-0.5 bg-white/10 p-2 rounded-full">
        {getIcon()}
      </div>
      <div>
        <h3 className="font-medium text-white">{title}</h3>
        <p className="text-sm text-neutral-300">{description}</p>
      </div>
    </div>
  );
};

export const ModernAuthLayout: React.FC<ModernAuthLayoutProps> = ({
  children,
  title,
  subtitle,
  className,
}) => {
  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5">
      {/* Vehicle Trust Mechanisms section */}
      <div className="hidden md:block md:col-span-1 lg:col-span-2 bg-gradient-to-b from-neutral-900 to-neutral-800 text-white p-8 relative overflow-hidden">
        <div className="absolute inset-0 opacity-20">
          <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
                <path d="M 10 0 L 0 0 0 10" fill="none" stroke="currentColor" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="100" height="100" fill="url(#grid)" />
          </svg>
        </div>
        
        <div className="flex flex-col h-full relative z-10">
          <div>
            <Logo variant="light" />
          </div>
          
          <div className="my-12">
            <div className="inline-block px-4 py-2 rounded-full bg-white/10 text-white text-sm font-medium mb-4">
              Vehicle-Centric Trust System
            </div>
            
            <h2 className="text-2xl font-bold mb-8">
              Digital Vehicle Identity with <span className="text-emerald-400">Multi-Layer Verification</span>
            </h2>
            
            <div className="mt-8 space-y-6">
              <TrustIndicator 
                level="blockchain"
                title="Immutable Record-Keeping"
                description="Blockchain-verified history ensures tamper-proof vehicle records"
              />
              
              <TrustIndicator 
                level="professional"
                title="Professional Verification"
                description="Certified mechanics and specialists validate vehicle information"
              />
              
              <TrustIndicator 
                level="physical"
                title="Physical Validation"
                description="PTZ centers verify physical attributes and condition"
              />
              
              <TrustIndicator 
                level="smart"
                title="Smart Ownership Management"
                description="Secure transfer and fractional ownership capabilities"
              />
            </div>
          </div>
          
          <div className="mt-auto mb-8">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
              <p className="text-sm text-neutral-300">
                Secure authentication is the gateway to your vehicle's digital identity
              </p>
            </div>
          </div>
        </div>
      </div>
      
      {/* Form section */}
      <div className={cn("flex flex-col justify-center p-4 md:p-8 lg:p-12 col-span-1 md:col-span-1 lg:col-span-3", className)}>
        <div className="md:hidden mb-8">
          <Logo variant="dark" />
          <div className="mt-4 p-4 bg-neutral-50 dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700">
            <h3 className="text-sm font-medium">Vehicle-Centric Platform</h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
              Secure authentication for your vehicle's digital identity management
            </p>
          </div>
        </div>
        
        <div className="w-full max-w-md mx-auto space-y-6">
          <div className="space-y-2 text-center md:text-left">
            <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
            {subtitle && <p className="text-neutral-500 dark:text-neutral-400">{subtitle}</p>}
          </div>
          
          {children}
          
          <div className="mt-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
            <p>
              By continuing, you agree to Nuke's{' '}
              <a href="#" className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 hover:underline">Terms of Service</a>{' '}
              and{' '}
              <a href="#" className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 hover:underline">Privacy Policy</a>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

