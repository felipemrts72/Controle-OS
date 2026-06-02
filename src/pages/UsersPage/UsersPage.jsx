import { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api.js';
import { DataTable } from '../../components/DataTable/DataTable.jsx';
import './UsersPage.css';

const roleOptions = [
  { value: 'admin', label: 'Administrador' },
  { value: 'manager', label: 'Gerente' },
  { value: 'shipping', label: 'Expedição' },
  { value: 'viewer', label: 'Visualização' },
];

const statusLabels = {
  pending: 'Pendente',
  approved: 'Aprovado',
  rejected: 'Recusado',
};

export function UsersPage() {
  const [users, setUsers] = useState([]);

  async function load() {
    const response = await api.get('/users');
    setUsers(response.data);
  }

  useEffect(() => { load(); }, []);

  async function approve(id) {
    await api.patch(`/users/${id}/approve`);
    await load();
  }

  async function reject(id) {
    await api.patch(`/users/${id}/reject`);
    await load();
  }

  async function changeRole(id, role) {
    await api.patch(`/users/${id}/role`, { role });
    await load();
  }

  async function toggleActive(id) {
    await api.patch(`/users/${id}/toggle-active`);
    await load();
  }

  const groupedUsers = useMemo(() => ({
    pending: users.filter((user) => user.approval_status === 'pending'),
    approved: users.filter((user) => user.approval_status === 'approved' && user.is_active),
    rejected: users.filter((user) => user.approval_status === 'rejected' || (user.approval_status === 'approved' && !user.is_active)),
  }), [users]);

  const columns = [
    { key: 'name', label: 'Nome' },
    { key: 'username', label: 'Usuário' },
    { key: 'role', label: 'Perfil', render: (row) => roleOptions.find((role) => role.value === row.role)?.label || row.role },
    { key: 'approval_status', label: 'Status', render: (row) => statusLabels[row.approval_status] || row.approval_status },
    { key: 'is_active', label: 'Ativo', render: (row) => row.is_active ? 'Sim' : 'Não' },
    {
      key: 'actions',
      label: 'Ações',
      render: (row) => (
        <div className="users-page__actions">
          {row.approval_status !== 'approved' && <button className="button button_primary" type="button" onClick={() => approve(row.id)}>Aprovar</button>}
          {row.approval_status !== 'rejected' && <button className="button button_danger" type="button" onClick={() => reject(row.id)}>Recusar</button>}
          <label className="field users-page__role">
            <span className="field__label">Alterar perfil</span>
            <select className="field__input" value={row.role} onChange={(event) => changeRole(row.id, event.target.value)}>
              {roleOptions.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
            </select>
          </label>
          <button className="button" type="button" onClick={() => toggleActive(row.id)}>{row.is_active ? 'Desativar' : 'Ativar'}</button>
        </div>
      ),
    },
  ];

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
    </section>
  );
}
