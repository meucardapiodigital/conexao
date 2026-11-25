# CardápioPro no plano Spark

A plataforma usa Firebase Authentication, Cloud Firestore e Firebase Hosting. O painel central cadastra estabelecimentos e vincula seus proprietários. Cada loja tem um painel de catálogo e pedidos e um cardápio público em `/loja/{slug}`.

O checkout inicia uma sessão anônima do Firebase, sem exigir cadastro do cliente. As regras verificam o preço dos produtos e a taxa de entrega antes de gravar o pedido. O limite é de cinco produtos diferentes por pedido, com até 50 unidades de cada. Cada sessão pode enviar um pedido por minuto. A forma de pagamento é registrada para o estabelecimento. A cobrança fica a cargo da loja.

## Teste local

Com Node 22 e Java 21, execute na pasta `plataforma/`:

```sh
npm ci
npx -y firebase-tools@latest --config firebase.local.json emulators:exec --project demo-cardapiopro --only auth,firestore 'npm test'
npm run build
```

Para abrir a interface conectada aos emuladores, use `emulators:start` com a mesma configuração e execute `VITE_FIREBASE_EMULATORS=true npm run dev` em outro terminal.

## Publicação

1. Verifique as regras ativas do Firestore padrão do projeto `meucardapiodigital-ce935`. Preserve a política da Conexão Sabor. Confirme especialmente que o acesso a dados privados da operação existente não depende apenas de `request.auth != null`, pois o checkout adiciona usuários anônimos ao projeto. Incorpore os blocos do CardápioPro e teste a política completa antes de publicar. A configuração padrão de deploy omite as regras locais para impedir a substituição acidental.
2. Habilite o provedor Anônimo após a revisão das regras compartilhadas. Mantenha o provedor e-mail/senha para os painéis. Cadastre os usuários administrativos pelo Console e crie `superadmins/{uid}` para a conta central autorizada.
3. Use a configuração de um app Web do projeto e preencha as variáveis de `.env.example`. Confirme a disponibilidade do site `cardapiopro-ce935` e crie um site dedicado com esse identificador.
4. Compile o app e use o alvo específico `npx -y firebase-tools@latest deploy --project meucardapiodigital-ce935 --only hosting:cardapiopro`.
