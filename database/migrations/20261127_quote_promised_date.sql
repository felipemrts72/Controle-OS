SET LOCAL lock_timeout = '10s';
ALTER TABLE commercial_quotes ADD COLUMN promised_date DATE;
COMMENT ON COLUMN commercial_quotes.promised_date IS 'Previsão interna antes da produção; após o vínculo a referência operacional é internal_orders.promised_date. Nunca integra o PDF comercial.';
