class WakeLockManager {
  constructor() {
    this.wakeLock = null;
    this.isRequested = false;

    // Obnovení zámku po návratu do popředí prohlížeče
    document.addEventListener('visibilitychange', async () => {
      if (this.isRequested && document.visibilityState === 'visible') {
        await this.request();
      }
    });
  }

  async request() {
    this.isRequested = true;
    if ('wakeLock' in navigator) {
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => {
          this.wakeLock = null;
        });
        return true;
      } catch (err) {
        console.warn(`Chyba WakeLock (${err.name}): ${err.message}`);
        return false;
      }
    }
    return false;
  }

  async release() {
    this.isRequested = false;
    if (this.wakeLock !== null) {
      try {
        await this.wakeLock.release();
        this.wakeLock = null;
      } catch (err) {
        console.warn('Chyba při uvolnění WakeLock:', err);
      }
    }
  }
}

window.wakeLockManager = new WakeLockManager();