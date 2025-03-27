declare module 'canvas' {
  export class Canvas {
    constructor(width: number, height: number);
    width: number;
    height: number;
    getContext(contextId: '2d'): CanvasRenderingContext2D;
    toBuffer(mimeType?: string): Buffer;
  }

  export interface CanvasRenderingContext2D {
    createImageData(width: number, height: number): ImageData;
    putImageData(imageData: ImageData, dx: number, dy: number): void;
  }
} 