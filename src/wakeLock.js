// Správa zhasínání displeje při cvičení
class WakeLockManager {
  constructor() {
    this.wakeLock = null;
    this.isActive = false;

    document.addEventListener('visibilitychange', async () => {
      if (this.isActive && document.visibilityState === 'visible') {
        await this.requestLock();
      }
    });
  }

  isSupported() {
    return 'wakeLock' in navigator;
  }

  async enable() {
    this.isActive = true;
    return await this.requestLock();
  }

  async disable() {
    this.isActive = false;
    if (this.wakeLock !== null) {
      await this.wakeLock.release();
      this.wakeLock = null;
    }
  }

  async requestLock() {
    if (!this.isSupported()) return false;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => {});
      return true;
    } catch (err) {
      console.warn(`Wake Lock selhal: ${err.name}, ${err.message}`);
      return false;
    }
  }
}

export const screenLock = new WakeLockManager();