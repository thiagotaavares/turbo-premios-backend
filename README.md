[README.md](https://github.com/user-attachments/files/28858450/README.md)
# Backend de Pagamentos — Turbo Prêmios (VeoPag PIX)

Pequeno servidor que conecta o site da rifa ao gateway **VeoPag**. Ele guarda a
chave secreta (que **nunca** pode ficar no site), cria a cobrança PIX, recebe o
aviso de pagamento (webhook) e libera os títulos.

```
Site da rifa ──▶ ESTE backend ──▶ VeoPag ──▶ (cliente paga) ──▶ webhook ──▶ libera títulos
```

## 1. Pré-requisitos
- Conta na VeoPag com KYC aprovado e credenciais geradas em
  https://dashboard.veopag.com/credentials (`client_id` + `client_secret`).
- Node.js 18+ (para rodar localmente) **ou** uma conta numa hospedagem
  (Render, Railway, Fly.io — todas têm plano gratuito pra começar).

## 2. Rodar localmente (teste)
```bash
cd backend
cp .env.example .env        # preencha CLIENT_ID e CLIENT_SECRET
npm install
npm run dev
```
O servidor sobe em `http://localhost:3000`. Teste: abra `http://localhost:3000/health`.

## 3. Configurar o site
No site, edite **`config.js`** (na raiz do projeto) e aponte para o backend:
```js
window.TURBO_CONFIG = { apiBase: "http://localhost:3000" };
```
Em produção, troque pela URL pública do backend (ex.: `https://api.turbopremios.com.br`).
> Com `apiBase` vazio, o site roda em **modo demonstração** (QR fictício) — útil
> para mostrar o protótipo sem backend.

## 4. Subir em produção (resumo)
1. Suba a pasta `backend/` numa hospedagem Node (Render/Railway/Fly).
2. Defina as variáveis de ambiente do `.env` no painel da hospedagem.
3. Pegue a URL pública gerada e coloque em **dois** lugares:
   - `PUBLIC_URL` (no backend) → para o webhook funcionar.
   - `apiBase` no `config.js` do site.
4. No painel da VeoPag, cadastre a URL de webhook
   `https://SEU-BACKEND/webhooks/veopag` (ou deixe o backend enviar via
   `clientCallbackUrl`, já incluso).
5. Faça um teste real com **R$ 1,00** (a VeoPag não tem sandbox separado).

## 5. Endpoints
| Método | Rota | Função |
|---|---|---|
| `POST` | `/api/pix/criar` | Cria a cobrança e devolve `qrcode` + `qrImage`. |
| `GET`  | `/api/pix/status/:txId` | O site consulta se já foi pago. |
| `POST` | `/webhooks/veopag` | A VeoPag avisa quando o PIX cai. |
| `GET`  | `/health` | Teste de vida. |

## ⚠️ Antes de operar com dinheiro de verdade
- **Banco de dados:** `store.js` é em memória (perde tudo ao reiniciar). Troque
  por PostgreSQL/MySQL/Mongo. A interface já está isolada pra facilitar.
- **Geração de números:** hoje é aleatória. Para uma rifa real, controle a faixa
  de números por edição para garantir unicidade.
- **Segurança do webhook:** valide a autenticidade (assinatura/segredo ou IP
  whitelist da VeoPag) antes de confiar no aviso. Confirme o formato do corpo na
  doc **Webhooks** da VeoPag e ajuste `server.js` se necessário.
- **Legal:** rifas/sorteios pagos no Brasil são regulamentados. Verifique a
  autorização necessária (Ministério da Fazenda/SECAP) antes de vender.
