# Pix via Goti Pay

O checkout, carrinho e tela Pix continuam nesta loja. O banco permanece exclusivamente no gateway Goti Pay. Não configurar Turso na loja.

## Ativação

Webhook: **https://ttkshops-two.vercel.app/api/webhooks/gotipay**

Na Vercel da loja:

- `STORE_ORIGIN=https://ttkshops-two.vercel.app` (sem barra final).
- `GOTIPAY_API_BASE_URL=https://gateway-pzol.vercel.app/api/v1`.
- `GOTIPAY_API_KEY`: chave dedicada criada no painel Goti Pay.
- `GOTIPAY_WEBHOOK_SECRET`: segredo do callback dessa mesma chave.
- `CHECKOUT_SESSION_SECRET`: segredo aleatório com pelo menos 32 caracteres; nunca usar a API key.
- `PAYMENTS_ENABLED=false` até concluir configuração; depois `true` mediante liberação operacional.

No gateway:

1. Aplicar a migração aditiva `0015_store_orders.sql` com `npm run db:migrate`, usando o banco já configurado. Não alterar migrações anteriores.
2. Criar chave exclusiva da loja, com o callback acima. Acrescentar `ttkshops-two.vercel.app` a `CALLBACK_HOSTS`, preservando os hosts existentes.
3. Configurar `STORE_API_KEY_ID` com o **ID** dessa chave (não seu Bearer) e `STORE_ORDERS_ENABLED=true` depois da migração. Sem esses valores as rotas novas ficam bloqueadas.
4. Não alterar `PUBLIC_API_ENABLED` nem o gateway ativo de vendas existentes durante esta preparação. Se a API pública estiver bloqueada, a liberação financeira deve ser feita separadamente.
5. Manter o cron autenticado atual para conciliação e filas.

Nunca colocar segredos em variáveis `NEXT_PUBLIC_*`, scripts, commits, logs ou mensagens. Todas as chamadas do navegador são para `/api/session`, `/api/orders` e `/api/order` da própria loja.

## Contrato e segurança

A loja usa a extensão `/api/v1/store-orders`, que persiste itens, endereço e corpo congelado antes de chamar o `createCharge` existente. `/transactions` mantém seu contrato anterior, sem campos extras. O gateway calcula preços inteiros em centavos pelo catálogo versionado em `lib/server/store-catalog.json`; quantidades 1–99, variantes válidas, valor mínimo R$ 5. Frete grátis e nenhum cupom adicional, como no resumo atual. Preços promocionais já estão no catálogo.

O navegador envia somente IDs, quantidades, variantes e dados reais preenchidos. O cookie assinado é HttpOnly, SameSite=Strict e Secure em produção. Pedidos são isolados por chave e hash de sessão. Dados pessoais e corpo da cobrança são criptografados usando a chave já utilizada pelo gateway. A tentativa fica estável em recargas/falhas; mudanças no pedido exigem nova tentativa. Não limpar a tentativa para contornar timeout.

HTTP 202 abre a tela Pix e consulta o pedido já criado. Consulta com intervalo de 5 segundos crescendo até 60 segundos, pausada em aba oculta; encerrada ao estado terminal ou prazo expirado. Não se usa `checkout_url`. QR e código vêm do backend. O relógio usa `pix.expires_at`, sem reiniciar artificialmente.

O webhook usa o corpo bruto, HMAC-SHA256, comparação segura e tolerância de 300 segundos. É validado novamente pelo gateway antes da gravação durável. Retorna erro se a persistência falhar, permitindo repetição. Evento, transação, referência, valor e chave precisam coincidir. Apenas a transação canônica confirmada pelo processador libera os registros únicos de processamento; um evento de QR gerado não confirma pagamento.

## Estoque, entrega e notificações

`store_effects` registra uma única tarefa por pedido/tipo, após PAID. Os registros `stock`, `fulfillment` e `notification` são **pendências operacionais**, não simulam baixa de estoque, postagem ou envio de e-mail. Este projeto não tinha estoque autoritativo nem conector logístico. Antes de automatizar essas etapas, conectar um executor idempotente a esses registros. Não afirmar entrega concluída apenas por existir tarefa.

## TrackerOrder e anúncios

O envio ao TrackerOrder é específico desta integração: `STORE_TRACKERORDER_ENABLED=true` no gateway, após conferir as credenciais existentes do TrackerOrder e seu destino. Por padrão fica desligado. Usa itens completos, quantidades, preço e ID do pedido local como `external_order_id`. Só envia após PAID. Há claim exclusivo; timeout/retorno incerto vai para `REVIEW`, sem repetição automática que possa duplicar pedidos ou mensagens. Pedidos pagos enquanto a integração estiver desligada recebem DISABLED e não são enviados retroativamente. A fila fixa o destino configurado; troca de projeto exige revisão.

A loja captura UTMs e click IDs e os persiste com o pedido no gateway. O script da loja dispara Purchase no pixel TikTok **se ele já estiver carregado**, somente após resposta PAID do servidor, com ID estável e proteção local contra repetição. Não foi instalado um novo pixel e não se presume disparo automático pela API externa. A chave usada pelas rotinas antigas da Goti permanece separada.

## Catálogo e manutenção

Ao alterar preço ou variantes: executar `node scripts/export-store-catalog.mjs` na loja, revisar `server/store-catalog.json`, copiar o resultado para `gateway/lib/server/store-catalog.json`, testar e publicar ambos. Não confiar em nomes/preços vindos do browser. Inclui configurações dinâmicas de iPhone, pneus, scooter e kits. Carrinhos antigos de scooter sem modelo/potência completos devem selecionar a variante novamente.

## Verificação

- Loja: `npm test` e `npm run build`.
- Gateway: `npm run test:security`, `node tests/vercel-adapter.mjs`, `npm run build`.
- Cobertura com mocks: geração imediata e 202, PAID, expiração, timeout, clique concorrente, replay, assinatura inválida/antiga, valor adulterado, sessão alheia e isolamento dos fluxos existentes.

Nenhuma cobrança real é necessária para esses testes. Credenciais reais, callback e recebimento financeiro precisam ser validados separadamente antes da ativação.

