class MetronomeController {
  constructor() {
    this.audioCtx = null;
    this.isRunning = false;
    this.currentBpm = 60;
    this.targetBpm = 100;
    this.beatsPerBar = 4;
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

  playCelebratoryChord(startTime) {
    if (!this.audioCtx) return;
    const t0 = Math.max(this.audioCtx.currentTime, startTime || this.audioCtx.currentTime);

    const chordNotes = [
      { freq: 130.81, delay: 0.00 }, // C3
      { freq: 261.63, delay: 0.05 }, // C4
      { freq: 329.63, delay: 0.10 }, // E4
      { freq: 392.00, delay: 0.15 }, // G4
      { freq: 523.25, delay: 0.20 }, // C5
      { freq: 659.25, delay: 0.25 }, // E5
      { freq: 783.99, delay: 0.30 }, // G5
      { freq: 1046.5, delay: 0.35 }  // C6
    ];

    chordNotes.forEach(({ freq, delay }) => {
      try {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t0 + delay);

        const noteStart = t0 + delay;
        gain.gain.setValueAtTime(0.0001, noteStart);
        gain.gain.exponentialRampToValueAtTime(0.18, noteStart + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 2.4);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start(noteStart);
        osc.stop(noteStart + 2.5);
      } catch (_) {}
    });
  }

  async toggle() {
    if (this.isRunning) this.stop();
    else await this.start();
  }

  async start() {
    await this.initAudio();
    if (window.wakeLockManager) {
      try { await window.wakeLockManager.request(); } catch (_) {}
    }

    // Načteme hodnotu start a cíl z posuvníků
    const startInput = document.getElementById('metroStartBpm');
    if (startInput) this.currentBpm = Number(startInput.value) || this.currentBpm;

    const targetInput = document.getElementById('metroTargetBpm');
    if (targetInput) this.targetBpm = Number(targetInput.value) || 100;
    this.updateTargetDisplay(this.targetBpm);

    this.isRunning = true;
    this.phase = 'leadin';
    this.beatIndex = 0;
    this.measureIndexInCycle = 0;

    this.updateTempoDisplays(this.currentBpm);
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

  // --- OBSLUHA POSUVNÍKŮ A TEMPA ---
  onStartBpmInput(val) {
    const bpm = Math.max(30, Math.min(240, Number(val)));
    const lbl = document.getElementById('metroStartVal');
    if (lbl) lbl.innerText = bpm;
    if (!this.isRunning) {
      this.setBpm(bpm);
    }
  }

  adjustStartBpm(delta) {
    const slider = document.getElementById('metroStartBpm');
    if (slider) {
      slider.value = Number(slider.value) + delta;
      this.onStartBpmInput(slider.value);
    }
  }

  onTargetBpmInput(val) {
    this.targetBpm = Math.max(30, Math.min(240, Number(val)));
    const lbl = document.getElementById('metroTargetVal');
    if (lbl) lbl.innerText = this.targetBpm;
    this.updateTargetDisplay(this.targetBpm);
  }

  adjustTargetBpm(delta) {
    const slider = document.getElementById('metroTargetBpm');
    if (slider) {
      slider.value = Number(slider.value) + delta;
      this.onTargetBpmInput(slider.value);
    }
  }

  updateTargetDisplay(targetBpm) {
    const targetText = document.getElementById('metroTargetBpmText');
    if (targetText) {
      targetText.innerText = `➔ Cíl: ${targetBpm}`;
    }
  }

  changeBpm(delta) {
    this.setBpm(this.currentBpm + delta);
  }

  setBpm(newBpm) {
    this.currentBpm = Math.max(30, Math.min(240, Number(newBpm) || 60));
    this.updateTempoDisplays(this.currentBpm);
  }

  setBeats(beats) {
    this.beatsPerBar = Math.max(1, Math.min(16, Number(beats) || 4));
    this.beatIndex = 0;

    const inp = document.getElementById('metroBeatsPerBar');
    if (inp && inp.value !== String(this.beatsPerBar)) inp.value = this.beatsPerBar;

    const sel = document.getElementById('playMetroBeatsSelect');
    if (sel && sel.value !== String(this.beatsPerBar)) sel.value = this.beatsPerBar;
  }

  resetTempo() {
    const startSlider = document.getElementById('metroStartBpm');
    const startBpm = startSlider ? Number(startSlider.value) : 60;
    this.setBpm(startBpm);
  }

  updateTempoDisplays(bpm) {
    const d1 = document.getElementById('metroCurrentBpmText');
    if (d1) d1.innerText = bpm;
    const d2 = document.getElementById('playMetroBpmText');
    if (d2) d2.innerText = bpm;

    // Posuvník v Hraní
    const playSlider = document.getElementById('playTempoSlider');
    if (playSlider) playSlider.value = bpm;

    // Posuvník Start v Laboratoři (pokud metronom neběží)
    if (!this.isRunning) {
      const startSlider = document.getElementById('metroStartBpm');
      if (startSlider) startSlider.value = bpm;
      const startLbl = document.getElementById('metroStartVal');
      if (startLbl) startLbl.innerText = bpm;
    }
  }

  schedulerLoop() {
    if (!this.audioCtx || !this.isRunning) return;
    while (this.nextBeatTime < this.audioCtx.currentTime + this.scheduleAheadSec) {
      this.scheduleCurrentBeat(this.nextBeatTime);
      this.advanceBeat();
      if (!this.isRunning) break;
    }
  }

  scheduleCurrentBeat(time) {
    const beatsPerBar = this.beatsPerBar;
    const isAccent = (this.beatIndex === 0);
    const scheduledBeat = this.beatIndex;
    const scheduledPhase = this.phase;
    const scheduledBpm = this.currentBpm;

    this.playClickSound(time, isAccent, scheduledPhase === 'leadin');

    const delayMs = Math.max(0, (time - this.audioCtx.currentTime) * 1000);
    setTimeout(() => {
      if (!this.isRunning && scheduledPhase !== 'goal') return;
      this.renderBeatLight(scheduledBeat, beatsPerBar, scheduledPhase);
      if (scheduledBeat === 0) {
        this.updateCircleUI(scheduledPhase);
        this.updateTempoDisplays(scheduledBpm);
      }
    }, delayMs);
  }

  advanceBeat() {
    const beats = this.beatsPerBar;
    const targetBpm = this.targetBpm;
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
            // CÍL SPLNĚN
            const isLab = document.getElementById('labView')?.style.display === 'flex';
            if (isLab) {
              const finishTime = this.nextBeatTime;
              const delayMs = Math.max(0, (finishTime - this.audioCtx.currentTime) * 1000);

              this.isRunning = false;
              if (this.timerId) clearInterval(this.timerId);
              this.timerId = null;

              this.playCelebratoryChord(finishTime);

              setTimeout(() => {
                this.clearBeatLights();
                this.updateCircleUI('goal');
              }, delayMs);

              return;
            } else {
              this.phase = 'goal';
            }
          }
          this.measureIndexInCycle = 0;
        }
      }
    }
  }

  updateCircleUI(phase) {
    const buttons = [
      { btn: document.getElementById('metroCircleBtn'), icn: document.getElementById('metroCircleIcon') },
      { btn: document.getElementById('playMetroCircleBtn'), icn: document.getElementById('playMetroCircleIcon') }
    ];

    buttons.forEach(({ btn, icn }) => {
      if (!btn || !icn) return;
      btn.className = btn.classList.contains('play-metro-circle')
        ? 'metro-circle-btn play-metro-circle'
        : 'metro-circle-btn';

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
    });
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