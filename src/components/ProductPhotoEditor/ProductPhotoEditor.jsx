import { useEffect, useState } from 'react';
import { api, getStoredUser } from '../../services/api.js';
import { canAccessPermission, isSuperAdmin } from '../../utils/permissions.js';
import { useToast } from '../ToastProvider/ToastProvider.jsx';
import './ProductPhotoEditor.css';

export function ProductPhotoEditor({
  product = {},
  pendingFile = null,
  onPendingFileChange,
  creationUploadToken = '',
  onPhotoChange,
  onUploadComplete,
}) {
  const toast = useToast();
  const user = getStoredUser();
  const [previewUrl, setPreviewUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const canEditAny = isSuperAdmin(user) || canAccessPermission(user, 'products.edit');
  const canEditOwnPreliminary = product?.review_status === 'pending_review'
    && product?.creation_origin === 'purchases'
    && String(product?.preliminary_created_by || '') === String(user?.id || '')
    && canAccessPermission(user, 'purchase_imports.create_product');
  const canStageNew = !product?.id && canAccessPermission(user, 'products.create');
  const canUploadInitial = Boolean(product?.id && creationUploadToken && canAccessPermission(user, 'products.create') && !product?.has_photo);
  const canManage = Boolean(canEditAny || canEditOwnPreliminary || canStageNew || canUploadInitial);

  useEffect(() => {
    let active = true;
    let objectUrl = '';
    if (pendingFile) {
      objectUrl = URL.createObjectURL(pendingFile);
      setPreviewUrl(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    }
    if (!product?.id || !product?.has_photo) {
      setPreviewUrl('');
      return undefined;
    }
    api.get(`/products/${product.id}/photo`, { responseType: 'blob' })
      .then((response) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(response.data);
        setPreviewUrl(objectUrl);
      })
      .catch(() => {
        if (active) setPreviewUrl('');
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [pendingFile, product?.id, product?.has_photo]);

  function validateFile(file) {
    if (!file) return false;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      toast.warning('Use uma imagem PNG ou JPEG.');
      return false;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.warning('A foto deve ter no máximo 5 MB.');
      return false;
    }
    return true;
  }

  async function upload(file) {
    if (!validateFile(file)) return;
    setBusy(true);
    try {
      const headers = { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) };
      if (creationUploadToken) headers['X-Product-Create-Token'] = creationUploadToken;
      await api.put(`/products/${product.id}/photo`, await file.arrayBuffer(), { headers });
      onPendingFileChange?.(null);
      onPhotoChange?.(true);
      toast.success(product.has_photo ? 'Foto do Produto substituída.' : 'Foto do Produto adicionada.');
      onUploadComplete?.();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível salvar a foto do Produto. O Produto permanece cadastrado.');
    } finally {
      setBusy(false);
    }
  }

  function selectFile(file) {
    if (!validateFile(file)) return;
    if (product?.id) upload(file);
    else onPendingFileChange?.(file);
  }

  async function remove() {
    if (!window.confirm('Remover a foto deste Produto?')) return;
    setBusy(true);
    try {
      await api.delete(`/products/${product.id}/photo`);
      onPhotoChange?.(false);
      toast.success('Foto do Produto removida.');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível remover a foto do Produto.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="product-photo-editor" aria-label="Foto do produto">
      <strong>{product?.id ? 'Foto do Produto' : 'Foto do produto (opcional)'}</strong>
      {previewUrl && <img className="product-photo-editor__preview" src={previewUrl} alt={`Foto de ${product.name || 'Produto'}`} />}
      {!previewUrl && !product.has_photo && <span className="product-form__hint">Nenhuma foto selecionada.</span>}
      {canManage && (
        <div className="product-photo-editor__actions">
          <label className="button">
            {product.has_photo ? 'Trocar pela câmera' : 'Tirar foto'}
            <input type="file" accept="image/png,image/jpeg" capture="environment" disabled={busy} onChange={(event) => { selectFile(event.target.files?.[0]); event.target.value = ''; }} />
          </label>
          <label className="button">
            {product.has_photo ? 'Escolher outra imagem' : 'Escolher da galeria'}
            <input type="file" accept="image/png,image/jpeg" disabled={busy} onChange={(event) => { selectFile(event.target.files?.[0]); event.target.value = ''; }} />
          </label>
          {creationUploadToken && pendingFile && <button className="button button_primary" type="button" disabled={busy} onClick={() => upload(pendingFile)}>Tentar enviar novamente</button>}
          {pendingFile && <button className="button" type="button" disabled={busy} onClick={() => onPendingFileChange?.(null)}>Remover seleção</button>}
          {product.has_photo && previewUrl && <button className="button" type="button" onClick={() => window.open(previewUrl, '_blank', 'noopener,noreferrer')}>Ver foto</button>}
          {product.has_photo && (canEditAny || canEditOwnPreliminary) && <button className="button button_danger" type="button" disabled={busy} onClick={remove}>Remover foto</button>}
        </div>
      )}
      {!canManage && product.has_photo && <span className="product-form__hint">Somente usuários autorizados podem alterar esta foto.</span>}
      <small className="product-photo-editor__hint">PNG ou JPEG, até 5 MB. A foto é opcional.</small>
    </section>
  );
}
