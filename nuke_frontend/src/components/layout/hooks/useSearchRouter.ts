import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { classifyIntent } from '../../../lib/search/intentRouter';
import { parseQuery } from '../../../lib/search/queryParser';
import type { SearchState } from './useSearch';

export interface SearchRouterActions {
  handleSubmit: (query: string) => void;
  handleAutocompleteSelect: (category: string, value: string, label: string) => void;
}

export function useSearchRouter(search: SearchState): SearchRouterActions {
  const navigate = useNavigate();

  const handleSubmit = useCallback((raw: string) => {
    const q = raw.trim();
    if (!q) return;

    const { intent } = classifyIntent(q);

    switch (intent) {
      case 'NAVIGATE': {
        const path = q.startsWith('@')
          ? `/profile/${q.slice(1)}`
          : q;
        navigate(path);
        search.clear();
        break;
      }

      case 'EXACT_VIN': {
        navigate(`/search?q=${encodeURIComponent(q)}&mode=vin`);
        search.clear();
        break;
      }

      case 'EXACT_URL': {
        // Trigger extraction via existing universal-search flow
        navigate(`/search?q=${encodeURIComponent(q)}&mode=url`);
        search.clear();
        break;
      }

      case 'MY_VEHICLES': {
        navigate('/vehicle/list');
        search.clear();
        break;
      }

      case 'MARKET': {
        const parsed = parseQuery(q);
        const params = new URLSearchParams();
        if (parsed.make) params.set('make', parsed.make);
        if (parsed.model) params.set('model', parsed.model);
        navigate(`/market?${params.toString()}`);
        search.clear();
        break;
      }

      case 'QUESTION': {
        navigate(`/search?q=${encodeURIComponent(q)}&mode=question`);
        search.clear();
        break;
      }

      case 'BROWSE': {
        const parsed = parseQuery(q);
        const params = new URLSearchParams();
        if (parsed.make) params.set('make', parsed.make);
        if (parsed.model) params.set('model', parsed.model);
        if (parsed.yearMin) params.set('yearMin', String(parsed.yearMin));
        if (parsed.yearMax) params.set('yearMax', String(parsed.yearMax));
        if (parsed.bodyStyle) params.set('bodyStyle', parsed.bodyStyle);
        if (parsed.era) params.set('era', parsed.era);
        navigate(`/browse?${params.toString()}`);
        search.clear();
        break;
      }

      case 'QUERY':
      default: {
        const parsed = parseQuery(q);
        const params = new URLSearchParams();
        params.set('q', q);
        if (parsed.make) params.set('make', parsed.make);
        if (parsed.model) params.set('model', parsed.model);
        if (parsed.yearMin) params.set('yearMin', String(parsed.yearMin));
        if (parsed.yearMax) params.set('yearMax', String(parsed.yearMax));
        if (parsed.priceMin) params.set('priceMin', String(parsed.priceMin));
        if (parsed.priceMax) params.set('priceMax', String(parsed.priceMax));
        if (parsed.color) params.set('color', parsed.color);
        navigate(`/search?${params.toString()}`);
        search.clear();
        break;
      }
    }
  }, [navigate, search]);

  const handleAutocompleteSelect = useCallback((category: string, value: string, label: string) => {
    switch (category) {
      case 'make':
        navigate(`/browse?make=${encodeURIComponent(value)}`);
        break;
      case 'model': {
        // label is "Make Model", value is model
        const parts = label.split(' ');
        const make = parts[0];
        const model = parts.slice(1).join(' ');
        navigate(`/browse?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`);
        break;
      }
      case 'vehicle':
        navigate(`/vehicle/${value}`);
        break;
      default:
        navigate(`/search?q=${encodeURIComponent(label)}`);
    }
    search.clear();
  }, [navigate, search]);

  return { handleSubmit, handleAutocompleteSelect };
}
