# UTMify no checkout Portugal

Configuração no painel: **Desenvolvedor → UTMify · Rastreamento de vendas**.
Salve a credencial, valide a conexão e ative os envios. Não é necessário colocar
o token nas variáveis da Vercel. Cada banco tem sua própria configuração,
criptografada com `APP_ENCRYPTION_KEY`. O painel nunca devolve o token salvo.

A documentação fornecida (`Documentação API - UTMify.docx`) aceita EUR, mas só
lista `credit_card`, `boleto`, `pix`, `paypal` e `free_price` como métodos.
O valor inicial enviado é `mbway`, sem inventar que a cobrança foi Pix ou cartão.
A validação usa `isTest: true`: conforme o documento, valida o pedido sem salvar
uma venda. A integração só pode ser ativada após a API aceitar o token e o método.
Se MB WAY for recusado, confirme com o suporte da UTMify o método compatível e
selecione-o em “Compatibilidade do método de pagamento”, salve e valide novamente.

## Estados e dados

- MB WAY gerado: `waiting_payment`.
- Confirmado pela Broski via webhook ou consulta autenticada: `paid`.
- Recusado/expirado pela Broski: `refused`.
- Reembolsado pela Broski: `refunded`.

As atualizações reutilizam `orderId` e `createdAt`. O envio usa EUR e centavos,
quantidade e preços do snapshot do servidor, datas UTC e país PT. NIF não é
enviado como CPF/CNPJ. A API da Broski usada aqui não informa taxas: enviamos
taxa zero e comissão igual ao bruto, opção permitida pelo documento da UTMify.
O total inclui portes; o produto mantém seu preço unitário, como no exemplo da API.
Multibanco não faz parte desta integração.

O checkout captura `src`, `sck`, `utm_source`, `utm_campaign`, `utm_medium`,
`utm_content`, `utm_term` na URL e os preserva na sessão do produto e no pedido.
A página de vendas precisa encaminhar esses parâmetros no botão que abre o
checkout. Parâmetros ausentes são enviados como `null`; não inventamos campanha.

## Entrega

A migração `0018_utmify.sql` é aplicada no build da Vercel. Os pedidos novos são
acompanhados somente com a integração ativa. Não há importação de histórico.
Pausar interrompe envios; trocar o token não transfere pedidos antigos para outra
conta. O método utilizado é fixado no pedido ao capturar a atribuição.

Consultas ao pedido, painel e cron despacham a fila após a resposta. A fila envia
o estado atual, serializa os envios por pedido e repete falhas com o mesmo ID.
Uma aprovação ignora o atraso de retentativa do estado pendente. O painel mostra
o último estado aceito e erros sem expor dados pessoais ou respostas brutas.
Aplicamos o limite documentado de 7 dias por pedido, ou 45 dias para reembolso.

Não são alterados os critérios de conversão Meta/TikTok nem o estado financeiro
do checkout. O fluxo da UTMify representa o estado real do pagamento.

Validação local: `npm run test:security`, `npm run typecheck`, `npm run build`.
Os testes mockam a API e não enviam vendas nem geram cobranças reais.
