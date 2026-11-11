// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CatalogProductReference, type ReceiptCatalogProduct } from './CatalogProductReference';

let host: HTMLDivElement, root: Root;
const product: ReceiptCatalogProduct = { catalog_part_id: 'synthetic-product', name: 'Seat cover', part_number: 'SYNTHETIC-1',
  manufacturer: 'Example', image_url: null, page_url: 'https://www.classicindustries.com/product/synthetic-1.html',
  captured_at: '2026-11-11T12:00:00Z', source_role: 'original_receipt_supplier', quote_price: 49.95, currency: 'USD', price_stale: false };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host=document.createElement('div'); document.body.appendChild(host); root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
const render=async(value:ReceiptCatalogProduct)=>act(async()=>root.render(<CatalogProductReference product={value}/>));

it('keeps the exact product link and dated supplier quote when no image is available',async()=>{
  await render(product);
  expect(host.querySelector('a')?.href).toBe(product.page_url);
  expect(host.textContent).toContain('$49.95 supplier quote · Nov 11, 2026');
  expect(host.textContent).toContain('Example · SYNTHETIC-1');
  expect(host.querySelector('img')).toBeNull();
  expect(host.textContent).not.toContain('Supplier stock image');
});

it('an image load failure removes only the thumbnail and its label',async()=>{
  await render({...product,image_url:'https://catalog.example/retained.jpg'});
  expect(host.textContent).toContain('Supplier stock image');
  await act(async()=>host.querySelector('img')!.dispatchEvent(new Event('error')));
  expect(host.querySelector('img')).toBeNull();expect(host.textContent).not.toContain('Supplier stock image');
  expect(host.querySelector('a')?.href).toBe(product.page_url);expect(host.textContent).toContain('$49.95 supplier quote');
});

it('suppresses an unqualified image without suppressing the product, and refuses an unsafe product link',async()=>{
  await render({...product,image_url:'http://catalog.example/unqualified.jpg'});
  expect(host.querySelector('img')).toBeNull();expect(host.textContent).toContain('$49.95');
  await render({...product,page_url:'javascript:alert(1)'});expect(host.querySelector('a')).toBeNull();
});

it('retains zero quotes and stale-date qualification without inventing unknown currency',async()=>{
  await render({...product,quote_price:0,price_stale:true});
  expect(host.textContent).toContain('$0.00 supplier quote');expect(host.textContent).toContain('Check current price');
  await render({...product,currency:null});expect(host.textContent).not.toContain('supplier quote');expect(host.querySelector('a')).not.toBeNull();
});
