// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
vi.mock('./SensitiveImageOverlay', () => ({ SensitiveImageOverlay: ({ isSensitive }: any) => isSensitive ? <button type="button">Sign in to request access</button> : null }));
import ImageZoneSection, { groupImagesByZone, imageZoneSectionKey, ZONE_SECTIONS } from './ImageZoneSection';

describe('retained image view classifications', () => {
  it.each([
    ['vehicle_exterior', 'exterior'], ['vehicle_interior', 'interior'],
    ['engine_bay', 'engine_bay'], ['undercarriage', 'undercarriage'],
    ['detail_closeup', 'detail'], ['part_closeup', 'detail'],
    ['vin_plate', 'detail'], ['receipt_document', 'documents'], ['other', 'uncategorized'],
  ])('uses %s when a precise vehicle zone is absent', (image_type, section) => {
    expect(imageZoneSectionKey({ vehicle_zone: null, ai_scan_metadata: { classification: { image_type } } })).toBe(section);
  });

  it('keeps explicit document and precise physical-area evidence ahead of coarse classifications', () => {
    expect(imageZoneSectionKey({ is_document: true, vehicle_zone: 'ext_front' })).toBe('documents');
    expect(imageZoneSectionKey({ vehicle_zone: 'wheel_driver_front', ai_scan_metadata: { classification: { image_type: 'detail_closeup' } } })).toBe('wheels');
    expect(imageZoneSectionKey({ vehicle_zone: 'mech_engine' })).toBe('engine_bay');
    expect(imageZoneSectionKey({ vehicle_zone: 'mech_drivetrain' })).toBe('undercarriage');
  });

  it('retains legacy scene/angle classifications and unknown sources without losing or duplicating images', () => {
    const images = [
      { id: 'a', ai_detected_angle: 'interior_front' },
      { id: 'b', ai_scan_metadata: { byok_deep_analysis: { scene_type: 'body_exterior' } } },
      { id: 'c', ai_scan_metadata: { byok_deep_analysis: { scene_type: 'data_plate' } } },
      { id: 'd', vehicle_zone: 'unrecognized_area' },
    ];
    const groups = groupImagesByZone(images);
    expect(Object.fromEntries(groups.map(group => [group.section.key, group.images.map(image => image.id)]))).toEqual({
      exterior: ['b'], interior: ['a'], detail: ['c'], uncategorized: ['d'],
    });
  });

  it('lets a document access control handle its own keyboard and click actions', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container), inspect = vi.fn();
    try {
      await act(async () => root.render(<ImageZoneSection section={ZONE_SECTIONS.find(section => section.key === 'documents')!}
        images={[{ id: 'private-source', image_url: 'https://images.example.test/document.jpg', is_sensitive: true }]}
        defaultOpen imagesPerRow={3} vehicleId="vehicle" onImageClick={inspect} globalIndexMap={new Map([['private-source', 0]])} />));
      const access = [...container.querySelectorAll('button')].find(button => button.textContent === 'Sign in to request access')!;
      const keyboardEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      await act(async () => { access.dispatchEvent(keyboardEvent); access.click(); });
      expect(keyboardEvent.defaultPrevented).toBe(false);
      expect(inspect).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
