/**
 * Contextual Summary Generator for Timeline Events
 * 
 * Generates meaningful summaries that mature as data accrues.
 * Provides contextual information about work sessions, costs, participants, etc.
 */

export interface TimelineEventSummary {
  primary: string; // Main summary line
  details: string[]; // Supporting detail lines
  metrics: {
    cost?: number;
    hours?: number;
    parts?: number;
    photos?: number;
    participants?: number;
  };
}

export function generateEventSummary(event: any): TimelineEventSummary {
  const summary: TimelineEventSummary = {
    primary: '',
    details: [],
    metrics: {}
  };

  // Extract data
  const title = event.title || '';
  const description = event.description || '';
  const eventType = event.event_type || '';
  const metadata = event.metadata || {};
  const cost = event.cost_amount || event.receipt_amount || metadata.total_cost || 0;
  const hours = event.duration_hours || metadata.labor_hours || metadata.hours || 0;
  const parts = Array.isArray(metadata.parts_used) ? metadata.parts_used.length : 
                Array.isArray(event.parts_used) ? event.parts_used.length : 0;
  const photos = Array.isArray(event.image_urls) ? event.image_urls.length : 
                 Array.isArray(metadata.image_urls) ? metadata.image_urls.length : 0;
  const participants = Array.isArray(event.participants) ? event.participants.length :
                        Array.isArray(metadata.participants) ? metadata.participants.length : 0;
  const serviceProvider = event.service_provider_name || metadata.service_provider || '';
  const location = event.location_name || metadata.location || '';
  const workDescription = metadata.work_description || description || '';

  // Store metrics
  summary.metrics = { cost, hours, parts, photos, participants };

  // Generate primary summary based on available data
  const summaryParts: string[] = [];

  // Work type/description
  if (workDescription && workDescription.length > 0 && workDescription !== title) {
    // Use work description if it's meaningful
    const desc = workDescription.length > 80 ? workDescription.substring(0, 80) + '...' : workDescription;
    summaryParts.push(desc);
  } else if (title && title !== 'Work Session' && title !== 'Work Session documentation') {
    summaryParts.push(title);
  } else {
    // Fallback: generate from event type
    const typeLabel = eventType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    summaryParts.push(typeLabel || 'Work Session');
  }

  // Add location if available
  if (location) {
    summaryParts.push(`at ${location}`);
  }

  // Add service provider if available
  if (serviceProvider && serviceProvider !== location) {
    summaryParts.push(`by ${serviceProvider}`);
  }

  summary.primary = summaryParts.join(' ') || 'Work Session';

  // Generate detail lines
  const details: string[] = [];

  // Cost information
  if (cost > 0) {
    details.push(`Total cost: $${cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  }

  // Labor hours
  if (hours > 0) {
    const hoursLabel = hours === 1 ? 'hour' : 'hours';
    details.push(`${hours.toFixed(1)} ${hoursLabel} of labor`);
  }

  // Parts count
  const partsCount = parts;
  if (partsCount > 0) {
    const partsLabel = partsCount === 1 ? 'part' : 'parts';
    details.push(`${partsCount} ${partsLabel} used`);
  }

  // Photo count
  if (photos > 0) {
    const photosLabel = photos === 1 ? 'photo' : 'photos';
    details.push(`${photos} ${photosLabel} documented`);
  }

  // Participants
  if (participants > 0) {
    const peopleLabel = participants === 1 ? 'person' : 'people';
    details.push(`${participants} ${peopleLabel} involved`);
  }

  // Date
  if (event.event_date) {
    const date = new Date(event.event_date);
    const dateStr = date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
    details.push(`Date: ${dateStr}`);
  }

  // Mileage
  if (event.mileage_at_event) {
    details.push(`Mileage: ${event.mileage_at_event.toLocaleString()} miles`);
  }

  summary.details = details;

  return summary;
}

/**
 * Generate summary for multiple events (day summary)
 */
export function generateDaySummary(events: any[]): TimelineEventSummary {
  const summary: TimelineEventSummary = {
    primary: '',
    details: [],
    metrics: {}
  };

  if (events.length === 0) {
    summary.primary = 'No events';
    return summary;
  }

  // Aggregate metrics
  let totalCost = 0;
  let totalHours = 0;
  let totalParts = 0;
  let totalPhotos = 0;
  const participants = new Set<string>();
  const eventTypes = new Set<string>();

  events.forEach(ev => {
    const eventSummary = generateEventSummary(ev);
    totalCost += eventSummary.metrics.cost || 0;
    totalHours += eventSummary.metrics.hours || 0;
    totalParts += eventSummary.metrics.parts || 0;
    totalPhotos += eventSummary.metrics.photos || 0;
    
    if (ev.participants) {
      ev.participants.forEach((p: any) => {
        if (p.user_id) participants.add(p.user_id);
        if (p.name) participants.add(p.name);
      });
    }
    
    if (ev.event_type) {
      eventTypes.add(ev.event_type);
    }
  });

  summary.metrics = {
    cost: totalCost,
    hours: totalHours,
    parts: totalParts,
    photos: totalPhotos,
    participants: participants.size
  };

  // Generate primary summary
  const summaryParts: string[] = [];
  
  if (events.length === 1) {
    // Single event - use its summary
    const eventSummary = generateEventSummary(events[0]);
    summary.primary = eventSummary.primary;
    summary.details = eventSummary.details;
    return summary;
  }

  // Multiple events
  summaryParts.push(`${events.length} events`);
  
  if (eventTypes.size === 1) {
    const type = Array.from(eventTypes)[0];
    const typeLabel = type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    summaryParts.push(`(${typeLabel})`);
  }

  summary.primary = summaryParts.join(' ');

  // Generate detail lines
  const details: string[] = [];

  if (totalCost > 0) {
    details.push(`Total cost: $${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  }

  if (totalHours > 0) {
    const hoursLabel = totalHours === 1 ? 'hour' : 'hours';
    details.push(`${totalHours.toFixed(1)} ${hoursLabel} of labor`);
  }

  if (totalParts > 0) {
    const partsLabel = totalParts === 1 ? 'part' : 'parts';
    details.push(`${totalParts} ${partsLabel} used`);
  }

  if (totalPhotos > 0) {
    const photosLabel = totalPhotos === 1 ? 'photo' : 'photos';
    details.push(`${totalPhotos} ${photosLabel} documented`);
  }

  if (participants.size > 0) {
    const peopleLabel = participants.size === 1 ? 'person' : 'people';
    details.push(`${participants.size} ${peopleLabel} involved`);
  }

  if (events[0]?.event_date) {
    const date = new Date(events[0].event_date);
    const dateStr = date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
    details.push(`Date: ${dateStr}`);
  }

  summary.details = details;

  return summary;
}

