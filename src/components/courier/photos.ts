"use client";

/**
 * Fotos de los problemas mientras la encuesta no se envía: viven en IndexedDB (no caben bien en
 * localStorage). Si IndexedDB no está disponible (modo privado), quedan solo en memoria.
 */
const DB_NAME = "apphouse-repartidor";
const STORE = "photos";
const mem = new Map<string, Blob>();

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const db = await open();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(req.result);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        resolve(undefined);
      };
    } catch {
      db.close();
      resolve(undefined);
    }
  });
}

export async function putPhoto(id: string, blob: Blob) {
  mem.set(id, blob);
  await run("readwrite", (s) => s.put(blob, id));
}

export async function getPhoto(id: string): Promise<Blob | undefined> {
  return mem.get(id) ?? (await run<Blob>("readonly", (s) => s.get(id) as IDBRequest<Blob>));
}

export async function deletePhoto(id: string) {
  mem.delete(id);
  await run("readwrite", (s) => s.delete(id));
}

export async function clearPhotos() {
  mem.clear();
  await run("readwrite", (s) => s.clear());
}
