import { useEffect, useState } from 'react';
import { ConfirmModal } from '../../components/ConfirmModal/ConfirmModal.jsx';
import { api, apiErrorMessage } from '../../services/api.js';

export function QuickOperationalProductModal({ name: initialName, commercialProductId, onClose, onCreated }) {
  const [name, setName] = useState(initialName);
  const [sector, setSector] = useState('');
  const [sectors, setSectors] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { api.get('/sectors').then(({ data }) => setSectors(data.filter((s) => s.is_active))).catch((e) => setError(apiErrorMessage(e))); }, []);
  async function create() {
    setSaving(true); setError('');
    try {
      const { data } = await api.post('/commercial/catalog/operational-products', { name, sector_id: sector, commercial_product_id: commercialProductId || null });
      onCreated(data);
    } catch (e) { setError(apiErrorMessage(e)); } finally { setSaving(false); }
  }
  return <ConfirmModal open title="Criar Produto do Estoque" onCancel={() => { if (!saving) onClose(); }} actions={<button type="button" className="button button_primary" disabled={saving || !name.trim() || !sector} onClick={create}>{saving ? 'Criando...' : 'Criar e selecionar'}</button>}>
    <label className="field"><span className="field__label">Nome do produto operacional</span><input className="field__input" value={name} disabled={saving} onChange={(e) => setName(e.target.value)} /></label>
    <label className="field"><span className="field__label">Setor do produto operacional</span><select className="field__input" value={sector} disabled={saving} onChange={(e) => setSector(e.target.value)}><option value="">Selecione o setor</option>{sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <p>O produto ficará pendente de revisão no Estoque.</p>
    {error && <p role="alert">{error}</p>}
  </ConfirmModal>;
}
