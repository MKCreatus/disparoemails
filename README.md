# Envio de e-mails — demonstração e teste Google Workspace

Campanhas da demonstração continuam sem envio. Há um fluxo separado e restrito para **um único e-mail manual**, condicionado à configuração do backend e à autorização OAuth da conta remetente.

## Execução

Node.js 24 ou superior (OAuth usa SQLite nativo):

```sh
npm ci
npm start
npm test
```

Interface em `http://localhost:3000/`; painel de conexão em `/google.html`. O OAuth de produção exige HTTPS e o gateway autenticado VibeCode em `OWNER_ONLY`. Nenhuma credencial é necessária para visualizar a demonstração, e o teste real permanece desativado por padrão.

## Configuração do backend

Configure via segredos/ambiente do servidor, nunca no navegador ou no repositório:

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: cliente OAuth Web do Google Cloud.
- `APP_ORIGIN`: origem HTTPS exata do aplicativo, sem barra final.
- `OAUTH_OWNER_USER_ID`: ID Bitrix24 do proprietário admitido pelo gateway. O backend exige o header `X-Vibe-User-Id` correspondente; não exponha esse serviço fora do gateway Black Hole.
- `TEST_EMAIL_SENDER`: única conta remetente admitida, configurada pelo operador. O proprietário escolhe um único destinatário na interface.
- `TEST_EMAIL_ENABLED`: somente o valor literal `true` libera a tentativa manual restrita. Não habilita campanhas.
- `OAUTH_DATA_DIR`: diretório durável fora de `/opt/app`, declarado em `dataDirs` no deploy. Não coloque tokens ou a chave de criptografia na árvore limpa pelo deploy.

No Google Cloud, registre exatamente `APP_ORIGIN` + `/oauth/google/callback` como URI de redirecionamento do cliente Web. Origens JavaScript não são necessárias. Confirme Gmail API ativa, público interno e permissões `openid`, `email` e `https://www.googleapis.com/auth/gmail.send`. Autorize na conta remetente, fora do iframe (o link abre o painel em outra aba). O administrador Workspace pode precisar liberar o aplicativo.

O OAuth utiliza state vinculado a cookie HttpOnly/Secure/SameSite=Lax, validade de dez minutos, consumo único, nonce e PKCE S256. A biblioteca oficial Google valida assinatura, emissor, audiência e validade do ID token. O backend verifica endereço exato, e-mail verificado e domínio Workspace. Não são aceitas outras contas ou autorização sem refresh token/escopo de envio.

Tokens ficam criptografados com AES-256-GCM em SQLite; a chave aleatória é criada em arquivo privado separado no mesmo diretório durável. Proteja o diretório e seus backups. Isso protege o banco isolado, não contra um administrador com acesso ao banco e à chave. URLs OAuth, códigos, tokens e credenciais não são registrados pelo aplicativo.

## Limites do teste

`GET /api/google/status` informa somente configuração pública, estado da conexão e token CSRF da sessão. `POST /api/google/send-test` exige proprietário autenticado, origem exata, cookie da sessão e token CSRF. Recebe somente `{ recipient, confirmed: true }`: um endereço simples validado e confirmação explícita. Não aceita remetente, assunto, corpo, anexos, arrays ou cópias. Remetente e conteúdo são fixados no backend. Trocar o destinatário desmarca a confirmação na interface. Bcc/Cc e campanhas não existem nesse fluxo.

Há **uma tentativa total por banco**, reservada de forma atômica antes da chamada Gmail. Timeout ou resultado desconhecido consomem a tentativa, sem retry automático. Mesmo após reinício/redeploy, o teste não será repetido. O operador precisa investigar qualquer resultado desconhecido; não apague o banco para repetir sem verificar a caixa Enviados e o destinatário. Aceitação pelo Gmail não garante entrega na caixa de entrada.

O botão exige confirmação explícita na interface. Não é efetuado nenhum envio durante conexão OAuth ou testes automatizados. `sendingEnabled=false` permanece no `/health` para campanhas; `restrictedTestEnabled` informa separadamente se a exceção manual está configurada no ambiente. A função de envio de campanhas continua lançando erro e `/api/send` continua bloqueado.

## Testes e versões

Testes usam somente credenciais fictícias e cliente Google simulado: vínculo proprietário, state/cookie/nonce, conta remetente, criptografia, reinício, CSRF, origem, destinatário único validado e limite persistente. Não acessam Gmail real.

A versão 2 local com persistência de campanhas/CRM permanece em `development/v2-local-persistence`, sem alterações por este fluxo. Nenhum CRM real é modificado por esta demonstração.

A política `data.uiDesign` versão 2 permanece pendente; não há declaração de conformidade. Este modo restrito não atende envio em massa nem a meta futura de 300 mil e-mails/mês.
