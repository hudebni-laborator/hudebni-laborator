class ScoreDB {
  constructor() {
    this.dbName = 'GuitarTrainerDB';
    this.version = 1;
    this.db = null;
  }

  async open() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('scores')) {
          db.createObjectStore('scores', { keyPath: 'id' });
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };

      request.onerror = (e) => {
        reject('Chyba při otevírání IndexedDB: ' + e.target.error);
      };
    });
  }

  async saveScore(scoreData) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('scores', 'readwrite');
      const store = tx.objectStore('scores');
      const req = store.put(scoreData);

      req.onsuccess = () => resolve(scoreData.id);
      req.onerror = () => reject(req.error);
    });
  }

  async getScore(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('scores', 'readonly');
      const store = tx.objectStore('scores');
      const req = store.get(id);

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteScore(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('scores', 'readwrite');
      const store = tx.objectStore('scores');
      const req = store.delete(id);

      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }
}

window.scoreDB = new ScoreDB();