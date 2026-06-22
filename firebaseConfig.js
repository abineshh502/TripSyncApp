import { initializeApp, getApp, getApps } from "firebase/app";

import {
  initializeAuth,
  getReactNativePersistence,
  getAuth,
} from "firebase/auth";

import AsyncStorage from "@react-native-async-storage/async-storage";

const firebaseConfig = {
  apiKey: "AIzaSyDpBTv3re8BuZR-i25ZeuKsUykN1DYcxNo",
  authDomain: "tripsync-8e63e.firebaseapp.com",
  projectId: "tripsync-8e63e",
  storageBucket: "tripsync-8e63e.firebasestorage.app",
  messagingSenderId: "167694267883",
  appId: "1:167694267883:web:61bd7d4f75be2ad2a915ae",
  measurementId: "G-QN6RB14ZGF"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

let authInstance;
try {
  authInstance = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch (e) {
  authInstance = getAuth(app);
}

export const auth = authInstance;
export const authVerification = { isVerifying: false };
export default app;