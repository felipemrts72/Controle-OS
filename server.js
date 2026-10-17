import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { catalogRequestTrace } from './backend/src/middlewares/catalogRequestTrace.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const PORT = Number(process.env.FRONTEND_PORT) || 4173;
const BACKEND_URL =
  process.env.BACKEND_URL || 'http://127.0.0.1:3333';

app.use(catalogRequestTrace('frontend-proxy'));

app.use(
  '/api',
  createProxyMiddleware({
    target: BACKEND_URL,
    changeOrigin: true,

    // O Express remove o prefixo /api ao entrar neste middleware.
    // Recolocamos para o backend, que expõe as rotas em /api.
    pathRewrite: (requestPath) => `/api${requestPath}`,
    on: {
      error(error, req, res) {
        console.error(JSON.stringify({ event: 'api_proxy_error', id: req.catalogRequestId, method: req.method, path: req.originalUrl?.split('?')[0], code: error.code, message: error.message }));
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ message: 'Não foi possível obter resposta do servidor. Confira os dados salvos antes de tentar novamente.', code: 'API_PROXY_ERROR', request_id: req.catalogRequestId }));
        } else res.destroy();
      },
    },
  }),
);

app.use(express.static(path.join(__dirname, 'dist')));

// Fallback do React Router:
// qualquer rota que não seja /api entrega index.html.
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(
    `Controle-OS frontend rodando em http://0.0.0.0:${PORT}`,
  );
  console.log(
    `Proxy /api apontando para ${BACKEND_URL}/api`,
  );
});
