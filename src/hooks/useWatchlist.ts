
import { useState, useEffect } from 'react';
import { useAuth } from './use-auth';

export interface WatchlistItem {
  id: string;
  type: 'listing' | 'vehicle' | 'garage';
  addedAt: string;
}

export const useWatchlist = () => {
  const { session } = useAuth();
  const isAuthenticated = !!session;
  
  // Store watchlist in state
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Load watchlist from localStorage on component mount
  useEffect(() => {
    const loadWatchlist = () => {
      try {
        const savedWatchlist = localStorage.getItem('watchlist');
        if (savedWatchlist) {
          setWatchlist(JSON.parse(savedWatchlist));
        }
      } catch (error) {
        console.error('Error loading watchlist from localStorage:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadWatchlist();
  }, []);
  
  // Save watchlist to localStorage when it changes
  useEffect(() => {
    if (!isLoading) {
      localStorage.setItem('watchlist', JSON.stringify(watchlist));
    }
  }, [watchlist, isLoading]);
  
  // Check if an item is in the watchlist
  const isWatched = (id: string, type: WatchlistItem['type'] = 'listing') => {
    return watchlist.some(item => item.id === id && item.type === type);
  };
  
  // Add an item to the watchlist
  const addToWatchlist = (id: string, type: WatchlistItem['type'] = 'listing') => {
    if (!isWatched(id, type)) {
      const newItem: WatchlistItem = {
        id,
        type,
        addedAt: new Date().toISOString()
      };
      
      setWatchlist(prev => [...prev, newItem]);
      return true; // Successfully added
    }
    return false; // Already in watchlist
  };
  
  // Remove an item from the watchlist
  const removeFromWatchlist = (id: string, type: WatchlistItem['type'] = 'listing') => {
    if (isWatched(id, type)) {
      setWatchlist(prev => prev.filter(item => !(item.id === id && item.type === type)));
      return true; // Successfully removed
    }
    return false; // Not in watchlist
  };
  
  // Toggle an item in the watchlist
  const toggleWatchlist = (id: string, type: WatchlistItem['type'] = 'listing') => {
    return isWatched(id, type) 
      ? removeFromWatchlist(id, type) 
      : addToWatchlist(id, type);
  };
  
  // Get all watchlist items of a specific type
  const getWatchlistByType = (type: WatchlistItem['type']) => {
    return watchlist.filter(item => item.type === type);
  };
  
  // Clear the entire watchlist
  const clearWatchlist = () => {
    setWatchlist([]);
  };
  
  return {
    watchlist,
    isLoading,
    isWatched,
    addToWatchlist,
    removeFromWatchlist,
    toggleWatchlist,
    getWatchlistByType,
    clearWatchlist,
    isAuthenticated
  };
};
