// Source for vendor/firebase.js (the Firebase SDK bundled into one local file so the app
// works offline and does not depend on a CDN). Rebuild:
//   npm i firebase@10.14.1 esbuild && npx esbuild tools/firebase-entry.js --bundle --format=iife --minify --target=es2019 --outfile=vendor/firebase.js
import { initializeApp } from "firebase/app";
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, sendSignInLinkToEmail,
  isSignInWithEmailLink, signInWithEmailLink, onAuthStateChanged, signOut, connectAuthEmulator } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator,
  collection, doc, getDoc, setDoc, deleteDoc, onSnapshot, query, where, writeBatch, serverTimestamp,
  Timestamp, terminate, clearIndexedDbPersistence } from "firebase/firestore";
import { getMessaging, getToken, deleteToken, isSupported as messagingSupported } from "firebase/messaging";
window.FB = { initializeApp, initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, sendSignInLinkToEmail,
  isSignInWithEmailLink, signInWithEmailLink, onAuthStateChanged, signOut, connectAuthEmulator,
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator,
  collection, doc, getDoc, setDoc, deleteDoc, onSnapshot, query, where, writeBatch, serverTimestamp,
  Timestamp, terminate, clearIndexedDbPersistence, getMessaging, getToken, deleteToken, messagingSupported };
