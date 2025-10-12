// ProImageViewer - Constants and Types

export const TAG_TYPES = [
  { value: 'product', label: 'Product', description: 'Parts, tools, or products visible in the image' },
  { value: 'damage', label: 'Damage', description: 'Visible damage or wear' },
  { value: 'location', label: 'Location', description: 'Geographic or physical location' },
  { value: 'modification', label: 'Modification', description: 'Aftermarket modifications or upgrades' },
  { value: 'brand', label: 'Brand', description: 'Brand names or logos' },
  { value: 'part', label: 'Part', description: 'Specific vehicle parts' },
  { value: 'tool', label: 'Tool', description: 'Tools used or visible' },
  { value: 'fluid', label: 'Fluid', description: 'Oils, coolants, or other fluids' }
] as const;

export type TagType = typeof TAG_TYPES[number]['value'];

export const getTagColor = (tagType?: string): string => {
  switch (tagType) {
    case 'product': return 'var(--success)';
    case 'damage': return 'var(--danger)';
    case 'location': return 'var(--info)';
    case 'modification': return 'var(--warning)';
    case 'brand': return 'var(--purple, #8b5cf6)';
    case 'part': return 'var(--cyan, #06b6d4)';
    case 'tool': return 'var(--orange, #f97316)';
    case 'fluid': return 'var(--indigo, #6366f1)';
    default: return 'var(--success)';
  }
};

export interface ImageData {
  id: string;
  image_url: string;
  is_primary?: boolean;
  storage_path?: string;
  thumbnail_url?: string;
  medium_url?: string;
  large_url?: string;
  created_at?: string;
  filename?: string;
  file_size?: number;
  mime_type?: string;
  exif_data?: any;
  user_id?: string;
  is_archived?: boolean;
  caption?: string;
  tags?: string[];
  spatial_tags?: SpatialTag[];
}

export interface SpatialTag {
  id: string;
  x: number;
  y: number;
  text: string;
  type: TagType;
  isEditing?: boolean;
  created_by?: string;
  created_at?: string;
}

export interface ViewerState {
  selectedImage: ImageData | null;
  showFullRes: boolean;
  showTags: boolean;
  showGrid: boolean;
  loading: boolean;
  error: string | null;
}

export interface TagState {
  imageTags: SpatialTag[];
  activeTagId: string | null;
  tagText: string;
  selectedTagType: TagType;
  tagSaving: boolean;
  tagsLoading: boolean;
}

export interface CommentState {
  comments: any[];
  commentText: string;
  commentSaving: boolean;
  commentError: string | null;
}

export const VIEWER_MODES = {
  GRID: 'grid',
  FULLSCREEN: 'fullscreen',
  COMPARISON: 'comparison'
} as const;

export type ViewerMode = typeof VIEWER_MODES[keyof typeof VIEWER_MODES];

export const DEFAULT_VIEWER_STATE: ViewerState = {
  selectedImage: null,
  showFullRes: false,
  showTags: false,
  showGrid: true,
  loading: false,
  error: null
};

export const DEFAULT_TAG_STATE: TagState = {
  imageTags: [],
  activeTagId: null,
  tagText: '',
  selectedTagType: 'product',
  tagSaving: false,
  tagsLoading: false
};

export const DEFAULT_COMMENT_STATE: CommentState = {
  comments: [],
  commentText: '',
  commentSaving: false,
  commentError: null
};