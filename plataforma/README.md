# CardápioPro — plataforma multiestabelecimento

Implementação inicial independente do cardápio Conexão Sabor atual.

## Módulos
- Painel central de cadastro de restaurantes (superadministrador)
- Painel individual (pedidos em tempo real, produtos, categorias, personalização)
- Cardápio público (produtos, carrinho e checkout)
- Firebase Authentication + Firestore + Cloud Functions
- Regras de segurança por restaurante

## Configuração
1. Crie um projeto Firebase, habilite Authentication (email/senha), Firestore e Cloud Functions. Functions podem exigir plano Blaze.
2. Copie .env.example para .env e informe os campos do aplicativo Web do Firebase.
3. Rode npm install e npm run dev nesta pasta.
4. Na pasta functions, rode npm install.
5. Configure o Firebase CLI com firebase login e firebase use --add.
6. Dentro de plataforma, execute npm run build e firebase deploy --only firestore:rules,functions,hosting.
7. Cadastre um usuário no Firebase Authentication. **Superadmin:** crie manualmente o documento superadmins/{uid} no Firestore usando ambiente confiável (Console). Não permita que o navegador crie esse documento.
8. O superadmin poderá cadastrar novos restaurantes, designar UID de proprietário e compartilhar a rota /loja/{slug}.

## Cuidados
A primeira versão não processa pagamentos eletrônicos reais: registra apenas a forma indicada. Valide antifraude, rate limiting, LGPD, custos e integrações antes de aceitar pedidos comerciais. O checkout público em Cloud Functions precisa de mecanismos antiabuso (App Check e limites).

Esta branch não substitui nem altera os arquivos index.html e painel.html existentes.
