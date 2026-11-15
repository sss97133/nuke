import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import CowlTagReproduction from './CowlTagReproduction';

it('places reviewed public codes and never includes body serial or sequence', () => {
  const html = renderToStaticMarkup(<CowlTagReproduction modelYear="73" style="4FS87" plant="N"
    trim="232" seat="A51" paintLower="75" paintUpper="75" buildDate="07C"
    {...{ bodySerial: 'PRIVATE-BODY-123', lowerSequence: 'PRIVATE-SEQ-456' }} />);
  expect(html).toContain('BODY BY FISHER');
  expect(html).toContain('GENERAL MOTORS CORPORATION');
  expect(html).toContain('4FS87');
  expect(html).toContain('75');
  expect(html).toContain('cowl-repro__redaction');
  expect(html).not.toMatch(/PRIVATE-BODY|PRIVATE-SEQ|bodySerial|lowerSequence|<image|<img|href=/);
});

it('marks fields without a public reading as unknown', () => {
  const html = renderToStaticMarkup(<CowlTagReproduction paintLower="75" paintUpper="75" />);
  expect(html).toContain('Style —');
  expect(html).toContain('>—</text>');
  expect(html).not.toContain('4FS87');
});
