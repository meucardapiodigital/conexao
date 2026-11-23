const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();
const region = "southamerica-east1";
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function text(value, max) {
  return typeof value === "string" && value.trim().length <= max ? value.trim() : "";
}

function checkedId(value) {
  if (typeof value !== "string" || !idPattern.test(value)) {
    throw new HttpsError("invalid-argument", "Identificador inválido");
  }
  return value;
}

function userId(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login");
  return request.auth.uid;
}

const isSuper = async uid => (await db.collection("superadmins").doc(uid).get()).exists;

async function requireRole(uid, restaurant, roles) {
  if (await isSuper(uid)) return;
  const membership = await restaurant.collection("membros").doc(uid).get();
  if (!roles.includes(membership.data()?.papel)) {
    throw new HttpsError("permission-denied", "Acesso restrito");
  }
}

exports.criarRestaurante = onCall({ region }, async request => {
  if (!(await isSuper(userId(request)))) {
    throw new HttpsError("permission-denied", "Acesso restrito");
  }
  const nome = text(request.data?.nome, 150);
  const slug = text(request.data?.slug || nome, 150).toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const uid = request.data?.uid ? checkedId(request.data.uid) : null;
  if (nome.length < 3 || slug.length < 3 || slug.length > 80 || !slugPattern.test(slug)) {
    throw new HttpsError("invalid-argument", "Informe um nome e um identificador válidos");
  }
  if (uid) {
    try {
      const owner = await getAuth().getUser(uid);
      if (owner.disabled) throw new HttpsError("failed-precondition", "Conta desativada");
    } catch (error) {
      if (error.code !== "auth/user-not-found") throw error;
      throw new HttpsError("not-found", "Conta do proprietário não encontrada");
    }
  }

  const restaurant = db.collection("restaurantes").doc();
  const address = db.collection("slugs").doc(slug);
  await db.runTransaction(async transaction => {
    if ((await transaction.get(address)).exists) {
      throw new HttpsError("already-exists", "Identificador do link em uso");
    }
    transaction.create(address, { restauranteId: restaurant.id });
    transaction.create(restaurant, {
      nome, slug, status: "ativo", tema: { cor: "#e96039" },
      taxaEntregaCentavos: 0, criadoEm: FieldValue.serverTimestamp()
    });
    if (uid) {
      transaction.create(restaurant.collection("membros").doc(uid), { papel: "proprietario" });
      transaction.create(db.doc(`acessosCardapioPro/${uid}/restaurantes/${restaurant.id}`), {
        restauranteId: restaurant.id
      });
    }
  });
  return { id: restaurant.id, slug };
});

exports.listarLojas = onCall({ region }, async request => {
  const uid = userId(request);
  const restaurants = db.collection("restaurantes");
  if (await isSuper(uid)) {
    const all = await restaurants.get();
    return all.docs.map(restaurantSummary);
  }
  const links = await db.collection(`acessosCardapioPro/${uid}/restaurantes`).get();
  if (links.empty) return [];
  const stores = await Promise.all(links.docs.map(async link => {
    const restaurant = restaurants.doc(link.id);
    const member = await restaurant.collection("membros").doc(uid).get();
    if (!["proprietario", "gerente", "atendente"].includes(member.data()?.papel)) return null;
    const snapshot = await restaurant.get();
    return snapshot.exists ? restaurantSummary(snapshot) : null;
  }));
  return stores.filter(Boolean);
});

function restaurantSummary(snapshot) {
  const { nome, slug, status, tema, taxaEntregaCentavos } = snapshot.data();
  return { id: snapshot.id, nome, slug, status, tema, taxaEntregaCentavos };
}

exports.configurarLoja = onCall({ region }, async request => {
  const uid = userId(request);
  const restaurant = db.collection("restaurantes").doc(checkedId(request.data?.id));
  const { cor, taxa } = request.data;
  await requireRole(uid, restaurant, ["proprietario", "gerente"]);
  if (typeof cor !== "string" || !/^#[0-9a-f]{6}$/i.test(cor) ||
    !Number.isSafeInteger(taxa) || taxa < 0 || taxa > 100000) {
    throw new HttpsError("invalid-argument", "Cor ou taxa inválida");
  }
  await restaurant.update({ "tema.cor": cor, taxaEntregaCentavos: taxa });
  return { ok: true };
});

