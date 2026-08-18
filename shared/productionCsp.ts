/** Production CSP — no third-party hosts. Applied to dist/index.html and the app window session. */
export const PRODUCTION_CSP =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; " +
  "font-src 'self'; " +
  "connect-src 'self'; " +
  "object-src 'none'; " +
  "base-uri 'self'; " +
  "frame-src 'none'";
