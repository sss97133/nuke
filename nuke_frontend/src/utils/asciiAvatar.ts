/**
 * Generate ASCII art avatar similar to Firecrawl's decorative style
 * Creates a unique pattern based on a seed (username/ID)
 */

export function generateAsciiAvatar(seed: string, size: 'small' | 'medium' | 'large' = 'small'): string {
  // Simple hash function to convert seed to number
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  
  // Use hash to generate consistent pattern
  const rng = (seed: number) => {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  };
  
  const width = size === 'small' ? 12 : size === 'medium' ? 16 : 20;
  const height = size === 'small' ? 12 : size === 'medium' ? 16 : 20;
  
  // Characters for ASCII art (similar to Firecrawl's style)
  const chars = ['.', ':', '-', '=', '+', 'X'];
  
  let pattern = '';
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Create symmetric pattern
      const distFromCenter = Math.sqrt(
        Math.pow(x - width / 2, 2) + Math.pow(y - height / 2, 2)
      );
      const maxDist = Math.sqrt(Math.pow(width / 2, 2) + Math.pow(height / 2, 2));
      const normalizedDist = distFromCenter / maxDist;
      
      // Use hash to add randomness
      const noise = rng(hash + x * 7 + y * 11);
      const density = (1 - normalizedDist) * 0.8 + noise * 0.2;
      
      if (density > 0.3) {
        const charIndex = Math.floor(density * chars.length);
        pattern += chars[Math.min(charIndex, chars.length - 1)];
      } else {
        pattern += ' ';
      }
    }
    pattern += '\n';
  }
  
  return pattern;
}

/**
 * Generate a simple monogram-style avatar (single character)
 */
export function generateMonogramAvatar(seed: string): string {
  const firstChar = seed.charAt(0).toUpperCase();
  return firstChar;
}

/**
 * Generate Firecrawl-style decorative ASCII art
 * More complex pattern similar to their homepage decoration
 */
export function generateFirecrawlStyleAvatar(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash = hash & hash;
  }
  
  const rng = (seed: number) => {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  };
  
  // Firecrawl uses: . : - = + X (dots, colons, dashes, equals, plus, X)
  // Their style is more organic/flowing, less geometric
  const chars = ['.', ':', '-', '=', '+', 'X'];
  const width = 12; // Smaller for avatar
  const height = 12;
  
  let pattern = '';
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Create organic, flowing pattern
      const centerX = width / 2;
      const centerY = height / 2;
      const dx = x - centerX;
      const dy = y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);
      const normalizedDist = dist / maxDist;
      
      // Multiple wave frequencies for organic feel
      const angle = Math.atan2(dy, dx);
      const wave1 = Math.sin(dist * 0.8 + angle * 3) * 0.5 + 0.5;
      const wave2 = Math.cos(dist * 1.2 - angle * 2) * 0.3 + 0.3;
      const noise = rng(hash + x * 13 + y * 17 + seed.length);
      
      // Combine patterns for organic density
      const density = (1 - normalizedDist * 0.7) * (wave1 * 0.6 + wave2 * 0.4) + noise * 0.2;
      
      if (density > 0.3) {
        // Map density to character (higher density = darker chars)
        const charIndex = Math.min(
          Math.floor((density - 0.3) / 0.7 * chars.length),
          chars.length - 1
        );
        pattern += chars[charIndex];
      } else {
        pattern += ' ';
      }
    }
    pattern += '\n';
  }
  
  return pattern;
}

