import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { tokens } from '@/styles/design-tokens';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button-system';
import { TrustIndicator } from '@/components/ui/trust-indicator';

/**
 * Vehicle Timeline Event Interface
 * 
 * This defines the structure of a vehicle history event
 * in line with the vehicle-centric architecture.
 */
export interface VehicleTimelineEvent {
  id: string;
  date: Date | string;
  title: string;
  description?: string;
  category: 'maintenance' | 'ownership' | 'documentation' | 'market' | 'accident' | 'modification' | 'other';
  verificationLevel: keyof typeof tokens.verificationLevels;
  sourceType: 'blockchain' | 'ptz' | 'professional' | 'user' | 'third_party' | 'ai_derived';
  sourceName?: string;
  attachments?: Array<{
    id: string;
    type: 'image' | 'document' | 'video' | 'link';
    url: string;
    name: string;
  }>;
  metadata?: Record<string, any>;
  trustScore?: number;
}

export interface VehicleTimelineProps {
  events: VehicleTimelineEvent[];
  vehicleId: string;
  compact?: boolean;
  initialFilter?: string[];
  showFilters?: boolean;
  className?: string;
  onEventClick?: (event: VehicleTimelineEvent) => void;
  onAddEvent?: () => void;
}

/**
 * Modern Vehicle Timeline Component
 * 
 * This timeline visualizes a vehicle's history, emphasizing the 
 * chronological nature of events while highlighting verification
 * levels and trust mechanisms - central to Nuke's vehicle-centric
 * philosophy.
 */
