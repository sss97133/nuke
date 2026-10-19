import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

// maplibre-gl 6 resolves its worker from import.meta.url, which a bundled chunk breaks.
setWorkerUrl(workerUrl);
