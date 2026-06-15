import { LogOut, Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clearSession, getStoredUser } from '../../services/api.js';
import './Header.css';

export function Header() {
  const navigate = useNavigate();
  const user = getStoredUser();
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light');

  function toggleTheme() {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem('controle-os-theme', nextTheme);
    setTheme(nextTheme);
  }

  function logout() {
    clearSession();
    navigate('/entrar');
  }

  return (
    <header className="header">
      <div>
        <strong>{user?.name || 'Usuário'}</strong>
        <span className="header__role">{user?.role || ''}</span>
      </div>
      <button className="header__button" type="button" onClick={toggleTheme} title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'} aria-label={theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}>
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>
      <button className="header__button" type="button" onClick={logout} title="Sair">
        <LogOut size={18} />
      </button>
    </header>
  );
}
