import { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api.js';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import { canAccessPermission } from '../../utils/permissions.js';
import { getStoredUser } from '../../services/api.js';
import './RolesPage.css';

const emptyForm = {
  id: null,
  name: '',
  slug: '',
  description: '',
  is_active: true,
  permission_codes: [],
  is_system: false,
};

export function RolesPage() {
  const toast = useToast();
  const currentUser = getStoredUser();
  const canManage = canAccessPermission(currentUser, 'roles.manage');
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [selectedRoleId, setSelectedRoleId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  async function load() {
    const [rolesResponse, permissionsResponse] = await Promise.all([
      api.get('/roles'),
      api.get('/roles/permissions'),
    ]);
    setRoles(rolesResponse.data);
    setPermissions(permissionsResponse.data);
    if (!selectedRoleId && rolesResponse.data[0]) setSelectedRoleId(rolesResponse.data[0].id);
  }

  useEffect(() => {
    load().catch(() => toast.error('Não foi possível carregar roles e permissões.'));
  }, []);

  useEffect(() => {
    const selected = roles.find((role) => role.id === selectedRoleId);
    if (!selected) {
      setForm(emptyForm);
      return;
    }
    setForm({
      id: selected.id,
      name: selected.name || '',
      slug: selected.slug || '',
      description: selected.description || '',
      is_active: selected.is_active,
      permission_codes: selected.permissions || [],
      is_system: selected.is_system,
    });
  }, [roles, selectedRoleId]);

  const groupedPermissions = useMemo(() => permissions.reduce((groups, permission) => {
    const groupName = permission.group_name || 'Outras';
    return {
      ...groups,
      [groupName]: [...(groups[groupName] || []), permission],
    };
  }, {}), [permissions]);

  function startNewRole() {
    setSelectedRoleId(null);
    setForm(emptyForm);
  }

  function togglePermission(code) {
    setForm((current) => ({
      ...current,
      permission_codes: current.permission_codes.includes(code)
        ? current.permission_codes.filter((permissionCode) => permissionCode !== code)
        : [...current.permission_codes, code],
    }));
  }

  async function save(event) {
    event.preventDefault();
    if (!canManage) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        slug: form.slug,
        description: form.description,
        is_active: form.is_active,
        permission_codes: form.permission_codes,
      };
      if (form.id) {
        await api.put(`/roles/${form.id}`, payload);
        toast.success('Role atualizada com sucesso.');
      } else {
        const response = await api.post('/roles', payload);
        setSelectedRoleId(response.data.id);
        toast.success('Role criada com sucesso.');
      }
      await load();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível salvar a role.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page roles-page">
      <div className="page__header roles-page__header">
        <h1 className="page__title">Roles e Permissões</h1>
        {canManage && <button className="button button_primary" type="button" onClick={startNewRole}>Nova role</button>}
      </div>

      <div className="roles-page__layout">
        <div className="panel roles-page__list">
          {roles.map((role) => (
            <button
              key={role.id}
              className={`roles-page__role-button${role.id === form.id ? ' roles-page__role-button_active' : ''}`}
              type="button"
              onClick={() => setSelectedRoleId(role.id)}
            >
              <strong>{role.name}</strong>
              <span>{role.is_active ? 'Ativa' : 'Inativa'}{role.is_system ? ' · Sistema' : ''}</span>
            </button>
          ))}
        </div>

        <form className="panel roles-page__form" onSubmit={save}>
          <div className="roles-page__form-grid">
            <label className="field">
              <span className="field__label">Nome</span>
              <input className="field__input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} disabled={!canManage} required />
            </label>
            <label className="field">
              <span className="field__label">Identificador</span>
              <input className="field__input" value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} disabled={!canManage || Boolean(form.id)} placeholder="expedicao_teste" />
            </label>
          </div>
          <label className="field">
            <span className="field__label">Descrição</span>
            <textarea className="field__input" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} disabled={!canManage} rows={3} />
          </label>
          <label className="roles-page__status">
            <input
              type="checkbox"
              checked={form.is_active}
              disabled={!canManage || form.is_system}
              onChange={(event) => setForm({ ...form, is_active: event.target.checked })}
            />
            <span>Role ativa</span>
          </label>

          <div className="roles-page__permissions">
            {Object.entries(groupedPermissions).map(([groupName, groupPermissions]) => (
              <section className="roles-page__permission-group" key={groupName}>
                <h2>{groupName}</h2>
                <div className="roles-page__checks">
                  {groupPermissions.map((permission) => (
                    <label className="roles-page__check" key={permission.code}>
                      <input
                        type="checkbox"
                        checked={form.permission_codes.includes(permission.code)}
                        disabled={!canManage}
                        onChange={() => togglePermission(permission.code)}
                      />
                      <span>{permission.name}</span>
                    </label>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {canManage && (
            <div className="roles-page__actions">
              <button className="button button_primary" type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Salvar role'}</button>
            </div>
          )}
        </form>
      </div>
    </section>
  );
}
