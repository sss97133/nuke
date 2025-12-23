import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import type { Vehicle, VehiclePermissions } from './types';

interface VehicleTaxonomyTabProps {
  vehicle: Vehicle;
  session: any;
  permissions: VehiclePermissions;
  canEdit: boolean;
}

interface NomenclatureData {
  trim?: string;
  series?: string;
  body_designation?: string;
  drive_type?: string;
  weight_class?: string;
  wheelbase?: string;
  bed_length?: string;
  cab_style?: string;
  is_dually?: boolean;
  is_diesel?: boolean;
  is_hd?: boolean;
  is_special_edition?: boolean;
  special_edition_name?: string;
  package_code?: string;
  interior_trim_code?: string;
  exterior_color_code?: string;
  paint_code?: string;
  oem_model_code?: string;
  oem_chassis_code?: string;
}

const VehicleTaxonomyTab: React.FC<VehicleTaxonomyTabProps> = ({
  vehicle,
  session,
  permissions,
  canEdit
}) => {
  const [nomenclature, setNomenclature] = useState<NomenclatureData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadNomenclature();
  }, [vehicle.id]);

  const loadNomenclature = async () => {
    try {
      const { data, error } = await supabase
        .from('vehicle_nomenclature')
        .select('*')
        .eq('vehicle_id', vehicle.id)
        .single();

      if (!error && data) {
        setNomenclature(data);
      }
    } catch (error) {
      console.error('Error loading nomenclature:', error);
    } finally {
      setLoading(false);
    }
  };

  const buildTaxonomyGroups = () => {
    const groups: Array<{ title: string; items: Array<{ label: string; value: string | boolean | null }> }> = [];

    // Core Identification
    const coreItems: Array<{ label: string; value: string | boolean | null }> = [];
    if (vehicle.year) coreItems.push({ label: 'Year', value: vehicle.year });
    if (vehicle.make) coreItems.push({ label: 'Make', value: vehicle.make });
    if (vehicle.model) coreItems.push({ label: 'Model', value: vehicle.model });
    if ((vehicle as any).series) coreItems.push({ label: 'Series', value: (vehicle as any).series });
    if (coreItems.length > 0) {
      groups.push({ title: 'Core Identification', items: coreItems });
    }

    // Sub-Model Taxonomy
    if (nomenclature) {
      const subModelItems: Array<{ label: string; value: string | boolean | null }> = [];
      if (nomenclature.trim) subModelItems.push({ label: 'Trim', value: nomenclature.trim });
      if (nomenclature.series) subModelItems.push({ label: 'Series', value: nomenclature.series });
      if (nomenclature.body_designation) subModelItems.push({ label: 'Body Designation', value: nomenclature.body_designation });
      if (subModelItems.length > 0) {
        groups.push({ title: 'Sub-Model Taxonomy', items: subModelItems });
      }

      // Drivetrain Nomenclature
      const drivetrainItems: Array<{ label: string; value: string | boolean | null }> = [];
      if (nomenclature.drive_type) drivetrainItems.push({ label: 'Drive Type', value: nomenclature.drive_type });
      if (nomenclature.weight_class) drivetrainItems.push({ label: 'Weight Class', value: nomenclature.weight_class });
      if (nomenclature.wheelbase) drivetrainItems.push({ label: 'Wheelbase', value: nomenclature.wheelbase });
      if (nomenclature.bed_length) drivetrainItems.push({ label: 'Bed Length', value: nomenclature.bed_length });
      if (nomenclature.cab_style) drivetrainItems.push({ label: 'Cab Style', value: nomenclature.cab_style });
      if (drivetrainItems.length > 0) {
        groups.push({ title: 'Drivetrain Nomenclature', items: drivetrainItems });
      }

      // Special Designations
      const specialItems: Array<{ label: string; value: string | boolean | null }> = [];
      if (nomenclature.is_dually) specialItems.push({ label: 'Dually', value: 'Yes' });
      if (nomenclature.is_diesel) specialItems.push({ label: 'Diesel', value: 'Yes' });
      if (nomenclature.is_hd) specialItems.push({ label: 'Heavy Duty', value: 'Yes' });
      if (nomenclature.is_special_edition) specialItems.push({ label: 'Special Edition', value: 'Yes' });
      if (nomenclature.special_edition_name) specialItems.push({ label: 'Special Edition Name', value: nomenclature.special_edition_name });
      if (specialItems.length > 0) {
        groups.push({ title: 'Special Designations', items: specialItems });
      }

      // OEM Codes
      const oemItems: Array<{ label: string; value: string | boolean | null }> = [];
      if (nomenclature.package_code) oemItems.push({ label: 'Package Code', value: nomenclature.package_code });
      if (nomenclature.interior_trim_code) oemItems.push({ label: 'Interior Trim Code', value: nomenclature.interior_trim_code });
      if (nomenclature.exterior_color_code) oemItems.push({ label: 'Exterior Color Code', value: nomenclature.exterior_color_code });
      if (nomenclature.paint_code) oemItems.push({ label: 'Paint Code', value: nomenclature.paint_code });
      if (nomenclature.oem_model_code) oemItems.push({ label: 'OEM Model Code', value: nomenclature.oem_model_code });
      if (nomenclature.oem_chassis_code) oemItems.push({ label: 'OEM Chassis Code', value: nomenclature.oem_chassis_code });
      if (oemItems.length > 0) {
        groups.push({ title: 'OEM Codes', items: oemItems });
      }
    }

    // Body Style & Classification
    const classificationItems: Array<{ label: string; value: string | boolean | null }> = [];
    if ((vehicle as any).body_style) classificationItems.push({ label: 'Body Style', value: (vehicle as any).body_style });
    if (vehicle.drivetrain) classificationItems.push({ label: 'Drivetrain', value: vehicle.drivetrain });
    if ((vehicle as any).fuel_type) classificationItems.push({ label: 'Fuel Type', value: (vehicle as any).fuel_type });
    if (classificationItems.length > 0) {
      groups.push({ title: 'Classification', items: classificationItems });
    }

    return groups;
  };

  const taxonomyGroups = buildTaxonomyGroups();

  if (loading) {
    return <div style={{ padding: '24px', textAlign: 'center' }}>Loading taxonomy...</div>;
  }

  return (
    <div style={{ maxWidth: '1200px' }}>
      {taxonomyGroups.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
          No taxonomy data available. {canEdit && (
            <span style={{ marginLeft: '8px', color: 'var(--text-muted)' }}>
              Taxonomy data can be added through the vehicle editor.
            </span>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          {taxonomyGroups.map((group, groupIndex) => (
            <div key={groupIndex} className="card">
              <div className="card-header">
                <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>{group.title}</h3>
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                  gap: '1px',
                  backgroundColor: 'var(--border-light)'
                }}>
                  {group.items.map((item, itemIndex) => (
                    <div
                      key={itemIndex}
                      style={{
                        padding: '12px 16px',
                        backgroundColor: 'var(--surface)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px'
                      }}
                    >
                      <dt style={{
                        fontSize: '12px',
                        fontWeight: 500,
                        color: 'var(--text-muted)',
                        margin: 0
                      }}>
                        {item.label}
                      </dt>
                      <dd style={{
                        fontSize: '14px',
                        color: 'var(--text)',
                        margin: 0
                      }}>
                        {typeof item.value === 'boolean' ? (item.value ? 'Yes' : 'No') : String(item.value || 'Not specified')}
                      </dd>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default VehicleTaxonomyTab;

