// Used by the Docker HEALTHCHECK. The node:slim image has no curl, so we
// make the request with node itself and exit 0 (healthy) or 1 (unhealthy).
const http = require('http');
const port = process.env.PORT || 3000;
const req = http.get(
  { host: '127.0.0.1', port, path: '/api/healthz', timeout: 2000 },
  (res) => process.exit(res.statusCode === 200 ? 0 : 1),
);
req.on('error', () => process.exit(1));
req.on('timeout', () => { req.destroy(); process.exit(1); });
