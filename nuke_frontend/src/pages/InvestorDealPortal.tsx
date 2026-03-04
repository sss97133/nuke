/**
 * InvestorDealPortal
 *
 * The "send Gerard a link and he buys" experience.
 * Route: /vehicle/:vehicleId/invest
 *
 * Curated investor-facing view of a vehicle:
 * - Hero image gallery
 * - Performance stats (video game style)
 * - Provenance timeline
 * - Market analysis & NukeEstimate
 * - Investment thesis
 * - Deal CTA → deposit flow
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import VehiclePerformanceCard from '../components/vehicle/VehiclePerformanceCard';
import '../styles/unified-design-system.css';

interface VehicleData {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  series: string | null;
  vin: string | null;
  mileage: number | null;
  color: string | null;
  interior_color: string | null;
  engine_type: string | null;
  engine_liters: number | null;
  horsepower: number | null;
  torque: number | null;
  transmission_type: string | null;
  drivetrain: string | null;
  body_style: string | null;
  description: string | null;
  highlights: string | null;
  modifications: string | null;
  known_flaws: string | null;
  recent_service_history: string | null;
  condition_rating: number | null;
  previous_owners: number | null;
  title_status: string | null;
  sale_price: number | null;
  asking_price: number | null;
  nuke_estimate: number | null;
  nuke_estimate_confidence: number | null;
  deal_score: number | null;
  heat_score: number | null;
  investment_grade: string | null;
  overall_desirability_score: number | null;
  social_positioning_score: number | null;
  provenance_score: number | null;
  investment_quality_score: number | null;
  is_public: boolean;
}

interface VehicleImage {
  id: string;
  image_url: string;
  thumbnail_url: string | null;
  medium_url: string | null;
  variants: any;
  caption: string | null;
  category: string | null;
  is_primary: boolean;
}

interface TimelineEvent {
  id: string;
  event_type: string;
  title: string | null;
  description: string | null;
  event_date: string | null;
  metadata: any;
}

interface DealFormData {
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string;
  buyer_organization: string;
  offer_amount: string;
  payment_method: 'wire' | 'ach' | 'card' | 'escrow';
  notes: string;
}

export default function InvestorDealPortal() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();
  const [vehicle, setVehicle] = useState<VehicleData | null>(null);
  const [images, setImages] = useState<VehicleImage[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [heroIndex, setHeroIndex] = useState(0);
  const [showDealModal, setShowDealModal] = useState(false);
  const [dealForm, setDealForm] = useState<DealFormData>({
    buyer_name: '',
    buyer_email: '',
    buyer_phone: '',
    buyer_organization: '',
    offer_amount: '',
    payment_method: 'wire',
    notes: '',
  });
  const [dealSubmitting, setDealSubmitting] = useState(false);
  const [dealSuccess, setDealSuccess] = useState(false);

  useEffect(() => {
    if (vehicleId) loadVehicle();
  }, [vehicleId]);

  const loadVehicle = async () => {
    if (!vehicleId) return;
    setLoading(true);

    try {
      // Fetch vehicle
      const { data: v } = await supabase
        .from('vehicles')
        .select(`
          id, year, make, model, trim, series, vin, mileage, color, interior_color,
          engine_type, engine_liters, horsepower, torque, transmission_type, drivetrain,
          body_style, description, highlights, modifications, known_flaws,
          recent_service_history, condition_rating, previous_owners, title_status,
          sale_price, asking_price, nuke_estimate, nuke_estimate_confidence,
          deal_score, heat_score, investment_grade,
          overall_desirability_score, social_positioning_score, provenance_score,
          investment_quality_score, is_public
        `)
        .eq('id', vehicleId)
        .single();

      if (v) setVehicle(v as VehicleData);

      // Fetch images
      const { data: imgs } = await supabase
        .from('vehicle_images')
        .select('id, image_url, thumbnail_url, medium_url, variants, caption, category, is_primary')
        .eq('vehicle_id', vehicleId)
        .order('is_primary', { ascending: false })
        .order('position', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(30);

      if (imgs) setImages(imgs as VehicleImage[]);

      // Fetch timeline events
      const { data: events } = await supabase
        .from('vehicle_timeline')
        .select('id, event_type, title, description, event_date, metadata')
        .eq('vehicle_id', vehicleId)
        .order('event_date', { ascending: false })
        .limit(20);

      if (events) setTimeline(events as TimelineEvent[]);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const getImageUrl = (img: VehicleImage, size: 'thumb' | 'medium' | 'full' = 'medium') => {
    const v = img.variants as any;
    if (size === 'thumb') return v?.thumbnail || img.thumbnail_url || v?.medium || img.medium_url || img.image_url;
    if (size === 'medium') return v?.medium || img.medium_url || img.image_url;
    return img.image_url;
  };

  const formatPrice = (val: number | null) => {
    if (val == null) return '--';
    return '$' + val.toLocaleString('en-US');
  };

  const handleDealSubmit = async () => {
    if (!vehicleId || !dealForm.buyer_name || !dealForm.buyer_email) return;
    setDealSubmitting(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase.from('vehicle_deal_offers').insert({
        vehicle_id: vehicleId,
        buyer_user_id: user?.id || null,
        buyer_name: dealForm.buyer_name,
        buyer_email: dealForm.buyer_email,
        buyer_phone: dealForm.buyer_phone || null,
        buyer_organization: dealForm.buyer_organization || null,
        offer_amount: parseFloat(dealForm.offer_amount) || 0,
        payment_method: dealForm.payment_method,
        notes: dealForm.notes || null,
        deal_status: 'inquiry',
      });

      if (!error) {
        setDealSuccess(true);
      }
    } catch {
      // ignore
    } finally {
      setDealSubmitting(false);
    }
  };

  const title = vehicle
    ? `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''} ${vehicle.trim || ''}`.trim()
    : '';

  const askingPrice = vehicle?.asking_price || vehicle?.sale_price || vehicle?.nuke_estimate;

  if (loading) {
    return (
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '40px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Loading vehicle profile...</div>
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '40px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: '13px', fontWeight: 700 }}>Vehicle not found</div>
        <button onClick={() => navigate('/')} style={{ marginTop: '12px', padding: '8px 16px', border: '2px solid var(--text)', background: 'var(--surface)', cursor: 'pointer', fontWeight: 700, fontSize: '11px' }}>
          Go Home
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 20px 60px' }}>
      {/* Top bar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '16px 0',
        borderBottom: '2px solid var(--text)',
        marginBottom: '20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', color: 'var(--text-secondary)' }}>
            NUKE
          </div>
          <div style={{ width: '1px', height: '16px', background: 'var(--border)' }} />
          <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px' }}>
            Investment Prospectus
          </div>
        </div>
        <button
          onClick={() => navigate(`/vehicle/${vehicleId}`)}
          style={{ fontSize: '9px', fontWeight: 700, border: '1px solid var(--border)', padding: '4px 10px', background: 'var(--surface)', cursor: 'pointer' }}
        >
          Full Profile
        </button>
      </div>

      {/* Hero section */}
      <div style={{ marginBottom: '24px' }}>
        {/* Main image */}
        {images.length > 0 && (
          <div style={{ position: 'relative', marginBottom: '8px' }}>
            <img
              src={getImageUrl(images[heroIndex], 'full')}
              alt={title}
              style={{
                width: '100%',
                height: '480px',
                objectFit: 'cover',
                display: 'block',
                border: '2px solid var(--text)',
              }}
            />
            {/* Navigation arrows */}
            {images.length > 1 && (
              <>
                <button
                  onClick={() => setHeroIndex((i) => (i > 0 ? i - 1 : images.length - 1))}
                  style={{
                    position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)',
                    width: '36px', height: '36px', border: '2px solid var(--text)', background: 'rgba(255,255,255,0.9)',
                    cursor: 'pointer', fontSize: '19px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  ‹
                </button>
                <button
                  onClick={() => setHeroIndex((i) => (i < images.length - 1 ? i + 1 : 0))}
                  style={{
                    position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
                    width: '36px', height: '36px', border: '2px solid var(--text)', background: 'rgba(255,255,255,0.9)',
                    cursor: 'pointer', fontSize: '19px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  ›
                </button>
              </>
            )}
            {/* Image count */}
            <div style={{
              position: 'absolute', bottom: '12px', right: '12px',
              background: 'rgba(0,0,0,0.8)', color: 'var(--bg)',
              padding: '4px 10px', fontSize: '9px', fontWeight: 700,
            }}>
              {heroIndex + 1} / {images.length}
            </div>
          </div>
        )}
        {/* Thumbnails */}
        {images.length > 1 && (
          <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', paddingBottom: '4px' }}>
            {images.slice(0, 12).map((img, idx) => (
              <img
                key={img.id}
                src={getImageUrl(img, 'thumb')}
                alt=""
                onClick={() => setHeroIndex(idx)}
                style={{
                  width: '72px', height: '54px', objectFit: 'cover', cursor: 'pointer',
                  border: idx === heroIndex ? '2px solid var(--text)' : '1px solid var(--border)',
                  opacity: idx === heroIndex ? 1 : 0.7,
                  flexShrink: 0,
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Title + Price bar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: '20px',
        marginBottom: '24px',
        flexWrap: 'wrap',
      }}>
        <div>
          <h1 style={{ fontSize: '29px', fontWeight: 800, margin: '0 0 4px', letterSpacing: '-0.5px' }}>
            {title}
          </h1>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            {vehicle.vin && <span>VIN: {vehicle.vin}</span>}
            {vehicle.mileage != null && <span>{vehicle.mileage.toLocaleString()} mi</span>}
            {vehicle.color && <span>{vehicle.color}</span>}
            {vehicle.previous_owners != null && <span>{vehicle.previous_owners} owner{vehicle.previous_owners !== 1 ? 's' : ''}</span>}
            {vehicle.title_status && <span>Title: {vehicle.title_status}</span>}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {askingPrice && (
            <div style={{ fontSize: '29px', fontWeight: 800 }}>{formatPrice(askingPrice)}</div>
          )}
          {vehicle.nuke_estimate && vehicle.nuke_estimate !== askingPrice && (
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              Nuke Estimate: {formatPrice(vehicle.nuke_estimate)}
              {vehicle.nuke_estimate_confidence && (
                <span style={{ marginLeft: '4px' }}>({vehicle.nuke_estimate_confidence}% conf.)</span>
              )}
            </div>
          )}
          {vehicle.investment_grade && (
            <div style={{
              display: 'inline-block',
              padding: '3px 10px',
              border: '2px solid var(--text)',
              fontSize: '11px',
              fontWeight: 800,
              textTransform: 'uppercase',
              marginTop: '4px',
            }}>
              Grade: {vehicle.investment_grade}
            </div>
          )}
        </div>
      </div>

      {/* Main grid: left = details, right = performance + deal */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 380px',
        gap: '24px',
        alignItems: 'start',
      }}>
        {/* LEFT COLUMN */}
        <div>
          {/* Investment Thesis */}
          {(vehicle.highlights || vehicle.description) && (
            <div style={{ border: '2px solid var(--text)', marginBottom: '20px' }}>
              <div style={{
                padding: '10px 14px',
                borderBottom: '1px solid var(--border)',
                fontSize: '12px',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '1px',
              }}>
                Vehicle Overview
              </div>
              <div style={{ padding: '14px' }}>
                {vehicle.highlights && (
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, marginBottom: '4px', textTransform: 'uppercase' }}>
                      Highlights
                    </div>
                    <div style={{ fontSize: '12px', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                      {vehicle.highlights}
                    </div>
                  </div>
                )}
                {vehicle.description && (
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, marginBottom: '4px', textTransform: 'uppercase' }}>
                      Description
                    </div>
                    <div style={{ fontSize: '12px', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                      {vehicle.description}
                    </div>
                  </div>
                )}
                {vehicle.modifications && (
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, marginBottom: '4px', textTransform: 'uppercase' }}>
                      Modifications
                    </div>
                    <div style={{ fontSize: '12px', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                      {vehicle.modifications}
                    </div>
                  </div>
                )}
                {vehicle.known_flaws && (
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, marginBottom: '4px', textTransform: 'uppercase' }}>
                      Known Issues
                    </div>
                    <div style={{ fontSize: '12px', lineHeight: '1.5', whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>
                      {vehicle.known_flaws}
                    </div>
                  </div>
                )}
                {vehicle.recent_service_history && (
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 700, marginBottom: '4px', textTransform: 'uppercase' }}>
                      Recent Service
                    </div>
                    <div style={{ fontSize: '12px', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                      {vehicle.recent_service_history}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Key specs grid */}
          <div style={{ border: '2px solid var(--text)', marginBottom: '20px' }}>
            <div style={{
              padding: '10px 14px',
              borderBottom: '1px solid var(--border)',
              fontSize: '12px',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '1px',
            }}>
              Specifications
            </div>
            <div style={{ padding: '14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {[
                ['Year', vehicle.year],
                ['Make', vehicle.make],
                ['Model', `${vehicle.model || ''} ${vehicle.trim || ''} ${vehicle.series || ''}`.trim()],
                ['Engine', `${vehicle.engine_liters ? vehicle.engine_liters + 'L ' : ''}${vehicle.engine_type || ''}`],
                ['Power', vehicle.horsepower ? `${vehicle.horsepower} hp` : null],
                ['Torque', vehicle.torque ? `${vehicle.torque} lb-ft` : null],
                ['Transmission', vehicle.transmission_type],
                ['Drivetrain', vehicle.drivetrain],
                ['Body Style', vehicle.body_style],
                ['Exterior', vehicle.color],
                ['Interior', vehicle.interior_color],
                ['Mileage', vehicle.mileage != null ? `${vehicle.mileage.toLocaleString()} mi` : null],
                ['Condition', vehicle.condition_rating ? `${vehicle.condition_rating}/10` : null],
                ['VIN', vehicle.vin],
              ]
                .filter(([, val]) => val != null && String(val).trim() !== '')
                .map(([label, val]) => (
                  <div key={String(label)} style={{ borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
                    <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-disabled)', marginBottom: '2px' }}>
                      {label}
                    </div>
                    <div style={{ fontSize: '12px', fontWeight: 600 }}>{val}</div>
                  </div>
                ))}
            </div>
          </div>

          {/* Provenance timeline */}
          {timeline.length > 0 && (
            <div style={{ border: '2px solid var(--text)', marginBottom: '20px' }}>
              <div style={{
                padding: '10px 14px',
                borderBottom: '1px solid var(--border)',
                fontSize: '12px',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '1px',
              }}>
                Provenance Timeline
              </div>
              <div style={{ padding: '14px' }}>
                {timeline.map((event, idx) => (
                  <div key={event.id} style={{
                    display: 'flex',
                    gap: '12px',
                    paddingBottom: idx < timeline.length - 1 ? '12px' : '0',
                    marginBottom: idx < timeline.length - 1 ? '12px' : '0',
                    borderBottom: idx < timeline.length - 1 ? '1px solid var(--border)' : 'none',
                  }}>
                    <div style={{
                      width: '8px', height: '8px', borderRadius: '50%',
                      background: 'var(--text)', flexShrink: 0, marginTop: '4px',
                    }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '11px', fontWeight: 700 }}>
                        {event.title || event.event_type.replace(/_/g, ' ')}
                      </div>
                      {event.event_date && (
                        <div style={{ fontSize: '9px', color: 'var(--text-disabled)', marginTop: '1px' }}>
                          {new Date(event.event_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                        </div>
                      )}
                      {event.description && (
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                          {event.description}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Market scores */}
          <div style={{ border: '2px solid var(--text)' }}>
            <div style={{
              padding: '10px 14px',
              borderBottom: '1px solid var(--border)',
              fontSize: '12px',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '1px',
            }}>
              Market Intelligence
            </div>
            <div style={{ padding: '14px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
              {vehicle.deal_score != null && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '27px', fontWeight: 800 }}>{Math.round(vehicle.deal_score)}</div>
                  <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Deal Score</div>
                </div>
              )}
              {vehicle.heat_score != null && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '27px', fontWeight: 800 }}>{Math.round(vehicle.heat_score)}</div>
                  <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Heat Score</div>
                </div>
              )}
              {vehicle.provenance_score != null && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '27px', fontWeight: 800 }}>{vehicle.provenance_score}</div>
                  <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Provenance</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN - Performance + Deal CTA */}
        <div style={{ position: 'sticky', top: '20px' }}>
          {/* Performance card */}
          <div style={{ marginBottom: '20px' }}>
            <VehiclePerformanceCard vehicleId={vehicleId!} />
          </div>

          {/* Deal CTA */}
          <div style={{
            border: '2px solid var(--text)',
            background: 'var(--text)',
            color: 'var(--bg)',
          }}>
            <div style={{ padding: '16px' }}>
              <div style={{ fontSize: '13px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
                Acquire This Vehicle
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-disabled)', marginBottom: '16px', lineHeight: '1.4' }}>
                Submit an inquiry or make a deposit to begin the acquisition process. Wire instructions will be provided upon request.
              </div>
              {askingPrice && (
                <div style={{ fontSize: '24px', fontWeight: 800, marginBottom: '16px' }}>
                  {formatPrice(askingPrice)}
                </div>
              )}
              <button
                onClick={() => setShowDealModal(true)}
                style={{
                  width: '100%',
                  padding: '12px',
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  border: 'none',
                  fontSize: '12px',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  cursor: 'pointer',
                }}
              >
                Begin Acquisition
              </button>
            </div>
          </div>

          {/* Trust signals */}
          <div style={{
            marginTop: '12px',
            padding: '12px',
            border: '1px solid var(--border)',
            fontSize: '9px',
            color: 'var(--text-secondary)',
          }}>
            <div style={{ fontWeight: 700, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Buyer Protection
            </div>
            <div style={{ lineHeight: '1.6' }}>
              {'\u2713'} Escrow-protected deposits{'\n'}
              {'\u2713'} Verified vehicle data{'\n'}
              {'\u2713'} Independent inspection option{'\n'}
              {'\u2713'} Secure wire transfer{'\n'}
              {'\u2713'} Full provenance documentation
            </div>
          </div>
        </div>
      </div>

      {/* Deal Modal */}
      {showDealModal && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'var(--overlay)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9999,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowDealModal(false); }}
        >
          <div style={{
            background: 'var(--surface)', width: '100%', maxWidth: '520px',
            maxHeight: '90vh', overflow: 'auto',
            border: '2px solid var(--text)',
          }}>
            {dealSuccess ? (
              <div style={{ padding: '40px', textAlign: 'center' }}>
                <div style={{ fontSize: '32px', marginBottom: '16px' }}>{'\u2713'}</div>
                <div style={{ fontSize: '16px', fontWeight: 800, marginBottom: '8px' }}>Inquiry Submitted</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: '1.5' }}>
                  Your inquiry for the {title} has been received. Wire instructions and next steps will be sent to {dealForm.buyer_email} shortly.
                </div>
                <button
                  onClick={() => { setShowDealModal(false); setDealSuccess(false); }}
                  style={{
                    padding: '10px 24px', border: '2px solid var(--text)', background: 'var(--text)',
                    color: 'var(--bg)', fontWeight: 700, fontSize: '12px', cursor: 'pointer',
                  }}
                >
                  Close
                </button>
              </div>
            ) : (
              <>
                <div style={{
                  padding: '16px 20px',
                  borderBottom: '2px solid var(--text)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px' }}>
                      Acquisition Inquiry
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{title}</div>
                  </div>
                  <button
                    onClick={() => setShowDealModal(false)}
                    style={{ border: 'none', background: 'none', fontSize: '21px', cursor: 'pointer', fontWeight: 700 }}
                  >
                    ×
                  </button>
                </div>
                <div style={{ padding: '20px' }}>
                  {/* Form fields */}
                  {[
                    { key: 'buyer_name', label: 'Full Name *', type: 'text' },
                    { key: 'buyer_email', label: 'Email *', type: 'email' },
                    { key: 'buyer_phone', label: 'Phone', type: 'tel' },
                    { key: 'buyer_organization', label: 'Fund / Organization', type: 'text' },
                  ].map(({ key, label, type }) => (
                    <div key={key} style={{ marginBottom: '12px' }}>
                      <label style={{ display: 'block', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
                        {label}
                      </label>
                      <input
                        type={type}
                        value={(dealForm as any)[key]}
                        onChange={(e) => setDealForm((f) => ({ ...f, [key]: e.target.value }))}
                        style={{
                          width: '100%', padding: '8px 10px', border: '2px solid var(--text)',
                          fontSize: '12px', fontWeight: 600, boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  ))}

                  {/* Offer amount */}
                  <div style={{ marginBottom: '12px' }}>
                    <label style={{ display: 'block', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
                      Offer Amount (USD)
                    </label>
                    <input
                      type="number"
                      value={dealForm.offer_amount}
                      onChange={(e) => setDealForm((f) => ({ ...f, offer_amount: e.target.value }))}
                      placeholder={askingPrice ? String(askingPrice) : ''}
                      style={{
                        width: '100%', padding: '8px 10px', border: '2px solid var(--text)',
                        fontSize: '12px', fontWeight: 600, boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  {/* Payment method */}
                  <div style={{ marginBottom: '12px' }}>
                    <label style={{ display: 'block', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
                      Preferred Payment
                    </label>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {(['wire', 'ach', 'card', 'escrow'] as const).map((method) => (
                        <button
                          key={method}
                          onClick={() => setDealForm((f) => ({ ...f, payment_method: method }))}
                          style={{
                            padding: '6px 12px',
                            border: `2px solid ${dealForm.payment_method === method ? 'var(--text)' : 'var(--border)'}`,
                            background: dealForm.payment_method === method ? 'var(--text)' : 'var(--surface)',
                            color: dealForm.payment_method === method ? 'var(--bg)' : 'var(--text)',
                            fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
                            cursor: 'pointer',
                          }}
                        >
                          {method}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Notes */}
                  <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
                      Notes
                    </label>
                    <textarea
                      value={dealForm.notes}
                      onChange={(e) => setDealForm((f) => ({ ...f, notes: e.target.value }))}
                      rows={3}
                      placeholder="Questions, inspection requests, financing details..."
                      style={{
                        width: '100%', padding: '8px 10px', border: '2px solid var(--text)',
                        fontSize: '12px', fontWeight: 500, boxSizing: 'border-box', resize: 'vertical',
                      }}
                    />
                  </div>

                  {/* Submit */}
                  <button
                    onClick={handleDealSubmit}
                    disabled={dealSubmitting || !dealForm.buyer_name || !dealForm.buyer_email}
                    style={{
                      width: '100%', padding: '12px', border: 'none',
                      background: dealSubmitting ? 'var(--text-secondary)' : 'var(--text)',
                      color: 'var(--bg)', fontSize: '12px', fontWeight: 800,
                      textTransform: 'uppercase', letterSpacing: '1px',
                      cursor: dealSubmitting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {dealSubmitting ? 'Submitting...' : 'Submit Inquiry'}
                  </button>

                  <div style={{ fontSize: '9px', color: 'var(--text-disabled)', textAlign: 'center', marginTop: '12px', lineHeight: '1.4' }}>
                    By submitting, you agree to receive wire instructions and deal documentation via email.
                    Deposits are held in escrow until both parties confirm.
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
