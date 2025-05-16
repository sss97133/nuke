import React from 'react';
import { cn } from '@/lib/utils';
import { tokens } from '@/styles/design-tokens';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button-system';
import { Link } from 'react-router-dom';
import { useUserStore } from '@/stores/userStore';
import { TrustIndicator } from './trust-indicator';

export interface VehicleCardProps {
  id: string;
  vin?: string;
  make: string;
  model: string;
  year: number;
  imageUrl?: string;
  ownershipStatus?: 'owned' | 'watching' | 'discovered';
  verificationLevel?: keyof typeof tokens.verificationLevels;
  trustScore?: number;
  tokenized?: boolean;
  recentEvent?: {
    date: string;
    description: string;
    type: 'maintenance' | 'ownership' | 'documentation' | 'market' | 'other';
  };
  className?: string;
}

/**
 * Modern Vehicle Card Component
 * 
 * This component is designed to showcase vehicles as first-class digital entities,
 * with clear visual hierarchy, verification indicators, and contextual actions.
 * It follows modern UI principles while emphasizing the vehicle's digital identity.
 */
export function VehicleCard({
  id,
  vin,
  make,
  model,
  year,
  imageUrl,
  ownershipStatus = 'discovered',
  verificationLevel,
  trustScore,
  tokenized,
  recentEvent,
  className,
}: VehicleCardProps) {
  const user = useUserStore(state => state.user);
  
  // Determine verification badge styling based on verification level
  const getVerificationBadge = () => {
    if (!verificationLevel) return null;
    
    switch (verificationLevel) {
      case 'BLOCKCHAIN':
        return <Badge variant="blockchain" className="absolute top-3 right-3">Blockchain Verified</Badge>;
      case 'PTZ_VERIFIED':
        return <Badge variant="verified" className="absolute top-3 right-3">PTZ Verified</Badge>;
      case 'PROFESSIONAL':
        return <Badge variant="success" className="absolute top-3 right-3">Professional Verified</Badge>;
      case 'MULTI_SOURCE':
        return <Badge variant="secondary" className="absolute top-3 right-3">Multiple Sources</Badge>;
      case 'SINGLE_SOURCE':
        return <Badge variant="outline" className="absolute top-3 right-3">Single Source</Badge>;
      default:
        return null;
    }
  };

  // Get ownership status badge
  const getOwnershipBadge = () => {
    switch (ownershipStatus) {
      case 'owned':
        return <Badge variant="primary" className="absolute top-3 left-3">Owned</Badge>;
      case 'watching':
        return <Badge variant="secondary" className="absolute top-3 left-3">Watching</Badge>;
      case 'discovered':
        return <Badge variant="outline" className="absolute top-3 left-3">Discovered</Badge>;
      default:
        return null;
    }
  };

  // Get recent event badge if available
  const getRecentEventBadge = () => {
    if (!recentEvent) return null;
    
    const getEventColor = () => {
      switch (recentEvent.type) {
        case 'maintenance': return 'bg-blue-500';
        case 'ownership': return 'bg-purple-500';
        case 'documentation': return 'bg-green-500';
        case 'market': return 'bg-accent-500';
        default: return 'bg-neutral-500';
      }
    };
    
    return (
      <div className="absolute bottom-20 left-0 right-0 px-4">
        <div className={cn("rounded-md px-3 py-2 text-white text-sm flex items-center", getEventColor())}>
          <span className="mr-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </span>
          <span className="truncate">{recentEvent.description}</span>
        </div>
      </div>
    );
  };

  return (
    <div 
      className={cn(
        "group relative overflow-hidden rounded-xl bg-white dark:bg-neutral-800 shadow-md transition-all duration-300 hover:shadow-xl w-full max-w-sm",
        className
      )}
    >
      {/* Vehicle image with gradient overlay for text legibility */}
      <div className="relative h-48 w-full overflow-hidden bg-neutral-200 dark:bg-neutral-700">
        {imageUrl ? (
          <img 
            src={imageUrl} 
            alt={`${year} ${make} ${model}`} 
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-neutral-200 to-neutral-300 dark:from-neutral-700 dark:to-neutral-800">
            <span className="text-2xl font-semibold text-neutral-500 dark:text-neutral-400">{make}</span>
          </div>
        )}
        
        {/* Gradient overlay for text legibility */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-80"></div>
      </div>

      {/* Status badges */}
      {getOwnershipBadge()}
      {getVerificationBadge()}
      
      {/* Vehicle information */}
      <div className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xl font-bold text-neutral-900 dark:text-white">
            {year} {make} {model}
          </h3>
          
          {tokenized && (
            <Badge variant="accent" className="ml-2">
              <svg className="mr-1 h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.5a.5.5 0 01-.5.5.5.5 0 01-.5-.5V5a1 1 0 10-2 0v.5a.5.5 0 01-.5.5 1 1 0 100 2 .5.5 0 01.5.5v.5a1 1 0 102 0v-.5a.5.5 0 01.5-.5.5.5 0 01.5.5v.5a1 1 0 102 0v-.5a.5.5 0 01.5-.5 1 1 0 100-2 .5.5 0 01-.5-.5V5z" clipRule="evenodd" />
              </svg>
              Tokenized
            </Badge>
          )}
        </div>
        
        {/* VIN with copy option */}
        {vin && (
          <div className="mb-4 flex items-center text-sm text-neutral-600 dark:text-neutral-400">
            <span className="mr-1 font-medium">VIN:</span>
            <span className="font-mono">{vin}</span>
            <button 
              className="ml-2 rounded-full p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
              onClick={() => navigator.clipboard.writeText(vin)}
              title="Copy VIN"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
        )}
        
        {/* Trust score indicator */}
        {trustScore !== undefined && (
          <div className="mb-4">
            <TrustIndicator score={trustScore} label="Trust Score" />
          </div>
        )}
      </div>
      
      {/* Recent event notification */}
      {getRecentEventBadge()}
      
      {/* Action buttons */}
      <div className="border-t border-neutral-200 dark:border-neutral-700 p-4 flex justify-between">
        <Link to={`/vehicles/${id}`} className="w-full">
          <Button variant="primary" className="w-full">
            View Vehicle
          </Button>
        </Link>
      </div>
    </div>
  );
}

/**
 * Vehicle Card Grid
 * 
 * A responsive grid layout for displaying multiple vehicle cards
 */
export function VehicleCardGrid({ 
  children, 
  className 
}: { 
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(
      "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6",
      className
    )}>
      {children}
    </div>
  );
}
