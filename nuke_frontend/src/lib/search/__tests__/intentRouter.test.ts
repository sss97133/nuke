import { describe, it, expect } from 'vitest';
import { classifyIntent } from '../intentRouter';

describe('classifyIntent', () => {
  // NAVIGATE
  it('classifies /settings as NAVIGATE', () => {
    expect(classifyIntent('/settings').intent).toBe('NAVIGATE');
  });
  it('classifies @user as NAVIGATE', () => {
    expect(classifyIntent('@skylar').intent).toBe('NAVIGATE');
  });

  // EXACT_VIN
  it('classifies 17-char VIN as EXACT_VIN', () => {
    expect(classifyIntent('WBS8M9C50J5K98234').intent).toBe('EXACT_VIN');
  });
  it('rejects short VIN', () => {
    expect(classifyIntent('WBS8M9C50').intent).not.toBe('EXACT_VIN');
  });

  // EXACT_URL
  it('classifies http URL as EXACT_URL', () => {
    expect(classifyIntent('https://bringatrailer.com/listing/1973-porsche').intent).toBe('EXACT_URL');
  });
  it('classifies domain-containing string as EXACT_URL', () => {
    expect(classifyIntent('bringatrailer.com/listing/123').intent).toBe('EXACT_URL');
  });

  // MY_VEHICLES
  it('classifies "my vehicles" as MY_VEHICLES', () => {
    expect(classifyIntent('my vehicles').intent).toBe('MY_VEHICLES');
  });
  it('classifies "favorites" as MY_VEHICLES', () => {
    expect(classifyIntent('favorites').intent).toBe('MY_VEHICLES');
  });

  // MARKET
  it('classifies "porsche market" as MARKET', () => {
    expect(classifyIntent('porsche market').intent).toBe('MARKET');
  });
  it('classifies "911 price trend" as MARKET', () => {
    expect(classifyIntent('911 price trend').intent).toBe('MARKET');
  });

  // QUESTION
  it('classifies "how many ferraris" as QUESTION', () => {
    expect(classifyIntent('how many ferraris').intent).toBe('QUESTION');
  });
  it('classifies query ending with ? as QUESTION', () => {
    expect(classifyIntent('what is the most expensive porsche?').intent).toBe('QUESTION');
  });

  // BROWSE
  it('classifies "porsche" as BROWSE', () => {
    expect(classifyIntent('porsche').intent).toBe('BROWSE');
  });
  it('classifies "porsche 911" as BROWSE', () => {
    expect(classifyIntent('porsche 911').intent).toBe('BROWSE');
  });
  it('classifies "chevy" (alias) as BROWSE', () => {
    expect(classifyIntent('chevy').intent).toBe('BROWSE');
  });
  it('classifies "convertible" as BROWSE', () => {
    expect(classifyIntent('convertible').intent).toBe('BROWSE');
  });
  it('classifies "muscle" era as BROWSE', () => {
    expect(classifyIntent('muscle').intent).toBe('BROWSE');
  });

  // QUERY
  it('classifies "1973 porsche 911 red" as QUERY', () => {
    expect(classifyIntent('1973 porsche 911 red').intent).toBe('QUERY');
  });
  it('classifies "asdfghjkl" as QUERY', () => {
    expect(classifyIntent('asdfghjkl').intent).toBe('QUERY');
  });
});
