// Dynamic import type stubs for optional heavy dependencies.
// These are loaded lazily at runtime and may not be present.

declare module 'maplibre-gl' {
  export class Map {
    constructor(options: {
      container: HTMLElement;
      style: string;
      center: [number, number];
      zoom: number;
    });
    on(event: string, callback: (...args: unknown[]) => void): this;
    getBounds(): {
      getNorth(): number;
      getSouth(): number;
      getEast(): number;
      getWest(): number;
    };
    getZoom(): number;
    remove(): void;
  }
}

declare module 'hls.js' {
  export default class Hls {
    static isSupported(): boolean;
    loadSource(url: string): void;
    attachMedia(media: HTMLVideoElement): void;
    destroy(): void;
  }
}
