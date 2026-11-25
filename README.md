# Plataforma de delivery: dois sites separados + admin, um só backend

```
apps/
  api/        Backend único (Node 22, sem dependências). Banco SQLite, sessões, SSE em tempo real.
  cliente/    SITE 1: público. Busca, cardápio, carrinho, checkout, acompanhamento, perfil.
  vendedor/   SITE 2: painel privado. Central de pedidos com campainha, cardápio, horários, financeiro.
  admin/      SITE 3: ambiente do administrador geral. Lojas, vendedores, pedidos, auditoria.
scripts/      seed (dados de demonstração), serve-sites, dev
tests/        31 testes ponta a ponta (segurança, isolamento, tempo real)
deploy/       nginx.conf e .env.example para produção
```

Cada site é uma pasta estática independente (HTML/CSS/JS próprios, sem código compartilhado) servida em **sua própria origem**.
Os três falam com a mesma API e o mesmo banco.

## Ver funcionando sem instalar nada

Abra **`demo/index.html`** no navegador (duplo clique). Ela reúne os três sites reais e um servidor simulado dentro da página (dados fictícios, em memória).
Use "Cliente e vendedor lado a lado" para ver o pedido chegar com a campainha e o status voltar para o cliente.
Para regenerar depois de mudar os sites: `node demo/build.mjs`.

## Rodar localmente

Requer Node 22.5 ou superior. Não há `npm install`.

```bash
npm run dev
```

| Site | Endereço | Login de teste (só desenvolvimento) |
|---|---|---|
| Cliente | http://localhost:4001 | cliente@teste.local / Cliente#12345 |
| Vendedor | http://localhost:4002 | vendedor@acaipapum.local / Vendedor#12345 |
| Admin | http://localhost:4003 | admin@delivery.local / Admin#12345 |
| API | http://localhost:4000 | |

Na primeira execução o banco é criado com a loja **Açaí Papum** (cardápio dos seus prints) e a **Pizzaria Demo** (para provar o isolamento).
O horário de demonstração do Açaí Papum é 13h–23h; fora dele o cliente vê "Loja fechada". Ajuste em *Loja e horários*.

Para testar a campainha: abra o painel do vendedor, clique em qualquer lugar da página (o navegador só libera áudio após um clique) e faça um pedido no site do cliente.

```bash
npm test      # 31 testes: autorização, isolamento entre lojas, preço, SSE, Pix, auditoria
```

## Como as regras foram atendidas

| Regra | Implementação |
|---|---|
| 1. Sites independentes | Três pastas, três origens, nenhum arquivo compartilhado. |
| 2 e 4. Cliente nunca vê o painel | O site do cliente não tem tela, link, botão nem chamada para `/vendedor` ou `/admin`. |
| 5. Segurança no backend | Cada rota declara `auth: 'cliente' | 'vendedor' | 'admin'`. Sem sessão válida da área certa → 401. Origem errada → 403. Esconder botão não é a proteção. |
| 6. Mesmo backend e banco | `apps/api` + SQLite (`data/delivery.db`). |
| 7. Pedido em tempo real | O checkout grava o pedido e publica `pedido.novo` no canal `loja:{id}` (SSE). |
| 8. Campainha só no vendedor | O som (WebAudio) existe apenas em `apps/vendedor`; toca em loop enquanto houver pedido aguardando aceite. |
| 9. Status em tempo real | O vendedor muda o status, a API publica no canal `cliente:{id}`, e a tela de acompanhamento atualiza sozinha. |
| 10. Multi-estabelecimento | Toda tabela de negócio tem `estabelecimento_id`. O escopo do vendedor vem **sempre da sessão**, nunca do corpo ou da URL. |

Outras proteções: senhas com scrypt; cookies `HttpOnly` por área (`sid_cliente`, `sid_vendedor`, `sid_admin`); origem obrigatória em escritas;
CORS só para as 3 origens; limite de tentativas de login; **preços sempre recalculados no servidor**; validação de entrada em todas as rotas;
upload validado por assinatura do arquivo; CSP restritiva nos sites; auditoria de ações; suspender uma loja derruba as sessões dos vendedores.

## Produção

1. Domínios: `cliente.`, `vendedor.`, `admin.` e `api.` (veja `deploy/nginx.conf`) com HTTPS.
2. Copie `deploy/.env.example` e ajuste as origens. Em cada `apps/*/config.js`, defina a `API_URL` (ou sirva um `config.js` próprio).
3. Rode o seed **uma vez** para criar o admin e **troque todas as senhas de teste**.
4. Proteja `admin.` por IP/VPN se possível.

### Pendências conhecidas (precisam de decisão sua)

- **Pagamento Pix real.** Hoje usa um provedor de teste (`PAYMENTS_PROVIDER=mock`) com botão "Simular pagamento" que só existe fora de produção.
  Para cobrar de verdade, implemente seu gateway (Mercado Pago, Asaas, Pagar.me…) em `apps/api/src/services/payments.js`; o webhook (`POST /webhooks/pagamentos`) já valida assinatura HMAC.
- **Imagens do cardápio.** Os produtos do seed não têm foto. Envie pelo editor de produto (upload) ou informe o endereço da imagem.
- **Escala.** SQLite e SSE em um único processo atendem bem uma operação pequena/média. Para várias instâncias, troque por Postgres e um barramento (Redis).
- **Entrega por zona/raio e cupons** não foram implementados.
