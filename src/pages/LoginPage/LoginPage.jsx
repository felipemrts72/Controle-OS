import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setSession } from '../../services/api.js';
import './LoginPage.css';

export function LoginPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: 'admin', password: 'admin123' });
  const [message, setMessage] = useState('');

  async function submit(event) {
    event.preventDefault();
    try {
      const response = await api.post('/auth/login', form);
      setSession(response.data.token, response.data.user);
      navigate('/dashboard');
    } catch {
      setMessage('Usuário ou senha inválidos.');
    }
  }

  return (
    <main className="login-page">
      <form className="login-page__form" onSubmit={submit}>
        <h1 className="login-page__title">Controle Interno de OS e Expedição</h1>
        <label className="field">
          <span className="field__label">Usuário</span>
          <input className="field__input" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required />
        </label>
        <label className="field">
          <span className="field__label">Senha</span>
          <input className="field__input" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required />
        </label>
        {message && <p className="login-page__message">{message}</p>}
        <button className="button button_primary" type="submit">Entrar</button>
      </form>
    </main>
  );
}
