/**
 * IDText - Automatically wraps any UUID/ID in text with hover cards
 * Usage: <IDText>{someTextWithIDs}</IDText>
 * 
 * This will automatically detect and make hoverable:
 * - Full UUIDs: 550e8400-e29b-41d4-a716-446655440000
 * - Short IDs: abc12345
 * - Vehicle IDs, Image IDs, User IDs, etc.
 */

import React from 'react';
import { IDHoverCard } from './IDHoverCard';

const UUID_PATTERN = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
const SHORT_ID_PATTERN = /\b([0-9a-f]{8,32})\b/gi;

interface IDTextProps {
  children: React.ReactNode;
  className?: string;
}

export const IDText: React.FC<IDTextProps> = ({ children, className = '' }) => {
  // Convert children to string if it's a string or number
  const text = typeof children === 'string' || typeof children === 'number' 
    ? String(children) 
    : null;

  if (!text) {
    // If not a simple string/number, just render as-is
    return <>{children}</>;
  }

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  // Find all UUIDs first
  const uuidMatches: Array<{ start: number; end: number; id: string }> = [];
  const uuidRegex = new RegExp(UUID_PATTERN);
  let match;
  while ((match = uuidRegex.exec(text)) !== null) {
    uuidMatches.push({
      start: match.index,
      end: match.index + match[0].length,
      id: match[0]
    });
  }

  // Find short IDs that aren't part of UUIDs
  const shortIdMatches: Array<{ start: number; end: number; id: string }> = [];
  const shortIdRegex = new RegExp(SHORT_ID_PATTERN);
  while ((match = shortIdRegex.exec(text)) !== null) {
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

  // Combine and sort
  const allMatches = [...uuidMatches, ...shortIdMatches].sort((a, b) => a.start - b.start);

  // Build parts
  allMatches.forEach((match, index) => {
    if (match.start > lastIndex) {
      parts.push(text.substring(lastIndex, match.start));
    }
    parts.push(
      <IDHoverCard key={`id-${index}-${match.id}`} id={match.id} type="auto" className={className}>
        {match.id}
      </IDHoverCard>
    );
    lastIndex = match.end;
  });

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return <span className={className}>{parts.length > 0 ? parts : text}</span>;
};

