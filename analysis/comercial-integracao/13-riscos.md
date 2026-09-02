# 13 — Riscos da futura integração

## Críticos

| Risco | Evidência no OliMen | Mitigação futura |
|---|---|---|
| Duplicidade/falsa equivalência | Nome não é único; matching atual usa similaridade; `internal_code` pode coincidir entre sistemas | Tabela de equivalência, revisão humana, import em preview/confirm |
| Colisão de código | `lower(internal_code)` é único; não há namespace/sequência de Produto | Separar código local de código externo e definir política antes de importar |
| Documento histórico mutável | Cliente/Empresa/Catálogo vivos podem mudar | Snapshots completos + versão técnica específica; decidir persistência/hash do PDF |
| Cliente insuficiente | Sem CPF/CNPJ, e-mail e endereço completo; sem CRUD próprio | Evoluir tabela oficial antes do Orçamento; não criar cliente paralelo |
| Defaults preliminares falsos | Compras usa Revenda, Expedição, 1 volume, 1 kg | Marcar pendências por campo/contexto e impedir uso cego como dado confirmado |
| Mistura Cotação de Compras × Orçamento | `purchase_quote_*` e “Cotações” já existem | Namespaces, tabelas, rotas e Permissões `commercial_*` distintos |

## Altos

| Risco | Evidência | Mitigação |
|---|---|---|
| Origem inadequada | `creation_origin` só aceita manual/purchases | Identificador externo N:1, não enum simples |
| Tipo inconsistente | `products.type` sem FK; tipos customizados sem comportamento explícito | Validação central e testes; decidir impacto comercial por tipo |
| Campos obrigatórios bloquearem legado | Nome/tipo/volume/peso obrigatórios; fluxo regular exige setor/unidade | Campos novos opcionais; onboarding/import específico e revisão |
| Produto inativo em histórico | Buscas só retornam ativos | Itens com FK + snapshot; detalhe histórico não deve exigir atividade |
| Versionamento técnico mutável | Ainda inexistente | Versionar conteúdo, imagens e publicação; impedir edição retroativa |
| Storage local | Arquivos no filesystem da instância | Volume persistente/backup; avaliar object storage quando houver escala |
| Upload parcial/órfão | DB e filesystem não têm transação comum | Escrita temporária/compensação/job de limpeza/hash |
| Permissão incompleta | Catálogo de Permissões aparece em DB e código; frontend não é barreira | Migration + backend + frontend + testes coordenados |
| Exclusão de Orçamento | Produto usa soft delete; regra comercial não definida | Cancelamento/soft delete com auditoria, nunca delete físico de emitido |

## Médios

- Unidade externa diferente ou não reconhecida: normalizar por `measurement_units`/aliases e exigir escolha quando ambígua.
- Preço divergente: não existe preço de venda mestre; definir fonte, vigência, moeda, desconto e snapshot por item.
- Ausência de descrição comercial/technical: não bloquear Produto operacional; exigir no contexto em que for realmente necessária.
- Imagem ausente/inválida: PDF deve degradar de forma controlada; versão publicada deve registrar exatamente o conjunto usado.
- Uma única foto de Produto: não tentar reutilizá-la como galeria versionada.
- `product_components` confundido com “itens inclusos”: composição de Produção e conteúdo de Catálogo são semânticas diferentes.
- `material_groups` confundido com categoria: domínio de Compras/fornecedores.
- Datas misturam TIMESTAMP/TIMESTAMPTZ: novas estruturas devem definir timezone e tipo.
- APIs de lista têm formatos de paginação diferentes: definir contrato do Comercial e mantê-lo consistente.
- Validação manual espalhada: evitar duplicar regras nos controllers e frontend.
- Token em localStorage e fallback `dev-secret`: riscos de segurança transversais.
- MIME/extensão válidos não garantem imagem segura: considerar re-encoding/EXIF/antivírus conforme exposição.
- Não há drag-and-drop, preview PDF embutido ou biblioteca de forms: escopo de UX pode crescer.
- Não há reativação de Produto exposta: import pode encontrar código pertencente a Produto inativo e precisar de decisão humana.

## Riscos de acoplamento a evitar

- Comercial movimentar estoque na primeira fase.
- Orçamento criar tarefa/OS automaticamente sem fase própria aprovada.
- Catálogo Técnico alterar roteiro/BOM/componentes.
- Importação atualizar `products` ou apagar imagens sem confirmação.
- Reutilizar Permissões de Compras apenas porque ambas usam “cotação”.
- Servir uploads técnicos como arquivos públicos.
- PDF buscar Cliente/Empresa/Produto atuais na reimpressão histórica.

## Pontos que exigem decisão antes de implementar

1. Identificador externo estável disponível e política de equivalência.
2. Política de código interno de Produto.
3. Campos oficiais e deduplicação de Cliente.
4. Fonte/política de preço comercial.
5. Estados e revisões de Orçamento.
6. Momento de congelar snapshots.
7. Publicação/imutabilidade do Catálogo.
8. Persistência do binário PDF ou regeneração determinística.
9. Assinatura textual versus imagem e seu versionamento.
10. Escopo por vendedor/equipe, se houver.
