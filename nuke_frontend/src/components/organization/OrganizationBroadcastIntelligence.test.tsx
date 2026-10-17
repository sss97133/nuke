// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: rpcMock } }));

import OrganizationBroadcastIntelligence from './OrganizationBroadcastIntelligence';

const sampleIntel = {
  organization_id: 'ce89bd2d-fd65-4a76-ad24-a1ca0efac6c1',
  observations: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      source_identifier: 'yt:barrett_jackson:surface_census',
      source_url: 'https://www.youtube.com/@BarrettJackson/videos',
      observed_at: '2026-10-18T18:00:00Z',
      ingested_at: '2026-10-18T18:00:00Z',
      confidence: 'high',
      confidence_score: 0.95,
      content_text: 'Barrett-Jackson YouTube surface census',
      structured_data: {
        property: 'broadcast_channel_surface_census',
        channel_handle: '@BarrettJackson',
        value: {
          organization_name: 'Barrett-Jackson',
          channel_handle: '@BarrettJackson',
          unique_video_ids: 2898,
          surface_counts: {
            total_public_items: 2898,
            videos: 2410,
            streams: 188,
            shorts: 300,
          },
        },
      },
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      source_identifier: 'yt:barrett_jackson:claims_rollup',
      source_url: 'https://www.youtube.com/watch?v=fG1vP1t0d4w',
      observed_at: '2026-10-18T18:05:00Z',
      ingested_at: '2026-10-18T18:05:00Z',
      confidence: 'high',
      confidence_score: 0.92,
      content_text: 'Barrett-Jackson reviewed broadcast claims rollup',
      structured_data: {
        property: 'broadcast_reviewed_claims_rollup',
        value: {
          total_reviewed_claims: 1,
          claims: [
            {
              property: 'publisher_reported_result',
              value: '$330,000',
              lot_number: '700',
              vehicle_label: '1969 Ford Mustang Boss 429',
              video_id: 'fG1vP1t0d4w',
              offset_seconds: 120,
              source_url: 'https://www.youtube.com/watch?v=fG1vP1t0d4w&t=120s',
            },
          ],
        },
      },
    },
  ],
  bound_vehicles: [
    {
      vehicle_id: '33333333-3333-4333-8333-333333333333',
      vin: '9F02Z100001',
      year: 1969,
      make: 'Ford',
      model: 'Mustang Boss 429',
      observation_count: 4,
      latest_observed_at: '2026-10-18T18:05:00Z',
      sample_source_url: 'https://www.youtube.com/watch?v=fG1vP1t0d4w&t=120s',
      sample_excerpt: 'Lot 700 · 1969 Ford Mustang Boss 429 crossed the block at $330,000.',
    },
  ],
  publications: [
    {
      id: '5bd7e36b-b4f5-4c04-a8cf-a69f401980b4',
      external_id: 'fG1vP1t0d4w',
      title: 'Barrett-Jackson 2026 Scottsdale Fall Auction',
      canonical_url: 'https://www.youtube.com/watch?v=fG1vP1t0d4w',
      published_at: '2026-10-15T18:00:00Z',
      publisher: 'Barrett-Jackson',
      auction_house: 'Barrett-Jackson',
      metadata: {},
      bound_observation_count: 112,
    },
  ],
  native_profile: {
    version: 'broadcast-entity-profile-v1',
    counts: {
      observations_total: 112,
      distinct_publications: 1,
      distinct_vehicles: 21,
    },
  },
};

describe('OrganizationBroadcastIntelligence', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    rpcMock.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('renders folded broadcast entity profile and Barrett-Jackson broadcast evidence', async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === 'get_organization_broadcast_intelligence') {
        return Promise.resolve({ data: sampleIntel, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    await act(async () => {
      root.render(
        <MemoryRouter>
          <OrganizationBroadcastIntelligence
            organizationId="ce89bd2d-fd65-4a76-ad24-a1ca0efac6c1"
            organizationName="Barrett-Jackson"
          />
        </MemoryRouter>
      );
    });

    expect(container.textContent).toContain('LIVE BROADCAST & VIDEO OCR');
    expect(container.textContent).toContain('Barrett-Jackson Broadcast Intelligence Fold');
    expect(container.textContent).toContain('2,898 videos');
    expect(container.textContent).toContain('1969 Ford Mustang Boss 429');
    expect(container.textContent).toContain('1 publications (YouTube carriers)');

    const buttons = Array.from(container.querySelectorAll('button'));
    const claimsTab = buttons.find((b) => b.textContent?.includes('ATOMIC CLAIMS (1)'));
    expect(claimsTab).toBeTruthy();
    await act(async () => {
      claimsTab!.click();
    });
    expect(container.textContent).toContain('$330,000');
  });
});
