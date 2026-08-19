/// <reference types="vite/client" />

// Beim Build von Vite eingesetzt (siehe vite.config.ts -> define).
declare const __APP_VERSION__: string;
/** Startmittelpunkt der Karte als [lng, lat]. */
declare const __MAP_CENTER__: [number, number];
/** Startzoom der Karte. */
declare const __MAP_ZOOM__: number;
