export function resolveVacationView(routeKey, resource) {
  if (resource?.key !== routeKey) return { kind: 'loading' };
  if (resource.error) return { kind: 'error', message: resource.error };
  const data = resource.data;
  if (!data) return { kind: 'loading' };
  if (routeKey === 'list') {
    return Array.isArray(data.employees) && data.indicators && typeof data.indicators === 'object'
      ? { kind: 'list', data }
      : { kind: 'error', message: 'A listagem de férias recebeu dados incompletos. Tente novamente.' };
  }
  return data.employee?.id === routeKey && Array.isArray(data.periods) && Array.isArray(data.audit)
    ? { kind: 'detail', data }
    : { kind: 'error', message: 'O histórico do funcionário recebeu dados incompletos. Tente novamente.' };
}
