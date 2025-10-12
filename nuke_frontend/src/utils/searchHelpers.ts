import { type SearchFilters } from '../services/vehicleSearchService';

export class SearchHelpers {
  /**
   * Parse URL parameters into search filters
   */
  static parseUrlFilters(searchParams: URLSearchParams): SearchFilters {
    const filters: SearchFilters = {};

    if (searchParams.get('yearFrom')) {
      filters.yearFrom = parseInt(searchParams.get('yearFrom')!);
    }
    if (searchParams.get('yearTo')) {
      filters.yearTo = parseInt(searchParams.get('yearTo')!);
    }
    if (searchParams.get('make')) {
      filters.make = searchParams.get('make')!;
    }
    if (searchParams.get('model')) {
      filters.model = searchParams.get('model')!;
    }
    if (searchParams.get('priceFrom')) {
      filters.priceFrom = parseInt(searchParams.get('priceFrom')!);
    }
    if (searchParams.get('priceTo')) {
      filters.priceTo = parseInt(searchParams.get('priceTo')!);
    }
    if (searchParams.get('zipCode')) {
      filters.zipCode = searchParams.get('zipCode')!;
    }
    if (searchParams.get('radius')) {
      filters.radius = parseInt(searchParams.get('radius')!);
    }
    if (searchParams.get('forSale') === 'true') {
      filters.forSale = true;
    }
    if (searchParams.get('q')) {
      filters.textSearch = searchParams.get('q')!;
    }

    return filters;
  }

  /**
   * Convert search filters to URL parameters
   */
  static filtersToUrlParams(filters: SearchFilters): URLSearchParams {
    const params = new URLSearchParams();

    if (filters.yearFrom) params.set('yearFrom', filters.yearFrom.toString());
    if (filters.yearTo) params.set('yearTo', filters.yearTo.toString());
    if (filters.make) params.set('make', filters.make);
    if (filters.model) params.set('model', filters.model);
    if (filters.priceFrom) params.set('priceFrom', filters.priceFrom.toString());
    if (filters.priceTo) params.set('priceTo', filters.priceTo.toString());
    if (filters.zipCode) params.set('zipCode', filters.zipCode);
    if (filters.radius) params.set('radius', filters.radius.toString());
    if (filters.forSale) params.set('forSale', 'true');
    if (filters.textSearch) params.set('q', filters.textSearch);

    return params;
  }

  /**
   * Generate shareable search URLs
   */
  static generateSearchUrl(filters: SearchFilters, baseUrl: string = '/all-vehicles'): string {
    const params = this.filtersToUrlParams(filters);
    return params.toString() ? `${baseUrl}?${params.toString()}` : baseUrl;
  }

  /**
   * Common search presets for quick access
   */
  static getSearchPresets(): Array<{ name: string; filters: SearchFilters; description: string }> {
    return [
      {
        name: 'Sports Cars Under $50k',
        filters: { priceFrom: 0, priceTo: 50000, textSearch: 'sports coupe performance' },
        description: 'Affordable performance vehicles'
      },
      {
        name: 'Classic Cars',
        filters: { yearFrom: 1900, yearTo: 1979 },
        description: 'Vintage automobiles pre-1980'
      },
      {
        name: 'Modern Luxury',
        filters: { yearFrom: 2015, textSearch: 'luxury premium' },
        description: 'Recent high-end vehicles'
      },
      {
        name: 'Electric Vehicles',
        filters: { textSearch: 'electric tesla model hybrid' },
        description: 'Electric and hybrid vehicles'
      },
      {
        name: 'Trucks & SUVs',
        filters: { textSearch: 'truck suv pickup tahoe suburban' },
        description: 'Utility and family vehicles'
      },
      {
        name: 'Japanese Imports',
        filters: { textSearch: 'honda toyota nissan mazda subaru' },
        description: 'Japanese manufacturer vehicles'
      },
      {
        name: 'German Engineering',
        filters: { textSearch: 'bmw mercedes audi porsche volkswagen' },
        description: 'German manufacturer vehicles'
      },
      {
        name: 'American Muscle',
        filters: { textSearch: 'mustang camaro challenger charger corvette' },
        description: 'Classic American performance cars'
      }
    ];
  }

  /**
   * Validate search filters for common issues
   */
  static validateFilters(filters: SearchFilters): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (filters.yearFrom && filters.yearTo && filters.yearFrom > filters.yearTo) {
      errors.push('Year "from" cannot be greater than year "to"');
    }

    if (filters.priceFrom && filters.priceTo && filters.priceFrom > filters.priceTo) {
      errors.push('Price "from" cannot be greater than price "to"');
    }

    if (filters.zipCode && !/^\d{5}$/.test(filters.zipCode)) {
      errors.push('Zip code must be 5 digits');
    }

    if (filters.radius && !filters.zipCode) {
      errors.push('Radius requires a zip code');
    }

    const currentYear = new Date().getFullYear();
    if (filters.yearFrom && (filters.yearFrom < 1900 || filters.yearFrom > currentYear + 1)) {
      errors.push(`Year "from" must be between 1900 and ${currentYear + 1}`);
    }

    if (filters.yearTo && (filters.yearTo < 1900 || filters.yearTo > currentYear + 1)) {
      errors.push(`Year "to" must be between 1900 and ${currentYear + 1}`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Format search summary for display
   */
  static formatSearchSummary(filters: SearchFilters): string {
    const parts: string[] = [];

    if (filters.textSearch) {
      parts.push(`"${filters.textSearch}"`);
    }

    if (filters.make) {
      parts.push(filters.model ? `${filters.make} ${filters.model}` : filters.make);
    }

    if (filters.yearFrom || filters.yearTo) {
      if (filters.yearFrom && filters.yearTo) {
        parts.push(`${filters.yearFrom}-${filters.yearTo}`);
      } else if (filters.yearFrom) {
        parts.push(`${filters.yearFrom}+`);
      } else if (filters.yearTo) {
        parts.push(`-${filters.yearTo}`);
      }
    }

    if (filters.priceFrom || filters.priceTo) {
      if (filters.priceFrom && filters.priceTo) {
        parts.push(`$${filters.priceFrom.toLocaleString()}-$${filters.priceTo.toLocaleString()}`);
      } else if (filters.priceFrom) {
        parts.push(`$${filters.priceFrom.toLocaleString()}+`);
      } else if (filters.priceTo) {
        parts.push(`-$${filters.priceTo.toLocaleString()}`);
      }
    }

    if (filters.zipCode) {
      const location = filters.radius 
        ? `within ${filters.radius}mi of ${filters.zipCode}`
        : `near ${filters.zipCode}`;
      parts.push(location);
    }

    if (filters.forSale) {
      parts.push('for sale');
    }

    return parts.length > 0 ? parts.join(', ') : 'All vehicles';
  }
}
