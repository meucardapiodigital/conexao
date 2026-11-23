import { signInAnonymously } from "firebase/auth";
import { collection, doc, getDoc, getDocs, runTransaction, serverTimestamp, updateDoc, writeBatch } from "firebase/firestore";
import { auth, db } from "./firebase";

export const maxProducts = 5;

export async function criarRestaurante({ nome, slug, uid }) {
  nome = nome.trim();
  slug = (slug.trim() || nome).toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  uid = uid.trim();
  if (nome.length < 3 || nome.length > 150 || slug.length < 3 || slug.length > 80 ||
    (uid && !/^[a-zA-Z0-9_-]{1,128}$/.test(uid))) {
    throw new Error("Confira o nome, o identificador e o UID.");
  }
  const restaurant = doc(collection(db, "restaurantes"));
  const batch = writeBatch(db);
  batch.set(restaurant, {
    nome, slug, status: "ativo", tema: { cor: "#e96039" },
    taxaEntregaCentavos: 0, criadoEm: serverTimestamp()
  });
  batch.set(doc(db, "slugs", slug), { restauranteId: restaurant.id });
  if (uid) {
    batch.set(doc(restaurant, "membros", uid), { papel: "proprietario" });
    batch.set(doc(db, "acessosCardapioPro", uid, "restaurantes", restaurant.id), {
      restauranteId: restaurant.id
    });
  }
  await batch.commit();
  return { id: restaurant.id, slug };
}

export async function listarLojas() {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return [];
  if ((await getDoc(doc(db, "superadmins", user.uid))).exists()) {
    const stores = await getDocs(collection(db, "restaurantes"));
    return stores.docs.map(store => ({ ...store.data(), id: store.id }));
  }
  const links = await getDocs(collection(db, "acessosCardapioPro", user.uid, "restaurantes"));
  const stores = await Promise.all(links.docs.map(async link => {
    const store = await getDoc(doc(db, "restaurantes", link.id));
    return store.exists() ? { ...store.data(), id: store.id } : null;
  }));
  return stores.filter(Boolean);
}

export function configurarLoja({ id, cor, taxa }) {
  return updateDoc(doc(db, "restaurantes", id), { "tema.cor": cor, taxaEntregaCentavos: taxa });
}

export function atualizarPedido({ id, pedidoId, status }) {
  return updateDoc(doc(db, "restaurantes", id, "pedidos", pedidoId), { status });
}

export async function criarPedido({ id, itens, cliente, modalidade, pagamento }) {
  if (itens.length < 1 || itens.length > maxProducts) {
    throw new Error("Escolha até cinco produtos diferentes por pedido.");
  }
  await auth.authStateReady();
  const user = auth.currentUser || (await signInAnonymously(auth)).user;
  const restaurant = doc(db, "restaurantes", id);
  const order = doc(collection(restaurant, "pedidos"));
  const limit = doc(db, "limitesPedidosCardapioPro", user.uid);

  return runTransaction(db, async transaction => {
    const [store, previous, ...products] = await Promise.all([
      transaction.get(restaurant),
      transaction.get(limit),
      ...itens.map(item => transaction.get(doc(restaurant, "produtos", item.id)))
    ]);
    if (store.data()?.status !== "ativo") throw new Error("Restaurante indisponível.");
    if (previous.exists() && Date.now() - previous.data().criadoEm.toMillis() < 60000) {
      throw new Error("Aguarde um minuto antes de enviar outro pedido.");
    }
    const lines = products.map((product, index) => {
      const data = product.data();
      if (!data?.ativo) throw new Error("Um produto do carrinho ficou indisponível.");
      const quantidade = itens[index].quantidade;
      return {
        id: product.id, nome: data.nome, quantidade, precoCentavos: data.precoCentavos,
        totalCentavos: data.precoCentavos * quantidade
      };
    });
    const subtotalCentavos = lines.reduce((total, line) => total + line.totalCentavos, 0);
    const taxaEntregaCentavos = modalidade === "entrega" ? store.data().taxaEntregaCentavos : 0;
    const totalCentavos = subtotalCentavos + taxaEntregaCentavos;
    transaction.set(order, {
      uid: user.uid, cliente, itens: lines, modalidade, pagamento, subtotalCentavos,
      taxaEntregaCentavos, totalCentavos, status: "recebido", criadoEm: serverTimestamp()
    });
    transaction.set(limit, { restauranteId: id, pedidoId: order.id, criadoEm: serverTimestamp() });
    return { id: order.id, totalCentavos };
  });
}
