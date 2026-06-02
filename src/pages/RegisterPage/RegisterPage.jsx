import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api.js';
import '../LoginPage/LoginPage.css';

export function RegisterPage() {
  const [form, setForm] = useState({ name: '', username: '', password: '' });
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');

  function change(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function submit(event) {
    event.preventDefault();
    try {
      await api.post('/auth/register', form);
      setForm({ name: '', username: '', password: '' });
      setMessage('Cadastro solicitado com sucesso. Aguarde aprovação do administrador.');
      setMessageType('success');
    } catch (error) {
      setMessage(error.response?.data?.message || 'Não foi possível solicitar cadastro.');
      setMessageType('error');
    }
  }

  return (
    <main className="login-page">
      <form className="login-page__form" onSubmit={submit}>
        <h1 className="login-page__title">Solicitar cadastro</h1>
        <label className="field">
          <span className="field__label">Nome</span>
          <input className="field__input" name="name" value={form.name} onChange={change} required />
        </label>
        <label className="field">
          <span className="field__label">Usuário</span>
          <input className="field__input" name="username" value={form.username} onChange={change} required />
        </label>
        <label className="field">
          <span className="field__label">Senha</span>
          <input className="field__input" name="password" type="password" value={form.password} onChange={change} required />
        </label>
        {message && <p className={messageType === 'success' ? 'field__label' : 'login-page__message'}>{message}</p>}
        <button className="button button_primary" type="submit">Solicitar cadastro</button>
        <Link className="button" to="/entrar">Entrar</Link>
      </form>
    </main>
  );
}
