# 12 — Riscos atualizados e controles

## Críticos

| Risco | Evidência | Impacto | Controle recomendado |
|---|---|---|---|
| Homônimos fundidos | `customers.normalized_name` é único e upsert atual atualiza por nome | Cliente/documento/OS incorretos | Retirar unique, migrar por ID externo/documento, revisão humana |
| Cliente histórico mutável | ERP congela só nome e PDF consulta cadastro atual | PDF antigo muda ou reconstrói dado incorreto | Snapshot completo na emissão; marcar limitações do histórico |
| Código de Produto conflitante | `internal_code` é único; ERP usa SKU e até ID como “código” | Falha/overwrite/falsa equivalência | Namespace externo, política de código local, nunca sobrescrever |
| Produto implícito/manual | ERP cria `fabricado` por nome em item manual | Duplicados/tipo falso | Resolver todos os Produtos antes; bloquear criação implícita no importador |
| Campos operacionais ausentes | origem não tem setor/volume/peso; destino exige volume/peso | Defaults falsos ou import bloqueado | Pendência controlada/staging; não inventar 1/1 kg |
| Versão histórica editável | bloqueio ERP depende de referência atual | PDF técnico muda | Selo permanente de publicação/uso + nova versão |
| Caminhos/arquivos compartilhados | clones podem apontar mesmo arquivo | exclusão de uma versão quebra outra | cópia independente ou asset imutável referenciado; hash |
| IDs incompatíveis | serial na origem, UUID no destino | FKs erradas/duplicidade em reexecução | mapas externos e constraints `(source_system, source_id)` |

## Altos

| Risco | Evidência | Controle |
|---|---|---|
| CPF/CNPJ ausente/inválido | campo nullable, sem constraint de unicidade/validação | Normalização + relatório; não fundir por nome |
| Telefone não normalizado/compartilhado | texto livre nos dois sistemas | Sinal combinado, nunca chave isolada |
| `location`/`destination_uf` confundidos com endereço | campos OliMen têm semântica de Entrega | criar endereço civil estruturado; preservar campos operacionais |
| Tipo divergente | `conjunto`/`consumivel` sem equivalente comportamental | tabela de conversão e revisão |
| Unidade divergente | strings/aliases diferentes | mapa por `measurement_units`; bloquear desconhecidos |
| Preço sem política | destino não tem preço mestre; origem tem nullable | perfil opcional + snapshot; definir moeda/vigência |
| Produto local inativo | buscas costumam filtrar ativos | mostrar no matching; revisão para reativar/criar, histórico não depende de atividade |
| Catálogo parcial | primeira versão/arquivos podem falhar separadamente | importar agregado, validar antes de ativar |
| PDF não determinístico | dados vivos e renderer evolui | snapshots + armazenar PDF oficial/hash/renderer version |
| Permissões insuficientes | ERP usa auth/admin amplo; OliMen usa RBAC | Permissões específicas no backend/frontend e testes negativos |
| Mistura Compra × Comercial | OliMen já tem `purchase_quotes` e “Cotações” | namespace `commercial_*`, menu e permissões separados |
| Aprovação com efeitos | ERP cria venda/reserva/Produção/Entrega | mapear somente estado comercial; nenhuma chamada operacional |
| Importação parcial de mídia | DB/filesystem sem transação comum | temporário, ledger, compensação e retomada |

## Médios

- Nome/SKU com espaços, acentos e case diferentes: normalização somente para matching; preservar exibição.
- `sku UNIQUE` permite vários nulos e pode ter semântica diferente de `internal_code`.
- Cliente inativo no ERP pode estar ativo/necessário no OliMen; status não sobrescreve automaticamente equivalente.
- Estado `rejeitado` da origem precisa mapear para `refused`, sem apagar histórico.
- Itens históricos não têm unidade/código snapshot; dados reconstruídos devem ser identificados.
- Desconto absoluto do ERP é por unidade; nome genérico pode causar cálculo incorreto.
- Soma de pagamentos não é validada no backend fonte; importar inconsistências precisa relatório.
- Itens/pagamentos são recriados em updates no ERP; IDs filhos não são boa identidade isolada.
- Produto repetido pode apontar versões diferentes; dedupe de PDF apenas por Produto é incorreto.
- Logo/assinatura podem faltar; renderer deve degradar sem quebrar.
- WebP da origem não é suportado pelo upload atual do destino; conversão/decoder deve ser decidido.
- Storage local requer volume persistente, backup e restore conjunto.
- Datas usam timestamp sem timezone em partes dos dois sistemas; `commercial_date` deve permanecer DATE e eventos devem ter timezone definido.
- Documento normalizado parcialmente pode colidir; índice único só após saneamento.
- Relatórios de conflito contêm dados pessoais; controlar acesso/retenção.
- Importador reexecutado com regras diferentes pode mudar candidatos; versionar contrato/decisões.

## Riscos de escopo

- transformar aprovação comercial em Venda/OS automaticamente;
- incluir reserva/saldo de Estoque “por conveniência”;
- transportar BOM/componentes do ERP como itens inclusos de Catálogo;
- reutilizar `product_images` como galeria versionada;
- duplicar Cliente/Produto/Empresa/autenticação;
- copiar código/estrutura PDF do ERP sem adaptar padrões do OliMen;
- migrar todos os Orçamentos históricos antes de provar seu valor;
- desligar a origem antes de validar mídia/PDF e reconciliação delta.

## Decisões que exigem aceite antes de implementar

1. política de `internal_code` para novos Produtos;
2. tratamento de volume/peso/setor ausentes;
3. mapeamento de `conjunto` e `consumivel`;
4. perfil comercial versus colunas no Produto;
5. política de documento duplicado/matriz-filial;
6. momento exato de emissão/selo e regras de revisão;
7. documento PDF oficial persistido e retenção;
8. estratégia WebP e assets compartilhados;
9. escopo de Orçamentos históricos;
10. um ou vários assinantes.

## Indicadores de controle

- zero overwrite automático de mestre local;
- zero duplicidade por source ID;
- zero Cliente unido somente por nome;
- 100% de conflitos classificados/decididos antes da aplicação;
- 100% das versões referenciadas imutáveis e acessíveis;
- 100% dos PDFs homologados usando snapshots;
- zero movimento/ordem/reserva/compra/entrega criado pelo Comercial inicial;
- reconciliação de contagens e hashes por lote.

