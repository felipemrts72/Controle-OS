# 11 — Matriz de compatibilidade: lado OliMen

Esta matriz não contém dados nem suposições do ERP Universal. “Adaptar” significa trabalho futuro provável no OliMen.

| Conceito | OliMen atual | Existe? | Precisa adaptar? | Observação |
|---|---|:---:|:---:|---|
| Produto mestre | `products`, compartilhado e exibido em Estoque | Sim | Parcial | Reutilizar; enriquecer sem criar Produto comercial paralelo |
| ID interno | UUID `products.id` | Sim | Não | Identidade canônica local |
| Código | `internal_code`, opcional, único case-insensitive | Sim | Sim | Falta política de geração/edição/importação |
| SKU | Não há campo separado | Não | Decidir | Não assumir equivalência automática com código |
| Nome | `products.name`, obrigatório, não único | Sim | Não | Pode ser snapshot em itens; não serve sozinho para equivalência |
| Descrição comercial | Não existe em Produto | Não | Sim | Deve continuar opcional para legado |
| Descrição técnica | Apenas descrições pontuais em Compras | Não | Sim | Pertence ao Catálogo/versionamento |
| Preço de venda | Não existe | Não | Sim | Não confundir com histórico de preço de fornecedor |
| Código de barras | Não existe | Não | Decidir | Lacuna de identificação |
| NCM | Não existe | Não | Decidir | Lacuna fiscal; fora do Catálogo puramente técnico |
| Unidade | `measurement_units` + `measurement_unit_code` | Sim | Parcial | Campo aceita nulo no DB; fluxo regular exige unidade |
| Tipo de Produto | `product_types` e `products.type` | Sim | Parcial | Sem FK; tipos extras não têm regras específicas |
| Categoria | Não existe; `material_groups` é de Compras | Não | Decidir | Não reutilizar grupo de material sem decisão semântica |
| Produto ativo/inativo | `is_active`, soft delete no endpoint | Sim | Parcial | Falta reativação na UI/API; histórico preserva FK/snapshot |
| Cadastro parcial | `pending_review` do fluxo de Compras | Sim | Sim | Defaults artificiais e exigências do fluxo regular precisam política |
| Origem local | `creation_origin = manual/purchases` | Sim | Sim | Representa fluxo interno, não sistema externo |
| Equivalência externa | Não existe; há mapeamento por fornecedor | Não | Sim | Criar tabela própria por origem/chave externa |
| Foto cadastral | `product_images`, uma por Produto | Sim | Parcial | Não atende galeria/versionamento técnico |
| Cliente | `customers` oficial | Sim | Sim | Cadastro muito enxuto e sem CRUD próprio |
| ID Cliente | UUID `customers.id` | Sim | Não | Reutilizar como FK |
| Nome Cliente | `name` + `normalized_name` | Sim | Parcial | Unique normalizado pode fundir homônimos |
| Razão social/nome fantasia Cliente | Não existem separados | Não | Sim | Necessário definir modelo oficial |
| CPF/CNPJ Cliente | Não existe | Não | Sim | Necessário para deduplicação/documento comercial |
| Telefone Cliente | `phone` | Sim | Não | Opcional |
| E-mail Cliente | Não existe | Não | Sim | Lacuna comercial |
| Endereço Cliente | Apenas `location` + UF | Parcial | Sim | Falta endereço estruturado/CEP |
| Cliente ativo/inativo | Não existe | Não | Decidir | Relevante para seleção sem apagar histórico |
| Snapshot de Cliente | Parcial em `internal_orders` | Parcial | Sim | Orçamento deve congelar conjunto completo |
| Configuração da empresa | Singleton `company_settings` | Sim | Parcial | Reutilizar; adicionar só defaults comerciais necessários |
| Logo | Arquivo privado + `logo_path` | Sim | Não | Já chega aos PDFs; decidir snapshot histórico |
| Assinatura | Nome/cargo textual; sem imagem | Parcial | Sim | Lacuna de upload/versionamento de imagem |
| Site da empresa | Não existe | Não | Decidir | Só adicionar se documento exigir |
| Uploads | Filesystem local, endpoints protegidos | Sim | Sim | Extrair padrão e suportar coleção/versionamento |
| PDF | PDFKit + helpers comuns | Sim | Parcial | Criar builders comerciais sobre infraestrutura existente |
| Download | Blob autenticado e attachment | Sim | Não | Reutilizável |
| Impressão | Pelo visualizador do PDF; etiquetas têm fluxo próprio | Parcial | Decidir | Não existe fila/serviço genérico de impressão |
| Perfis | `roles` dinâmicos | Sim | Não | Reutilizar |
| Permissões | `permissions` + `role_permissions` | Sim | Sim | Inserir códigos comerciais e apresentação no frontend |
| Autenticação | JWT Bearer | Sim | Não | Reutilizar, com riscos transversais registrados |
| Auditoria | `audit_logs` | Sim | Parcial | Reutilizar; histórico de estados pode merecer tabela própria |
| Menu Comercial | Não existe | Não | Sim | Adicionar grupo Comercial quando houver funcionalidade |
| Catálogo Técnico | Não existe | Não | Sim | Novo domínio relacionado ao Produto |
| Versões do Catálogo | Não existe | Não | Sim | Tabelas e regras novas |
| Imagens do Catálogo | Não existem | Não | Sim | Não usar `product_images` 1:1 |
| Especificações | Não existem no Produto | Não | Sim | Estrutura versionada nova |
| Itens inclusos | Não existem como catálogo | Não | Sim | Não confundir com `product_components` de Produção |
| Orçamentos comerciais | Não existem | Não | Sim | Novo módulo Comercial |
| Itens de Orçamento | Não existem | Não | Sim | FK Produto + snapshots comerciais |
| Data comercial/validade | Não existe | Não | Sim | Definir no cabeçalho/versões |
| Formas de pagamento | Campos textuais existem em Compras | Parcial | Sim | Não reutilizar tabelas de Compras; decidir catálogo ou snapshot comercial |
| Estoque/saldo | Não existe | Não | Não na fase inicial | Comercial inicial não deve movimentar estoque |
| Produção | Roteiros, componentes, tarefas | Sim | Não | Catálogo/Comercial não devem alterar fluxo |
| Compras | Módulo completo e mapeamentos de fornecedor | Sim | Não | Somente consumir Produto; não integrar Comercial → Compras agora |

## Síntese

O OliMen já tem os pilares transversais — Produto, Cliente mínimo, Empresa, Usuário/RBAC, storage protegido e PDF — mas os domínios comerciais e técnicos precisam ser modelados. O maior reaproveitamento é estrutural; a maior adaptação é preservar história e origem sem contaminar Produção/Compras.
