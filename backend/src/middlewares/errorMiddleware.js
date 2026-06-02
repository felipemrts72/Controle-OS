export function errorMiddleware(error, _req, res, _next) {
  const status = error.status || 500;
  res.status(status).json({
    message: status === 500 ? 'Erro interno do servidor.' : error.message,
  });
}
