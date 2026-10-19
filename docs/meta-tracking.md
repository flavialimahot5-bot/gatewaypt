# Meta Conversions API

O checkout Portugal envia `Purchase` quando a Broski confirma a criação de um
MB WAY em estado pendente ou pago. Este evento representa **MB WAY gerado**,
não receita recebida. Multibanco, tentativas recusadas e vendas anteriores à
configuração não são convertidos em eventos. O TikTok mantém seu comportamento.

A configuração é exclusiva de cada banco: `tracking_pixels.store_slug='meta'`.
O token fica criptografado com `APP_ENCRYPTION_KEY`, sem exposição no navegador
ou Git. Não copiar essa configuração entre instalações de comerciantes.

A atribuição aceita `fbclid`, `fbc` e `fbp` no link do checkout e os cookies
`_fbc`/`_fbp` quando disponíveis. A página de vendas deve preservar esses
parâmetros no botão de compra entre domínios. Sem eles, o evento ainda pode ser
enviado com os identificadores disponíveis, mas a atribuição à campanha não é
garantida. E-mail e telefone são normalizados e enviados com hash SHA-256.

A fila usa `tracking_events.store_slug='meta'`, ID determinístico por pixel e
pedido, lease de envio, retentativas limitadas e expiração de sete dias.
`delivered_at` só é preenchido quando a Meta responde `events_received: 1`.
Consultas ao pedido, painel e cron processam a fila em segundo plano. A aprovação
posterior não cria outro Purchase. O payload é removido depois do envio; o ID
permanece para deduplicação. Não há Purchase no navegador.

Diagnóstico sem dados de clientes ou tokens:

```sql
SELECT event, COUNT(*) AS total,
  SUM(delivered_at IS NOT NULL) AS enviados,
  SUM(delivered_at IS NULL AND payload IS NOT NULL AND attempts < 12) AS pendentes
FROM tracking_events WHERE store_slug='meta' GROUP BY event;
```

Para testes manuais na Meta, configurar `META_TEST_EVENT_CODE` no servidor e
remover após a validação. A suíte `npm run test:security` usa mocks e não envia
eventos reais. Não gerar eventos fictícios no pixel de produção.

Referências oficiais:
- https://github.com/fbsamples/lead-ads-webhook-sample
- https://github.com/facebook/capi-param-builder
- https://github.com/facebook/facebook-nodejs-business-sdk
