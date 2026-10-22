# Envio de e-mails — Google Workspace integrado

App privado de campanhas com Google Workspace na navegação principal, SQLite para rascunhos/modelos/listas e envio manual para **um destinatário ou uma lista**. Não há integração automática com CRM, agendamento ou envio ao abrir páginas.

## Como usar

1. Em **Google Workspace**, confira a conexão da conta remetente. A autorização do Google continua abrindo em outra aba, pois o Google não permite esse login no iframe do Bitrix24. Retorne ao app e clique em Atualizar conexão. Tokens nunca chegam ao navegador.
2. Em **Contatos**, crie uma lista e importe CSV (coluna obrigatória `email`; opcionais `nome`, `empresa`). E-mails são normalizados e deduplicados dentro da lista. A importação persiste no servidor e não autoriza envios por si só.
3. Em **Modelos de e-mail**, edite conteúdo textual. `{{nome}}` será substituído pelo nome do destinatário; para destinatário único sem nome, fica vazio.
4. Em **Campanhas**, crie um rascunho com assunto, modelo e lista. Salve e clique em Revisar e enviar. Escolha um endereço único ou a lista da campanha.
5. Gere a prévia. Confira remetente, assunto, conteúdo e os destinatários efetivos. Confirme a autorização dos destinatários e o envio real. Só então clique em Enviar campanha.
6. Acompanhe em **Envios**. Atualizar consulta o resultado. Há ações para cancelar pendentes e continuar somente os pendentes de um envio pausado. **Relatórios** exporta resultados reais de processamento, sem alegar entrega ou abertura.
7. Em **Supressões**, bloqueie um endereço com motivo (descadastro, reclamação etc.). A supressão é conferida na prévia e novamente antes de processar cada mensagem. Uma mensagem já em trânsito pode ter sido aceita antes do bloqueio.

## Limites e garantias práticas

- Limites iniciais locais: **50 destinatários por envio e 100 em uma janela móvel de 24 horas**. A cota inclui destinatários reservados, ainda pendentes, cancelados e sem confirmação; é conservadora. Os limites e políticas próprios do Google Workspace continuam valendo.
- Mensagens individuais, sem Cc/Bcc, anexos ou HTML livre. Assunto codificado em UTF-8, conteúdo textual e sem exposição da lista aos outros destinatários.
- Confirmação manual da prévia e da permissão dos destinatários é obrigatória. A declaração é registrada no envio; o app não verifica automaticamente consentimento nem concede consentimento a contatos importados.
- Contatos demonstrativos, suprimidos e consentimentos explicitamente revogados não são enviados. O restante exige a confirmação do proprietário na revisão.
- A prévia é invalidada se campanha, modelo, remetente ou lista mudar. Conteúdo e audiência são congelados ao registrar o envio.
- Um envio por campanha. Repetir a mesma requisição retorna o registro anterior; uma campanha já enviada não pode ser editada, excluída ou reenviada. Para outra campanha, crie novo rascunho e revise novamente.
- Fila durável SQLite com um trabalhador por processo, intervalo de dois segundos, sem retry automático de envio. Antes de chamar Gmail o destinatário é marcado como em trânsito. Após falha/timeout ou queda nessa fase, seu resultado é desconhecido, a fila pausa e ele nunca é reenviado automaticamente. Confira Enviados e a caixa destinatária antes de decidir outra ação.
- Aceitação pelo Gmail não prova entrega, leitura ou abertura. Nenhum tracking real é implementado.
- Um processo Node por banco. Não executar réplicas concorrentes sobre os mesmos arquivos SQLite. Não há garantia distribuída de exactly-once com serviços externos.
- O servidor pode dormir após inatividade, conforme a configuração da hospedagem. A fila continua do estado durável ao iniciar novamente; trabalhos pendentes e já confirmados não exigem nova confirmação. Isso não é agendamento nem serviço contínuo de grande volume.

## Execução e configuração

Node.js 24+. `npm ci`, `npm start`, `npm test`. A demonstração estática pode abrir localmente, mas dados privados e mutações exigem a identidade autenticada do gateway VibeCode. Não falsifique headers nem exponha a API diretamente à internet. Para desenvolvimento/testes, `createApplication` aceita armazenamento e Google simulados.

Variáveis do backend (nunca versionar valores reais):

- `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`: segredos do cliente OAuth Google já cadastrado.
- `APP_ORIGIN`: origem HTTPS exata. URI de retorno no Google Cloud: `APP_ORIGIN` + `/oauth/google/callback`.
- `OAUTH_OWNER_USER_ID`: proprietário permitido pelo header confiável `X-Vibe-User-Id`. Acesso da hospedagem permanece `OWNER_ONLY`.
- `TEST_EMAIL_SENDER`: conta remetente admitida. O OAuth valida endereço exato, domínio Workspace, identidade verificada, nonce e escopo `gmail.send` (além de `openid` e `email`).
- `OAUTH_DATA_DIR`: diretório durável **existente**, fora de `/opt/app`, com `oauth.sqlite` e `encryption.key`. Não mudar, apagar ou substituir ao atualizar: preserva a autorização já concedida. Tokens ficam criptografados AES-256-GCM e protegidos por arquivo de chave privado. Os dois devem ser protegidos nos backups.
- `DATABASE_PATH`: arquivo SQLite durável separado para campanhas, listas, supressões e envios, fora de `/opt/app`.
- `CAMPAIGN_SEND_ENABLED=true`: habilita o envio manual descrito acima. Ausente ou outro valor bloqueia a criação de envios e o trabalhador.
- `TEST_EMAIL_ENABLED`: controla apenas o teste inicial legado em `/google.html`, independente das campanhas. O limite de uma tentativa do teste legado é preservado, sem reset. Recomenda-se desativá-lo após a integração.

Declare os diretórios persistentes em `dataDirs` no deploy. Um clean deploy só deve substituir `/opt/app`; não colocar bancos, tokens ou chave de criptografia no pacote. O gateway deve encaminhar a porta 3000 para `node server.js`, que respeita `PORT`. Nenhuma credencial Google é gravada na imagem ou frontend.

A API de campanhas exige proprietário, origem exata e token CSRF emitido pelo backend. Para funcionar dentro do iframe, esse token é validado no header sem depender de cookie de terceiro; sua leitura continua restrita à mesma origem e ao proprietário. O fluxo OAuth continua protegido por state vinculado a cookie Secure/HttpOnly, nonce, PKCE e verificação da biblioteca oficial Google. Não há logs de tokens ou URLs OAuth.

`/health` informa `sendingEnabled` para campanhas e `restrictedTestEnabled` para o teste legado. `GET /api/state` consulta os dados privados; `POST /api/campaigns/:id/preview` prepara a revisão e `POST /api/campaigns/:id/send` registra a fila somente com as confirmações. Nenhuma chamada genérica `/api/send` foi habilitada. Nenhum CRM é alterado.

## Validação e pendências

Testes automatizados usam somente dados fictícios e Google simulado: persistência, CRUD, CSRF, OAuth, confirmação, idempotência, limite por lista/24h, supressão, revogação, pausa, cancelamento e recuperação após interrupção. Verificação em Chromium do fluxo integrado é feita sem acesso externo. Nenhum e-mail real é enviado pelos testes ou pelo deploy.

A interface inclui exemplos de métricas claramente marcados como simulados; os relatórios de envio usam registros reais. A meta futura de mais de 300 mil e-mails/mês exige outra arquitetura e provedor/capacidade aprovados, e não é suportada por esta versão. A política `data.uiDesign` versão 2 permanece pendente; não há declaração de conformidade.
