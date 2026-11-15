import { describe, expect, it } from 'vitest';
import { selectZipArea, zipAreaBounds, zipAreaRequest, type ZipMapReading } from './zipAreaGeometry';

const mapValue = {
    zcta: '89005', label: 'Boulder City, NV',
    bounds: { geojson: 'map-data/geo/v1/county/32003.geojson', county_fips: '32003' },
};
const reading: ZipMapReading = { key: 'location.map', status: 'reading', value: mapValue };

describe('ZIP outline from the location reader', () => {
  it('accepts the sanctioned ZIP and its exact county geometry path', () => {
    expect(zipAreaRequest(reading)).toEqual({ zip: '89005', countyFips: '32003',
      path: 'map-data/geo/v1/county/32003.geojson', label: 'Boulder City, NV' });
    expect(zipAreaRequest({ ...reading, status: 'missing' })).toBeNull();
    expect(zipAreaRequest({ ...reading, value: { ...mapValue, zcta: null } })).toBeNull();
    expect(zipAreaRequest({ ...reading, value: { ...mapValue,
      bounds: { geojson: 'map-data/geo/v1/county/99999.geojson', county_fips: '32003' } } })).toBeNull();
  });

  it('selects the ZIP polygon rather than a county or city point', () => {
    const polygon = { type: 'Feature', id: '89005', properties: { GEOID: '89005' }, geometry: {
      type: 'Polygon', coordinates: [[[-114.9, 35.9], [-114.8, 35.9], [-114.8, 36.1], [-114.9, 35.9]]],
    } };
    const county = { type: 'Feature', id: '32003', properties: {}, geometry: polygon.geometry };
    const selected = selectZipArea({ type: 'FeatureCollection', features: [county, polygon] }, '89005');
    expect(selected?.id).toBe('89005');
    expect(selected && zipAreaBounds(selected)).toEqual([-114.9, 35.9, -114.8, 36.1]);
    expect(selectZipArea({ features: [county] }, '89005')).toBeNull();
  });

  it('supports multipart areas and rejects malformed geometry', () => {
    const multi = { type: 'Feature', id: '89005', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [
      [[[-114.9, 35.9], [-114.8, 35.9], [-114.8, 36.0], [-114.9, 35.9]]],
      [[[-114.7, 36.0], [-114.6, 36.0], [-114.6, 36.1], [-114.7, 36.0]]],
    ] } };
    const selected = selectZipArea({ features: [multi] }, '89005');
    expect(selected && zipAreaBounds(selected)).toEqual([-114.9, 35.9, -114.6, 36.1]);
    expect(selectZipArea({ features: [{ ...multi, geometry: { type: 'Point', coordinates: [-114.8, 36] } }] }, '89005')).toBeNull();
    for (const coordinates of [null, 'not an array', [null], [[null]], [[[null]]], [[[-114.8, '36']]],
      [[[181, 36], [-114.8, 36], [-114.8, 36], [181, 36]]]]) {
      expect(selectZipArea({ features: [{ ...multi, geometry: { type: 'Polygon', coordinates } }] }, '89005')).toBeNull();
    }
    for (const coordinates of [null, [null], [[null]], [[[null]]]]) {
      expect(selectZipArea({ features: [{ ...multi, geometry: { type: 'MultiPolygon', coordinates } }] }, '89005')).toBeNull();
    }
  });
});
