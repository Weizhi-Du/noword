export function readLegacyPages() {
  let draft = null;
  let extra = null;
  let theme = null;
  try {
    if (sessionStorage.getItem("noword:migrated-v3")) return null;
    draft = sessionStorage.getItem("noword:draft");
    theme = sessionStorage.getItem("noword:theme");
    extra = JSON.parse(sessionStorage.getItem("noword:pages"));
  } catch {
    // The first draft can still be intact if the earlier page list is malformed.
  }

  const additional = Array.isArray(extra?.additional)
    ? extra.additional.filter((text) => typeof text === "string")
    : [];
  const drafts = draft !== null || additional.length ? [draft ?? "", ...additional] : [];
  return drafts.length || theme ? { drafts, active: extra?.active, theme } : null;
}

export function markLegacyImported() {
  try {
    sessionStorage.setItem("noword:migrated-v3", "yes");
  } catch {
    // The browser can still retain the imported pages in IndexedDB.
  }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
  });
}

export function openLibrary() {
  const request = indexedDB.open("noword-library", 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore("pages", { keyPath: "id" });
    request.result.createObjectStore("settings");
  };
  return requestResult(request);
}

export async function readLibrary(database) {
  const transaction = database.transaction(["pages", "settings"]);
  const settings = transaction.objectStore("settings");
  const [pages, active, theme] = await Promise.all([
    requestResult(transaction.objectStore("pages").getAll()),
    requestResult(settings.get("active")),
    requestResult(settings.get("theme"))
  ]);
  pages.sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
  return { pages, active, theme };
}

export function importPages(database, pages, active, theme) {
  const transaction = database.transaction(["pages", "settings"], "readwrite", { durability: "strict" });
  const pagesStore = transaction.objectStore("pages");
  const settings = transaction.objectStore("settings");
  if (active) settings.put(active, "active");
  if (theme) {
    const current = settings.get("theme");
    current.onsuccess = () => {
      if (current.result === undefined) settings.put(theme, "theme");
    };
  }
  for (const page of pages) pagesStore.add(page);
  return transactionDone(transaction);
}

export async function writePage(database, page, active) {
  const transaction = database.transaction(["pages", "settings"], "readwrite", { durability: "strict" });
  const pagesStore = transaction.objectStore("pages");
  const lookup = pagesStore.get(page.id);
  let saved;
  let concurrent;
  lookup.onsuccess = () => {
    const current = lookup.result;
    // Retain both versions if two tabs edit the same page independently.
    concurrent = current && current.revision !== page.revision ? current : null;
    saved = concurrent
      ? { ...page, id: crypto.randomUUID(), created: Date.now(), revision: 1 }
      : { ...page, revision: page.revision + 1 };
    pagesStore.put(saved);
    if (active) transaction.objectStore("settings").put(saved.id, "active");
  };
  await transactionDone(transaction);
  return { saved, concurrent };
}

export function writeSetting(database, key, value) {
  const transaction = database.transaction("settings", "readwrite", { durability: "strict" });
  transaction.objectStore("settings").put(value, key);
  return transactionDone(transaction);
}
