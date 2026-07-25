# RCFM Site

Versão web do RCFM Launcher, construída com React + Vite e sincronizada ao catálogo do Firebase.

## Desenvolvimento

```bash
npm install
npm run dev
```

## Build de produção

```bash
npm run build
```

O resultado é criado em `dist/`.

## Publicar no Vercel

1. Envie esta pasta para um repositório GitHub.
2. No Vercel, clique em **New Project** e importe o repositório.
3. Se o repositório também tiver o launcher, configure **Root Directory** como `rcfm-site`.
4. O Vercel detecta Vite; mantenha `npm run build` e `dist` como saída.
5. Clique em **Deploy**.

Depois disso, cada push na branch `main` publica automaticamente uma nova versão.
