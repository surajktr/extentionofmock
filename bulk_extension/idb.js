const DB_NAME = 'savemockDB';
const DB_VERSION = 1;
const STORE = 'store';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Helper to fetch the full database object (chunks combined)
async function getFullDb(subjectsArr) {
  const dbObj = {};
  const subjects = subjectsArr && subjectsArr.length > 0 ? subjectsArr : ['Math', 'English', 'GK/GS', 'Reasoning'];
  let hasData = false;

  for (const s of subjects) {
    const data = await idbGet(`savemock_${s}`);
    if (data && data.length > 0) hasData = true;
    dbObj[s] = data || [];
  }

  // Fallback migration logic: If IndexedDB is completely empty, check if we have legacy data in chrome.storage.local
  if (!hasData) {
    return new Promise((resolve) => {
      chrome.storage.local.get(['savemockQuestions'], async (res) => {
        if (res.savemockQuestions && Object.keys(res.savemockQuestions).length > 0) {
          console.log("Fallback migration: Found legacy data, moving to IndexedDB...");
          const legacyDb = res.savemockQuestions;
          await setFullDb(legacyDb);
          await chrome.storage.local.remove(['savemockQuestions']);
          resolve(legacyDb);
        } else {
          resolve(dbObj);
        }
      });
    });
  }

  return dbObj;
}

// Helper to save the full database object (splits into chunks)
async function setFullDb(dbObj) {
  const subjects = Object.keys(dbObj);
  const promises = subjects.map(s => idbSet(`savemock_${s}`, dbObj[s]));
  await Promise.all(promises);
}
