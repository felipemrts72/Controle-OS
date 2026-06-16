export function httpError(status, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = details.code;
  error.field = details.field;
  return error;
}
