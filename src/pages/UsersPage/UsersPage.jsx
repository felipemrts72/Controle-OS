import { useEffect, useMemo, useState } from 'react';
import { api, getStoredUser } from '../../services/api.js';
import { DataTable } from '../../components/DataTable/DataTable.jsx';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import { canAccessPermission, isSuperAdmin } from '../../utils/permissions.js';
import './UsersPage.css';

const statusLabels = {
  pending: 'Pendente',
  approved: 'Aprovado',
  rejected: 'Recusado',
};

const emptyPasswordForm = {
  current_password: '',
  new_password: '',
  confirm_password: '',
};

export function UsersPage() {
  const toast = useToast();
  const currentUser = getStoredUser();
  const canApprove = canAccessPermission(currentUser, 'users.approve') || canAccessPermission(currentUser, 'users.manage');
  const canManage = canAccessPermission(currentUser, 'users.manage');
  const canChangePassword = canAccessPermission(currentUser, 'users.change_password') || isSuperAdmin(currentUser);
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [passwordTarget, setPasswordTarget] = useState(null);
  const [passwordForm, setPasswordForm] = useState(emptyPasswordForm);
  const [savingPassword, setSavingPassword] = useState(false);

  async function load() {
    const usersResponse = await api.get('/users');
    setUsers(usersResponse.data);
    if (canManage) {
      try {
        const rolesResponse = await api.get('/roles');
        setRoles(rolesResponse.data.filter((role) => role.is_active));
      } catch {
        setRoles([]);
      }
    }
  }

  useEffect(() => {
    load().catch(() => toast.error('Não foi possível carregar usuários.'));
  }, []);

  async function approve(id) {
    try {
      await api.patch(`/users/${id}/approve`);
      await load();
      toast.success('Usuário aprovado com sucesso.');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível aprovar o usuário.');
    }
  }

  async function reject(id) {
    try {
      await api.patch(`/users/${id}/reject`);
      await load();
      toast.success('Usuário recusado.');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível recusar o usuário.');
    }
  }

  async function changeRole(id, roleId) {
    try {
      await api.patch(`/users/${id}/role`, { role_id: roleId });
      await load();
      toast.success('Perfil atualizado com sucesso.');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível atualizar o perfil.');
    }
  }

  async function toggleActive(id) {
    try {
      await api.patch(`/users/${id}/toggle-active`);
      await load();
      toast.success('Status do usuário atualizado.');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível atualizar o usuário.');
    }
  }

  function openPasswordModal(user) {
    setPasswordTarget(user);
    setPasswordForm(emptyPasswordForm);
  }

  async function savePassword(event) {
    event.preventDefault();
    const isSelf = passwordTarget?.id === currentUser?.id;
    if (isSelf && !passwordForm.current_password) {
      toast.error('Informe a senha atual.');
      return;
    }
    if (!passwordForm.new_password || !passwordForm.confirm_password) {
      toast.error('Informe e confirme a nova senha.');
      return;
    }
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      toast.error('A nova senha e a confirmação precisam ser iguais.');
      return;
    }

    setSavingPassword(true);
    try {
      await api.patch(`/users/${passwordTarget.id}/password`, passwordForm);
      setPasswordTarget(null);
      toast.success('Senha alterada com sucesso.');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível alterar a senha.');
    } finally {
      setSavingPassword(false);
    }
  }

  const groupedUsers = useMemo(() => ({
    pending: users.filter((user) => user.approval_status === 'pending'),
    approved: users.filter((user) => user.approval_status === 'approved' && user.is_active),
    rejected: users.filter((user) => user.approval_status === 'rejected' || (user.approval_status === 'approved' && !user.is_active)),
  }), [users]);

  const columns = [
    { key: 'name', label: 'Nome' },
    { key: 'username', label: 'Usuário' },
    { key: 'role', label: 'Perfil', render: (row) => row.role_name || row.role_slug || row.role },
    { key: 'approval_status', label: 'Status', render: (row) => statusLabels[row.approval_status] || row.approval_status },
    { key: 'is_active', label: 'Ativo', render: (row) => row.is_active ? 'Sim' : 'Não' },
    {
      key: 'actions',
      label: 'Ações',
      render: (row) => {
        const isMainAdmin = row.username === 'admin';
        return (
          <div className="users-page__actions">
            {isMainAdmin && <span className="users-page__protected">Admin principal protegido</span>}
            {canApprove && row.approval_status !== 'approved' && <button className="button button_primary" type="button" onClick={() => approve(row.id)}>Aprovar</button>}
            {canManage && !isMainAdmin && row.approval_status !== 'rejected' && <button className="button button_danger" type="button" onClick={() => reject(row.id)}>Recusar</button>}
            {canManage && !isMainAdmin && roles.length > 0 && (
              <label className="field users-page__role">
                <span className="field__label">Alterar perfil</span>
                <select className="field__input" value={row.role_id || ''} onChange={(event) => changeRole(row.id, event.target.value)}>
                  <option value="">Perfil legado: {row.role}</option>
                  {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                </select>
              </label>
            )}
            {canManage && !isMainAdmin && <button className="button" type="button" onClick={() => toggleActive(row.id)}>{row.is_active ? 'Desativar' : 'Ativar'}</button>}
            {(canChangePassword || row.id === currentUser?.id) && <button className="button" type="button" onClick={() => openPasswordModal(row)}>Alterar senha</button>}
          </div>
        );
      },
    },
  ];

  const isChangingOwnPassword = passwordTarget?.id === currentUser?.id;

  return (
    <section className="page users-page">
      <div className="page__header">
        <h1 className="page__title">Usuários</h1>
      </div>
      <div className="panel">
        <h2 className="users-page__title">Pendentes</h2>
        <DataTable columns={columns} rows={groupedUsers.pending} />
      </div>
      <div className="panel">
        <h2 className="users-page__title">Aprovados</h2>
        <DataTable columns={columns} rows={groupedUsers.approved} />
      </div>
      <div className="panel">
        <h2 className="users-page__title">Recusados</h2>
        <DataTable columns={columns} rows={groupedUsers.rejected} />
      </div>

      {passwordTarget && (
        <div className="users-page__modal">
          <form className="users-page__modal-content" onSubmit={savePassword}>
            <h2>Alterar senha</h2>
            <p>{passwordTarget.name} ({passwordTarget.username})</p>
            {isChangingOwnPassword && (
              <label className="field">
                <span className="field__label">Senha atual</span>
                <input className="field__input" type="password" value={passwordForm.current_password} onChange={(event) => setPasswordForm({ ...passwordForm, current_password: event.target.value })} required />
              </label>
            )}
            <label className="field">
              <span className="field__label">Nova senha</span>
              <input className="field__input" type="password" value={passwordForm.new_password} onChange={(event) => setPasswordForm({ ...passwordForm, new_password: event.target.value })} required />
            </label>
            <label className="field">
              <span className="field__label">Repetir nova senha</span>
              <input className="field__input" type="password" value={passwordForm.confirm_password} onChange={(event) => setPasswordForm({ ...passwordForm, confirm_password: event.target.value })} required />
            </label>
            <div className="users-page__modal-actions">
              <button className="button" type="button" onClick={() => setPasswordTarget(null)} disabled={savingPassword}>Cancelar</button>
              <button className="button button_primary" type="submit" disabled={savingPassword}>{savingPassword ? 'Salvando...' : 'Salvar senha'}</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
