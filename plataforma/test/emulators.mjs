import assert from "node:assert/strict";
import { test } from "node:test";
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously, signInWithEmailAndPassword } from "firebase/auth";
import { collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore, query,
  serverTimestamp, setDoc, terminate, updateDoc, where, writeBatch } from "firebase/firestore";
import { initializeApp as initializeAdmin } from "firebase-admin/app";
import { getAuth as adminAuth } from "firebase-admin/auth";
import { getFirestore as adminFirestore } from "firebase-admin/firestore";

const projectId = "demo-cardapiopro";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
const admin = initializeAdmin({ projectId });
const seed = adminFirestore(admin);

async function client(label, mode = "password") {
  const app = initializeApp({ projectId, apiKey: projectId }, label);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  if (mode === "password") {
    const email = `${label}@example.test`;
    const password = "Emulator-only-123!";
    await adminAuth(admin).createUser({ uid: label, email, password });
    await signInWithEmailAndPassword(auth, email, password);
  } else if (mode === "anonymous") {
    await signInAnonymously(auth);
  }
  return { db, uid: auth.currentUser?.uid };
}

function createStore(db, id, slug, ownerId) {
  const store = doc(db, "restaurantes", id);
  const batch = writeBatch(db);
  batch.set(store, {
    nome: "Loja teste", slug, status: "ativo", tema: { cor: "#123456" },
    taxaEntregaCentavos: 500, criadoEm: serverTimestamp()
  });
  batch.set(doc(db, "slugs", slug), { restauranteId: id });
  batch.set(doc(store, "membros", ownerId), { papel: "proprietario" });
  batch.set(doc(db, "acessosCardapioPro", ownerId, "restaurantes", id), { restauranteId: id });
  return batch.commit();
}

test("Spark: login, cadastro atômico, catálogo, pedidos e isolamento", async t => {
  const suffix = Date.now().toString(36);
  const [central, owner, outsider, buyer, guest] = await Promise.all([
    client(`admin-${suffix}`), client(`dono-${suffix}`), client(`outro-${suffix}`),
    client(`comprador-${suffix}`, "anonymous"), client(`publico-${suffix}`, "guest")
  ]);
  t.after(async () => {
    await Promise.all([central, owner, outsider, buyer, guest].map(({db}) => terminate(db)));
    await seed.terminate();
  });
  await seed.doc(`superadmins/${central.uid}`).set({ active: true });

  const slug = `loja-${suffix}`;
  const id = `id-${suffix}`;
  await assert.rejects(createStore(outsider.db, id, slug, owner.uid), { code: "permission-denied" });
  await createStore(central.db, id, slug, owner.uid);
  await assert.rejects(createStore(central.db, id + "2", slug, owner.uid), { code: "permission-denied" });
  const access = (db, uid) => collection(db, "acessosCardapioPro", uid, "restaurantes");
  assert.equal((await getDocs(access(owner.db, owner.uid))).size, 1);
  await assert.rejects(getDocs(access(outsider.db, owner.uid)), { code: "permission-denied" });
  assert.equal((await getDocs(access(outsider.db, outsider.uid))).size, 0);

  const ref = (db, ...parts) => doc(db, "restaurantes", id, ...parts);
  assert.equal((await getDoc(doc(guest.db, "slugs", slug))).data().restauranteId, id);
  await setDoc(ref(owner.db, "categorias", "comidas"), { nome: "Comidas", ordem: 0 });
  const product = { nome: "Sanduíche", categoriaId: "comidas", precoCentavos: 1800, ativo: true };
  await setDoc(ref(owner.db, "produtos", "lanche"), product);
  await setDoc(ref(owner.db, "produtos", "oculto"), { ...product, ativo: false });
  await assert.rejects(getDoc(ref(guest.db, "produtos", "oculto")), { code: "permission-denied" });
  const visible = query(collection(guest.db, "restaurantes", id, "produtos"), where("ativo", "==", true));
  assert.deepEqual((await getDocs(visible)).docs.map(p => p.id), ["lanche"]);
  await assert.rejects(setDoc(ref(outsider.db, "produtos", "lanche"), product), { code: "permission-denied" });
  await assert.rejects(setDoc(ref(owner.db, "produtos", "lanche"), { ...product, precoCentavos: -1 }),
    { code: "permission-denied" });
  await updateDoc(ref(owner.db), { "tema.cor": "#112233" });

  function submit(orderId, lines, subtotal) {
    const batch = writeBatch(buyer.db);
    batch.set(ref(buyer.db, "pedidos", orderId), {
      uid: buyer.uid, itens: lines, cliente: { nome: "Cliente teste", telefone: "92999999999",
        endereco: "Rua teste, 10" }, modalidade: "entrega", pagamento: "pix",
      subtotalCentavos: subtotal, taxaEntregaCentavos: 500, totalCentavos: subtotal + 500,
      status: "recebido", criadoEm: serverTimestamp()
    });
    batch.set(doc(buyer.db, "limitesPedidosCardapioPro", buyer.uid), {
      restauranteId: id, pedidoId: orderId, criadoEm: serverTimestamp()
    });
    return batch.commit();
  }
  const line = { id: "lanche", nome: product.nome, quantidade: 2,
    precoCentavos: 1800, totalCentavos: 3600 };
  await assert.rejects(submit("invalido", [{ ...line, precoCentavos: 1, totalCentavos: 2 }], 2),
    { code: "permission-denied" });
  const lines = [line];
  for (let index = 1; index < 5; index++) {
    const id = `item-${index}`;
    await setDoc(ref(owner.db, "produtos", id), product);
    lines.push({ ...line, id });
  }
  await submit("valido", lines, 18000);
  await assert.rejects(submit("segundo", lines, 18000), { code: "permission-denied" });
  const order = ref(owner.db, "pedidos", "valido");
  assert.equal((await getDoc(order)).data().totalCentavos, 18500);
  for (const client of [buyer, guest, outsider]) {
    await assert.rejects(getDoc(ref(client.db, "pedidos", "valido")), { code: "permission-denied" });
  }
  await assert.rejects(updateDoc(order, { totalCentavos: 1 }), { code: "permission-denied" });
  await updateDoc(order, { status: "preparando" });
  await assert.rejects(updateDoc(order, { status: "entrega" }), { code: "permission-denied" });

  await seed.doc(`restaurantes/${id}`).update({ status: "inativo" });
  await assert.rejects(getDocs(visible), { code: "permission-denied" });
});
