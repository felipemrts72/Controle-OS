import { useEffect, useState } from 'react';
import { api } from '../../services/api.js';

export function CatalogImage({ imageId, alt = 'Imagem comercial' }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true; let objectUrl;
    if (!imageId) return undefined;
    api.get(`/commercial/catalog/images/${imageId}/content`, { responseType: 'blob' }).then((response) => {
      objectUrl = URL.createObjectURL(response.data);
      if (active) setUrl(objectUrl);
    }).catch(() => {});
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [imageId]);
  return url ? <img src={url} alt={alt} /> : null;
}
