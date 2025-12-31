export type SearchResultType =
  | 'vehicle'
  | 'organization'
  | 'shop'
  | 'part'
  | 'user'
  | 'timeline_event'
  | 'image'
  | 'document'
  | 'auction'
  | 'reference'
  | 'source'
  | 'status';

export interface SearchResult {
  id: string;
  type: SearchResultType;
  title: string;
  description: string;
  metadata: any;
  relevance_score: number;
  location?: {
    lat: number;
    lng: number;
    address?: string;
  };
  image_url?: string;
  created_at: string;
  related_entities?: {
    vehicles?: any[];
    organizations?: any[];
    users?: any[];
  };
}
