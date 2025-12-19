/**
 * AutoIDWrapper - Automatically wraps UUIDs/IDs in text with IDHoverCard
 * Use this to wrap any text content that might contain IDs
 */

import React from 'react';
import { IDHoverCard } from './IDHoverCard';

// UUID pattern (full and short)
const UUID_PATTERN = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
const SHORT_ID_PATTERN = /\b([0-9a-f]{8,32})\b/gi;

interface AutoIDWrapperProps {
  text: string;
  className?: string;
}

export const AutoIDWrapper: React.FC<AutoIDWrapperProps> = ({ text, className = '' }) => {
  // Split text by UUIDs and wrap them
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  // First, find all UUIDs (full format)
  const uuidMatches: Array<{ start: number; end: number; id: string }> = [];
  const uuidRegex = new RegExp(UUID_PATTERN);
  while ((match = uuidRegex.exec(text)) !== null) {
    uuidMatches.push({
      start: match.index,
      end: match.index + match[0].length,
      id: match[0]
    });
  }

  // Then find short IDs that aren't already part of a UUID
  const shortIdMatches: Array<{ start: number; end: number; id: string }> = [];
  const shortIdRegex = new RegExp(SHORT_ID_PATTERN);
  while ((match = shortIdRegex.exec(text)) !== null) {
    // Check if this match is already part of a UUID
    const isPartOfUuid = uuidMatches.some(
      uuid => match.index >= uuid.start && match.index < uuid.end
    );
    if (!isPartOfUuid) {
      shortIdMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        id: match[0]
      });
    }
  }

  // Combine and sort all matches
  const allMatches = [...uuidMatches, ...shortIdMatches].sort((a, b) => a.start - b.start);

  // Build parts array
  allMatches.forEach((match, index) => {
    // Add text before this match
    if (match.start > lastIndex) {
      parts.push(text.substring(lastIndex, match.start));
    }

    // Add the ID with hover card
    parts.push(
      <IDHoverCard key={`id-${index}`} id={match.id} type="auto" className={className}>
        {match.id}
      </IDHoverCard>
    );

    lastIndex = match.end;
  });

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  // If no matches, just return the text
  if (parts.length === 0) {
    return <>{text}</>;
  }

  return <>{parts}</>;
};

