import React, { useState } from 'react';

interface Supplier {
  supplier_id: string;
  supplier_name: string;
  price_cents: number;
  url: string;
  in_stock: boolean;
  shipping_days?: number;
}

interface ShoppablePartTagProps {
  tag: {
    id: string;
    tag_name: string;
    oem_part_number?: string;
    aftermarket_part_numbers?: string[];
    suppliers?: Supplier[];
    lowest_price_cents?: number;
    highest_price_cents?: number;
    is_shoppable?: boolean;
    verified: boolean;
    source_type: string;
    metadata?: any;
    condition?: string;
    install_difficulty?: string;
    warranty_info?: string;
  };
  onBuy: (supplier: Supplier, partNumber: string) => void;
  onEnrichPart: (tagId: string) => void;
}

const ShoppablePartTag: React.FC<ShoppablePartTagProps> = ({ tag, onBuy, onEnrichPart }) => {
  const [showSuppliers, setShowSuppliers] = useState(false);
  
  const suppliers = tag.suppliers || [];
  const hasMultipleSuppliers = suppliers.length > 1;

  return (
    <div style={{
      background: tag.is_shoppable ? '#e8f5e8' : (tag.verified ? '#c0c0c0' : '#ffffff'),
      border: tag.is_shoppable ? '2px solid #008000' : '1px solid #808080',
      padding: '4px',
      marginBottom: '4px',
      fontFamily: '"MS Sans Serif", sans-serif',
      fontSize: '9pt'
    }}>
      {/* Tag Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
        <span style={{
          display: 'inline-block',
          width: '10px',
          height: '10px',
          background: tag.source_type === 'ai' ? '#000080' : '#008080',
          border: '1px solid #000000'
        }} />
        <span style={{ fontWeight: 'bold', color: '#000000' }}>
          {tag.tag_name}
        </span>
        {tag.is_shoppable && (
          <span style={{ color: '#008000', fontSize: '10pt' }}>🛒</span>
        )}
        {tag.verified && (
          <span style={{ 
            background: '#008000',
            color: '#ffffff',
            padding: '0 3px',
            fontSize: '7pt',
            fontWeight: 'bold'
          }}>OK</span>
        )}
      </div>
      
      {/* Part Numbers */}
      {tag.oem_part_number && (
        <div style={{ fontSize: '7pt', color: '#424242', marginBottom: '2px' }}>
          <strong>OEM:</strong> {tag.oem_part_number}
          {tag.aftermarket_part_numbers && tag.aftermarket_part_numbers.length > 0 && (
            <>
              <br />
              <strong>AM:</strong> {tag.aftermarket_part_numbers.join(', ')}
            </>
          )}
        </div>
      )}
      
      {/* Part Metadata */}
      {(tag.condition || tag.install_difficulty || tag.warranty_info) && (
        <div style={{ fontSize: '7pt', color: '#424242', marginBottom: '4px' }}>
          {tag.condition && <span>Condition: {tag.condition} • </span>}
          {tag.install_difficulty && <span>Install: {tag.install_difficulty} • </span>}
          {tag.warranty_info && <span>{tag.warranty_info}</span>}
        </div>
      )}
      
      {/* Supplier Pricing */}
      {tag.is_shoppable && suppliers.length > 0 && (
        <div style={{ marginTop: '4px' }}>
          {suppliers.length === 1 ? (
            // Single supplier - direct buy button
            <div style={{
              background: '#fff',
              border: '1px inset #808080',
              padding: '4px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 'bold', fontSize: '8pt' }}>{suppliers[0].supplier_name}</div>
                <div style={{ fontSize: '7pt', color: '#808080' }}>
                  {suppliers[0].in_stock ? 'In Stock' : 'Out of Stock'}
                  {suppliers[0].shipping_days && ` • ${suppliers[0].shipping_days}d ship`}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 'bold', color: '#008000', fontSize: '9pt' }}>
                  ${(suppliers[0].price_cents / 100).toFixed(2)}
                </div>
                <button
                  onClick={() => onBuy(suppliers[0], tag.oem_part_number!)}
                  style={{
                    padding: '2px 8px',
                    background: '#008000',
                    color: '#fff',
                    border: '1px outset #fff',
                    fontSize: '7pt',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    marginTop: '2px'
                  }}
                >
                  BUY NOW
                </button>
              </div>
            </div>
          ) : (
            // Multiple suppliers - expandable list
            <>
              <button
                onClick={() => setShowSuppliers(!showSuppliers)}
                style={{
                  width: '100%',
                  padding: '3px',
                  background: '#c0c0c0',
                  border: '1px outset #fff',
                  fontSize: '8pt',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <span>{showSuppliers ? '▼' : '▶'} {suppliers.length} Suppliers</span>
                <span style={{ fontWeight: 'bold', color: '#008000' }}>
                  ${(tag.lowest_price_cents! / 100).toFixed(2)} - ${(tag.highest_price_cents! / 100).toFixed(2)}
                </span>
              </button>
              
              {showSuppliers && (
                <div style={{
                  background: '#fff',
                  border: '1px inset #808080',
                  marginTop: '2px',
                  padding: '2px',
                  maxHeight: '200px',
                  overflowY: 'auto'
                }}>
                  {suppliers
                    .sort((a, b) => a.price_cents - b.price_cents) // Cheapest first
                    .map((supplier, idx) => (
                      <div key={idx} style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '3px',
                        borderBottom: idx < suppliers.length - 1 ? '1px solid #e0e0e0' : 'none'
                      }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 'bold', fontSize: '8pt' }}>
                            {supplier.supplier_name}
                            {idx === 0 && (
                              <span style={{
                                background: '#008000',
                                color: '#fff',
                                padding: '0 3px',
                                fontSize: '6pt',
                                marginLeft: '4px'
                              }}>LOWEST</span>
                            )}
                          </div>
                          <div style={{ fontSize: '7pt', color: '#808080' }}>
                            {supplier.in_stock ? '✓ In Stock' : '✗ Out of Stock'}
                            {supplier.shipping_days && ` • ${supplier.shipping_days}d`}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: 'bold', color: '#008000', fontSize: '8pt' }}>
                            ${(supplier.price_cents / 100).toFixed(2)}
                          </div>
                          <button
                            onClick={() => onBuy(supplier, tag.oem_part_number!)}
                            disabled={!supplier.in_stock}
                            style={{
                              padding: '1px 6px',
                              background: supplier.in_stock ? '#008000' : '#808080',
                              color: '#fff',
                              border: '1px outset #fff',
                              fontSize: '7pt',
                              cursor: supplier.in_stock ? 'pointer' : 'not-allowed',
                              marginTop: '2px'
                            }}
                          >
                            BUY
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
      
      {/* Part Details from metadata */}
      {tag.metadata?.part_number && (
        <div style={{ fontSize: '7pt', color: '#000000', marginTop: '4px' }}>
          Part#: {tag.metadata.part_number}
          {tag.metadata.brand && ` | ${tag.metadata.brand}`}
        </div>
      )}
      
      {tag.metadata?.estimated_cost && (
        <div style={{ fontSize: '7pt', color: '#008000', fontWeight: 'bold' }}>
          Est. Cost: ${tag.metadata.estimated_cost}
        </div>
      )}
      
      {/* Vendor Links (legacy) */}
      {tag.metadata?.vendor_links && tag.metadata.vendor_links.length > 0 && (
        <div style={{ marginTop: '4px', display: 'flex', gap: '2px', flexWrap: 'wrap' }}>
          {tag.metadata.vendor_links.map((link: any, idx: number) => (
            <a
              key={idx}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                padding: '1px 4px',
                background: '#c0c0c0',
                color: '#000000',
                textDecoration: 'none',
                fontSize: '7pt',
                border: '1px outset #ffffff'
              }}
            >
              {link.vendor}
            </a>
          ))}
        </div>
      )}
      
      {/* Not Shoppable - Add Part Info Button */}
      {!tag.is_shoppable && tag.verified && (
        <button
          onClick={() => onEnrichPart(tag.id)}
          style={{
            width: '100%',
            padding: '3px',
            background: '#ffffe1',
            border: '1px solid #000',
            fontSize: '7pt',
            cursor: 'pointer',
            marginTop: '4px',
            fontWeight: 'bold'
          }}
        >
          + Add Part Number & Suppliers
        </button>
      )}
    </div>
  );
};

export default ShoppablePartTag;

