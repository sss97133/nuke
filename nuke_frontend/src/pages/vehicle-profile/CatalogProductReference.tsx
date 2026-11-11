import React, { useState } from 'react';
import './catalog-product-reference.css';

export interface ReceiptCatalogProduct {
  catalog_part_id: string; name: string; part_number: string; manufacturer: string | null;
  image_url: string | null; page_url: string; captured_at: string; source_role: string;
  quote_price: number | null; currency: string | null; price_stale: boolean;
}

export function CatalogProductReference({ product }: { product?: ReceiptCatalogProduct | null }) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  if (!product || !/^https:\/\//.test(product.page_url)) return null;
  const imageUrl = product.image_url && /^https:\/\//.test(product.image_url) && failedImage !== product.image_url ? product.image_url : null;
  const captured = new Date(product.captured_at);
  const date = Number.isFinite(captured.getTime()) ? captured.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : null;
  let price: string | null = null;
  if (product.quote_price != null && Number.isFinite(product.quote_price) && product.currency) {
    try { price = new Intl.NumberFormat('en-US', { style: 'currency', currency: product.currency }).format(product.quote_price); } catch { /* Currency must be known. */ }
  }
  return <a className="vp-catalog-product" href={product.page_url} target="_blank" rel="noopener noreferrer"
    aria-label={`View ${product.name} at the supplier`}>
    {imageUrl && <img src={imageUrl} alt={product.name} width={112} height={88}
      loading="lazy" onError={() => setFailedImage(imageUrl)} />}
    <span className="vp-catalog-product__body"><strong>{product.name}</strong>
      <span>{[product.manufacturer, product.part_number].filter(Boolean).join(' · ')}</span>
      <small>{imageUrl ? 'Supplier stock image · ' : ''}View product ↗</small>
      {price && date && <small>{price} supplier quote · {date}{product.price_stale ? ' · Check current price' : ''}</small>}
    </span>
  </a>;
}
