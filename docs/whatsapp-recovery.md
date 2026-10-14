# Recuperação de Pix com WATI

Em **Produtos → Recuperação WhatsApp**, cole o token da WATI e o número conectado com `55` e DDD. O token é criptografado no banco de cada operação e nunca retorna pela API. Salvar faz apenas uma consulta de modelos, sem enviar mensagens.

Na WATI, aprove o modelo `recuperacao_kit_panelas` em português:

> Sou a Juliana aqui do suporte ao cliente. Eu vi que você gerou o pedido do Kit Panelas da promoção, mas acabou não finalizando o pagamento!
>
> Gostaria de saber se ficou com alguma dúvida e como posso te ajudar na finalização?

Edite cada produto desejado, ative **Recuperar Pix pendente pelo WhatsApp** e selecione o modelo. O texto aprovado aparece no formulário. Esta versão aceita os primeiros 500 modelos consultados, somente texto em português sem variáveis, cabeçalhos de mídia ou botões. Para mudar a mensagem, aprove a alteração na WATI e selecione novamente no produto. Upsells e produtos existentes começam desativados. Ative também a conexão global quando estiver pronta.

## Agendamento obrigatório

Para testar apenas a conexão e o envio, abra **Testar no meu WhatsApp**, carregue os modelos aprovados, selecione um e informe seu número pessoal com 55 e DDD, diferente do remetente. **Enviar teste agora** envia uma mensagem real somente ao destinatário digitado, sem criar pedidos, ativar produtos ou executar o agendador. São até 5 tentativas por hora por administrador. A mesma tentativa não é reenviada automaticamente; em caso de resposta incerta, consulte a WATI antes de preparar outra.

Configure um agendador externo (por exemplo, https://cron-job.org/en/) com:

- URL: `https://SEU-DOMINIO/api/internal/recovery` (o painel mostra a URL exata).
- Método: **POST**.
- Frequência: **a cada minuto**.
- Cabeçalho `Authorization`: `Bearer ` seguido de `DISPATCH_SECRET` desse projeto.
- Corpo vazio. Nunca coloque segredos na URL.

O cron diário existente não atende a recuperação em 10 minutos. Não há alteração no plano da Vercel nem implantação manual. O painel indica a última chamada; a conexão ao agendador fica verde com sinal nos últimos 3 minutos. Se ainda não houver pedidos elegíveis, testar a chamada somente atualiza esse sinal.

## Comportamento

- O cliente pode aceitar um lembrete por WhatsApp no checkout. O aceite é opcional, não vem marcado e não interfere no pagamento. O texto e instante do aceite ficam no snapshot do pedido.
- A fila nasce quando o processador fornece o código Pix, nunca ao clicar no botão. Pedidos anteriores à ativação não entram.
- O envio torna-se elegível após 10 minutos, no próximo ciclo do agendador (normalmente 10–11 minutos). Pix expirado e lembrete atrasado mais de 5 minutos são cancelados. Há limite de quatro verificações por chamada e limite de duração do processamento; acompanhe a fila se houver volume acima dessa capacidade.
- Antes do envio: verifica produto ativo, mesma conexão/modelo do pedido, autorização do contato na WATI e pagamento diretamente no processador. Falha na consulta financeira impede o envio. Não altera o estado financeiro com base no WhatsApp.
- Desativar um produto/conexão ou mudar seu modelo cancela a fila ainda não enviada. Pausar não recolhe mensagens já encaminhadas. Para opt-out de um contato existente, desative sua autorização de mensagens/broadcasts na WATI; a integração não a reativa.
- Uma chamada de envio por pedido, com identificação estável e reserva atômica. Se a resposta for incerta ou o processo parar durante o envio, não repete automaticamente: confira na WATI. A API externa não permite garantir entrega exatamente uma vez.
- “Aceito pela WATI” não significa entregue. Entrega, falhas posteriores e respostas são consultadas na WATI. Webhooks de entrega WATI não estão conectados nesta versão.
- Há uma pequena janela inevitável entre a consulta do processador e o envio: um pagamento aprovado nesse intervalo pode coincidir com o lembrete.

## Implantação e validação

Aplicar a migração aditiva `0007_whatsapp_recovery.sql` pelo executor `scripts/migrate.mjs` em cada banco que receber o código. Preserva as tabelas antigas e acrescenta apenas `products.recovery_template`, `transactions.pix_generated_at` e `recovery_jobs`. A configuração WATI é separada por banco.

Executar `node tests/security.mjs`, `node tests/vercel-adapter.mjs`, `node tests/pwa.mjs` e `npm run build`. Os testes usam WATI e processador simulados; não criam cobranças reais nem enviam mensagens.

Referências oficiais: [autenticação WATI](https://docs.wati.io/reference/authentication), [modelos](https://docs.wati.io/reference/messagetemplate_getmessagetemplates), [envio](https://docs.wati.io/reference/messagetemplate_sendtemplatemessages), [contatos](https://docs.wati.io/reference/contacts_getcontactdetail).
