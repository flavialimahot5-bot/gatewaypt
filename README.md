# Goti Pay Portugal

Cópia independente do Goti Pay brasileiro, em `E:\gotipt`. A pasta original não foi editada. Não há remote Git, identidade Vercel, credenciais ou banco do projeto brasileiro nesta cópia.

## Abrir localmente

- `npm ci`
- `node scripts/setup-local.mjs` cria exclusivamente `.local/portugal-preview.db`, um produto demonstrativo e `.env.local` com segredos novos. Não sobrescreve configuração existente.
- `npm run dev`
- Painel: http://127.0.0.1:5174/topsdlsodo
- Acesso local: `.local/acesso-portugal.txt` (ignorado pelo Git).
- Checkout: link disponível no cadastro de produtos. O exemplo local é `/comprar/prd_ppppppppppppppppppppppppppppppppppppppppppp`.

A prévia tem pagamentos reais DESATIVADOS. O produto é demonstrativo e não representa uma venda.

## Implementação

Next.js 16, React, Auth.js com palavra-passe scrypt, libSQL/Turso. Mantém o painel, catálogo, imagens, avaliações, produtos digitais/físicos e encomendas da base. Checkout em pt-PT/EUR, com quantidade, NIF opcional, telemóvel PT e código postal NNNN-NNN. Preço e portes são calculados no servidor; a tentativa guarda um snapshot imutável. Upsell só é disponibilizado após webhook pago.

Broski: criação, consulta, listagem com cursor, reembolso total/parcial e webhooks HMAC-SHA256. O browser nunca recebe a chave nem chama a Broski. Eventos desconhecidos são ignorados com 2xx; assinatura inválida, moeda/valor/método/referência divergentes são rejeitados. Eventos repetidos são deduplicados e pagamentos pagos não regridem para pendentes/falhados. Confirmar via GET não libera encomendas: apenas o webhook pago confirma.

MB WAY: espera com polling do banco local a cada 2,5 s. Uma única consulta de reconciliação à Broski após 60 s, reservada atomicamente por pedido. Após cinco minutos, a interface permite verificar o estado. Nova tentativa só é oferecida após falha/expiração confirmada. Após erro de rede, reenvia exatamente o payload e a chave persistidos. Bloqueios por telefone respeitam o prazo retornado.

Multibanco: tela final com entidade, referência, valor e validade, sem polling. Voucher vencido é ocultado. Envio transacional por Resend com chave idempotente; tentativas pendentes ficam no banco e são retomadas por `/api/cron`. Configure email antes de ativar o método em produção.

O saldo disponível, taxas e levantamentos continuam no painel Broski: a API de pedidos não fornece esses dados. O dashboard não apresenta o valor bruto como líquido.

As rotas antigas de cobrança Pix, processadores brasileiros e despacho brasileiro retornam 410. Os módulos de origem foram mantidos como referência; não são a integração ativa desta versão. Integrações publicitárias/TrackerOrder brasileiras não são disparadas por pagamentos Portugal. As APIs `v1` brasileiras não são compatíveis com o checkout Portugal.

## API desta aplicação

| Método | Endpoint | Proteção / comportamento |
| --- | --- | --- |
| POST | `/api/pt/products/{product_id}` | Mesma origem; cria pelo preço do catálogo |
| GET | `/api/pt/orders/{id}` | ID opaco com 122 bits aleatórios; somente estado e instruções, sem dados pessoais |
| POST | `/api/pt/webhook` | Assinatura Broski; corpo bruto, tolerância de 5 min |
| GET / POST | `/api/pt/admin` | Login administrativo; consultar/guardar conexão |
| GET | `/api/pt/provider-orders` | Login; parâmetros status, method, starting_after |
| GET | `/api/pt/provider-orders/{ord_id}` | Login; consulta pontual à Broski |
| POST | `/api/pt/refunds/{pt_id}` | Login, mesma origem, Idempotency-Key obrigatória; `{}` total ou `{amount: 500, reason: "..."}` parcial |

Criação: `{attempt: "UUID", method: "mbway" ou "multibanco", quantity: 1, customer: {name, email, phone?, nif?, address?: {line1, postal_code, city, country: "PT"}}}`. `visit` UUID opcional para associar o funil. Nova tentativa após falha/expiração exige UUID novo. Não envie amount. O pedido inclui checkout_url derivada de APP_ORIGIN.

## Publicar sem tocar no Brasil

1. Crie um repositório e projeto Vercel NOVOS. Não reutilize o remote nem importe esta pasta no projeto brasileiro.
2. Crie um banco Turso NOVO e configure `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` na nova Vercel.
3. Configure as variáveis em `.env.example`; use segredos novos para AUTH_SECRET e APP_ENCRYPTION_KEY. Gere acesso administrativo com `node scripts/create-admin.mjs SEU_EMAIL`. Não use a conta de demonstração local em produção.
4. Defina APP_ORIGIN e AUTH_URL para o novo domínio HTTPS. O build Vercel aplica migrações apenas no banco configurado.
5. Configure BROSKI_API_KEY/BROSKI_WEBHOOK_SECRET no servidor ou guarde as duas credenciais em Gateways no painel. Cadastre a URL final `/api/pt/webhook` no painel Broski, incluindo os eventos de pagamento, falha, expiração e reembolso.
6. Configure RESEND_API_KEY e MAIL_FROM com domínio remetente verificado, e CRON_SECRET para retentar emails. O cron incluído é diário; aumente a frequência conforme o plano Vercel para entrega mais rápida após falhas.
7. Mantenha PUBLIC_API_ENABLED=false até concluir a configuração. Depois ative na nova hospedagem e faça um teste real controlado autorizado pelo titular. Não existe sandbox público Broski documentado.

Nenhuma cobrança real foi feita nesta implementação. A ligação real depende da sua chave Broski, webhook HTTPS e banco de produção separados. A implementação foi verificada com respostas simuladas, não com liquidação financeira real.

## Verificações

- `npm run test:security`: verificações reaproveitadas de autenticação, origem, criptografia, limites e corpo; mais cenários financeiros Portugal.
- `npm run test:portugal`: preços no servidor, assinatura oficial, duplicação, replay após timeout, bloqueio por telemóvel, eventos fora de ordem, divergência de valores, reembolsos, expiração e reconciliação limitada.
- `node tests/vercel-adapter.mjs`: migrações idempotentes, rollback de transações e configuração fail-closed.
- `npm run typecheck` e `npm run build`.

A suíte completa `tests/security.mjs` conserva cenários brasileiros como referência e não é a suíte de aceitação Portugal: espera rotas Pix e fuso São Paulo que foram desativados. O comando test:security seleciona os cenários comuns e executa a suíte Portugal.

Documentação fonte: https://docs.broski.pt/ e https://resend.com/docs/api-reference/emails/send-email. Cópia da documentação Broski consultada em 14/10/2026 em `docs/broski/`.
