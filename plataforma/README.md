# CardápioPro

Plataforma multiestabelecimento em `plataforma/`. O painel central cadastra lojas e vincula seus proprietários. Cada loja recebe um painel de catálogo e pedidos e uma página pública em `/loja/{slug}`.

## Teste local

Use Node 22 e Java 21. Na pasta `plataforma/`, instale as dependências com `npm ci` e `npm ci --prefix functions`. Execute:

```sh
npx -y firebase-tools@latest --config firebase.local.json emulators:exec --project demo-cardapiopro --only auth,firestore,functions 'npm test'
npm run build
```

Para abrir a interface conectada aos emuladores, use `emulators:start` com a mesma configuração e execute `VITE_FIREBASE_EMULATORS=true npm run dev` em outro terminal.

## Firebase em produção

- Projeto `meucardapiodigital-ce935`. O Authentication usa e-mail e senha. Cadastre as contas no Console e crie `superadmins/{uid}` apenas para a conta central autorizada.
- O Firestore padrão é compartilhado com a Conexão Sabor. Preserve os blocos atuais de regras e os dados de `lojas/`. Revise a política ativa, incorpore os blocos do CardápioPro e teste o conjunto completo antes de publicar. Um allow amplo já existente também afeta os novos caminhos. O arquivo de regras da branch cobre o CardápioPro e é carregado apenas pela configuração local.
- Use um aplicativo Web próprio no projeto. Preencha `.env` com os valores de `.env.example` e registre o App Check com reCAPTCHA v3 para o domínio de hospedagem. Informe a chave pública em `VITE_FIREBASE_APP_CHECK_SITE_KEY`. A função de checkout exige App Check em produção. Para evitar impacto no cardápio atual, o checkout valida o token na função, sem exigir App Check globalmente no Firestore compartilhado.
- O site de Hosting planejado é `cardapiopro-ce935`, alvo `cardapiopro`. Verifique a disponibilidade do identificador e crie um site dedicado antes do primeiro deploy. O comando de hospedagem deve usar o alvo explícito: `npx -y firebase-tools@latest deploy --project meucardapiodigital-ce935 --only hosting:cardapiopro`.
- A publicação completa exige as Cloud Functions de cadastro, acesso e pedidos. Obtenha autorização para o Blaze antes de ativar faturamento ou implantar Functions. O checkout calcula preços no servidor e registra a modalidade de pagamento indicada pelo cliente. A cobrança eletrônica fica fora desse fluxo.
