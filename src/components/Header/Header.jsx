import { LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { clearSession, getStoredUser } from '../../services/api.js';
import './Header.css';

export function Header() {
  const navigate = useNavigate();
  const user = getStoredUser();

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
      <button className="header__button" type="button" onClick={logout} title="Sair">
        <LogOut size={18} />
      </button>
    </header>
  );
}
