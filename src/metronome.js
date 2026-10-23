class MetronomeController {
  constructor() {
    this.audioCtx = null;
    this.isRunning = false;
    this.activeMode = 'play'; // 'play' | 'lab'

    // ==========================================================
    // VOLBA ZVUKU A AKCENTU
    // ==========================================================
    this.soundType = 'woodblock'; // 'woodblock', 'beep', 'click', 'rimshot'
    this.accentEnabled = true;

    // ==========================================================
    // SAMOSTATNÉ PARAMETRY PRO REŽIM HRANÍ
    // ==========================================================
    this.playStartBpm = 60;
    this.playTargetBpm = 60; // Výchozí: Cíl = Start (rovnoměrný běh)
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
      const st = Math.max(this.audioCtx.currentTime, time);
      const isAcc = isAccent && this.accentEnabled;

      if (this.soundType === 'woodblock') {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        let freq = isLeadIn ? (isAcc ? 1400 : 1000) : (isAcc ? 1050 : 720);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, st);

        gain.gain.setValueAtTime(0.0001, st);
        gain.gain.exponentialRampToValueAtTime(isAcc ? 1.0 : 0.65, st + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, st + 0.045);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start(st);
        osc.stop(st + 0.05);

      } else if (this.soundType === 'beep') {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        let freq = isLeadIn ? (isAcc ? 1500 : 1100) : (isAcc ? 1200 : 800);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, st);

        gain.gain.setValueAtTime(0.0001, st);
        gain.gain.exponentialRampToValueAtTime(isAcc ? 0.9 : 0.55, st + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, st + 0.05);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start(st);
        osc.stop(st + 0.055);

      } else if (this.soundType === 'click') {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        let freq = isLeadIn ? (isAcc ? 2600 : 2000) : (isAcc ? 2200 : 1600);
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, st);

        gain.gain.setValueAtTime(0.0001, st);
        gain.gain.exponentialRampToValueAtTime(isAcc ? 0.8 : 0.45, st + 0.001);
        gain.gain.exponentialRampToValueAtTime(0.0001, st + 0.02);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start(st);
        osc.stop(st + 0.025);

      } else if (this.soundType === 'rimshot') {
        const bufferSize = Math.floor(this.audioCtx.sampleRate * 0.035);
        const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

        const noise = this.audioCtx.createBufferSource();
        noise.buffer = buffer;
        const filter = this.audioCtx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(isAcc ? 1600 : 2400, st);

        const gain = this.audioCtx.createGain();
        gain.gain.setValueAtTime(0.0001, st);
        gain.gain.exponentialRampToValueAtTime(isAcc ? 1.0 : 0.5, st + 0.001);
        gain.gain.exponentialRampToValueAtTime(0.0001, st + 0.035);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.audioCtx.destination);
        noise.start(st);
        noise.stop(st + 0.04);
      }
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
      this.updateLabSummaryUI();
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
    if (this.playTargetBpm <= this.playStartBpm) {
      this.playTargetBpm = this.playStartBpm;
    }

    if (this.isRunning && this.activeMode === 'play') {
      this.currentBpm = this.playStartBpm;
    } else {
      this.playCurrentBpm = this.playStartBpm;
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

    const btn = document.getElementById('playMatchTargetBtn');
    if (btn) {
      btn.innerText = '✔ Rovnoměrně aktivní';
      setTimeout(() => { btn.innerText = 'Rovnoměrně'; }, 1500);
    }
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

  // ==========================================================
  // METODY REŽIMU LABORATOŘ (Nezávislé na Hraní)
  // ==========================================================
  onStartBpmInput(val) {
    this.labStartBpm = Math.max(30, Math.min(260, Number(val) || 60));
    const lbl = document.getElementById('metroStartVal');
    if (lbl) lbl.innerText = this.labStartBpm;

    if (!this.isRunning && this.detectCurrentMode() === 'lab') {
      this.updateLabTempoUI(this.labStartBpm);
      this.updateLabSummaryUI();
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
    this.labTargetBpm = Math.max(30, Math.min(260, Number(val) || 100));
    const lbl = document.getElementById('metroTargetVal');
    if (lbl) lbl.innerText = this.labTargetBpm;
    this.updateLabTargetDisplay(this.labTargetBpm);
    this.updateLabSummaryUI();
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
    const d2 = document.getElementById('labMetroBpmDisplay');
    if (d2) d2.innerText = bpm;
  }

  resetTempo() {
    const startSlider = document.getElementById('metroStartBpm');
    const startVal = startSlider ? Number(startSlider.value) : this.labStartBpm;
    this.labCurrentBpm = startVal;
    this.updateLabTempoUI(startVal);
    this.updateLabSummaryUI();
  }

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
    this.updateLabSummaryUI();
  }

  // ==========================================================
  // OVLÁDÁNÍ VÝSUVNÉHO SPODNÍHO PANELU (BOTTOM SHEET)
  // ==========================================================
  openSheet() {
    const sheet = document.getElementById('metroBottomSheet');
    if (!sheet) return;
    sheet.style.display = 'flex';

    this.activeMode = this.detectCurrentMode();
    const isLab = (this.activeMode === 'lab');

    const startBpm = isLab ? this.labStartBpm : this.playStartBpm;
    const targetBpm = isLab ? this.labTargetBpm : this.playTargetBpm;
    const barsCount = isLab ? this.labBarsCount : this.playBarsCount;

    const startValEl = document.getElementById('sheetStartVal');
    if (startValEl) startValEl.innerText = startBpm;
    const startSlider = document.getElementById('sheetStartSlider');
    if (startSlider) startSlider.value = startBpm;

    const targetValEl = document.getElementById('sheetTargetVal');
    if (targetValEl) targetValEl.innerText = targetBpm;
    const targetSlider = document.getElementById('sheetTargetSlider');
    if (targetSlider) targetSlider.value = targetBpm;

    const measuresValEl = document.getElementById('sheetMeasuresVal');
    if (measuresValEl) measuresValEl.innerText = `${barsCount} ${barsCount === 1 ? 'takt' : (barsCount < 5 ? 'takty' : 'taktů')}`;

    this.updateSheetSelectors();
    this.updateLabSummaryUI();
  }

  closeSheet() {
    const sheet = document.getElementById('metroBottomSheet');
    if (sheet) sheet.style.display = 'none';
  }

  onSheetStartInput(val) {
    const bpm = Math.max(30, Math.min(260, Number(val) || 60));
    const isLab = (this.detectCurrentMode() === 'lab');

    if (isLab) {
      this.onStartBpmInput(bpm);
    } else {
      this.setPlayBpm(bpm);
    }

    const sheetLbl = document.getElementById('sheetStartVal');
    if (sheetLbl) sheetLbl.innerText = bpm;
    const sheetSlider = document.getElementById('sheetStartSlider');
    if (sheetSlider && Number(sheetSlider.value) !== bpm) sheetSlider.value = bpm;
  }

  adjustSheetStart(delta) {
    const isLab = (this.detectCurrentMode() === 'lab');
    const cur = isLab ? this.labStartBpm : this.playStartBpm;
    this.onSheetStartInput(cur + delta);
  }

  onSheetTargetInput(val) {
    const bpm = Math.max(30, Math.min(260, Number(val) || 100));
    const isLab = (this.detectCurrentMode() === 'lab');

    if (isLab) {
      this.onTargetBpmInput(bpm);
    } else {
      this.onPlayTargetInput(bpm);
    }

    const sheetLbl = document.getElementById('sheetTargetVal');
    if (sheetLbl) sheetLbl.innerText = bpm;
    const sheetSlider = document.getElementById('sheetTargetSlider');
    if (sheetSlider && Number(sheetSlider.value) !== bpm) sheetSlider.value = bpm;
  }

  adjustSheetTarget(delta) {
    const isLab = (this.detectCurrentMode() === 'lab');
    const cur = isLab ? this.labTargetBpm : this.playTargetBpm;
    this.onSheetTargetInput(cur + delta);
  }

  matchSheetTargetToStart() {
    const isLab = (this.detectCurrentMode() === 'lab');
    const startBpm = isLab ? this.labStartBpm : this.playStartBpm;
    this.onSheetTargetInput(startBpm);
  }

  setStepBpm(step) {
    const s = Math.max(1, Math.min(20, Number(step) || 2));
    const isLab = (this.detectCurrentMode() === 'lab');
    if (isLab) {
      this.labStepBpm = s;
      const inp = document.getElementById('metroStepBpm');
      if (inp) inp.value = s;
    } else {
      this.playStepBpm = s;
      const inp = document.getElementById('playStepBpm');
      if (inp) inp.value = s;
    }
    this.updateSheetSelectors();
    this.updateLabSummaryUI();
  }

  stepMeasures(delta) {
    const isLab = (this.detectCurrentMode() === 'lab');
    let bars = isLab ? this.labBarsCount : this.playBarsCount;
    bars = Math.max(1, Math.min(64, bars + delta));
    if (isLab) {
      this.labBarsCount = bars;
      const inp = document.getElementById('metroBarsCount');
      if (inp) inp.value = bars;
    } else {
      this.playBarsCount = bars;
      const inp = document.getElementById('playBarsCount');
      if (inp) inp.value = bars;
    }
    const measuresValEl = document.getElementById('sheetMeasuresVal');
    if (measuresValEl) measuresValEl.innerText = `${bars} ${bars === 1 ? 'takt' : (bars < 5 ? 'takty' : 'taktů')}`;
    this.updateLabSummaryUI();
  }

  setBeats(count) {
    const b = Math.max(1, Math.min(16, Number(count) || 4));
    const isLab = (this.detectCurrentMode() === 'lab');
    if (isLab) {
      this.labBeats = b;
      const inp = document.getElementById('metroBeatsPerBar');
      if (inp) inp.value = b;
    } else {
      this.playBeats = b;
      const sel = document.getElementById('playMetroBeatsSelect');
      if (sel) sel.value = String(b);
    }
    if (this.isRunning) {
      this.beatsPerBar = b;
      this.beatIndex = 0;
    }
    this.updateSheetSelectors();
    this.updateLabSummaryUI();
  }

  setSoundType(sound) {
    this.soundType = sound;
    this.updateSheetSelectors();
    this.initAudio();
    this.playClickSound(this.audioCtx.currentTime + 0.05, true, false);
  }

  toggleAccent() {
    this.accentEnabled = !this.accentEnabled;
    this.updateSheetSelectors();
    this.initAudio();
    this.playClickSound(this.audioCtx.currentTime + 0.05, this.accentEnabled, false);
  }

  updateLabSummaryUI() {
    const sStart = document.getElementById('labSumStart');
    if (sStart) sStart.innerText = `Start: ${this.labStartBpm}`;

    const sTarget = document.getElementById('labSumTarget');
    if (sTarget) sTarget.innerText = `🎯 Cíl: ${this.labTargetBpm}`;

    const sStep = document.getElementById('labSumStep');
    if (sStep) sStep.innerText = `+${this.labStepBpm} BPM`;

    const sBars = document.getElementById('labSumBars');
    if (sBars) sBars.innerText = `po ${this.labBarsCount} ${this.labBarsCount === 1 ? 't.' : 't.'}`;

    const sBeats = document.getElementById('labSumBeats');
    if (sBeats) sBeats.innerText = `${this.labBeats} ${this.labBeats === 1 ? 'doba' : (this.labBeats < 5 ? 'doby' : 'dob')}`;
  }

  updateSheetSelectors() {
    const isLab = (this.detectCurrentMode() === 'lab');
    const curBeats = isLab ? this.labBeats : this.playBeats;
    const curStep = isLab ? this.labStepBpm : this.playStepBpm;

    document.querySelectorAll('#beatsPillGroup .pill-btn').forEach(b => {
      b.classList.toggle('active', b.innerText === String(curBeats));
    });
    document.querySelectorAll('#stepPillGroup .pill-btn').forEach(b => {
      b.classList.toggle('active', b.innerText === `+${curStep}`);
    });
    document.querySelectorAll('#soundPillGroup .pill-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.sound === this.soundType);
    });
    const accBtn = document.getElementById('sheetAccentBtn');
    if (accBtn) {
      accBtn.innerText = this.accentEnabled ? '🔔 Akcent ZAP' : '🔕 Bez akcentu';
      accBtn.classList.toggle('active', this.accentEnabled);
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

    // 1. REŽIM HRANÍ:
    if (this.activeMode === 'play') {
      this.nextBeatTime += (60.0 / this.currentBpm);
      this.beatIndex++;

      if (this.beatIndex >= beats) {
        this.beatIndex = 0;
        if (this.playTargetBpm > this.playStartBpm) {
          if (this.currentBpm < this.playTargetBpm) {
            this.measureIndexInCycle++;
            if (this.measureIndexInCycle >= this.playBarsCount) {
              this.currentBpm = Math.min(this.playTargetBpm, this.currentBpm + this.playStepBpm);
              this.measureIndexInCycle = 0;
              const tText = document.getElementById('playMetroBpmText');
              if (tText) tText.innerText = this.currentBpm;
            }
          } else {
            // Cíl splněn i v Hraní
            this.measureIndexInCycle++;
            if (this.measureIndexInCycle >= this.playBarsCount) {
              const finishTime = this.nextBeatTime;
              const delayMs = Math.max(0, (finishTime - this.audioCtx.currentTime) * 1000);

              this.isRunning = false;
              if (this.timerId) clearInterval(this.timerId);
              this.timerId = null;

              this.playCelebratoryChord(finishTime);

              setTimeout(() => {
                this.updateCircleUI('goal');
              }, delayMs);
              return;
            }
          }
        } else {
          // Rovnoměrný běh: drží stále stejné tempo bez počítání cyklů
          this.currentBpm = this.playStartBpm;
          this.measureIndexInCycle = 0;
        }
      }
      return;
    }

    // 2. REŽIM LABORATOŘ:
    const targetBpm = this.labTargetBpm;
    const step = this.labStepBpm;
    const bars = this.labBarsCount;

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
            // CÍL DOSAŽEN! OSLAVA:
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
      playBtn.className = 'metro-circle-btn';
      if (phase === 'goal') {
        playBtn.classList.add('circle-playing');
        playIcn.innerText = '🏆';
      } else if (this.isRunning && this.activeMode === 'play') {
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