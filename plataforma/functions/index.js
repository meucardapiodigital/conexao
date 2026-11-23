const {onCall,onRequest,HttpsError}=require("firebase-functions/v2/https");
const admin=require("firebase-admin");admin.initializeApp();const db=admin.firestore();
const region="southamerica-east1";
const txt=(v,n=150)=>String(v||"").trim().slice(0,n);
const slugify=s=>txt(s,80).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9-]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"");
const isSuper=async uid=>(await db.doc("superadmins/"+uid).get()).exists;
const memberRole=async(uid,id)=>(await db.doc("restaurantes/"+id+"/membros/"+uid).get()).data()?.papel;
exports.criarRestaurante=onCall({region},async req=>{
 if(!req.auth||!(await isSuper(req.auth.uid)))throw new HttpsError("permission-denied","Acesso restrito");
 const nome=txt(req.data?.nome),slug=slugify(req.data?.slug||nome),uid=txt(req.data?.uid);
 if(nome.length<3||slug.length<3)throw new HttpsError("invalid-argument","Dados inválidos");
 const ref=db.collection("restaurantes").doc(),sr=db.doc("slugs/"+slug);
 await db.runTransaction(async t=>{if((await t.get(sr)).exists)throw new HttpsError("already-exists","Slug ocupado");t.create(sr,{restauranteId:ref.id});t.create(ref,{nome,slug,status:"ativo",tema:{cor:"#e96039"},taxaEntregaCentavos:0,criadoEm:admin.firestore.FieldValue.serverTimestamp()});if(uid)t.create(ref.collection("membros").doc(uid),{papel:"proprietario"})});
 return {id:ref.id,slug};
});
exports.configurarLoja=onCall({region},async req=>{
 if(!req.auth)throw new HttpsError("unauthenticated","Faça login");
 const id=txt(req.data?.id),cor=txt(req.data?.cor,7),taxa=Number(req.data?.taxa);
 if(!(await isSuper(req.auth.uid))&&!["proprietario","gerente"].includes(await memberRole(req.auth.uid,id)))throw new HttpsError("permission-denied","Acesso restrito");
 if(!/^#[0-9a-fA-F]{6}$/.test(cor)||!Number.isSafeInteger(taxa)||taxa<0||taxa>100000)throw new HttpsError("invalid-argument","Dados inválidos");
 await db.doc("restaurantes/"+id).update({"tema.cor":cor,taxaEntregaCentavos:taxa});return {ok:true};
});
exports.atualizarPedido=onCall({region},async req=>{
 if(!req.auth)throw new HttpsError("unauthenticated","Faça login");
 const id=txt(req.data?.id),pid=txt(req.data?.pedidoId),status=txt(req.data?.status);
 if(!(await isSuper(req.auth.uid))&&!["proprietario","gerente","atendente"].includes(await memberRole(req.auth.uid,id)))throw new HttpsError("permission-denied","Acesso restrito");
 const transitions={recebido:["preparando","cancelado"],preparando:["pronto","cancelado"],pronto:["entrega","concluido"],entrega:["concluido"]};
 await db.runTransaction(async t=>{const ref=db.doc("restaurantes/"+id+"/pedidos/"+pid),s=await t.get(ref);if(!s.exists||!transitions[s.data().status]?.includes(status))throw new HttpsError("failed-precondition","Status inválido");t.update(ref,{status})});return {ok:true};
});
exports.criarPedido=onRequest({region,cors:true,invoker:"public"},async(req,res)=>{
 if(req.method!=="POST")return res.status(405).json({erro:"Método inválido"});
 try{
 const {slug,itens,cliente,modalidade,pagamento}=req.body||{};
 const sl=await db.doc("slugs/"+slugify(slug)).get();if(!sl.exists)return res.status(404).json({erro:"Não encontrado"});
 const id=sl.data().restauranteId,ref=db.doc("restaurantes/"+id),r=(await ref.get()).data();
 if(!r||r.status!=="ativo")return res.status(403).json({erro:"Loja fechada"});
 if(!Array.isArray(itens)||itens.length<1||itens.length>40||!itens.every(x=>typeof x.id==="string"&&Number.isSafeInteger(x.quantidade)&&x.quantidade>=1&&x.quantidade<=50)||!["entrega","retirada","mesa"].includes(modalidade)||!["pix","dinheiro","cartao"].includes(pagamento)||txt(cliente?.nome).length<2)return res.status(400).json({erro:"Pedido inválido"});
 const ids=[...new Set(itens.map(x=>x.id))],refs=ids.map(x=>ref.collection("produtos").doc(x)),snaps=await db.getAll(...refs),prods=Object.fromEntries(snaps.map((s,i)=>[ids[i],s.data()]));
 let subtotal=0;const lines=[];
 for(const x of itens){const p=prods[x.id];if(!p||p.ativo!==true||!Number.isSafeInteger(p.precoCentavos)||p.precoCentavos<0)return res.status(400).json({erro:"Produto indisponível"});const total=p.precoCentavos*x.quantidade;subtotal+=total;lines.push({nome:p.nome,quantidade:x.quantidade,precoCentavos:p.precoCentavos,totalCentavos:total})}
 if(subtotal>100000000)return res.status(400).json({erro:"Limite excedido"});
 const taxa=modalidade==="entrega"?(r.taxaEntregaCentavos||0):0;const totalCentavos=subtotal+taxa;
 const doc=await ref.collection("pedidos").add({cliente:{nome:txt(cliente.nome),telefone:txt(cliente.telefone,24),endereco:txt(cliente.endereco,250)},itens:lines,modalidade,pagamento,subtotalCentavos:subtotal,taxaEntregaCentavos:taxa,totalCentavos,status:"recebido",criadoEm:admin.firestore.FieldValue.serverTimestamp()});
 return res.status(201).json({id:doc.id,totalCentavos});
 }catch(e){console.error(e);return res.status(500).json({erro:"Não foi possível registrar"})}
});
