/**
 * idbService.ts
 * Tiny IndexedDB helper to persist a FileSystemFileHandle across page reloads.
 * FileSystemFileHandle objects ARE serialisable into IndexedDB (unlike JSON).
 */

const DB_NAME = 'lumina_db';
const DB_VERSION = 1;
const STORE_NAME = 'handles';
const HANDLE_KEY = 'syncFileHandle';

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            req.result.createObjectStore(STORE_NAME);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function saveFileHandleToIDB(handle: FileSystemFileHandle): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function loadFileHandleFromIDB(): Promise<FileSystemFileHandle | null> {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
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
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        // ignore
    }
}
