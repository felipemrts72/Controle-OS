import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import './ShippingLookup.css';

export const ShippingLookup = forwardRef(function ShippingLookup({ onLookupCode, onLookupSale }, ref) {
  const [code, setCode] = useState('');
  const [sale, setSale] = useState('');
  const codeInputRef = useRef(null);

  useImperativeHandle(ref, () => ({
    clearCode() {
      setCode('');
    },
    focusCode() {
      codeInputRef.current?.focus();
    },
  }));

  return (
    <div className="shipping-lookup panel">
      <form className="shipping-lookup__form" onSubmit={(event) => { event.preventDefault(); onLookupCode(code); }}>
        <label className="field">
          <span className="field__label">Código de 6 dígitos</span>
          <input ref={codeInputRef} className="field__input" maxLength="6" value={code} onChange={(event) => setCode(event.target.value)} />
        </label>
        <button className="button button_primary" type="submit">Buscar código</button>
      </form>
      <form className="shipping-lookup__form" onSubmit={(event) => { event.preventDefault(); onLookupSale(sale); }}>
        <label className="field">
          <span className="field__label">Número da Venda</span>
          <input className="field__input" value={sale} onChange={(event) => setSale(event.target.value)} />
        </label>
        <button className="button" type="submit">Buscar venda</button>
      </form>
    </div>
  );
});
