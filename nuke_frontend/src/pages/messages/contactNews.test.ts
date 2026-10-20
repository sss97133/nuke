import { describe, expect, it } from 'vitest';
import { inboxNews, threadNews } from './contactNews';
import type { JsonObject } from '../jobs/jobRead';

const req = (id: string, extra: Record<string, unknown> = {}) => ({ request_id: id, status: 'pending', counterpart: { kind: 'user', handle: `h_${id}` },
  thread: { messages: 0 }, message: 'SECRET text', ...extra });

describe('inboxNews', () => {
  it('says nothing on the first load or when nothing changed', () => {
    const d = { incoming: [req('a')], outgoing: [] };
    expect(inboxNews(null, d)).toBeNull();
    expect(inboxNews(d, d)).toBeNull();
  });

  it('announces new incoming requests by handle and never their text', () => {
    const prev = { incoming: [req('a')], outgoing: [] };
    expect(inboxNews(prev, { incoming: [req('b'), req('a')], outgoing: [] })).toBe('New contact request from @h_b.');
    const two = inboxNews(prev, { incoming: [req('b'), req('c'), req('a')], outgoing: [] });
    expect(two).toBe('2 new contact requests.');
    expect(two).not.toContain('SECRET');
  });

  it('announces answers to your requests and new messages', () => {
    const prev = { incoming: [req('a', { status: 'accepted', thread: { messages: 1 } })], outgoing: [req('o')] };
    const next = { incoming: [req('a', { status: 'accepted', thread: { messages: 3 } })], outgoing: [req('o', { status: 'accepted' })] };
    expect(inboxNews(prev, next)).toBe('@h_o accepted your request. 2 new messages in your conversation with @h_a.');
  });

  it('does not announce your own answer to an incoming request', () => {
    const prev = { incoming: [req('a')], outgoing: [] };
    expect(inboxNews(prev, { incoming: [req('a', { status: 'accepted' })], outgoing: [] })).toBeNull();
  });
});

describe('threadNews', () => {
  const t = (messages: JsonObject[], status = 'accepted'): JsonObject => ({ request: { status }, messages });
  const you = { message_id: 'm1', author: { kind: 'you' }, body: 'mine' };
  const them = (id: string) => ({ message_id: id, author: { kind: 'user', handle: 'tech2' }, body: 'SECRET reply' });

  it('announces only the other side\'s new messages, by handle', () => {
    expect(threadNews(t([you]), t([you, them('m2')]))).toBe('New message from @tech2.');
    expect(threadNews(t([you]), t([you, them('m2'), them('m3')]))).toBe('2 new messages from @tech2.');
    expect(threadNews(t([]), t([you]))).toBeNull();
    expect(threadNews(t([you]), t([you, them('m2')]))).not.toContain('SECRET');
  });

  it('announces a status change', () => {
    expect(threadNews(t([], 'pending'), t([], 'accepted'))).toBe('The request was accepted. You can write here now.');
    expect(threadNews(t([], 'pending'), t([], 'withdrawn'))).toBe('The request was withdrawn.');
  });
});
