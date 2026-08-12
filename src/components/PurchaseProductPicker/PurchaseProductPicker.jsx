import { useState } from 'react';
import { api, getStoredUser } from '../../services/api.js';
import { canAccessPermission } from '../../utils/permissions.js';
import { ConfirmModal } from '../ConfirmModal/ConfirmModal.jsx';
import { ProductPhotoEditor } from '../ProductPhotoEditor/ProductPhotoEditor.jsx';
import { useToast } from '../ToastProvider/ToastProvider.jsx';
import './PurchaseProductPicker.css';

export function PurchaseProductPicker({ product, onSelect }) {
  const toast = useToast();
  const canCreate = canAccessPermission(getStoredUser(), 'purchase_imports.create_product');
  const [search, setSearch] = useState(product?.name || '');
  const [rows, setRows] = useState([]);
  const [creating, setCreating] = useState(false);
  const [duplicate, setDuplicate] = useState(null);
  const [photo, setPhoto] = useState(null);

  async function load() {
    try {
      setRows((await api.get('/purchases/products', { params: { search } })).data);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível pesquisar Produtos.');
    }
  }

  async function create(confirmDuplicate = false) {
    try {
      const response = await api.post('/purchases/imports/products', { name: search, confirm_duplicate: confirmDuplicate });
      const saved = { ...response.data, has_photo: false };
      if (photo) {
        try {
          await api.put(`/purchases/imports/products/${saved.id}/photo`, await photo.arrayBuffer(), {
            headers: { 'Content-Type': photo.type, 'X-File-Name': encodeURIComponent(photo.name) },
          });
          saved.has_photo = true;
        } catch (error) {
          toast.warning(`Produto criado, mas a foto não foi anexada: ${error.response?.data?.message || 'falha no envio'}.`);
        }
      }
      onSelect(saved);
      setRows([]);
      setCreating(false);
      setDuplicate(null);
      setPhoto(null);
      toast.success('Produto preliminar criado e selecionado.');
    } catch (error) {
      if (error.response?.data?.code === 'POSSIBLE_PRODUCT_DUPLICATE') {
        setDuplicate(error.response.data.details);
        setCreating(true);
        return;
      }
      toast.error(error.response?.data?.message || 'Não foi possível criar o Produto preliminar.');
    }
  }

  return (
    <div className="purchase-product-picker">
      <label className="field">
        <span className="field__label">Produto</span>
        <div className="purchase-product-picker__search">
          <input className="field__input" value={search} onChange={(event) => { setSearch(event.target.value); onSelect(null); }} placeholder="Nome, código, tipo ou grupo" required />
          <button className="button" type="button" onClick={load}>Pesquisar</button>
        </div>
      </label>
      {rows.length > 0 && (
        <div className="purchase-product-picker__results">
          {rows.map((row) => (
            <button className="button" type="button" key={row.id} onClick={() => { onSelect(row); setSearch(row.name); setRows([]); }}>
              <span>{row.internal_code ? `${row.internal_code} — ` : ''}{row.name}</span>
              {row.review_status === 'pending_review' && <small>Pendente de revisão{row.has_photo ? ' · com foto' : ''}</small>}
            </button>
          ))}
        </div>
      )}
      {canCreate && search.trim() && <button className="button" type="button" onClick={() => { setDuplicate(null); setCreating(true); }}>Cadastrar produto preliminar</button>}
      {product && <ProductPhotoEditor product={product} onPhotoChange={(hasPhoto) => onSelect({ ...product, has_photo: hasPhoto })} />}
      <ConfirmModal
        open={creating}
        title="Cadastrar produto preliminar"
        onCancel={() => { setCreating(false); setDuplicate(null); setPhoto(null); }}
        actions={<button className="button button_primary" type="button" onClick={() => create(Boolean(duplicate))}>{duplicate ? 'Confirmar mesmo assim' : 'Criar e selecionar'}</button>}
      >
        <p><strong>Nome:</strong> {search}</p>
        <label className="field">
          <span className="field__label">Foto do Produto (opcional)</span>
          <input className="field__input" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" onChange={(event) => {
            const file = event.target.files?.[0] || null;
            if (file && file.size > 5 * 1024 * 1024) {
              toast.warning('A foto deve ter no máximo 5 MB.');
              event.target.value = '';
              setPhoto(null);
              return;
            }
            setPhoto(file);
          }} />
          {photo && <small>{photo.name} · {(photo.size / 1024).toFixed(0)} KB</small>}
        </label>
        {duplicate ? (
          <>
            <p>Possíveis Produtos duplicados:</p>
            <ul>{duplicate.candidates?.map((row) => <li key={row.id}>{row.name}{row.review_status === 'pending_review' ? ' — pendente de revisão' : ''}</li>)}</ul>
            <p>Confirme somente se for realmente um Produto diferente.</p>
          </>
        ) : <p>O cadastro será criado como “Pendente de revisão”, sem saldo ou movimentação de estoque. A foto também ficará sujeita à revisão cadastral.</p>}
      </ConfirmModal>
    </div>
  );
}
