export function errorMiddleware(error, req, res, _next) {
  if (res.headersSent) return _next(error);
  let status = error.status || 500;
  let message = status === 500 ? 'Erro interno do servidor.' : error.message;
  let code = error.code;
  let field = error.field;
  let details = error.details;

  if (error.code === '23505') {
    status = 409;
    message = error.constraint?.includes('sale_number')
      ? 'Já existe uma OS cadastrada com este número de venda.'
      : 'Já existe um registro cadastrado com estes dados.';
    code = error.constraint?.includes('sale_number') ? 'SALE_NUMBER_ALREADY_EXISTS' : 'UNIQUE_VIOLATION';
    field = error.constraint?.includes('sale_number') ? 'sale_number' : undefined;
  }

  if (error.code === '23503') {
    status = 400;
    message = 'O registro informado não foi encontrado ou não pode ser utilizado.';
    code = 'FOREIGN_KEY_VIOLATION';
  }

  if (status === 500) {
    console.error('Erro interno:', {
      method: req.method,
      path: req.originalUrl,
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
  }

  res.status(status).json({
    message,
    ...(code ? { code } : {}),
    ...(field ? { field } : {}),
    ...(details ? { details } : {}),
  });
}
