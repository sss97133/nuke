import React from 'react';
import { Logo } from '@/components/common/Logo';
import { cn } from '@/lib/utils';
import { Shield, Gauge, Database, Car, CheckCircle } from 'lucide-react';

interface ModernAuthLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  className?: string;
}

// We don't need the TrustIndicator component anymore as we've inline the trust mechanisms
// directly in our new vehicle-centric layout

export const ModernAuthLayout: React.FC<ModernAuthLayoutProps> = ({
  children,
  title,
  subtitle,
  className,
}) => {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Vehicle Identity Branding Panel */}
      <div className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white p-8 flex flex-col justify-center items-center md:w-2/5">
        <div className="max-w-md mx-auto text-center">
          <div className="mb-6 text-4xl font-bold">NUKE</div>
          <h1 className="text-3xl font-bold mb-6">
            Vehicle-Centric Digital Identity Platform
          </h1>
          <p className="text-xl mb-8">
            Creating persistent digital identities for vehicles throughout their lifecycle.
          </p>
          
          {/* Vehicle identity trust mechanisms */}
          <div className="mt-10 text-left space-y-6">
            <div className="flex items-start space-x-3">
              <div className="mt-0.5 bg-white/10 p-2 rounded-full">
                <Shield className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-medium">Trust Verification</h3>
                <p className="text-sm opacity-80">Multi-layer verification with blockchain validation</p>
              </div>
            </div>
            
            <div className="flex items-start space-x-3">
              <div className="mt-0.5 bg-white/10 p-2 rounded-full">
                <Gauge className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-medium">Confidence Scoring</h3>
                <p className="text-sm opacity-80">Advanced reliability metrics for all vehicle data</p>
              </div>
            </div>
            
            <div className="flex items-start space-x-3">
              <div className="mt-0.5 bg-white/10 p-2 rounded-full">
                <Database className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-medium">Immutable History</h3>
                <p className="text-sm opacity-80">Complete timeline of verified vehicle events</p>
              </div>
            </div>
          </div>
          
          <div className="text-sm opacity-80 mt-10">
            Trusted by 12,000+ vehicle owners & professionals
          </div>
        </div>
      </div>

      {/* Auth Form Panel */}
      <div className="flex-1 flex justify-center items-center p-4 sm:p-8 bg-background">
        <div className="w-full max-w-md">
          <div className="space-y-2 mb-6">
            <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
            {subtitle && <p className="text-muted-foreground">{subtitle}</p>}
          </div>
          
          {children}
          
          <div className="mt-8 text-center text-sm text-muted-foreground">
            <p>
              By continuing, you agree to Nuke's{' '}
              <a href="/terms" className="text-primary hover:underline">Terms of Service</a>{' '}
              and{' '}
              <a href="/privacy" className="text-primary hover:underline">Privacy Policy</a>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

