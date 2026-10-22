# API local da versão 2

Apenas loopback. Todas as respostas são JSON e não armazenam cache. Nenhum endpoint de envio.

| Método             | Caminho                     | Operação                                              |
| ------------------ | --------------------------- | ----------------------------------------------------- |
| GET                | `/health`                   | Saúde e `sendingEnabled=false`                        |
| GET                | `/api/state`                | Campanhas, modelos, listas e destinatários locais     |
| GET / POST         | `/api/campaigns`            | Listar / criar rascunho                               |
| GET / PUT / DELETE | `/api/campaigns/:id`        | Consultar / editar / excluir rascunho                 |
| GET / POST         | `/api/templates`            | Listar / criar modelo                                 |
| GET / PUT / DELETE | `/api/templates/:id`        | Consultar / editar / excluir modelo                   |
| GET / POST         | `/api/lists`                | Listar / criar lista                                  |
| GET / PUT / DELETE | `/api/lists/:id`            | Consultar / renomear / excluir lista não referenciada |
| GET / POST         | `/api/lists/:id/recipients` | Consultar / importar lote de contatos                 |
| GET                | `/api/crm/contacts`         | Consulta autorizada de contatos CRM                   |
| GET                | `/api/crm/companies`        | Consulta autorizada de empresas CRM                   |

Mutações locais exigem `Content-Type: application/json` e `X-Local-Request: 1`. Origem diferente da aplicação e Host fora de localhost/127.0.0.1 são recusados. Não é autenticação multiusuário; não exponha esta API fora do computador.

Campanha: `name`, `subject`, `listId`, `template` (ID), e opcional `id` na criação. Em atualização, enviar `version` atual. Status é definido pelo backend como Rascunho; métricas reais e habilitação de envio não são aceitas.

Modelo: `name`, `subject`, `body`; em atualização, `version`. Lista: `name`. Lote: `{ "contacts": [{ "email": "pessoa@example.com", "nome": "Exemplo", "empresa": "Demo" }] }`. Consentimento enviado pelo cliente é ignorado; o backend usa `Não verificado`.

Importação suporta até 10000 contatos por requisição e 2,5 MB de JSON. CSV na interface: até 2 MB. O limite HTTP é por requisição, não uma promessa de escalabilidade para grandes bases.

CRM: query `name`, `email`, `responsible`, `limit`, `offset`; resposta `{ data, meta: { limit, offset, nextOffset } }`. Destino e entidades são fixos. Não existe URL arbitrária/proxy genérico. Requisição sem autorização explícita de CRM retorna 403 antes de qualquer acesso externo. Erros externos retornam 502 genérico, sem corpo/headers do provedor.

Falhas locais: 400 validação, 403 operação bloqueada, 404 inexistente, 409 duplicidade/referência/conflito de versão, 413 corpo acima do limite, 415 tipo de conteúdo incorreto. Exclusão de campanha simulada é recusada. Supressão e eventos de consentimento possuem somente esquema nesta etapa; não há API de alteração.
