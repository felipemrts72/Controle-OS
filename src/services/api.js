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
