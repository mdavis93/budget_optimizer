const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'dist', 'index.html');

if (!fs.existsSync(indexPath)) {
  console.error('dist/index.html not found — run pnpm run build:vite first');
  process.exit(1);
}

const html = fs.readFileSync(indexPath, 'utf8');
const match = html.match(/Content-Security-Policy" content="([^"]+)"/);

if (!match) {
  console.error('Content-Security-Policy meta tag not found in dist/index.html');
  process.exit(1);
}

const csp = match[1];
const scriptSrc = csp.match(/script-src[^;]*/)?.[0] ?? '';
const connectSrc = csp.match(/connect-src[^;]*/)?.[0] ?? '';

const errors = [];

if (csp.includes('unsafe-eval')) {
  errors.push('CSP must not include unsafe-eval in production');
}
if (scriptSrc.includes('unsafe-inline')) {
  errors.push('script-src must not include unsafe-inline in production');
}
if (connectSrc.includes('localhost')) {
  errors.push('connect-src must not allow localhost in production');
}
if (html.includes('fonts.googleapis.com') || csp.includes('fonts.googleapis.com')) {
  errors.push('CSP/HTML must not include fonts.googleapis.com');
}
if (html.includes('fonts.gstatic.com') || csp.includes('fonts.gstatic.com')) {
  errors.push('CSP/HTML must not include fonts.gstatic.com');
}
if (!csp.includes("object-src 'none'")) {
  errors.push("CSP must include object-src 'none'");
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error);
  }
  console.error('CSP:', csp);
  process.exit(1);
}

console.log('Production CSP verification passed');
