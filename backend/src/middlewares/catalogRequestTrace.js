import { randomUUID } from 'node:crypto';

// No bodies, credentials or query strings: correlate the two HTTP layers safely.
export function catalogRequestTrace(layer) {
  return (req, res, next) => {
    if (!req.originalUrl.startsWith('/api/commercial/catalog')) return next();
    const incoming = String(req.headers['x-request-id'] || '');
    const id = /^[a-zA-Z0-9-]{1,80}$/.test(incoming) ? incoming : randomUUID();
    req.catalogRequestId = id;
    req.headers['x-request-id'] = id;
    res.setHeader('X-Request-ID', id);
    const start = Date.now();
    const data = { layer, id, method: req.method, path: req.originalUrl.split('?')[0], bytes: req.headers['content-length'] || null };
    console.info(JSON.stringify({ event: 'catalog_request', ...data }));
    res.once('finish', () => console.info(JSON.stringify({ event: 'catalog_response', ...data, status: res.statusCode, ms: Date.now() - start })));
    res.once('close', () => { if (!res.writableFinished) console.error(JSON.stringify({ event: 'catalog_connection_closed', ...data, ms: Date.now() - start })); });
    next();
  };
}
