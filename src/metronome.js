class MetronomeController {
  constructor() {
    this.audioCtx = null;
    this.isRunning = false;
    this.activeMode = 'play'; // 'play' | 'lab'

    // ==========================================================
    // SAMOSTATNÉ PARAMETRY PRO REŽIM HRANÍ
    // ==========================================================
    this.playStartBpm = 60;
    this.playTargetBpm = 60;
    this.playCurrentBpm = 60;
    this.playStepBpm = 2;
    this.playBarsCount = 4;
    this.playBeats = 4;

    // ==========================================================
    // SAMOSTATNÉ PARAMETRY PRO REŽIM LABORATOŘ
    // ==========================================================
    this.labStartBpm = 60;
    this.labTargetBpm = 100;
    this.labCurrentBpm = 60;
    this.labStepBpm = 2;
    this.labBarsCount = 1;
    this.labBeats = 4;

    // ==========================================================
    // BĚHOVÝ STAV PLÁNOVAČE
    // ==========================================================
    this.currentBpm = 60;
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

  detectCurrentMode() {
    const isLab = document.getElementById('labView')?.style.display === 'flex';
    return isLab ? 'lab' : 'play';
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

    this.activeMode = this.detectCurrentMode();
    this.isRunning = true;
    this.beatIndex = 0;
    this.measureIndexInCycle = 0;

    if (this.activeMode === 'play') {
      this.playCurrentBpm = this.playStartBpm;
      this.currentBpm = this.playCurrentBpm;
      this.beatsPerBar = this.playBeats;
      this.phase = 'playing';
      this.updatePlayTempoUI();
    } else {
      const startSlider = document.getElementById('metroStartBpm');
      if (startSlider) this.labStartBpm = Number(startSlider.value) || this.labStartBpm;

      const targetSlider = document.getElementById('metroTargetBpm');
      if (targetSlider) this.labTargetBpm = Number(targetSlider.value) || this.labTargetBpm;

      const beatsInput = document.getElementById('metroBeatsPerBar');
      if (beatsInput) this.labBeats = Number(beatsInput.value) || this.labBeats;

      this.labCurrentBpm = this.labStartBpm;
      this.currentBpm = this.labCurrentBpm;
      this.beatsPerBar = this.labBeats;
      this.phase = 'leadin';

      this.updateLabTargetDisplay(this.labTargetBpm);
      this.updateLabTempoUI(this.currentBpm);
    }

    this.updateCircleUI(this.phase);
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

  // ==========================================================
  // METODY REŽIMU HRANÍ (Nezávislé na Laboratoři)
  // ==========================================================
  setPlayBpm(val) {
    this.playStartBpm = Math.max(30, Math.min(260, Number(val) || 60));
    if (!this.isRunning || this.activeMode !== 'play') {
      this.playCurrentBpm = this.playStartBpm;
      if (this.playTargetBpm < this.playStartBpm) {
        this.playTargetBpm = this.playStartBpm;
      }
    } else {
      this.currentBpm = this.playStartBpm;
    }
    this.updatePlayTempoUI();
  }

  changePlayBpm(delta) {
    this.setPlayBpm(this.playStartBpm + delta);
  }

  onPlayTargetInput(val) {
    this.playTargetBpm = Math.max(30, Math.min(260, Number(val) || 60));
    const lbl = document.getElementById('playTargetVal');
    if (lbl) lbl.innerText = this.playTargetBpm;
  }

  adjustPlayTargetBpm(delta) {
    const slider = document.getElementById('playTargetBpmSlider');
    if (slider) {
      slider.value = Number(slider.value) + delta;
      this.onPlayTargetInput(slider.value);
    }
  }

  matchPlayTargetToStart() {
    this.playTargetBpm = this.playStartBpm;
    const slider = document.getElementById('playTargetBpmSlider');
    if (slider) slider.value = this.playTargetBpm;
    const lbl = document.getElementById('playTargetVal');
    if (lbl) lbl.innerText = this.playTargetBpm;
  }

  setPlayStep(val) {
    this.playStepBpm = Math.max(1, Math.min(20, Number(val) || 2));
  }

  setPlayBars(val) {
    this.playBarsCount = Math.max(1, Math.min(64, Number(val) || 4));
  }

  setPlayBeats(val) {
    this.playBeats = Math.max(1, Math.min(16, Number(val) || 4));
    if (this.isRunning && this.activeMode === 'play') {
      this.beatsPerBar = this.playBeats;
      this.beatIndex = 0;
    }
    const sel = document.getElementById('playMetroBeatsSelect');
    if (sel && sel.value !== String(this.playBeats)) sel.value = String(this.playBeats);
  }

  updatePlayTempoUI() {
    const textEl = document.getElementById('playMetroBpmText');
    if (textEl) textEl.innerText = this.isRunning && this.activeMode === 'play' ? this.currentBpm : this.playStartBpm;

    const slider = document.getElementById('playTempoSlider');
    if (slider) slider.value = this.playStartBpm;

    const startLbl = document.getElementById('playStartVal');
    if (startLbl) startLbl.innerText = this.playStartBpm;

    const targetSlider = document.getElementById('playTargetBpmSlider');
    if (targetSlider) targetSlider.value = this.playTargetBpm;

    const targetLbl = document.getElementById('playTargetVal');
    if (targetLbl) targetLbl.innerText = this.playTargetBpm;
  }

  setBpm(val) { this.setPlayBpm(val); }
  changeBpm(delta) { this.changePlayBpm(delta); }
  setBeats(val) { this.setPlayBeats(val); }

  // ==========================================================
  // METODY REŽIMU LABORATOŘ (Nezávislé na Hraní)
  // ==========================================================
  onStartBpmInput(val) {
    this.labStartBpm = Math.max(30, Math.min(240, Number(val) || 60));
    const lbl = document.getElementById('metroStartVal');
    if (lbl) lbl.innerText = this.labStartBpm;

    if (!this.isRunning && this.detectCurrentMode() === 'lab') {
      this.updateLabTempoUI(this.labStartBpm);
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
    this.labTargetBpm = Math.max(30, Math.min(240, Number(val) || 100));
    const lbl = document.getElementById('metroTargetVal');
    if (lbl) lbl.innerText = this.labTargetBpm;
    this.updateLabTargetDisplay(this.labTargetBpm);
  }

  adjustTargetBpm(delta) {
    const slider = document.getElementById('metroTargetBpm');
    if (slider) {
      slider.value = Number(slider.value) + delta;
      this.onTargetBpmInput(slider.value);
    }
  }

  updateLabTargetDisplay(targetBpm) {
    const targetText = document.getElementById('metroTargetBpmText');
    if (targetText) {
      targetText.innerText = `➔ Cíl: ${targetBpm}`;
    }
  }

  updateLabTempoUI(bpm) {
    const d1 = document.getElementById('metroCurrentBpmText');
    if (d1) d1.innerText = bpm;
  }

  resetTempo() {
    const startSlider = document.getElementById('metroStartBpm');
    const startVal = startSlider ? Number(startSlider.value) : this.labStartBpm;
    this.labCurrentBpm = startVal;
    this.updateLabTempoUI(startVal);
  }

  // AUTOMATICKÝ RESET METRONOMU NA ZVOLENÝ START PŘI PŘEPNUTÍ TAKTU V LABORATOŘI
  resetLabDrill() {
    this.currentBpm = this.labStartBpm;
    this.measureIndexInCycle = 0;
    this.beatIndex = 0;
    if (this.isRunning && this.detectCurrentMode() === 'lab') {
      this.phase = 'leadin';
      this.nextBeatTime = this.audioCtx ? this.audioCtx.currentTime + 0.05 : 0;
      this.updateLabTempoUI(this.currentBpm);
      this.updateCircleUI('leadin');
    } else {
      this.phase = 'idle';
      this.updateLabTempoUI(this.currentBpm);
      this.updateCircleUI('idle');
      this.clearBeatLights();
    }
  }

  // ==========================================================
  // PLÁNOVAČ A SMYČKA DOB
  // ==========================================================
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

      if (this.activeMode === 'lab') {
        this.renderBeatLight(scheduledBeat, beatsPerBar, scheduledPhase);
        if (scheduledBeat === 0) {
          this.updateCircleUI(scheduledPhase);
          this.updateLabTempoUI(scheduledBpm);
        }
      } else {
        if (scheduledBeat === 0) {
          this.updateCircleUI(scheduledPhase);
          const tText = document.getElementById('playMetroBpmText');
          if (tText) tText.innerText = scheduledBpm;
        }
      }
    }, delayMs);
  }

  advanceBeat() {
    const beats = this.beatsPerBar;

    if (this.activeMode === 'play') {
      this.nextBeatTime += (60.0 / this.currentBpm);
      this.beatIndex++;

      if (this.beatIndex >= beats) {
        this.beatIndex = 0;
        if (this.playTargetBpm > this.currentBpm) {
          this.measureIndexInCycle++;
          if (this.measureIndexInCycle >= this.playBarsCount) {
            this.currentBpm = Math.min(this.playTargetBpm, this.currentBpm + this.playStepBpm);
            this.measureIndexInCycle = 0;
          }
        }
      }
      return;
    }

    const targetBpm = this.labTargetBpm;
    const step = Number(document.getElementById('metroStepBpm')?.value) || this.labStepBpm;
    const bars = Number(document.getElementById('metroBarsCount')?.value) || this.labBarsCount;

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
          }
          this.measureIndexInCycle = 0;
        }
      }
    }
  }

  updateCircleUI(phase) {
    const labBtn = document.getElementById('metroCircleBtn');
    const labIcn = document.getElementById('metroCircleIcon');
    const playBtn = document.getElementById('playMetroCircleBtn');
    const playIcn = document.getElementById('playMetroCircleIcon');

    if (labBtn && labIcn) {
      labBtn.className = 'metro-circle-btn';
      if (phase === 'idle') {
        labBtn.classList.add('circle-idle');
        labIcn.innerText = '▶';
      } else if (phase === 'leadin') {
        labBtn.classList.add('circle-leadin');
        labIcn.innerText = '⏸';
      } else if (phase === 'goal') {
        labBtn.classList.add('circle-playing');
        labIcn.innerText = '🏆';
      } else {
        labBtn.classList.add('circle-playing');
        labIcn.innerText = '⏸';
      }
    }

    if (playBtn && playIcn) {
      playBtn.className = 'metro-circle-btn play-metro-circle';
      if (this.isRunning && this.activeMode === 'play') {
        playBtn.classList.add('circle-playing');
        playIcn.innerText = '⏸';
      } else {
        playBtn.classList.add('circle-idle');
        playIcn.innerText = '▶';
      }
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