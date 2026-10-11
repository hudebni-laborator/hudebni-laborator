// Správa lokálního úložiště skladeb a taktů přes IndexedDB
const DB_NAME = 'GuitarTrainerDB';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('scores')) {
        db.createObjectStore('scores', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('measures')) {
        const measureStore = db.createObjectStore('measures', { keyPath: 'id' });
        measureStore.createIndex('byScoreId', 'scoreId', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveScore({ id, title, type, buffer }) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('scores', 'readwrite');
    const store = tx.objectStore('scores');
    store.put({
      id,
      title,
      type, // 'pdf' | 'image'
      buffer,
      updatedAt: Date.now()
    });
    tx.oncomplete = () => resolve(id);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllScores() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('scores', 'readonly');
    const store = tx.objectStore('scores');
    const request = store.openCursor();
    const scores = [];

    request.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const { id, title, type, updatedAt } = cursor.value;
        scores.push({ id, title, type, updatedAt });
        cursor.continue();
      } else {
        resolve(scores);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getScoreById(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('scores', 'readonly');
    const store = tx.objectStore('scores');
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteScore(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['scores', 'measures'], 'readwrite');
    tx.objectStore('scores').delete(id);

    const measureStore = tx.objectStore('measures');
    const index = measureStore.index('byScoreId');
    const req = index.openCursor(id);

    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveMeasures(scoreId, measuresList) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('measures', 'readwrite');
    const store = tx.objectStore('measures');

    // Nejprve odstraníme stávající takty dané skladby
    const index = store.index('byScoreId');
    const cursorReq = index.openCursor(scoreId);

    cursorReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        // Následně zapíšeme nový seznam
        measuresList.forEach((m) => {
          store.put({
            id: m.id || `${scoreId}-m-${m.number}`,
            scoreId,
            number: m.number,
            page: m.page || 1,
            box: m.box,
            keyBox: m.keyBox || null
          });
        });
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getMeasuresByScore(scoreId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('measures', 'readonly');
    const store = tx.objectStore('measures');
    const index = store.index('byScoreId');
    const req = index.getAll(scoreId);

    req.onsuccess = () => {
      const list = req.result.sort((a, b) => a.number - b.number);
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}