BEGIN;

UPDATE permissions
SET name = 'Aprovar orçamentos',
    description = 'Permite aprovar Orçamentos, criar a Venda vinculada e enviar itens aptos à Produção.',
    group_name = 'Comercial'
WHERE code = 'commercial.quotes.approve';

COMMIT;
