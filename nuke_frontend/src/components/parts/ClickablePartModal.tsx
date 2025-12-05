/**
 * Clickable Part Modal
 * 
 * When user clicks a part tag on an image, this modal shows:
 * - Part search results across suppliers
 * - Order tracking
 * - Installation documentation
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { 
  searchParts, 
  trackPartOrder, 
  documentInstallation
} from '../../services/partsMarketplaceService';
import type { PartSearchResult } from '../../services/partsMarketplaceService';
import '../../design-system.css';

interface ClickablePartModalProps {
  isOpen: boolean;
  onClose: () => void;
  partName: string;
  vehicleId: string;
  vehicleYMM?: { year?: number; make?: string; model?: string };
  imageId?: string;
  userId?: string;
}

export const ClickablePartModal: React.FC<ClickablePartModalProps> = ({
  isOpen,
  onClose,
  partName,
  vehicleId,
  vehicleYMM,
  imageId,
  userId
}) => {
  const [searchResults, setSearchResults] = useState<PartSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'search' | 'order' | 'install'>('search');
  const [selectedSupplier, setSelectedSupplier] = useState<string | null>(null);
  const [orderTracking, setOrderTracking] = useState<any>(null);
  const [installationData, setInstallationData] = useState({
    installationDate: new Date().toISOString().split('T')[0],
    notes: '',
    laborHours: '',
    difficulty: 'moderate' as 'easy' | 'moderate' | 'hard' | 'expert'
  });

  useEffect(() => {
    if (isOpen && partName) {
      loadSearchResults();
    }
  }, [isOpen, partName, vehicleYMM]);

  const loadSearchResults = async () => {
    setLoading(true);
    try {
      const results = await searchParts({
        partName,
        year: vehicleYMM?.year,
        make: vehicleYMM?.make,
        model: vehicleYMM?.model
      });
      setSearchResults(results);
    } catch (error) {
      console.error('Error searching parts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleOrder = async (supplier: any) => {
    if (!userId) {
      alert('Please log in to track orders');
      return;
    }

    setLoading(true);
    try {
      const order = await trackPartOrder({
        userId,
        vehicleId,
        partName,
        supplierId: supplier.id,
        supplierName: supplier.name,
        price: supplier.price,
        orderUrl: supplier.url,
        imageId
      });

      setOrderTracking(order);
      setSelectedSupplier(supplier.id);
      setActiveTab('order');
    } catch (error) {
      console.error('Error tracking order:', error);
      alert('Failed to track order. You can still order directly from the supplier.');
    } finally {
      setLoading(false);
    }
  };

  const handleInstallation = async () => {
    if (!orderTracking) {
      alert('Please track an order first');
      return;
    }

    setLoading(true);
    try {
      await documentInstallation({
        orderId: orderTracking.id,
        vehicleId,
        partName,
        installationDate: installationData.installationDate,
        notes: installationData.notes,
        laborHours: installationData.laborHours ? parseFloat(installationData.laborHours) : undefined,
        difficulty: installationData.difficulty
      });

      alert('Installation documented! This will appear in your vehicle timeline and job stats.');
      onClose();
    } catch (error) {
      console.error('Error documenting installation:', error);
      alert('Failed to document installation');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000,
      padding: '20px'
    }}>
      <div style={{
        background: 'var(--background)',
        borderRadius: '8px',
        maxWidth: '800px',
        width: '100%',
        maxHeight: '90vh',
        overflow: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
      }}>
        {/* Header */}
        <div style={{
          padding: '20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <h2 style={{ margin: 0, fontSize: '16pt' }}>Part: {partName}</h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '24pt',
              cursor: 'pointer',
              color: 'var(--text)'
            }}
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid var(--border)'
        }}>
          <button
            onClick={() => setActiveTab('search')}
            style={{
              padding: '12px 24px',
              background: activeTab === 'search' ? 'var(--color-primary)' : 'transparent',
              color: activeTab === 'search' ? '#fff' : 'var(--text)',
              border: 'none',
              cursor: 'pointer',
              fontSize: '10pt',
              fontWeight: activeTab === 'search' ? 600 : 400
            }}
          >
            Find Part
          </button>
          {orderTracking && (
            <>
              <button
                onClick={() => setActiveTab('order')}
                style={{
                  padding: '12px 24px',
                  background: activeTab === 'order' ? 'var(--color-primary)' : 'transparent',
                  color: activeTab === 'order' ? '#fff' : 'var(--text)',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '10pt',
                  fontWeight: activeTab === 'order' ? 600 : 400
                }}
              >
                Order Status
              </button>
              <button
                onClick={() => setActiveTab('install')}
                style={{
                  padding: '12px 24px',
                  background: activeTab === 'install' ? 'var(--color-primary)' : 'transparent',
                  color: activeTab === 'install' ? '#fff' : 'var(--text)',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '10pt',
                  fontWeight: activeTab === 'install' ? 600 : 400
                }}
              >
                Document Installation
              </button>
            </>
          )}
        </div>

        {/* Content */}
        <div style={{ padding: '20px' }}>
          {/* Search Tab */}
          {activeTab === 'search' && (
            <div>
              {loading ? (
                <div style={{ textAlign: 'center', padding: '40px' }}>
                  <div className="spinner" />
                  <p style={{ marginTop: '16px', color: 'var(--text-muted)' }}>
                    Searching suppliers...
                  </p>
                </div>
              ) : searchResults ? (
                <div>
                  <p style={{ marginBottom: '16px', color: 'var(--text-muted)' }}>
                    Found {searchResults.suppliers.length} supplier{searchResults.suppliers.length !== 1 ? 's' : ''}
                  </p>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {searchResults.suppliers.map(supplier => (
                      <div
                        key={supplier.id}
                        style={{
                          padding: '16px',
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center'
                        }}
                      >
                        <div>
                          <h3 style={{ margin: 0, fontSize: '12pt', marginBottom: '4px' }}>
                            {supplier.name}
                          </h3>
                          {supplier.location && (
                            <p style={{ margin: 0, fontSize: '9pt', color: 'var(--text-muted)' }}>
                              {supplier.location}
                            </p>
                          )}
                          {supplier.shippingDays && (
                            <p style={{ margin: '4px 0 0 0', fontSize: '9pt', color: 'var(--text-muted)' }}>
                              Ships in {supplier.shippingDays} day{supplier.shippingDays !== 1 ? 's' : ''}
                            </p>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <a
                            href={supplier.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              padding: '8px 16px',
                              background: 'var(--background-secondary)',
                              color: 'var(--text)',
                              textDecoration: 'none',
                              borderRadius: '4px',
                              fontSize: '9pt',
                              border: '1px solid var(--border)'
                            }}
                          >
                            View on {supplier.name}
                          </a>
                          {userId && (
                            <button
                              onClick={() => handleOrder(supplier)}
                              disabled={loading}
                              style={{
                                padding: '8px 16px',
                                background: 'var(--color-primary)',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '4px',
                                fontSize: '9pt',
                                cursor: loading ? 'not-allowed' : 'pointer'
                              }}
                            >
                              Track Order
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  No suppliers found
                </p>
              )}
            </div>
          )}

          {/* Order Tab */}
          {activeTab === 'order' && orderTracking && (
            <div>
              <h3 style={{ marginBottom: '16px' }}>Order Tracking</h3>
              <div style={{
                padding: '16px',
                background: 'var(--background-secondary)',
                borderRadius: '8px',
                marginBottom: '16px'
              }}>
                <p><strong>Part:</strong> {orderTracking.part_name}</p>
                <p><strong>Supplier:</strong> {orderTracking.supplier_name}</p>
                <p><strong>Status:</strong> {orderTracking.status}</p>
                <p><strong>Ordered:</strong> {new Date(orderTracking.created_at).toLocaleDateString()}</p>
                {orderTracking.price && (
                  <p><strong>Price:</strong> ${orderTracking.price.toFixed(2)}</p>
                )}
              </div>
              <a
                href={orderTracking.order_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-block',
                  padding: '12px 24px',
                  background: 'var(--color-primary)',
                  color: '#fff',
                  textDecoration: 'none',
                  borderRadius: '4px',
                  fontSize: '10pt'
                }}
              >
                View Order on {orderTracking.supplier_name}
              </a>
            </div>
          )}

          {/* Installation Tab */}
          {activeTab === 'install' && orderTracking && (
            <div>
              <h3 style={{ marginBottom: '16px' }}>Document Installation</h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '10pt', fontWeight: 600 }}>
                    Installation Date
                  </label>
                  <input
                    type="date"
                    value={installationData.installationDate}
                    onChange={(e) => setInstallationData({ ...installationData, installationDate: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '8px',
                      border: '1px solid var(--border)',
                      borderRadius: '4px',
                      fontSize: '10pt'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '10pt', fontWeight: 600 }}>
                    Difficulty
                  </label>
                  <select
                    value={installationData.difficulty}
                    onChange={(e) => setInstallationData({ ...installationData, difficulty: e.target.value as any })}
                    style={{
                      width: '100%',
                      padding: '8px',
                      border: '1px solid var(--border)',
                      borderRadius: '4px',
                      fontSize: '10pt'
                    }}
                  >
                    <option value="easy">Easy</option>
                    <option value="moderate">Moderate</option>
                    <option value="hard">Hard</option>
                    <option value="expert">Expert</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '10pt', fontWeight: 600 }}>
                    Labor Hours (optional)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={installationData.laborHours}
                    onChange={(e) => setInstallationData({ ...installationData, laborHours: e.target.value })}
                    placeholder="e.g., 2.5"
                    style={{
                      width: '100%',
                      padding: '8px',
                      border: '1px solid var(--border)',
                      borderRadius: '4px',
                      fontSize: '10pt'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '10pt', fontWeight: 600 }}>
                    Notes (optional)
                  </label>
                  <textarea
                    value={installationData.notes}
                    onChange={(e) => setInstallationData({ ...installationData, notes: e.target.value })}
                    placeholder="Any notes about the installation..."
                    rows={4}
                    style={{
                      width: '100%',
                      padding: '8px',
                      border: '1px solid var(--border)',
                      borderRadius: '4px',
                      fontSize: '10pt',
                      fontFamily: 'inherit'
                    }}
                  />
                </div>

                <button
                  onClick={handleInstallation}
                  disabled={loading}
                  style={{
                    padding: '12px 24px',
                    background: 'var(--color-primary)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '10pt',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    fontWeight: 600
                  }}
                >
                  {loading ? 'Saving...' : 'Document Installation'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

