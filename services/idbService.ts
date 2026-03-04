/**
 * idbService.ts
 * IndexedDB helper for Lumina.
 * Store 1 – 'handles':   Persists the FileSystemFileHandle for the sync file.
 * Store 2 – 'app_data':  Persists all card/history data (replacement for localStorage).
 *
 * FileSystemFileHandle objects are serialisable into IndexedDB (unlike JSON).
 */

import { CloudData } from '../types';

const DB_NAME = 'lumina_db';
const DB_VERSION = 2;           // bumped to add the 'app_data' store
const HANDLE_STORE = 'handles';
const DATA_STORE = 'app_data';
const HANDLE_KEY = 'syncFileHandle';
const DATA_KEY = 'appData';

// ─── DB open ────────────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (ev) => {
            const db = req.result;
            // v1 store – created in prior version
            if (!db.objectStoreNames.contains(HANDLE_STORE)) {
                db.createObjectStore(HANDLE_STORE);
            }
            // v2 store – new
            if (!db.objectStoreNames.contains(DATA_STORE)) {
                db.createObjectStore(DATA_STORE);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// ─── File Handle ────────────────────────────────────────────────────────────

export async function saveFileHandleToIDB(handle: FileSystemFileHandle): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(HANDLE_STORE, 'readwrite');
        tx.objectStore(HANDLE_STORE).put(handle, HANDLE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function loadFileHandleFromIDB(): Promise<FileSystemFileHandle | null> {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(HANDLE_STORE, 'readonly');
            const req = tx.objectStore(HANDLE_STORE).get(HANDLE_KEY);
            req.onsuccess = () => resolve((req.result as FileSystemFileHandle) ?? null);
            req.onerror = () => reject(req.error);
        });
    } catch {
        return null;
    }
}

export async function clearFileHandleFromIDB(): Promise<void> {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(HANDLE_STORE, 'readwrite');
            tx.objectStore(HANDLE_STORE).delete(HANDLE_KEY);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        // ignore
    }
}

// ─── App Data (primary data store, replaces localStorage) ───────────────────

export async function saveAppDataToIDB(data: CloudData): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(DATA_STORE, 'readwrite');
        tx.objectStore(DATA_STORE).put(data, DATA_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function loadAppDataFromIDB(): Promise<CloudData | null> {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(DATA_STORE, 'readonly');
            const req = tx.objectStore(DATA_STORE).get(DATA_KEY);
            req.onsuccess = () => resolve((req.result as CloudData) ?? null);
            req.onerror = () => reject(req.error);
        });
    } catch {
        return null;
    }
}

// ─── Storage Meta ────────────────────────────────────────────────────────────

/** Requests durable (persistent) storage so the browser won't auto-evict data. */
export async function requestPersistentStorage(): Promise<boolean> {
    if (!navigator.storage?.persist) return false;
    return navigator.storage.persist();
}

/** Returns whether storage is already marked persistent. */
export async function checkPersistentStorage(): Promise<boolean> {
    if (!navigator.storage?.persisted) return false;
    return navigator.storage.persisted();
}

/** Returns { usage, quota } in bytes, or null if the API is unavailable. */
export async function getStorageEstimate(): Promise<{ usage: number; quota: number } | null> {
    if (!navigator.storage?.estimate) return null;
    const est = await navigator.storage.estimate();
    return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
}
