# Shoppar

Aplicação web/PWA de compras partilhadas. Frontend estático (HTML + CSS + JavaScript em módulos ES, sem build) em Cloudflare Pages; API num Cloudflare Worker com base de dados D1.

```text
public/   → Cloudflare Pages (output directory: public, sem build command)
worker/   → Cloudflare Worker "shoppar" + D1 "shoopar-db" (binding DB)
tools/    → testes e2e e formatação (não são publicados)
```

## Frontend (`public/`)

| Ficheiro | Responsabilidade |
|---|---|
| `index.html` | estrutura, ícones SVG (sprite), modais |
| `style.css` | estilos e temas claro/escuro |
| `js/main.js` | arranque e ligação de eventos |
| `js/state.js` | configuração (`API`, `APP_VERSION`), `localStorage` seguro, estado |
| `js/api.js` | pedidos à API, tratamento de 401 |
| `js/auth.js` | ecrã do PIN, criação de agregado com confirmação, bloqueio aos 30 s |
| `js/lists.js` · `history.js` · `recipes.js` · `search.js` | funcionalidades |
| `js/prefs.js` | idioma, tema, alterar PIN |
| `js/i18n.js` · `translations.js` | PT/EN (as duas línguas têm de ter as mesmas chaves) |
| `_headers` | CSP e restantes cabeçalhos de segurança do Pages |
| `sw.js` | service worker (rede primeiro, cache para offline) |

## Nova versão — onde mudar o número

`APP_VERSION` em `public/js/state.js`, `CACHE` em `public/sw.js`, `VERSION` em `worker/src/index.js` e o texto `vX.Y` em `index.html`. O teste `quality.test.mjs` falha se não coincidirem.

## Publicar

1. **Worker primeiro** (a nova app usa endpoints novos): substituir `worker/` no GitHub; o Cloudflare faz deploy. As migrações da D1 são automáticas e só acrescentam (coluna `history.unit`, tabela `rate_limits`); nenhum dado é apagado.
2. **Depois `public/`**: o Pages publica sozinho.

## Testes

```bash
cd tools
npm install
npm test            # Worker local + D1 local descartável + Chromium; nunca toca na produção
npm run format:check
```

## Segurança — o que é e o que não é

O PIN de 4 dígitos identifica o agregado: quem o souber entra. O servidor limita as tentativas por IP (30/min) e o dispositivo só guarda o token do agregado, nunca o PIN. É adequado para uma lista de compras, não para dados sensíveis.
