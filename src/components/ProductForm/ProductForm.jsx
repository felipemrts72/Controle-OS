import { useEffect, useState } from 'react';
import { api, getStoredUser } from '../../services/api.js';
import { canAccessPermission } from '../../utils/permissions.js';
import { useToast } from '../ToastProvider/ToastProvider.jsx';
import { ProductComponentsEditor } from '../ProductComponentsEditor/ProductComponentsEditor.jsx';
import { ProductManufacturingRouteEditor } from '../ProductManufacturingRouteEditor/ProductManufacturingRouteEditor.jsx';
import { MeasurementUnitSelect } from '../MeasurementUnitSelect/MeasurementUnitSelect.jsx';
import { ProductPhotoEditor } from '../ProductPhotoEditor/ProductPhotoEditor.jsx';
import './ProductForm.css';

export function ProductForm({ initialProduct, onSubmit, onPhotoUploaded }) {
  const toast = useToast();
  const user = getStoredUser();
  const canViewCost = canAccessPermission(user, 'products.cost.view');
  const canEditCost = canAccessPermission(user, 'products.cost.edit');
  const [sectors, setSectors] = useState([]);
  const [productTypes, setProductTypes] = useState([]);
  const [form, setForm] = useState(initialProduct || { name: '', type: 'manufactured', measurement_unit_code: '', default_volume_quantity: 1, default_total_weight_kg: 1, is_active: true, components: [] });
  const [pendingPhoto, setPendingPhoto] = useState(null);

  useEffect(() => {
    api.get('/sectors').then((response) => setSectors(response.data.filter((sector) => sector.is_active)));
    api.get('/products/types').then((response) => setProductTypes(response.data.filter((type) => type.is_active)));
  }, []);

  function change(event) {
    const value = event.target.type === 'number' ? Number(event.target.value) : event.target.value;
    setForm((current) => ({ ...current, [event.target.name]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    if (!form.name || !form.measurement_unit_code || !form.default_volume_quantity || !form.default_total_weight_kg) {
      toast.error('Preencha os campos obrigatórios.');
      return;
    }
    if (!form.sector_id) {
      toast.error('Informe o setor responsável do Produto.');
      return;
    }
    if (initialProduct?.type !== 'resale' && form.type === 'resale' && (form.manufacturing_steps || []).length) {
      toast.error('Remova e salve o roteiro de fabricação antes de alterar o tipo para Revenda.');
      return;
    }
    const result = await onSubmit(form, pendingPhoto);
    if (result?.product) setForm(result.product);
  }

  return (
    <form className="product-form panel" onSubmit={submit}>
      <div className="product-form__identity">
        <label className="field">
          <span className="field__label">Nome</span>
          <input className="field__input" name="name" value={form.name} onChange={change} required />
        </label>
        <ProductPhotoEditor
          product={form}
          pendingFile={pendingPhoto}
          onPendingFileChange={setPendingPhoto}
          creationUploadToken={form.photo_upload_token || ''}
          onPhotoChange={(hasPhoto) => setForm((current) => ({ ...current, has_photo: hasPhoto }))}
          onUploadComplete={onPhotoUploaded}
        />
      </div>
      <div className="form-grid">
        <label className="field">
          <span className="field__label">Tipo</span>
          <select className="field__input" name="type" value={form.type} onChange={change}>
            {productTypes.map((type) => <option key={type.code} value={type.code}>{type.name}</option>)}
          </select>
        </label>
        <MeasurementUnitSelect value={form.measurement_unit_code||''} onChange={(event)=>setForm((current)=>({...current,measurement_unit_code:event.target.value}))} label="Unidade padrão" />
        <label className="field">
          <span className="field__label">Setor responsável</span>
          <select className="field__input" name="sector_id" value={form.sector_id || ''} onChange={change} required>
            <option value="">Selecione</option>
            {sectors.map((sector) => <option key={sector.id} value={sector.id}>{sector.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Quantidade padrão de volumes</span>
          <input className="field__input" type="number" min="1" name="default_volume_quantity" value={form.default_volume_quantity} onChange={change} required />
        </label>
        <label className="field">
          <span className="field__label">Peso total padrão (kg)</span>
          <input className="field__input" type="number" min="0.01" step="0.01" name="default_total_weight_kg" value={form.default_total_weight_kg} onChange={change} required />
        </label>
        {canViewCost && <label className="field">
          <span className="field__label">Custo operacional (R$)</span>
          <input className="field__input" type="number" min="0" step="0.01" name="operational_cost" value={form.operational_cost ?? ''} onChange={change} disabled={!canEditCost} required={canEditCost && (!initialProduct || (initialProduct.review_status === 'pending_review' && form.review_status === 'approved'))} />
          <small className="product-form__hint">Informação operacional sensível; não é preço de venda.</small>
        </label>}
      </div>
      {form.review_status === 'pending_review' && <div className="panel"><strong>Produto pendente de revisão</strong><p>Complete o cadastro e confirme abaixo para aprová-lo. Esta aprovação não cria saldo nem movimentação.</p><label><input type="checkbox" checked={form.review_status==='approved'} onChange={(event)=>setForm((current)=>({...current,review_status:event.target.checked?'approved':'pending_review'}))}/> Marcar cadastro como revisado</label></div>}
      <ProductComponentsEditor
        components={form.components || []}
        productId={form.id || null}
        sectors={sectors}
        onChange={(components) => {
          setForm((current) => ({ ...current, components }));
        }}
      />
      {form.type !== 'resale' && (
        <ProductManufacturingRouteEditor
          steps={form.manufacturing_steps || []}
          sectors={sectors}
          onChange={(manufacturingSteps) => setForm((current) => ({ ...current, manufacturing_steps: manufacturingSteps }))}
        />
      )}
      {form.type === 'manufactured' && !(form.manufacturing_steps || []).length && (
        <p className="product-form__hint">Este produto ainda utiliza o processo antigo de geração de tarefas. Cadastre um roteiro de fabricação para utilizar dependências.</p>
      )}
      <button className="button button_primary product-form__button" type="submit" disabled={Boolean(form.id && form.photo_upload_token && pendingPhoto)}>{form.id && form.photo_upload_token ? (pendingPhoto ? 'Produto criado — envie novamente a foto' : 'Concluir cadastro') : 'Salvar produto'}</button>
    </form>
  );
}
