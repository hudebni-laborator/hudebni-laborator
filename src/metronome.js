class MetronomeController {
  constructor() {
    this.audioCtx = null;
    this.isRunning = false;
    this.currentBpm = 60;
    this.phase = 'idle'; // 'idle', 'leadin', 'playing', 'goal'
    this.beatIndex = 0;
    this.measureIndexInCycle = 0;
    this.nextBeatTime = 0;
    this.timerId = null;
    this.lookaheadMs = 25;
    this.scheduleAheadSec = 0.12;
  }

  async initAudio() {
    if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
  }

  playClickSound(time, isAccent, isLeadIn) {
    if (!this.audioCtx) return;
    try {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      let freq = isLeadIn ? (isAccent ? 1600 : 1100) : (isAccent ? 1200 : 800);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time);

      const st = Math.max(this.audioCtx.currentTime, time);
      gain.gain.setValueAtTime(0.0001, st);
      gain.gain.exponentialRampToValueAtTime(1.0, st + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, st + 0.045);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(st);
      osc.stop(st + 0.05);
    } catch (_) {}
  }

  async toggle() {
    if (this.isRunning) this.stop();
    else await this.start();
  }

  async start() {
    await this.initAudio();
    if (window.wakeLockManager) try { await window.wakeLockManager.request(); } catch (_) {}

    this.currentBpm = Number(document.getElementById('metroStartBpm')?.value) || 60;
    this.isRunning = true;
    this.phase = 'leadin';
    this.beatIndex = 0;
    this.measureIndexInCycle = 0;

    const curText = document.getElementById('metroCurrentBpmText');
    if (curText) curText.innerText = this.currentBpm;

    this.nextBeatTime = this.audioCtx.currentTime + 0.05;
    this.timerId = setInterval(() => this.schedulerLoop(), this.lookaheadMs);
  }

  stop() {
    this.isRunning = false;
    if (this.timerId) clearInterval(this.timerId);
    this.timerId = null;
    this.phase = 'idle';
    this.beatIndex = 0;
    this.clearBeatLights();
    this.updateCircleUI('idle');
  }

  resetTempo() {
    this.currentBpm = Number(document.getElementById('metroStartBpm')?.value) || 60;
    const curText = document.getElementById('metroCurrentBpmText');
    if (curText) curText.innerText = this.currentBpm;
  }

  schedulerLoop() {
    if (!this.audioCtx || !this.isRunning) return;
    while (this.nextBeatTime < this.audioCtx.currentTime + this.scheduleAheadSec) {
      this.scheduleCurrentBeat(this.nextBeatTime);
      this.advanceBeat();
    }
  }

  scheduleCurrentBeat(time) {
    const beatsPerBar = Number(document.getElementById('metroBeatsPerBar')?.value) || 4;
    const isAccent = (this.beatIndex === 0);
    const scheduledBeat = this.beatIndex;
    const scheduledPhase = this.phase;
    const scheduledBpm = this.currentBpm;

    this.playClickSound(time, isAccent, scheduledPhase === 'leadin');

    const delayMs = Math.max(0, (time - this.audioCtx.currentTime) * 1000);
    setTimeout(() => {
      if (!this.isRunning) return;
      this.renderBeatLight(scheduledBeat, beatsPerBar, scheduledPhase);
      if (scheduledBeat === 0) {
        this.updateCircleUI(scheduledPhase);
        const curText = document.getElementById('metroCurrentBpmText');
        if (curText) curText.innerText = scheduledBpm;
      }
    }, delayMs);
  }

  advanceBeat() {
    const beats = Number(document.getElementById('metroBeatsPerBar')?.value) || 4;
    const targetBpm = Number(document.getElementById('metroTargetBpm')?.value) || 100;
    const step = Number(document.getElementById('metroStepBpm')?.value) || 2;
    const bars = Number(document.getElementById('metroBarsCount')?.value) || 1;

    this.nextBeatTime += (60.0 / this.currentBpm);
    this.beatIndex++;

    if (this.beatIndex >= beats) {
      this.beatIndex = 0;
      if (this.phase === 'leadin') {
        this.phase = 'playing';
        this.measureIndexInCycle = 0;
      } else if (this.phase === 'playing') {
        this.measureIndexInCycle++;
        if (this.measureIndexInCycle >= bars) {
          if (this.currentBpm < targetBpm) {
            this.currentBpm = Math.min(targetBpm, this.currentBpm + step);
            this.phase = 'leadin';
          } else {
            this.phase = 'goal';
          }
          this.measureIndexInCycle = 0;
        }
      }
    }
  }

  updateCircleUI(phase) {
    const btn = document.getElementById('metroCircleBtn');
    const icn = document.getElementById('metroCircleIcon');
    if (!btn || !icn) return;
    btn.className = 'metro-circle-btn';
    if (phase === 'idle') {
      btn.classList.add('circle-idle');
      icn.innerText = '▶';
    } else if (phase === 'leadin') {
      btn.classList.add('circle-leadin');
      icn.innerText = '⏸';
    } else {
      btn.classList.add('circle-playing');
      icn.innerText = phase === 'goal' ? '🏆' : '⏸';
    }
  }

  renderBeatLight(beatIdx, totalBeats, phase) {
    const container = document.getElementById('metroBeatLights');
    if (!container) return;
    while (container.children.length < totalBeats) {
      const dot = document.createElement('div');
      dot.className = 'beat-light';
      container.appendChild(dot);
    }
    while (container.children.length > totalBeats) container.removeChild(container.lastChild);

    const lights = container.children;
    for (let i = 0; i < lights.length; i++) {
      lights[i].className = 'beat-light';
      if (i === beatIdx) {
        lights[i].classList.add((beatIdx === 0 || phase === 'leadin') ? 'active-accent' : 'active-regular');
      }
    }
  }

  clearBeatLights() {
    const container = document.getElementById('metroBeatLights');
    if (!container) return;
    for (const dot of container.children) dot.className = 'beat-light';
  }
}