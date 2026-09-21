# Shoopar

Aplicação de compras partilhada para duas pessoas.

## Arquitectura

- Frontend: Cloudflare Pages
- API: Cloudflare Worker
- Base de dados: Cloudflare D1
- PIN: 4 dígitos
- PWA: instalação no iPhone

## Funcionalidades V1

- Lista partilhada entre dois iPhones
- Entrada apenas com PIN de 4 dígitos
- Sincronização automática
- Várias listas
- Categorias
- Quantidade
- Preço estimado
- Total estimado
- Marcar como comprado
- Histórico
- Modo escuro
- PWA / ícone Shoopar

## Publicação

### GitHub
Colocar todo o conteúdo deste ZIP no repositório `shoopar`.

### Cloudflare D1
Criar uma base D1 chamada `shoopar-db` e executar `worker/schema.sql`.

### Cloudflare Worker
No `worker/wrangler.toml`, colocar o `database_id` real da D1.

Depois, dentro de `worker`:

```bash
npx wrangler deploy
```

### Cloudflare Pages
Ligar o repositório GitHub ao Cloudflare Pages.

- Build command: vazio
- Output directory: `public`

Depois do deploy do Worker, copiar o URL do Worker para `public/app.js`:

```js
const API_URL='https://TEU-WORKER.workers.dev';
```

## Primeiro acesso

No primeiro iPhone:
1. Abrir a aplicação.
2. Criar um PIN de 4 dígitos.
3. A lista fica criada na Cloudflare D1.

No segundo iPhone:
1. Abrir exactamente a mesma aplicação.
2. Introduzir o mesmo PIN.
3. O servidor encontra a lista correspondente ao PIN e devolve o acesso.

O PIN é intencionalmente simples, conforme pedido. Não deve ser usado para proteger informação sensível.
