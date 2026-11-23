import{initializeApp}from"firebase/app";import{getAuth}from"firebase/auth";import{getFirestore}from"firebase/firestore";import{getFunctions}from"firebase/functions";
const e=import.meta.env;
export const ready=!!(e.VITE_FIREBASE_API_KEY&&e.VITE_FIREBASE_PROJECT_ID);
const app=initializeApp({apiKey:e.VITE_FIREBASE_API_KEY||"placeholder",authDomain:e.VITE_FIREBASE_AUTH_DOMAIN||"placeholder.invalid",projectId:e.VITE_FIREBASE_PROJECT_ID||"placeholder",storageBucket:e.VITE_FIREBASE_STORAGE_BUCKET,messagingSenderId:e.VITE_FIREBASE_MESSAGING_SENDER_ID,appId:e.VITE_FIREBASE_APP_ID});
export const auth=getAuth(app),db=getFirestore(app),fn=getFunctions(app,"southamerica-east1");
export const orderUrl="https://southamerica-east1-"+e.VITE_FIREBASE_PROJECT_ID+".cloudfunctions.net/criarPedido";
