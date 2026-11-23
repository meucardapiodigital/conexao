import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore,
  query, setDoc, terminate, where } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";

const projectId = "demo-cardapiopro";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp: initializeAdmin } = require("firebase-admin/app");
const { getAuth: adminAuth } = require("firebase-admin/auth");
const { getFirestore: adminFirestore } = require("firebase-admin/firestore");
const admin = initializeAdmin({ projectId });
const seed = adminFirestore(admin);

async function client(label, authenticated = true) {
  const app = initializeApp({ projectId, apiKey: projectId }, label);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const functions = getFunctions(app, "southamerica-east1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  if (authenticated) {
    const email = `${label}@example.test`;
    const password = "Emulator-only-123!";
    await adminAuth(admin).createUser({ uid: label, email, password });
    await signInWithEmailAndPassword(auth, email, password);
  }
  return {
    db,
    call: async (name, data) => (await httpsCallable(functions, name)(data)).data
  };
}

test("login, provisionamento, catálogo, checkout e isolamento", async t => {
  const suffix = Date.now().toString(36);
  const superId = `admin-${suffix}`;
  const ownerId = `dono-${suffix}`;
  const [central, owner, outsider, buyer] = await Promise.all([
    client(superId), client(ownerId), client(`outro-${suffix}`), client(`publico-${suffix}`, false)
  ]);
  t.after(async () => {
    await Promise.all([central, owner, outsider, buyer].map(({db}) => terminate(db)));
    await seed.terminate();
  });
  await seed.doc(`superadmins/${superId}`).set({ active: true });

  const slug = `loja-${suffix}`;
  const data = { nome: "Loja teste", slug, uid: ownerId };
  await assert.rejects(outsider.call("criarRestaurante", data), { code: "functions/permission-denied" });
  const { id } = await central.call("criarRestaurante", data);
  await assert.rejects(central.call("criarRestaurante", data), { code: "functions/already-exists" });
  assert.deepEqual((await owner.call("listarLojas", {})).map(store => store.id), [id]);
  assert.deepEqual(await outsider.call("listarLojas", {}), []);

  const ref = (db, ...parts) => doc(db, "restaurantes", id, ...parts);
  assert.equal((await getDoc(doc(buyer.db, "slugs", slug))).data().restauranteId, id);
  await setDoc(ref(owner.db, "categorias", "comidas"), { nome: "Comidas", ordem: 0 });
  const product = { nome: "Sanduíche", categoriaId: "comidas", precoCentavos: 1800, ativo: true };
  await setDoc(ref(owner.db, "produtos", "lanche"), product);
  await setDoc(ref(owner.db, "produtos", "oculto"), { ...product, ativo: false });
  await assert.rejects(getDoc(ref(buyer.db, "produtos", "oculto")), { code: "permission-denied" });
  const visible = query(collection(buyer.db, "restaurantes", id, "produtos"), where("ativo", "==", true));
  assert.deepEqual((await getDocs(visible)).docs.map(product => product.id), ["lanche"]);
  await assert.rejects(setDoc(ref(outsider.db, "produtos", "lanche"), product), { code: "permission-denied" });
  await assert.rejects(setDoc(ref(owner.db, "produtos", "lanche"), { ...product, precoCentavos: -1 }),
    { code: "permission-denied" });

  await owner.call("configurarLoja", { id, cor: "#112233", taxa: 500 });
  const request = {
    slug, itens: [{ id: "lanche", quantidade: 2, precoCentavos: 1 }],
    cliente: { nome: "Cliente teste", telefone: "92999999999", endereco: "Rua teste, 10" },
    modalidade: "entrega", pagamento: "pix"
  };
  await assert.rejects(buyer.call("criarPedido", { ...request, itens: [...request.itens, ...request.itens] }),
    { code: "functions/invalid-argument" });
  const order = await buyer.call("criarPedido", request);
  assert.equal(order.totalCentavos, 4100);
  assert.equal((await getDoc(ref(owner.db, "pedidos", order.id))).data().status, "recebido");
  for (const client of [buyer, outsider]) {
    await assert.rejects(getDoc(ref(client.db, "pedidos", order.id)), { code: "permission-denied" });
  }
  const transition = { id, pedidoId: order.id, status: "preparando" };
  await assert.rejects(outsider.call("atualizarPedido", transition), { code: "functions/permission-denied" });
  await owner.call("atualizarPedido", transition);
  assert.equal((await getDoc(ref(owner.db, "pedidos", order.id))).data().status, "preparando");
  await assert.rejects(owner.call("atualizarPedido", transition), { code: "functions/failed-precondition" });

  await seed.doc(`restaurantes/${id}`).update({ status: "inativo" });
  await assert.rejects(getDocs(visible), { code: "permission-denied" });
  await assert.rejects(buyer.call("criarPedido", request), { code: "functions/failed-precondition" });
});
