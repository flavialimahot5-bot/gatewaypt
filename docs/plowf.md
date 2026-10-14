# Plowf — vendas próprias

A aba **Gateways** permite selecionar PagPixHub ou Plowf para novas cobranças. A migração `0008_plowf_gateway.sql` é aditiva: identifica as cobranças existentes como PagPixHub e mantém esse gateway como padrão. Aplicar a migração antes de publicar o código em cada banco independente.

## Configuração

1. Na Plowf, obtenha uma chave API da conta de vendas próprias, com acesso a cobranças, provedores e consulta de webhooks. Tokens restritos a um provedor não permitem consultar os webhooks globais.
2. Em **Gateways → Plowf**, informe a chave e escolha um segredo para o webhook (ou use **Gerar segredo**). Salvar valida o acesso com uma consulta; não cria cobrança e não altera o gateway ativo.
3. Copie a URL exibida e o segredo recém-salvo. Cadastre na Plowf um webhook ativo para o evento `PAYMENT`, com essa URL e esse mesmo segredo como token.
4. Clique em **Usar esta Plowf para novas vendas**. A ativação confere o cadastro do webhook antes de trocar o gateway.

Depois da configuração, use **Ativar Plowf** ou **Ativar PagPixHub**: só um gateway fica ativo para novos pedidos. Os formulários ficam ocultos em **Editar credenciais salvas**, e campos vazios da Plowf preservam os valores existentes. Reativar não exige redigitar credenciais nem muda a URL do webhook. **Desativar** pausa novas cobranças sem apagar dados ou interromper a confirmação de Pix antigos. Uma tela desatualizada não pode desativar outro gateway que tenha sido ativado nesse intervalo.

Cada instalação usa suas próprias credenciais e URL, construída a partir de `APP_ORIGIN`. Não coloque a chave no código ou em variáveis públicas. A configuração é criptografada no banco com `APP_ENCRYPTION_KEY`.

## Cobranças e confirmação

- A criação envia `value` em reais, `type=PIX` e a referência interna em `external_ref`. Os dados de cliente disponíveis são enviados; não há nome ou endereço fictício para produtos digitais.
- Cada transação conserva o gateway e a conexão original. Cadastrar outra conexão Plowf mantém as chaves anteriores para consultar pedidos antigos. Mantenha essas chaves e seus webhooks ativos na Plowf.
- A API não documenta idempotência na criação. Depois da primeira tentativa de POST, uma resposta incerta fica em processamento e nunca causa outro POST para a mesma transação. A recuperação consulta as 100 cobranças mais recentes e recebe webhooks assinados. Se a cobrança sair dessa janela e o webhook não chegar, será necessária conferência manual; não há troca automática de gateway.
- O webhook usa HMAC-SHA256 do corpo original no cabeçalho `X-Webhook-Signature`. O evento é salvo antes da resposta HTTP. O processamento consulta a cobrança na API e verifica conta, referência, valor, moeda e identificador antes de aprovar.
- A fila durável é processada após os webhooks e nas rotas já usadas para consultas e dispatch. Tentativas malsucedidas têm intervalo progressivo; mantenha o agendador de `/api/internal/dispatch` configurado. O agendador de recuperação também aciona essa fila.
- Notificações, tracking, recuperação e redirecionamento continuam usando as transações locais. A aprovação depende do status confirmado pelo processador.

## Financeiro

As vendas de ambos os gateways aparecem no painel. A listagem permite filtrar o processador. O líquido da Plowf é uma **estimativa** de valor menos taxas retornadas, não uma confirmação de saldo disponível. Consulte saldo e retiradas na conta Plowf; o saldo consultado pela tela financeira atual é identificado como PagPixHub.

`PARTIALLY_REFUNDED` é identificado nos detalhes como reembolso parcial e tratado conservadoramente como reembolsado, excluído dos totais pagos. O painel não calcula o saldo parcial remanescente.

## Validação

Os testes locais usam respostas simuladas: criação, alternância, conexões antigas, assinaturas, persistência da fila, consulta antes da aprovação, divergências de valor/moeda, concorrência, timeout e ausência de POST duplicado. Não representam uma cobrança real validada na conta Plowf.

Documentação oficial: [criar cobrança](https://plowf.com/docs/api-reference/payments/create), [dados obrigatórios](https://plowf.com/docs/guides/start/required-data), [webhooks](https://plowf.com/docs/webhooks/create).
