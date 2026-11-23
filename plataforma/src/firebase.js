import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";

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
export const fn = getFunctions(app, "southamerica-east1");
export const checkoutReady = emulators || Boolean(ready &&
  env.VITE_FIREBASE_APP_ID && env.VITE_FIREBASE_APP_CHECK_SITE_KEY);

if (emulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099");
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(fn, "127.0.0.1", 5001);
} else if (checkoutReady) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(env.VITE_FIREBASE_APP_CHECK_SITE_KEY),
    isTokenAutoRefreshEnabled: true
  });
}
