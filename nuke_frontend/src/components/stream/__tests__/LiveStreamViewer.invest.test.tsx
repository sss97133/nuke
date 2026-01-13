// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

// NOTE: We keep this test lightweight and avoid full DOM rendering libraries.
// It asserts that the component wires the correct service calls and doesn't crash
// when deals are present/missing.

vi.mock('../../../lib/supabase', () => {
  const channel = vi.fn(() => ({
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn(() => ({})),
  }));

  const removeChannel = vi.fn();

  const from = vi.fn((table: string) => {
    if (table === 'live_streams') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: {
                id: 'stream-1',
                title: 'Test Stream',
                description: '',
                stream_type: 'live',
                status: 'live',
                streamer_id: 'streamer-1',
                started_at: new Date().toISOString(),
                hls_url: '',
                tags: [],
                allow_chat: true,
                streamer: { display_name: 'Streamer', avatar_url: '' },
              },
              error: null,
            })),
          })),
        })),
      };
    }

    if (table === 'stream_chat') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(async () => ({ data: [], error: null })),
              })),
            })),
          })),
        })),
      };
    }

    if (table === 'stream_viewers') {
      return {
        update: vi.fn(() => ({
          eq: vi.fn(async () => ({ data: null, error: null })),
        })),
      };
    }

    if (table === 'stream_follows') {
      return {
        delete: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(async () => ({ data: null, error: null })) })) })),
        insert: vi.fn(async () => ({ data: null, error: null })),
      };
    }

    return {
      select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(async () => ({ data: null, error: null })) })) })),
    };
  });

  const rpc = vi.fn(async () => ({ data: null, error: null }));

  return {
    supabase: {
      channel,
      removeChannel,
      from,
      rpc,
    },
    SUPABASE_URL: 'https://placeholder.supabase.co',
  };
});

vi.mock('../../../hooks/useAuth', () => {
  return {
    useAuth: () => ({ user: { id: 'viewer-1' } }),
  };
});

vi.mock('../../../services/streamTipService', () => {
  return {
    StreamTipService: {
      tipStream: vi.fn(async () => 'tip-id'),
    },
  };
});

vi.mock('../../../services/cashflowDealsService', () => {
  return {
    CashflowDealsService: {
      listPublicDealsForUser: vi.fn(async () => [
        {
          id: 'deal-1',
          deal_type: 'advance',
          title: 'Advance (Recoupable)',
          rate_bps: 2000,
          cap_multiple_bps: 13000,
          term_end_at: null,
          subject_user_id: 'streamer-1',
          is_public: true,
        },
      ]),
      createUserDeal: vi.fn(async () => 'deal-new'),
      fundDeal: vi.fn(async () => 'claim-1'),
    },
  };
});

// These are visual-only components; stub them to keep test environment simple.
vi.mock('../StreamActionOverlay', () => ({ default: () => null }));
vi.mock('../StreamActionPanel', () => ({ default: () => null }));
vi.mock('../StreamTipOverlay', () => ({ default: () => null }));

import React from 'react';
import { createRoot } from 'react-dom/client';
import LiveStreamViewer from '../LiveStreamViewer';
import { CashflowDealsService } from '../../../services/cashflowDealsService';

describe('LiveStreamViewer (invest panel)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mounts and requests public deals for streamer', async () => {
    const el = document.createElement('div');
    const root = createRoot(el);

    root.render(<LiveStreamViewer streamId="stream-1" />);

    // Allow microtasks + effects to flush
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(CashflowDealsService.listPublicDealsForUser).toHaveBeenCalledWith('streamer-1');

    root.unmount();
  });
});

