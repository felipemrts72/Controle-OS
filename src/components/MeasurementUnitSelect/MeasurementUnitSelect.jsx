import { useEffect, useState } from 'react';
import { api } from '../../services/api.js';

export function MeasurementUnitSelect({ value='', onChange, required=true, disabled=false, label='Unidade' }) {
  const [units,setUnits]=useState([]);
  useEffect(()=>{let active=true;api.get('/measurement-units').then(response=>{if(active)setUnits(response.data)}).catch(()=>{if(active)setUnits([])});return()=>{active=false}},[]);
  const isLegacy=Boolean(value)&&!units.some(unit=>unit.code===value);
  return <label className="field"><span className="field__label">{label}</span><select className="field__input" value={value} onChange={onChange} required={required} disabled={disabled}><option value="">Selecione</option>{isLegacy&&<option value={value}>{value} — unidade legada</option>}{units.map(unit=><option value={unit.code} key={unit.code}>{unit.code} — {unit.name}</option>)}</select>{isLegacy&&<small>Valor histórico preservado. Selecione uma unidade padronizada para salvar.</small>}</label>;
}
