// Firefox expose `browser` (promesses), Chrome MV3 expose `chrome` (promesses aussi) : pas de polyfill.
export const api: typeof chrome = (globalThis as unknown as { browser?: typeof chrome }).browser ?? globalThis.chrome;
