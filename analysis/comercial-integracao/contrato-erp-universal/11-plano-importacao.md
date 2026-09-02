# 11 — Plano conceitual de importação

Este plano descreve um importador futuro. Nenhuma etapa foi executada nesta análise.

## Pré-condições

- schema mestre e novas tabelas homologados;
- backup/restore de banco e storage testados;
- política de código local definida;
- conversão de tipos/unidades aprovada;
- regra para volume/peso ausentes definida;
- usuários e Permissões de revisão criados;
- fonte congelada ou janela incremental definida;
- contrato/versionamento do importador registrado.

## Ordem de dados

### Etapa 1 — Preparar/ampliar mestres

- evoluir `customers`;
- preparar identidade externa de Cliente/Produto;
- preparar cadastro parcial de Produto sem defaults falsos;
- preparar Catálogo/storage e tabelas do Comercial conforme escopo;
- criar ledger de lotes/importação;
- não alterar dados existentes automaticamente.

### Etapa 2 — Importar Clientes

1. ler `clientes`;
2. normalizar somente para comparação;
3. gerar candidatos por vínculo/documento/telefone/nome+cidade;
4. separar certos, prováveis, dúvidas e novos;
5. revisar ambiguidades;
6. criar/vincular `customers`;
7. registrar `customer_external_ids`;
8. validar contagens, status e campos.

Clientes vêm antes porque Orçamentos apontam para eles. Homônimos devem coexistir após a retirada da unicidade por nome.

### Etapa 3 — Importar/conciliar Produtos

1. ler `produtos`;
2. mapear tipo e unidade;
3. gerar candidatos;
4. detectar colisões de SKU/código;
5. revisar `conjunto`, `consumivel` e campos operacionais ausentes;
6. vincular ou criar Produtos pendentes conforme política;
7. registrar `product_external_ids`;
8. não importar estoque, custo, último preço de compra, BOM ou movimentos.

### Etapa 4 — Migrar Catálogo Técnico

- somente para Produtos resolvidos;
- criar/reutilizar Catálogo 1:1;
- migrar versões em ordem;
- migrar textos/filhos;
- inventariar/copiar mídia com hash;
- tratar paths compartilhados;
- ativar/selar após integridade completa;
- validar versão exata usada por histórico.

### Etapa 5 — Disponibilizar Comercial/Orçamentos novos

- criar o módulo e Permissões;
- usar cadastros já conciliados;
- validar snapshots, cálculo, Catálogo e PDF;
- sem efeitos operacionais.

### Etapa 6 — Orçamentos históricos, opcional

Executar apenas se aprovado após análise de custo/valor/legalidade. Exige mapas completos de Cliente, Produto e versão, política para dados não congelados e relatório de limitações. Não recriar vendas, reservas, produção ou entrega.

### Etapa 7 — Homologação e corte

- reconciliação final/incremental;
- operação paralela controlada;
- aceite funcional/documental;
- congelamento de escrita da origem por janela;
- importação delta;
- só então desativação gradual.

## Dry run obrigatório

Interface conceitual: `--dry-run`. Não grava banco, não copia arquivos e não cria vínculos definitivos.

Saída mínima por entidade:

- novos;
- vínculos certos existentes;
- candidatos prováveis;
- dúvidas;
- conflitos;
- ignorados com motivo;
- inválidos/erros;
- mudanças detectadas desde o último hash;
- arquivos ausentes, duplicados, WebP ou inválidos.

Produzir contagens e relatório detalhado reproduzível, com versão do contrato e hash da entrada. Dados pessoais devem ser mascarados quando o relatório sair do ambiente autorizado.

## Relatório de conflitos

### Produtos

- mesmo código/SKU, Produtos diferentes;
- nomes semelhantes com tipo/unidade incompatíveis;
- `conjunto`/`consumivel` sem decisão;
- unidade desconhecida/divergente;
- volume/peso/setor ausentes;
- Produto local inativo;
- múltiplos candidatos;
- Catálogo sem Produto resolvido.

### Clientes

- CPF/CNPJ ausente ou inválido;
- mesmo documento em mais de um Cliente;
- telefone compartilhado;
- homônimos;
- documento divergente entre candidato e origem;
- endereço/cidade conflitantes;
- Cliente local inativo;
- nome obrigatório vazio/impróprio.

### Mídia/histórico

- path fora da raiz;
- arquivo inexistente;
- MIME/assinatura inválidos;
- mesma origem com hashes diferentes entre leituras;
- caminho compartilhado entre versões;
- versão referenciada sem conteúdo;
- item histórico sem mapa de Produto/versão.

## Revisão humana

O relatório deve permitir decisões explícitas:

- vincular ao registro local X;
- criar novo;
- preencher apenas campos locais vazios selecionados;
- manter ambos e registrar rejeição do candidato;
- adiar/bloquear.

A decisão possui autor, data, justificativa e versão dos dados comparados. O importador aplica a decisão, não recalcula silenciosamente outro candidato entre dry run e execução.

## Idempotência

Chaves:

- Produto/Cliente: `(source_system, source_id)`;
- Catálogo: Produto resolvido + ID externo;
- versão: Catálogo + ID externo/número;
- imagem/filhos: ID externo ou chave composta estável + hash;
- Orçamento histórico: source system + source quote ID/revision;
- lote: fonte + snapshot/hash + versão do contrato.

Reexecução:

- encontra o mesmo UUID;
- não duplica filhos;
- não recria arquivo com hash já confirmado, conforme estratégia;
- não sobrescreve mestre local;
- retoma falhas parciais a partir do ledger;
- reporta mudança de payload para decisão.

## Transação, lotes e compensação

- unidades pequenas por Cliente/Produto/Catálogo/Orçamento;
- evitar uma transação gigante;
- usar savepoints/lotes quando apropriado;
- DB e filesystem requerem estado temporário e compensação;
- nunca remover origem;
- execução interrompida pode ser retomada;
- commit do vínculo só ocorre após validação do registro;
- versão de Catálogo só ativa após filhos/mídia íntegros.

## Validações pós-importação

- contagem fonte × criados/vinculados/ignorados/conflitos;
- unicidade de IDs externos;
- nenhum Produto/Cliente duplicado pelo mesmo source ID;
- FKs válidas;
- uma versão ativa por Catálogo;
- todas as versões referenciadas existem e estão bloqueadas;
- hashes/arquivos acessíveis pelo endpoint protegido;
- amostra e total de preços/quantidades/pagamentos;
- PDFs comparados visualmente em casos representativos;
- nenhuma movimentação em Estoque/Produção/Compras/Expedição.

## Orçamentos históricos: decisão de valor

| Classificação | Quando usar |
|---|---|
| obrigatório | somente se requisito legal/contratual determinar acesso no OliMen |
| opcional recomendado | histórico recente/aberto necessário à operação, com limitações aceitas |
| não recomendado | massa antiga sem valor operacional, snapshots insuficientes ou dependências irrecuperáveis |

Alternativa válida: manter ERP em modo consulta/arquivo por período, importar apenas Orçamentos ativos/recentes e preservar exportações oficiais. A decisão deve considerar LGPD, retenção, auditoria e custo de reconstrução.

## Rollback conceitual

- preferir importações marcadas por lote e reversão apenas de registros novos sem uso posterior;
- vínculos confirmados devem ser desfeitos por operação auditada, não delete amplo;
- registros locais preexistentes nunca são “restaurados” porque não devem ter sido sobrescritos;
- arquivos novos do lote só podem ser removidos após prova de ausência de referência;
- em produção, correção/novo lote costuma ser mais segura que rollback destrutivo.

