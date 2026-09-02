import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env?.VITE_API_URL || '/api',
});

const AUTH_CLEARED_EVENT = 'controle-os-auth-cleared';
let isRedirectingToLogin = false;

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  handleApiError,
);

export function handleApiError(error) {
  const status = error.response?.status;
  const url = error.config?.url || '';
  const isLoginRequest = url.includes('/auth/login');

  if (status === 401 && !isLoginRequest) {
    handleUnauthorizedSession();
  }

  return Promise.reject(error);
}

export function apiErrorMessage(error, fallback = 'Não foi possível concluir a operação.') {
  const status = error.response?.status;
  const serverMessage = error.response?.data?.message;

  if (status === 401) return 'Sessão expirada. Entre novamente.';
  if (status === 403) return 'Acesso não autorizado.';
  if (status === 404) return 'Funcionalidade indisponível no servidor atual (HTTP 404).';
  if (status >= 500) return serverMessage || 'Erro interno do servidor.';
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return 'O servidor demorou demais para responder.';
  }
  if (!error.response) return 'Servidor indisponível. Verifique sua conexão.';

  return serverMessage || error.message || fallback;
}

export function setSession(token, user) {
  isRedirectingToLogin = false;
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.dispatchEvent(new Event(AUTH_CLEARED_EVENT));
}

export function getStoredToken() {
  return localStorage.getItem('token');
}

export function logout(navigate) {
  clearSession();
  navigate('/entrar', { replace: true });
}

export function getStoredUser() {
  const raw = localStorage.getItem('user');
  return raw ? JSON.parse(raw) : null;
}

export function onSessionCleared(callback) {
  window.addEventListener(AUTH_CLEARED_EVENT, callback);
  return () => window.removeEventListener(AUTH_CLEARED_EVENT, callback);
}

function handleUnauthorizedSession() {
  if (isRedirectingToLogin) return;
  isRedirectingToLogin = true;
  clearSession();

  if (window.location.pathname !== '/entrar') {
    window.location.replace('/entrar');
  }
}
