import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { VehicleInquiryModal } from '../../components/organization/VehicleInquiryModal';
import type { StorefrontOrg } from '../StorefrontApp';

interface Props {
  organization: StorefrontOrg;
}

interface VehicleDetail {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  series: string | null;
  body_style: string | null;
  vin: string | null;
  image_url: string | null;
  primary_image_url: string | null;
  sale_price: number | null;
  asking_price: number | null;
  current_value: number | null;
  mileage: number | null;
  transmission: string | null;
  engine: string | null;
  drivetrain: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  description: string | null;
  condition_rating: number | null;
  location: string | null;
}

interface VehicleImage {
  id: string;
  url: string;
  source_url: string | null;
  is_primary: boolean;
}

export default function StorefrontVehicleDetail({ organization }: Props) {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const [vehicle, setVehicle] = useState<VehicleDetail | null>(null);
  const [images, setImages] = useState<VehicleImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeImage, setActiveImage] = useState(0);
  const [showInquiry, setShowInquiry] = useState(false);

  useEffect(() => {
    if (!vehicleId) return;

    (async () => {
      // Verify vehicle belongs to this org
      const { data: link } = await supabase
        .from('organization_vehicles')
        .select('vehicle_id')
        .eq('organization_id', organization.id)
        .eq('vehicle_id', vehicleId)
        .eq('status', 'active')
        .maybeSingle();

      if (!link) {
        setLoading(false);
        return;
      }

      // Fetch vehicle detail
      const { data } = await supabase
        .from('vehicles')
        .select('id, year, make, model, trim, series, body_style, vin, image_url, primary_image_url, sale_price, asking_price, current_value, mileage, transmission, engine, drivetrain, exterior_color, interior_color, description, condition_rating, location')
        .eq('id', vehicleId)
        .maybeSingle();

      if (data) setVehicle(data);

      // Fetch images
      const { data: imgs } = await supabase
        .from('vehicle_images')
        .select('id, image_url, source_url, is_primary')
        .eq('vehicle_id', vehicleId)
        .not('image_vehicle_match_status', 'in', '("mismatch","unrelated")')
        .order('is_primary', { ascending: false })
        .limit(30);

      if (imgs) setImages(imgs);

      setLoading(false);
    })();
  }, [vehicleId, organization]);

  // Update page title
  useEffect(() => {
    if (!vehicle) return;
    const title = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(' ');
    document.title = `${title} | ${organization.business_name}`;
  }, [vehicle, organization]);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', fontFamily: 'Arial, sans-serif', fontSize: 'var(--fs-9, 9px)', color: 'var(--text-secondary)' }}>
        Loading vehicle...
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div style={{ padding: 40, textAlign: 'center', fontFamily: 'Arial, sans-serif' }}>
        <p style={{ fontSize: 'var(--fs-9, 9px)', color: 'var(--text-secondary)', marginBottom: 16 }}>Vehicle not found.</p>
        <Link to="/inventory" style={{ fontSize: 'var(--fs-9, 9px)', color: 'var(--accent)' }}>Back to Inventory</Link>
      </div>
    );
  }

  const title = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(' ');
  const price = vehicle.sale_price || vehicle.asking_price || vehicle.current_value;
  const heroImage = images[activeImage]?.image_url || vehicle.primary_image_url || vehicle.image_url;

  const specs: { label: string; value: string }[] = [
    vehicle.engine && { label: 'Engine', value: vehicle.engine },
    vehicle.transmission && { label: 'Transmission', value: vehicle.transmission },
    vehicle.drivetrain && { label: 'Drivetrain', value: vehicle.drivetrain },
    vehicle.mileage && { label: 'Mileage', value: vehicle.mileage.toLocaleString() + ' mi' },
    vehicle.exterior_color && { label: 'Exterior', value: vehicle.exterior_color },
    vehicle.interior_color && { label: 'Interior', value: vehicle.interior_color },
    vehicle.body_style && { label: 'Body', value: vehicle.body_style },
    vehicle.vin && { label: 'VIN', value: vehicle.vin },
    vehicle.location && { label: 'Location', value: vehicle.location },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div style={{ fontFamily: 'Arial, sans-serif' }}>
      {/* Breadcrumb */}
      <div style={{ marginBottom: 16, fontSize: 'var(--fs-8, 8px)' }}>
        <Link to="/inventory" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Inventory</Link>
        <span style={{ color: 'var(--text-disabled)', margin: '0 6px' }}>/</span>
        <span style={{ color: 'var(--text)' }}>{title}</span>
      </div>

      {/* Main Content */}
      <div style={{ display: 'grid', gridTemplateColumns: images.length > 0 ? '1fr 360px' : '1fr', gap: 24 }}>
        {/* Left: Images */}
        <div>
          {/* Hero Image */}
          {heroImage && (
            <div style={{
              aspectRatio: '16/10',
              background: 'var(--bg)',
              border: '2px solid var(--border)',
              overflow: 'hidden',
              marginBottom: 8,
            }}>
              <img src={heroImage} alt={title} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </div>
          )}

          {/* Thumbnail Strip */}
          {images.length > 1 && (
            <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 4 }}>
              {images.map((img, i) => (
                <div
                  key={img.id}
                  onClick={() => setActiveImage(i)}
                  style={{
                    width: 64,
                    height: 44,
                    flexShrink: 0,
                    border: `2px solid ${i === activeImage ? 'var(--accent)' : 'var(--border)'}`,
                    overflow: 'hidden',
                    cursor: 'pointer',
                  }}
                >
                  <img src={img.image_url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              ))}
            </div>
          )}

          {/* Description */}
          {vehicle.description && (
            <div style={{ marginTop: 20 }}>
              <h3 style={{ fontSize: 'var(--fs-9, 9px)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text)', marginBottom: 8 }}>
                Description
              </h3>
              <p style={{ fontSize: 'var(--fs-9, 9px)', color: 'var(--text-secondary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {vehicle.description}
              </p>
            </div>
          )}
        </div>

        {/* Right: Details Panel */}
        <div>
          <div style={{ background: 'var(--surface)', border: '2px solid var(--border)', padding: 16 }}>
            <h1 style={{ fontSize: 'var(--fs-11, 11px)', fontWeight: 700, color: 'var(--text)', margin: '0 0 8px 0' }}>
              {title}
            </h1>

            {price && (
              <div style={{ fontSize: 'var(--fs-11, 11px)', fontWeight: 700, color: 'var(--accent)', fontFamily: 'monospace', marginBottom: 16 }}>
                ${price.toLocaleString()}
              </div>
            )}

            {/* Specs Table */}
            {specs.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-8, 8px)' }}>
                <tbody>
                  {specs.map(({ label, value }) => (
                    <tr key={label} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 0', color: 'var(--text-secondary)', fontWeight: 600, width: 90 }}>{label}</td>
                      <td style={{ padding: '6px 0', color: 'var(--text)' }}>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Contact */}
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '2px solid var(--border)' }}>
              <div style={{ fontSize: 'var(--fs-8, 8px)', color: 'var(--text-secondary)', marginBottom: 8 }}>
                Contact {organization.business_name}
              </div>
              {organization.phone && (
                <a href={`tel:${organization.phone}`} style={{ display: 'block', fontSize: 'var(--fs-9, 9px)', color: 'var(--accent)', marginBottom: 4 }}>
                  {organization.phone}
                </a>
              )}
              {organization.email && (
                <a href={`mailto:${organization.email}?subject=Inquiry: ${title}`} style={{ display: 'block', fontSize: 'var(--fs-9, 9px)', color: 'var(--accent)' }}>
                  {organization.email}
                </a>
              )}
              <button
                onClick={() => setShowInquiry(true)}
                style={{
                  marginTop: 12,
                  width: '100%',
                  padding: '8px 16px',
                  fontSize: 'var(--fs-9, 9px)',
                  fontFamily: 'Arial, sans-serif',
                  fontWeight: 600,
                  background: 'var(--accent)',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Inquire About This Vehicle
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Inquiry Modal */}
      {showInquiry && (
        <VehicleInquiryModal
          vehicleId={vehicle.id}
          vehicleName={title}
          organizationId={organization.id}
          organizationName={organization.business_name}
          onClose={() => setShowInquiry(false)}
          onSubmitted={() => setShowInquiry(false)}
        />
      )}
    </div>
  );
}
