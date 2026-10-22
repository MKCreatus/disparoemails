# Envio de e-mails — versão 2 local

Branch de desenvolvimento com SQLite local e integração CRM preparada, **desconectada por padrão**. A demonstração original permanece na branch `main`. Nenhuma implantação VibeCode é necessária.

## Executar localmente

Requer **Node.js 24 ou superior** (usa `node:sqlite`, sem serviço de banco externo).

```sh
git clone --branch development/v2-local-persistence https://github.com/MKCreatus/disparoemails.git
cd disparoemails
npm ci
npm start
```

Abra **http://localhost:3000/**. Se o repositório já estiver clonado, salve suas alterações antes de trocar para `development/v2-local-persistence` e executar `npm ci`.

O servidor escuta exclusivamente em `127.0.0.1`. Esta versão é um aplicativo local de usuário único, sem login; não deve ser exposta à internet ou à rede local. Não é um pacote de implantação Galaxy.

## Persistência

- Campanhas, modelos e listas/contatos em `data/app.sqlite`, incluindo arquivos auxiliares SQLite WAL/SHM. Recarregar a página ou reiniciar preserva os dados.
- Exemplos fictícios são inseridos uma única vez ao criar o banco. Não há reseed em reinícios.
- Rascunhos podem ser criados, editados, consultados e excluídos pela interface. Campanhas simuladas permanecem protegidas contra edição/exclusão.
- Modelos existentes são editáveis. Listas podem ser criadas e selecionadas; CSV importa para a lista selecionada.
- UUIDs identificam novos registros. Repetir criação com o mesmo ID é recusado. E-mails são normalizados e únicos dentro de cada lista; o mesmo e-mail pode pertencer a listas diferentes. Nomes de listas e modelos são únicos sem diferenciar maiúsculas/minúsculas. Títulos de campanhas podem se repetir.
- Importações são atômicas. Falha de validação no backend desfaz o lote. O parser informa linhas inválidas e duplicadas antes de salvar os registros válidos.
- Edição de campanhas/modelos usa versão do registro; alteração concorrente é recusada, exigindo atualização da página.
- Listas/modelos em uso por campanhas não podem ser excluídos pela API.

O diretório do banco, arquivos `.sqlite`/`.db`, `.env` e logs são ignorados pelo Git. Os dados locais não são criptografados: mantenha permissões adequadas no computador. Para backup, pare o aplicativo e copie o diretório `data/` completo; para restaurar, pare o aplicativo e restaure esse diretório. Não envie backups para o GitHub.

Para escolher outro arquivo de banco, configure `DATABASE_PATH` no ambiente antes de iniciar. O caminho padrão é relativo ao diretório de execução; execute a partir da pasta do projeto.

## CRM Bitrix24: preparado, sem conexão automática

A página **CRM · somente leitura** não consulta nada ao abrir. O backend só acessa VibeCode quando todas as condições estiverem explicitamente configuradas:

- `CRM_ENABLED=true`
- `CRM_READ_AUTHORIZED=true`
- `VIBECODE_API_KEY` disponível exclusivamente no ambiente do backend

**Não é necessário configurar nenhuma dessas variáveis para usar ou testar a versão local.** A chave sozinha não habilita o CRM. Não foram feitas consultas a registros reais no desenvolvimento desta versão.

Quando decidir autorizar leituras, use uma chave de escopo mínimo `crm`, preferencialmente `READONLY`, no backend. Não cole a chave no navegador, no código ou em arquivos versionados. O servidor não carrega `.env` automaticamente: se optar por um arquivo local ignorado pelo Git, use `node --env-file=.env server.js`. `.env.example` documenta as opções sem conter credenciais.

O adaptador possui somente `GET /v1/contacts` e `GET /v1/companies`, destino fixo `https://vibecode.bitrix24.com`, redirecionamentos bloqueados e timeout de 15 segundos. Não há chamadas de criação, edição, importação ou exclusão de CRM. Resultados são projetados para campos conhecidos, sem headers ou respostas de erro brutas. Não há sincronização automática com as listas SQLite.

Filtros: nome (`name` em contatos / `title` em empresas), e-mail exato e ID do responsável (`assignedById`). Paginação por `limit` (1–50) e `offset`; página seguinte apresentada quando a atual estiver completa. O filtro oficial de e-mail compara o valor exato e pode considerar somente o primeiro valor do registro, conforme as limitações documentadas do VibeCode. O filtro de nome de contatos considera o primeiro nome, não uma busca por nome completo.

Documentação usada: [contatos](https://vibecode.bitrix24.com/docs/entities/contacts/list), [empresas](https://vibecode.bitrix24.com/docs/entities/companies), [filtros](https://vibecode.bitrix24.com/docs/filtering).

## Envios e consentimento

`SendingEnabled` não é uma opção de configuração: **`sendingEnabled=false` está fixo**. Não existe provedor, SDK SMTP, rota funcional de envio ou chave de envio. As operações locais de persistência não alteram o CRM. Rotas desconhecidas de envio e mutações CRM são recusadas.

As tabelas `suppressions` e `consent_events` preparam supressão e histórico de consentimento para implementação futura; não há concessão automática de consentimento, endpoint público para concedê-lo ou mecanismo de envio. Contatos CSV entram como `Não verificado`. Dados de exemplo marcados como demonstrativos não constituem autorização.

Servidor protegido contra origens externas, Host desconhecido e requisições de mutação sem cabeçalho local; consultas de CRM só passam pelo backend. A CSP permite conexões do navegador apenas à própria origem. Não há tokens nas respostas da interface.

## Testes

```sh
npm test
```

Incluem SQLite real em arquivo/reabertura, CRUD HTTP, rollback, deduplicação, concorrência, referências, CSV, consultas CRM simuladas, proteção de origem/Host, CRM desconectado e bloqueio de envio.

Teste completo da interface com Chromium:

```sh
npx playwright install chromium
npm run test:ui
```

Se já tiver Chromium instalado, configure `BROWSER_EXECUTABLE` com o caminho do executável. Exemplo Linux:

```sh
BROWSER_EXECUTABLE=/usr/bin/chromium npm run test:ui
```

Esse teste usa banco temporário: criar/editar/excluir rascunho, recarregar a página, reiniciar servidor, editar modelo, importar CSV, criar/selecionar lista e verificar CRM desligado. Não acessa CRM ou provedores reais. Playwright é dependência somente de desenvolvimento; o aplicativo em si não depende dele.

## Pendências

Sem deploy, filas persistentes de envio, agendamento ou provedor. A meta futura de mais de 300 mil e-mails/mês não foi implementada ou validada. `data.uiDesign` versão 2 permanece pendente de verificação; esta versão não declara conformidade.
