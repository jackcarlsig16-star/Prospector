// IndexedDB mirror of localStorage — survives browser cache clears.
// Saves a bundle of all prospector_* keys to IDB after important state changes.
// On load, if localStorage looks empty, restores the bundle and reloads.

const DB_NAME    = "prospector_db";
const STORE_NAME = "kv";
const BUNDLE_KEY = "ls_bundle";

let _db = null;

const openDb = () => new Promise((resolve, reject) => {
  if (_db) { resolve(_db); return; }
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = e => e.target.result.createObjectStore(STORE_NAME);
  req.onsuccess  = e => { _db = e.target.result; resolve(_db); };
  req.onerror    = e => reject(e.target.error);
});

// Snapshot every prospector_* key from localStorage into IndexedDB
export const saveToIdb = async () => {
  try {
    const bundle = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("prospector_")) bundle[k] = localStorage.getItem(k);
    }
    // Also capture anthropic_key (needed for assay to work after restore)
    const ak = localStorage.getItem("anthropic_key");
    if (ak) bundle["anthropic_key"] = ak;

    const db  = await openDb();
    const tx  = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(bundle, BUNDLE_KEY);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch {} // never block the UI
};

// On app load: if localStorage is empty (cache cleared) but IDB has a bundle,
// restore to localStorage and return true so the caller can reload the page.
export const restoreFromIdb = async () => {
  try {
    // If accounts exist in localStorage, nothing to restore
    if (localStorage.getItem("prospector_accounts")) return false;

    const db  = await openDb();
    const tx  = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(BUNDLE_KEY);
    const bundle = await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror   = rej;
    });

    if (!bundle || !Object.keys(bundle).length) return false;

    Object.entries(bundle).forEach(([k, v]) => {
      try { localStorage.setItem(k, v); } catch {}
    });

    return true; // caller should reload
  } catch {
    return false;
  }
};
