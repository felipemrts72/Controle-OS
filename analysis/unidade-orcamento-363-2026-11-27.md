# Unidade na conversão do orçamento 363

## Causa comprovada por consulta READ ONLY

O orçamento 363 está em elaboração e seu item possui measurement_unit_snapshot=UN, quantidade 1 e produto comercial Eixo Universal H-2, código comercial 131. O vínculo comercial aponta para o produto operacional de código interno 568, cujo measurement_unit_code é NULL. A raiz do planejamento salvo, versão 0, contém unit_code vazio, setor Torno e seleção de demanda ativa. UN existe e está ativa no catálogo measurement_units. O cadastro commercial_products não possui campo próprio de unidade.

Não foi encontrada troca de identificador ou divergência no código UN neste caso. A perda decorre de o template recuperar somente a unidade vazia do produto interno, sem aproveitar a unidade comercial do item. O salvamento preservava o vazio, e a conferência validava exclusivamente o unit_code do planejamento contra o catálogo ativo. Assim, o UN apresentado comercialmente não chegava à demanda operacional.

## Correção pontual

A mesma recuperação agora é aplicada ao template, à leitura do orçamento, ao salvamento e à conferência/conversão. Uma escolha válida já salva no nó sempre prevalece. Quando ausente ou inválida, procura-se a unidade válida do produto cadastrado em qualquer nível; somente para a raiz, a unidade do item comercial é a alternativa seguinte. Não se presume a unidade dos filhos a partir do pai.

Códigos, IDs, descrições, símbolos e aliases inequívocos do catálogo ativo são convertidos para o código canônico exigido pelas tarefas. Valores desconhecidos, ambíguos ou inativos sem alternativa válida continuam gerando pendência. A validação de unidade ativa permanece intacta.

Planejamentos antigos são recuperados em memória na leitura, sem atualização retroativa em massa. A correção é persistida ao salvar ou na transação de conversão. O editor existente permite corrigir manualmente unidades sem fonte válida; a escolha válida é preservada ao salvar, reabrir e gerar a ordem. Não há alteração automática do cadastro do estoque nem de quantidades ou classificações.

## Validação e preservação

scripts/verify-quote-units.mjs usa banco descartável e dados fictícios equivalentes ao caso: código comercial 131, produto operacional sem unidade, item UN, quantidade 1, setor Torno e raiz salva vazia. Reproduz a falha da validação anterior, verifica recuperação sem escrita na leitura, conversão e persistência canônica na mesma transação e repetição sem duplicar venda ou ordem.

Cobre também produtos existentes, novos produtos, componentes e subcomponentes de árvore anterior, escolhas manuais válidas, UUIDs/aliases, rejeição de unidade inativa e ambígua e bloqueio real da conversão quando falta unidade válida. Pela interface, corrige manualmente um componente para KG, salva, recarrega, reabre e converte; a tarefa resultante mantém KG. Quantidade, setor, data, seleção e dependências foram preservados nos cenários.

Build e git diff --check passaram. Nenhuma migration necessária. A comparação com fccf163 confirma que TVs, Painel, consultas operacionais, conclusão, dependências, data de entrega e ordens manuais não foram modificados. O orçamento real 363 não foi convertido nem usado como massa de teste; sua consulta foi somente leitura. A situação pública final será informada no chat.
