
import { formatDistanceToNow } from 'date-fns';

export const getContentCardBackground = (type: string): string => {
  switch (type) {
    case 'vehicle':
      return 'bg-blue-50 dark:bg-blue-950/20';
    case 'auction':
      return 'bg-amber-50 dark:bg-amber-950/20';
    case 'event':
      return 'bg-green-50 dark:bg-green-950/20';
    case 'garage':
      return 'bg-purple-50 dark:bg-purple-950/20';
    case 'article':
      return 'bg-teal-50 dark:bg-teal-950/20';
    case 'stream':
      return 'bg-red-50 dark:bg-red-950/20';
    default:
      return 'bg-gray-50 dark:bg-gray-800/20';
  }
};

export const getRelativeTime = (timestamp?: string): string => {
  if (!timestamp) return '';
  try {
    return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
  } catch (e) {
    return '';
  }
};