const transitions = {
  recebido: ["preparando", "cancelado"], preparando: ["pronto", "cancelado"],
  pronto: ["entrega", "concluido"], entrega: ["concluido"]
};

exports.atualizarPedido = onCall({ region }, async request => {
  const uid = userId(request);
  const restaurant = db.collection("restaurantes").doc(checkedId(request.data?.id));
  const order = restaurant.collection("pedidos").doc(checkedId(request.data?.pedidoId));
  await requireRole(uid, restaurant, ["proprietario", "gerente", "atendente"]);
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(order);
    const status = request.data.status;
    const current = snapshot.data()?.status;
    if (!Object.hasOwn(transitions, current) || !transitions[current].includes(status)) {
      throw new HttpsError("failed-precondition", "Status inválido");
    }
    transaction.update(order, { status });
  });
  return { ok: true };
});

exports.criarPedido = onCall({
  region, enforceAppCheck: process.env.GCLOUD_PROJECT !== "demo-cardapiopro", maxInstances: 3
}, async request => {
  const { slug, itens, cliente, modalidade, pagamento } = request.data || {};
  const nome = text(cliente?.nome, 150);
  const telefone = text(cliente?.telefone, 24);
  const endereco = modalidade === "entrega" ? text(cliente?.endereco, 250) : "";
  if (typeof slug !== "string" || slug.length > 80 || !slugPattern.test(slug) ||
    !Array.isArray(itens) || itens.length < 1 || itens.length > 40 ||
    !["entrega", "retirada", "mesa"].includes(modalidade) ||
    !["pix", "dinheiro", "cartao"].includes(pagamento) ||
    nome.length < 2 || !/^\+?[0-9 ()-]{10,24}$/.test(telefone) ||
    telefone.replace(/\D/g, "").length < 10 || (modalidade === "entrega" && !endereco)) {
    throw new HttpsError("invalid-argument", "Revise os dados do pedido");
  }
  const quantities = new Map();
  for (const item of itens) {
    const id = checkedId(item?.id);
    if (quantities.has(id) || !Number.isInteger(item.quantidade) ||
      item.quantidade < 1 || item.quantidade > 50) {
      throw new HttpsError("invalid-argument", "Quantidades inválidas");
    }
    quantities.set(id, item.quantidade);
  }

  return db.runTransaction(async transaction => {
    const address = await transaction.get(db.collection("slugs").doc(slug));
    if (!address.exists) throw new HttpsError("not-found", "Restaurante não encontrado");
    const restaurant = db.collection("restaurantes").doc(address.data().restauranteId);
    const settings = (await transaction.get(restaurant)).data();
    if (settings?.status !== "ativo") {
      throw new HttpsError("failed-precondition", "Restaurante indisponível");
    }
    const products = await transaction.getAll(
      ...[...quantities.keys()].map(id => restaurant.collection("produtos").doc(id))
    );
    let subtotalCentavos = 0;
    const items = products.map(snapshot => {
      const product = snapshot.data();
      if (product?.ativo !== true || typeof product.nome !== "string" ||
        !Number.isSafeInteger(product.precoCentavos) ||
        product.precoCentavos < 0 || product.precoCentavos > 1000000) {
        throw new HttpsError("failed-precondition", "Produto indisponível");
      }
      const quantidade = quantities.get(snapshot.id);
      const totalCentavos = product.precoCentavos * quantidade;
      subtotalCentavos += totalCentavos;
      return { nome: product.nome, precoCentavos: product.precoCentavos, quantidade, totalCentavos };
    });
    const taxaEntregaCentavos = modalidade === "entrega" ? settings.taxaEntregaCentavos : 0;
    if (!Number.isSafeInteger(taxaEntregaCentavos) || taxaEntregaCentavos < 0 ||
      taxaEntregaCentavos > 100000 || subtotalCentavos > 100000000) {
      throw new HttpsError("failed-precondition", "Valor do pedido inválido");
    }
    const totalCentavos = subtotalCentavos + taxaEntregaCentavos;
    const order = restaurant.collection("pedidos").doc();
    transaction.create(order, {
      cliente: { nome, telefone, endereco }, itens: items, modalidade, pagamento,
      subtotalCentavos, taxaEntregaCentavos, totalCentavos, status: "recebido",
      criadoEm: FieldValue.serverTimestamp()
    });
    return { id: order.id, totalCentavos };
  });
});
