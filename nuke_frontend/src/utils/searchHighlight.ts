/**
 * Highlights matching search terms in text
 */
export const highlightSearchTerm = (text: string, searchTerm: string): string => {
  if (!text || !searchTerm) return text;
  
  const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedTerm})`, 'gi');
  
  return text.replace(regex, '<mark>$1</mark>');
};

/**
 * Truncates text and highlights search term
 */
export const truncateAndHighlight = (
  text: string,
  searchTerm: string,
  maxLength: number = 150
): string => {
  if (!text) return '';
  
  const highlighted = highlightSearchTerm(text, searchTerm);
  
  if (text.length <= maxLength) {
    return highlighted;
  }
  
  // Find the search term position
  const lowerText = text.toLowerCase();
  const lowerTerm = searchTerm.toLowerCase();
  const termIndex = lowerText.indexOf(lowerTerm);
  
  if (termIndex === -1) {
    // Term not found, just truncate
    return highlightSearchTerm(text.substring(0, maxLength) + '...', searchTerm);
  }
  
  // Try to center the highlight around the search term
  const start = Math.max(0, termIndex - Math.floor(maxLength / 2));
  const end = Math.min(text.length, start + maxLength);
  
  let truncated = text.substring(start, end);
  if (start > 0) truncated = '...' + truncated;
  if (end < text.length) truncated = truncated + '...';
  
  return highlightSearchTerm(truncated, searchTerm);
};

