# Envio de e-mails

Protótipo demonstrativo para Alaio VibeCode e futura integração com Bitrix24.

## Executar

Node.js 22 ou superior. Sem dependências externas.

```sh
npm start
# http://localhost:3000
npm test
```

Dashboard, criação e edição de rascunhos, contatos, CSV (até 2 MB, BOM, aspas, vírgula/ponto e vírgula e deduplicação), modelos textuais editáveis e relatórios CSV simulados.

Dados ficam na memória da aba; recarregar restaura os exemplos. Nenhum dado é enviado ao CRM ou a provedores. Consentimento não é validado. Não há persistência ou agendamento.

## Envios desativados

Não existe provedor, credencial no cliente ou rota de envio. O servidor recusa todos os métodos de mutação com HTTP 403, a função de envio lança erro, e a CSP bloqueia conexões de rede do navegador. `/health` informa `sendingEnabled: false`. Não há configuração para habilitar disparos nesta versão.

## Implantação pendente

Utilizar exclusivamente o aplicativo já existente, sem criar outro cartão. Antes de implantar, obter e validar a política oficial `data.uiDesign`, `policyVersion=2`, e confirmar a chave vinculada ao cartão pelo procedimento oficial. A interface atual é provisória e não declara conformidade com essa política. Nenhuma implantação foi realizada.

O catálogo `/v1/applications` contém os cartões do painel; `/v1/apps` contém registros OAuth distintos. A criação de infraestrutura reutiliza o vínculo pela chave, não pelo nome. Não executar criação com chave genérica supondo que o mesmo nome seleciona o cartão existente.

Documentação: [catálogo](https://vibecode.bitrix24.com/docs/applications), [descoberta](https://vibecode.bitrix24.com/docs/keys-auth/me), [infraestrutura](https://vibecode.bitrix24.com/docs/infra), [chave do cartão existente](https://vibecode.bitrix24.com/docs/cowork/applications-key).

## Evolução

Backend de CRM com autenticação por usuário; consentimento, descadastro e supressão; banco durável; fila persistente com idempotência, retentativas e fila de falhas; agendamento America/Sao_Paulo; provedor autorizado com SPF/DKIM/DMARC, webhooks assinados e limites de envio. A meta de mais de 300 mil e-mails/mês depende dessa infraestrutura e de teste de carga, ainda não implementados.

## Validação

7 testes automatizados de CSV, bloqueio de envio, HTTP, CSP e saúde passaram. Sintaxe verificada. Sem validação visual em navegador ou integração real com CRM/provedor.
