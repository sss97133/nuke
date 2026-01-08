import React from 'react';
import VehicleDescriptionCard from '../../components/vehicle/VehicleDescriptionCard';
import VehicleCommentsCard from '../../components/vehicle/VehicleCommentsCard';
import VehicleBasicInfo from './VehicleBasicInfo';
import VehicleROISummaryCard from '../../components/vehicle/VehicleROISummaryCard';
import { VehicleStructuredListingDataCard } from './VehicleStructuredListingDataCard';
import VehicleReferenceLibrary from '../../components/vehicle/VehicleReferenceLibrary';
import type { Vehicle, VehiclePermissions } from './types';

interface VehicleDescriptionTabProps {
  vehicle: Vehicle;
  session: any;
  permissions: VehiclePermissions;
  canEdit: boolean;
  onDataPointClick: (e: React.MouseEvent, fieldName: string, fieldValue: string, fieldLabel: string) => void;
  onEditClick: () => void;
  referenceLibraryRefreshKey: number;
  onReferenceLibraryRefresh: () => void;
}

const VehicleDescriptionTab: React.FC<VehicleDescriptionTabProps> = ({
  vehicle,
  session,
  permissions,
  canEdit,
  onDataPointClick,
  onEditClick,
  referenceLibraryRefreshKey,
  onReferenceLibraryRefresh
}) => {
  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)', gridTemplateColumns: '320px 1fr' }}>
      {/* Left Column: Vehicle Info & Tools */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {/* Basic Info */}
        <React.Suspense fallback={<div style={{ padding: '12px' }}>Loading basic info...</div>}>
          <VehicleBasicInfo
            vehicle={vehicle}
            session={session}
            permissions={permissions}
            onDataPointClick={onDataPointClick}
            onEditClick={onEditClick}
          />
        </React.Suspense>

        {/* Investment / ROI summary */}
        <VehicleROISummaryCard vehicleId={vehicle.id} />
        
        {/* Structured listing data (Options / Service records / etc.) */}
        <VehicleStructuredListingDataCard vehicle={vehicle} />
        
        {/* Reference Documents - Upload and Display (merged) */}
        <VehicleReferenceLibrary
          vehicleId={vehicle.id}
          userId={session?.user?.id}
          year={vehicle.year}
          make={vehicle.make}
          series={(vehicle as any).series}
          model={vehicle.model}
          bodyStyle={(vehicle as any).body_style}
          refreshKey={referenceLibraryRefreshKey}
          onUploadComplete={onReferenceLibraryRefresh}
        />
      </div>

      {/* Right Column: Description & Comments */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {/* Description */}
        <VehicleDescriptionCard
          vehicleId={vehicle.id}
          initialDescription={vehicle.description}
          isEditable={canEdit}
          onUpdate={() => {}}
        />

        {/* Comments */}
        <VehicleCommentsCard
          vehicleId={vehicle.id}
          session={session}
          collapsed={false}
          maxVisible={50}
        />
      </div>
    </div>
  );
};

export default VehicleDescriptionTab;

