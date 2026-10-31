// For Firebase JS SDK v7.20.0 and later, measurementId is optional
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {apiKey: "AIzaSyDs0UvpnmvW6AOIa9GVAAC7v-MKcITa4OE",
  authDomain: "findora-ai-28480.firebaseapp.com",
  databaseURL: "https://findora-ai-28480-default-rtdb.firebaseio.com",
  projectId: "findora-ai-28480",
  storageBucket: "findora-ai-28480.firebasestorage.app",
  messagingSenderId: "92906881682",
  appId: "1:92906881682:web:e5ebba283b3e66a3305c4b",
  measurementId: "G-05M4MRH8KM"
};
const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);