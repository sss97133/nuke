// TypeScript interfaces for VehicleProfile component breakdown

export interface Vehicle {
  id: string;
  year: number;
  make: string;
  model: string;
  vin: string | null;
  color: string | null;
  mileage: number | null;
  primaryImageUrl: string | null;
  isAnonymous: boolean;
  isPublic: boolean;
  created_at: string;
  updated_at: string;
  user_id?: string | null;
  trim?: string | null;
  engine?: string | null;
  transmission?: string | null;
  description?: string | null;
  ownership_type?: string | null;
  sale_price?: number;
  auction_end_date?: string;
  bid_count?: number;
  view_count?: number;
  auction_source?: string;
  current_value?: number;
  current_bid?: number;
  is_for_sale?: boolean;
  asking_price?: number;
  purchase_price?: number;
  msrp?: number;
  uploaded_by?: string;
  [key: string]: any;
}

export interface VehiclePermissions {
  isVerifiedOwner: boolean;
  hasContributorAccess: boolean;
  contributorRole: string | null;
  isDbUploader: boolean;
}

export interface SaleSettings {
  for_sale: boolean;
  live_auction: boolean;
  partners: string[];
  reserve: number | '';
}

export interface FieldAudit {
  open: boolean;
  fieldName: string;
  fieldLabel: string;
  entries: Array<{
    field_value: string;
    source_type?: string;
    user_id?: string;
    is_verified?: boolean;
    updated_at: string;
  }>;
  score?: number;
  met?: string[];
  next?: string[];
}

export interface CommentPopup {
  isOpen: boolean;
  targetId: string;
  targetType: 'vehicle' | 'data_point';
  targetLabel: string;
  anchorElement?: HTMLElement;
  dataPointType?: string;
  dataPointValue?: string;
}

export interface LiveSession {
  id: string;
  platform: string;
  stream_url: string | null;
  title: string | null;
}

export interface VehicleBaseProps {
  vehicle: Vehicle;
  session: any;
  permissions: VehiclePermissions;
}

export interface VehicleHeaderProps extends VehicleBaseProps {
  responsibleName: string | null;
  onPriceClick: () => void;
}

export interface VehicleHeroImageProps {
  leadImageUrl: string | null;
}

export interface VehicleBasicInfoProps extends VehicleBaseProps {
  onDataPointClick: (event: React.MouseEvent, dataType: string, dataValue: string, label: string) => void;
  onEditClick: () => void;
}

export interface VehicleTimelineSectionProps extends VehicleBaseProps {
  onAddEventClick: () => void;
}

export interface VehicleImageGalleryProps extends VehicleBaseProps {
  showMap: boolean;
  onToggleMap: () => void;
  onImageUpdate: () => void;
}

export interface VehicleCommentsSectionProps {
  vehicleId: string;
}

export interface VehicleSaleSettingsProps extends VehicleBaseProps {
  saleSettings: SaleSettings;
  savingSale: boolean;
  viewCount: number;
  onSaleSettingsChange: (settings: SaleSettings) => void;
  onSaveSaleSettings: () => void;
  onShowCompose: () => void;
}

export interface VehicleMetadataProps extends VehicleBaseProps {
  isPublic: boolean;
  viewCount: number;
  onPrivacyChange: (isPublic: boolean) => void;
}