export function VehicleTimeline({
  events,
  vehicleId,
  compact = false,
  initialFilter = [],
  showFilters = true,
  className,
  onEventClick,
  onAddEvent,
}: VehicleTimelineProps) {
  const [activeFilters, setActiveFilters] = useState<string[]>(initialFilter);
  const [expandedEvents, setExpandedEvents] = useState<string[]>([]);
  
  // Sort events by date (newest first)
  const sortedEvents = [...events].sort((a, b) => {
    const dateA = new Date(a.date);
    const dateB = new Date(b.date);
    return dateB.getTime() - dateA.getTime();
  });
  
  // Filter events by category if filters are active
  const filteredEvents = activeFilters.length > 0
    ? sortedEvents.filter(event => activeFilters.includes(event.category))
    : sortedEvents;
  
  // Toggle event expansion
  const toggleEventExpansion = (eventId: string) => {
    setExpandedEvents(prev => 
      prev.includes(eventId)
        ? prev.filter(id => id !== eventId)
        : [...prev, eventId]
    );
  };
  
  // Toggle category filter
  const toggleFilter = (category: string) => {
    setActiveFilters(prev => 
      prev.includes(category)
        ? prev.filter(cat => cat !== category)
        : [...prev, category]
    );
  };
  
  // Get category label and color
  const getCategoryInfo = (category: VehicleTimelineEvent['category']) => {
    switch (category) {
      case 'maintenance':
        return { label: 'Maintenance', color: 'bg-blue-500 dark:bg-blue-600' };
      case 'ownership':
        return { label: 'Ownership', color: 'bg-purple-500 dark:bg-purple-600' };
      case 'documentation':
        return { label: 'Documentation', color: 'bg-green-500 dark:bg-green-600' };
      case 'market':
        return { label: 'Market', color: 'bg-accent-500 dark:bg-accent-600' };
      case 'accident':
        return { label: 'Accident', color: 'bg-red-500 dark:bg-red-600' };
      case 'modification':
        return { label: 'Modification', color: 'bg-amber-500 dark:bg-amber-600' };
      default:
        return { label: 'Other', color: 'bg-neutral-500 dark:bg-neutral-600' };
    }
  };
  
  // Get verification badge
  const getVerificationBadge = (level: VehicleTimelineEvent['verificationLevel']) => {
    switch (level) {
      case 'BLOCKCHAIN':
        return <Badge variant="blockchain">Blockchain Verified</Badge>;
      case 'PTZ_VERIFIED':
        return <Badge variant="verified">PTZ Verified</Badge>;
      case 'PROFESSIONAL':
        return <Badge variant="success">Professional Verified</Badge>;
      case 'MULTI_SOURCE':
        return <Badge variant="secondary">Multiple Sources</Badge>;
      case 'SINGLE_SOURCE':
        return <Badge variant="outline">Single Source</Badge>;
      default:
        return <Badge variant="outline">Unverified</Badge>;
    }
  };
  
  // Get source badge
  const getSourceBadge = (sourceType: VehicleTimelineEvent['sourceType'], sourceName?: string) => {
    switch (sourceType) {
      case 'blockchain':
        return <Badge variant="blockchain" className="ml-2">Blockchain</Badge>;
      case 'ptz':
        return <Badge variant="verified" className="ml-2">PTZ {sourceName && `- ${sourceName}`}</Badge>;
      case 'professional':
        return <Badge variant="success" className="ml-2">Pro {sourceName && `- ${sourceName}`}</Badge>;
      case 'user':
        return <Badge variant="secondary" className="ml-2">User {sourceName && `- ${sourceName}`}</Badge>;
      case 'third_party':
        return <Badge variant="outline" className="ml-2">{sourceName || 'Third Party'}</Badge>;
      case 'ai_derived':
        return <Badge variant="accent" className="ml-2">AI Analysis</Badge>;
      default:
        return null;
    }
  };
  
  // Format date
  const formatDate = (date: Date | string) => {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };
  
  return (
    <div className={cn('w-full', className)}>
      {/* Category filters */}
      {showFilters && (
        <div className="mb-6 flex flex-wrap gap-2">
          <Badge 
            variant={activeFilters.length === 0 ? 'primary' : 'outline'} 
            className="cursor-pointer"
            onClick={() => setActiveFilters([])}
          >
            All
          </Badge>
          {['maintenance', 'ownership', 'documentation', 'market', 'accident', 'modification', 'other'].map(category => (
            <Badge 
              key={category}
              variant={activeFilters.includes(category) ? 'primary' : 'outline'}
              className="cursor-pointer"
              onClick={() => toggleFilter(category)}
            >
              {getCategoryInfo(category as VehicleTimelineEvent['category']).label}
            </Badge>
          ))}
        </div>
      )}
      
      {/* Add event button */}
      {onAddEvent && (
        <div className="mb-6">
          <Button 
            variant="outline" 
            onClick={onAddEvent}
            icon={
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            }
          >
            Add Event
          </Button>
        </div>
      )}
      
      {/* Empty state */}
      {filteredEvents.length === 0 && (
        <div className="rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 p-8 text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
            <svg className="h-6 w-6 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">No Events Found</h3>
          <p className="mt-2 text-neutral-600 dark:text-neutral-400">
            {activeFilters.length > 0 
              ? 'No events match the selected filters. Try a different filter or add a new event.'
              : 'No events have been recorded for this vehicle yet. Add the first event to start building its digital history.'}
          </p>
          {onAddEvent && (
            <Button 
              variant="primary" 
              className="mt-4"
              onClick={onAddEvent}
              icon={
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              }
            >
              Add First Event
            </Button>
          )}
        </div>
      )}
      
      {/* Timeline */}
      {filteredEvents.length > 0 && (
        <div className="relative">
          {/* Timeline connector line */}
          <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-neutral-200 dark:bg-neutral-700" />
          
          {/* Events */}
          <div className="space-y-4">
            {filteredEvents.map((event, index) => {
              const isExpanded = expandedEvents.includes(event.id);
              const { color } = getCategoryInfo(event.category);
              
              return (
                <div 
                  key={event.id}
                  className={cn(
                    "relative pl-14 transition-all duration-300",
                    compact ? "pb-4" : "pb-6"
                  )}
                >
                  {/* Date bubble */}
                  <div 
                    className={cn(
                      "absolute left-0 top-0 h-12 w-12 rounded-full flex items-center justify-center z-10",
                      "border-4 border-white dark:border-neutral-900",
                      color
                    )}
                  >
                    <span className="text-xs font-bold text-white">
                      {new Date(event.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  
                  {/* Event card */}
                  <div 
                    className={cn(
                      "rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 overflow-hidden",
                      "transition-all duration-300 shadow-sm hover:shadow-md",
                      "cursor-pointer"
                    )}
                    onClick={() => toggleEventExpansion(event.id)}
                  >
                    {/* Header */}
                    <div className="p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                            {event.title}
                          </h3>
                          <p className="text-sm text-neutral-600 dark:text-neutral-400">
                            {formatDate(event.date)}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {getVerificationBadge(event.verificationLevel)}
                          {getSourceBadge(event.sourceType, event.sourceName)}
                        </div>
                      </div>
                      
                      {/* Short description (always visible) */}
                      {event.description && !compact && (
                        <p className="mt-2 text-neutral-700 dark:text-neutral-300 line-clamp-2">
                          {event.description}
                        </p>
                      )}
                      
                      {/* Trust score (always visible) */}
                      {event.trustScore !== undefined && (
                        <div className="mt-3">
                          <TrustIndicator score={event.trustScore} size="sm" />
                        </div>
                      )}
                    </div>
                    
                    {/* Expanded content */}
                    {isExpanded && !compact && (
                      <div className="border-t border-neutral-200 dark:border-neutral-700 p-4">
                        {/* Full description */}
                        {event.description && (
                          <div className="mb-4">
                            <p className="text-neutral-700 dark:text-neutral-300">
                              {event.description}
                            </p>
                          </div>
                        )}
                        
                        {/* Attachments */}
                        {event.attachments && event.attachments.length > 0 && (
                          <div className="mb-4">
                            <h4 className="mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                              Attachments
                            </h4>
                            <div className="flex flex-wrap gap-3">
                              {event.attachments.map(attachment => (
                                <a
                                  key={attachment.id}
                                  href={attachment.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center rounded-md border border-neutral-200 dark:border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-700"
                                  onClick={e => e.stopPropagation()}
                                >
                                  {/* Icon based on attachment type */}
                                  {attachment.type === 'image' && (
                                    <svg className="mr-2 h-4 w-4 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                  )}
                                  {attachment.type === 'document' && (
                                    <svg className="mr-2 h-4 w-4 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                  )}
                                  {attachment.type === 'video' && (
                                    <svg className="mr-2 h-4 w-4 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                    </svg>
                                  )}
                                  {attachment.type === 'link' && (
                                    <svg className="mr-2 h-4 w-4 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                    </svg>
                                  )}
                                  
                                  <span>{attachment.name}</span>
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        {/* Actions */}
                        <div className="flex justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              onEventClick?.(event);
                            }}
                          >
                            View Details
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
