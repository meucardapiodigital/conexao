import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";

const env = import.meta.env;
const emulators = env.DEV && env.VITE_FIREBASE_EMULATORS === "true";
export const ready = emulators || Boolean(
  env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID && env.VITE_FIREBASE_AUTH_DOMAIN
);

const app = initializeApp({
  apiKey: emulators ? "demo-cardapiopro" : env.VITE_FIREBASE_API_KEY || "placeholder",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "placeholder.invalid",
  projectId: emulators ? "demo-cardapiopro" : env.VITE_FIREBASE_PROJECT_ID || "placeholder",
  appId: env.VITE_FIREBASE_APP_ID,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID
});

export const auth = getAuth(app);
export const db = getFirestore(app);
if (emulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099");
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}
