import './VolumeEditor.css';

export function VolumeEditor({ volumes, onChange }) {
  function normalize(nextVolumes) {
    const byItem = nextVolumes.reduce((acc, volume) => {
      acc[volume.sold_item_id] = acc[volume.sold_item_id] || [];
      acc[volume.sold_item_id].push(volume);
      return acc;
    }, {});
    return Object.values(byItem).flatMap((itemVolumes) => itemVolumes.map((volume, index) => ({
      ...volume,
      volume_number: index + 1,
      total_volumes: itemVolumes.length,
    })));
  }

  function update(index, field, value) {
    onChange(normalize(volumes.map((volume, currentIndex) => currentIndex === index ? { ...volume, [field]: value } : volume)));
  }

  function addAfter(volume) {
    const next = [...volumes, {
      sold_item_id: volume.sold_item_id,
      volume_number: volume.total_volumes + 1,
      total_volumes: volume.total_volumes + 1,
      weight_kg: volume.weight_kg,
      description: '',
      label_status: volume.label_status,
    }];
    onChange(normalize(next));
  }

  function remove(index) {
    onChange(normalize(volumes.filter((_, currentIndex) => currentIndex !== index)));
  }

  return (
    <div className="volume-editor">
      {volumes.map((volume, index) => (
        <div className="volume-editor__row" key={volume.id}>
          <strong>Volume {volume.volume_number}/{volume.total_volumes}</strong>
          <input className="field__input" type="number" min="1" value={volume.total_volumes} onChange={(event) => update(index, 'total_volumes', Number(event.target.value))} />
          <input className="field__input" type="number" min="0.01" step="0.01" value={volume.weight_kg} onChange={(event) => update(index, 'weight_kg', Number(event.target.value))} />
          <input className="field__input" value={volume.description || ''} onChange={(event) => update(index, 'description', event.target.value)} placeholder="Descrição do volume" />
          <button className="button" type="button" onClick={() => addAfter(volume)}>Adicionar</button>
          <button className="button button_danger" type="button" onClick={() => remove(index)}>Remover</button>
        </div>
      ))}
    </div>
  );
}
