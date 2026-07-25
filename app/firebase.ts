import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDMx2qzC--Zy-sUMNSbVIsDiL5be9xeTfo",
  authDomain: "rcfm-launcher.firebaseapp.com",
  projectId: "rcfm-launcher",
  storageBucket: "rcfm-launcher.firebasestorage.app",
  messagingSenderId: "1094426862171",
  appId: "1:1094426862171:web:64a712bcf74fcceab5d57e",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const db = getFirestore(app);
