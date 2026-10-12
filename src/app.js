if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

function compareMusicPosition(a, b) {
  const pageA = a.page || 1;
  const pageB = b.page || 1;
  if (pageA !== pageB) return pageA - pageB;
  const avgH = (a.box.height + b.box.height) / 2;
  const rowDiff = a.box.top - b.box.top;
  if (Math.abs(rowDiff) > avgH * 0.55) return rowDiff;
  return a.box.left - b.box.left;
}

async function processAndEnhancePhoto(file, maxDim = 2400) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; } 
        else { w = Math.round((w * maxDim) / h); h = maxDim; }
      }
      const cvs = document.createElement('canvas');
      cvs.width = w; cvs.height = h;
      const ctx = cvs.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h);
      const d = data.data;
      let sum = 0, c = 0;
      for (let i = 0; i < d.length; i += 64) { sum += d[i]*0.299 + d[i+1]*0.587 + d[i+2]*0.114; c++; }
      const avg = c > 0 ? sum / c : 200;
      const wp = Math.min(255, Math.max(160, avg * 0.92));
      const bp = 75;
      for (let i = 0; i < d.length; i += 4) {
        let lum = d[i]*0.299 + d[i+1]*0.587 + d[i+2]*0.114;
        let e = lum >= wp ? 255 : (lum <= bp ? 0 : Math.round(((lum - bp)/(wp - bp))*255));
        d[i] = d[i+1] = d[i+2] = e;
      }
      ctx.putImageData(data, 0, 0);
      resolve(cvs.toDataURL('image/jpeg', 0.90));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function scanStaffAndBarlinesFromCanvas(sourceCanvas, clickX, clickY) {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const ctx = sourceCanvas.getContext('2d');
  const scanTop = Math.max(0, Math.floor(clickY - 250));
  const scanH = Math.min(height - scanTop, 500);
  const imgData = ctx.getImageData(0, scanTop, width, scanH);
  const data = imgData.data;

  let sumB = 0, countSample = 0;
  for (let y = 0; y < scanH; y += 8) {
    for (let x = Math.max(0, clickX - 120); x < Math.min(width, clickX + 120); x += 8) {
      const idx = (y * width + Math.floor(x)) * 4;
      sumB += (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      countSample++;
    }
  }
  const bgBright = countSample > 0 ? (sumB / countSample) : 240;
  const darkThreshold = Math.min(145, Math.max(65, bgBright * 0.70));

  const isDarkRel = (x, localY) => {
    if (x < 0 || x >= width || localY < 0 || localY >= scanH) return false;
    const idx = (localY * width + Math.floor(x)) * 4;
    return (data[idx] + data[idx + 1] + data[idx + 2]) / 3 < darkThreshold;
  };

  const getHWidth = (x, localY, maxDist = 35) => {
    if (!isDarkRel(x, localY)) return 0;
    let l = 0; while (l < maxDist && isDarkRel(x - l - 1, localY)) l++;
    let r = 0; while (r < maxDist && isDarkRel(x + r + 1, localY)) r++;
    return l + r + 1;
  };

  const sampleLeft = Math.max(0, Math.floor(clickX - 160));
  const sampleRight = Math.min(width, Math.floor(clickX + 160));
  const minLineFill = (sampleRight - sampleLeft) * 0.35;

  const lineBlocks = [];
  let currentBlock = [];
  for (let y = 0; y < scanH; y++) {
    let darkCount = 0;
    for (let x = sampleLeft; x < sampleRight; x++) { if (isDarkRel(x, y)) darkCount++; }
    if (darkCount >= minLineFill) {
      currentBlock.push(y);
    } else {
      if (currentBlock.length > 0) {
        lineBlocks.push(Math.round(currentBlock.reduce((a, b) => a + b, 0) / currentBlock.length));
        currentBlock = [];
      }
    }
  }
  if (currentBlock.length > 0) lineBlocks.push(Math.round(currentBlock.reduce((a, b) => a + b, 0) / currentBlock.length));

  const lineRows = lineBlocks.map(y => y + scanTop);
  let currentStaff = null;
  for (let i = 0; i <= lineRows.length - 5; i++) {
    const group = lineRows.slice(i, i + 5);
    const spacings = [group[1]-group[0], group[2]-group[1], group[3]-group[2], group[4]-group[3]];
    const avgSpacing = spacings.reduce((a, b) => a + b) / 4;
    const isUniform = spacings.every(s => Math.abs(s - avgSpacing) <= 5 && s >= 4 && s <= 45);
    if (isUniform && clickY >= group[0] - 45 && clickY <= group[4] + 45) {
      currentStaff = { top: group[0], bottom: group[4], height: group[4] - group[0], lines: group, spacing: avgSpacing };
      break;
    }
  }

  if (!currentStaff) {
    return { isBarLine: () => false, box: { left: Math.max(0, Math.floor(clickX - 80)), top: Math.max(0, Math.floor(clickY - 50)), width: 160, height: 100 } };
  }

  const staffTopRel = currentStaff.top - scanTop;
  const staffBottomRel = currentStaff.bottom - scanTop;
  const linesRel = currentStaff.lines.map(y => y - scanTop);
  const spacing = currentStaff.spacing;

  const isBarLine = (col) => {
    let gapsPassed = 0;
    for (let i = 0; i < 4; i++) {
      let gapDark = 0, gapH = linesRel[i+1] - linesRel[i] + 1;
      for (let y = linesRel[i]; y <= linesRel[i+1]; y++) {
        if (isDarkRel(col, y) || isDarkRel(col-1, y) || isDarkRel(col+1, y)) gapDark++;
      }
      if (gapDark / gapH >= 0.60) gapsPassed++;
    }
    if (gapsPassed < 4) return false;
    
    const maxOvershoot = Math.max(4, Math.floor(spacing * 0.70));
    let oUp = 0; for (let y = staffTopRel-1; y >= Math.max(0, staffTopRel - spacing*2.5); y--) { if (isDarkRel(col, y) || isDarkRel(col-1, y) || isDarkRel(col+1, y)) oUp++; else break; }
    if (oUp > maxOvershoot) return false;
    
    let oDown = 0; for (let y = staffBottomRel+1; y <= Math.min(scanH-1, staffBottomRel + spacing*2.5); y++) { if (isDarkRel(col, y) || isDarkRel(col-1, y) || isDarkRel(col+1, y)) oDown++; else break; }
    if (oDown > maxOvershoot) return false;
    
    const minW = Math.max(6, Math.floor(spacing * 0.65));
    for (const testY of [Math.round(staffTopRel + spacing*0.45), Math.round(linesRel[1] + spacing*0.5), Math.round(linesRel[2] + spacing*0.5), Math.round(staffBottomRel - spacing*0.45)]) {
      if (getHWidth(col, testY) >= minW) return false;
    }
    return true;
  };

  let leftX = Math.floor(clickX) - 5;
  for (let x = leftX; x >= Math.max(0, clickX - spacing * 18); x--) {
    if (isBarLine(x)) { leftX = x; break; }
  }
  let rightX = Math.floor(clickX) + 5;
  for (let x = rightX; x <= Math.min(width, clickX + spacing * 18); x++) {
    if (isBarLine(x)) { rightX = x; break; }
  }

  const gapMargin = Math.round(currentStaff.height * 0.65);
  return {
    isBarLine,
    box: { left: leftX, top: Math.max(0, currentStaff.top - gapMargin), width: Math.max(30, rightX - leftX), height: Math.max(30, (currentStaff.bottom + gapMargin) - Math.max(0, currentStaff.top - gapMargin)) }
  };
}

class MeasureBoxEditor {
  constructor(canvas, renderCallback, initialBox, onUpdate, isBarLineFn) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.renderCallback = renderCallback; this.box = { ...initialBox };
    this.isBarLineFn = isBarLineFn;
    this.touchTolerance = 36; this.activeAction = null; this.dragStart = { x: 0, y: 0 };
    this.loupeEl = document.getElementById('touchLoupe');
    this.loupeCanvas = document.getElementById('loupeCanvas');
    this.loupeCtx = this.loupeCanvas ? this.loupeCanvas.getContext('2d') : null;
    this.render();
  }

  hitTest(x, y, tol) {
    const b = this.box, r = b.left + b.width, bot = b.top + b.height;
    if (Math.abs(x - b.left) <= tol && Math.abs(y - b.top) <= tol) return 'corner-tl';
    if (Math.abs(x - r) <= tol && Math.abs(y - b.top) <= tol) return 'corner-tr';
    if (Math.abs(x - b.left) <= tol && Math.abs(y - bot) <= tol) return 'corner-bl';
    if (Math.abs(x - r) <= tol && Math.abs(y - bot) <= tol) return 'corner-br';
    if (Math.abs(x - b.left) <= tol && y >= b.top - tol && y <= bot + tol) return 'left';
    if (Math.abs(x - r) <= tol && y >= b.top - tol && y <= bot + tol) return 'right';
    if (Math.abs(y - b.top) <= tol && x >= b.left - tol && x <= r + tol) return 'top';
    if (Math.abs(y - bot) <= tol && x >= b.left - tol && x <= r + tol) return 'bottom';
    if (x > b.left && x < r && y > b.top && y < bot) return 'drag';
    return null;
  }

  startDrag(action, x, y, cx, cy) {
    this.activeAction = action; this.dragStart = { x, y }; this.initBox = { ...this.box };
    if (action !== 'drag') this.updateLoupe(cx, cy, x, y);
  }

  moveDrag(x, y, cx, cy) {
    if (!this.activeAction) return;
    const dx = x - this.dragStart.x, dy = y - this.dragStart.y, init = this.initBox;
    switch (this.activeAction) {
      case 'drag': this.box.left = Math.max(0, init.left + dx); this.box.top = Math.max(0, init.top + dy); break;
      case 'left': case 'corner-tl': case 'corner-bl':
        const nL = Math.min(init.left + dx, init.left + init.width - 20);
        this.box.left = Math.max(0, nL); this.box.width = init.width - (this.box.left - init.left);
        if (this.activeAction === 'corner-tl') { this.box.top = Math.max(0, Math.min(init.top + dy, init.top + init.height - 20)); this.box.height = init.height - (this.box.top - init.top); }
        else if (this.activeAction === 'corner-bl') this.box.height = Math.max(20, init.height + dy);
        break;
      case 'right': case 'corner-tr': case 'corner-br':
        this.box.width = Math.max(20, init.width + dx);
        if (this.activeAction === 'corner-tr') { this.box.top = Math.max(0, Math.min(init.top + dy, init.top + init.height - 20)); this.box.height = init.height - (this.box.top - init.top); }
        else if (this.activeAction === 'corner-br') this.box.height = Math.max(20, init.height + dy);
        break;
      case 'top': this.box.top = Math.max(0, Math.min(init.top + dy, init.top + init.height - 20)); this.box.height = init.height - (this.box.top - init.top); break;
      case 'bottom': this.box.height = Math.max(20, init.height + dy); break;
    }
    this.render();
    if (this.activeAction !== 'drag') {
      const tx = this.activeAction.includes('left') ? this.box.left : (this.box.left + this.box.width);
      this.updateLoupe(cx, cy, tx, y);
    }
  }

  endDrag() { this.activeAction = null; if (this.loupeEl) this.loupeEl.style.display = 'none'; }
  destroy() { if (this.loupeEl) this.loupeEl.style.display = 'none'; }

  updateLoupe(cx, cy, tx, ty) {
    if (!this.loupeEl || !this.loupeCtx) return;
    this.loupeEl.style.display = 'block'; this.loupeEl.style.left = cx + 'px'; this.loupeEl.style.top = cy + 'px';
    const lw = this.loupeCanvas.width, lh = this.loupeCanvas.height, z = 2.0, cw = lw/z, ch = lh/z;
    const sx = Math.max(0, Math.min(this.canvas.width - cw, tx - cw/2));
    const sy = Math.max(0, Math.min(this.canvas.height - ch, ty - ch/2));
    this.loupeCtx.clearRect(0,0,lw,lh); this.loupeCtx.drawImage(this.canvas, sx, sy, cw, ch, 0, 0, lw, lh);
    this.loupeCtx.strokeStyle = 'rgba(239,68,68,0.9)'; this.loupeCtx.lineWidth = 2;
    this.loupeCtx.beginPath(); this.loupeCtx.moveTo(lw/2, 0); this.loupeCtx.lineTo(lw/2, lh); this.loupeCtx.stroke();
  }

  expandMeasure(dir) {
    const step = 8;
    if (dir === 'right') {
      const curR = Math.floor(this.box.left + this.box.width); let f = false;
      if (this.isBarLineFn) {
        for (let x = curR + step; x < this.canvas.width; x++) {
          if (this.isBarLineFn(x)) { this.box.width = x - this.box.left; f = true; break; }
        }
      }
      if (!f) this.box.width += 140;
    } else {
      const curL = Math.floor(this.box.left); let f = false;
      if (this.isBarLineFn) {
        for (let x = curL - step; x >= 0; x--) {
          if (this.isBarLineFn(x)) { this.box.width += (this.box.left - x); this.box.left = x; f = true; break; }
        }
      }
      if (!f) { const nL = Math.max(0, this.box.left - 140); this.box.width += (this.box.left - nL); this.box.left = nL; }
    }
    this.render();
  }

  render() {
    this.renderCallback();
    const c = this.ctx; c.save();
    c.fillStyle = 'rgba(37, 99, 235, 0.22)'; c.fillRect(this.box.left, this.box.top, this.box.width, this.box.height);
    c.strokeStyle = '#1d4ed8'; c.lineWidth = 4; c.strokeRect(this.box.left, this.box.top, this.box.width, this.box.height);
    c.fillStyle = '#ffffff'; c.lineWidth = 3.5;
    const hs = [ {x:this.box.left+this.box.width/2, y:this.box.top}, {x:this.box.left+this.box.width/2, y:this.box.top+this.box.height}, {x:this.box.left, y:this.box.top+this.box.height/2}, {x:this.box.left+this.box.width, y:this.box.top+this.box.height/2}, {x:this.box.left, y:this.box.top}, {x:this.box.left+this.box.width, y:this.box.top}, {x:this.box.left, y:this.box.top+this.box.height}, {x:this.box.left+this.box.width, y:this.box.top+this.box.height} ];
    hs.forEach(h => { c.beginPath(); c.arc(h.x, h.y, 9.5, 0, Math.PI*2); c.fill(); c.stroke(); });
    c.restore();
  }
}

class GuitarTrainer {
  constructor() {
    this.scoreCanvas = document.getElementById('scoreCanvas');
    this.scoreCtx = this.scoreCanvas ? this.scoreCanvas.getContext('2d') : null;
    this.canvasBox = document.getElementById('canvasBox');
    this.canvasViewport = document.getElementById('canvasViewport');

    this.labCanvas = document.getElementById('labCanvas');
    this.labCtx = this.labCanvas ? this.labCanvas.getContext('2d') : null;

    this.currentScore = null;
    this.pdfDoc = null;
    this.pageCache = new Map();
    this.currentPage = 1;
    this.totalPages = 1;

    this.activeEditor = null;
    this.labCurrentIndex = 0;
    this.labContext = 'solo';
    this.isMarkingMode = false; // Výchozí: Hraní / listování stránkami

    this.zoomScale = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.activeType = null;
    this.editingId = null;

    // Metronome
    this.audioCtx = null;
    this.isMetroRunning = false;
    this.metroCurrentBpm = 60;
    this.metroPhase = 'idle';
    this.metroBeatIndex = 0;
    this.metroMeasureIndexInCycle = 0;
    this.metroNextBeatTime = 0;
    this.metroTimerId = null;
    this.lookaheadMs = 25;
    this.scheduleAheadSec = 0.12;

    this.initLibrary();
    this.initTouchEngine();
  }

  // --- FULLSCREEN A PŘEPÍNAČ REŽIMU ---
  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    }
    setTimeout(() => this.fitCanvasToScreen(), 150);
  }

  toggleInteractionMode() {
    this.isMarkingMode = !this.isMarkingMode;
    const btn = document.getElementById('toggleInteractionBtn');
    const zLeft = document.getElementById('zoneLeft');
    const zRight = document.getElementById('zoneRight');

    if (this.isMarkingMode) {
      if (btn) {
        btn.innerText = '✏ Značkování taktů';
        btn.className = 'btn btn-gold';
      }
      if (zLeft) zLeft.style.display = 'none';
      if (zRight) zRight.style.display = 'none';
    } else {
      if (btn) {
        btn.innerText = '📖 Hraní (listování)';
        btn.className = 'btn btn-accent';
      }
      if (zLeft) zLeft.style.display = 'block';
      if (zRight) zRight.style.display = 'block';
      this.resetActiveSelection();
    }
  }

  // --- AUDIO A METRONOM ---
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

      osc.connect(gain); gain.connect(this.audioCtx.destination);
      osc.start(st); osc.stop(st + 0.05);
    } catch (_) {}
  }

  async toggleIncrementalMetronome() {
    if (this.isMetroRunning) this.stopMetronome();
    else await this.startIncrementalMetronome();
  }

  async startIncrementalMetronome() {
    await this.initAudio();
    if (window.wakeLockManager) try { await window.wakeLockManager.request(); } catch (_) {}

    this.metroCurrentBpm = Number(document.getElementById('metroStartBpm')?.value) || 60;
    this.isMetroRunning = true;
    this.metroPhase = 'leadin';
    this.metroBeatIndex = 0;
    this.metroMeasureIndexInCycle = 0;

    const curText = document.getElementById('metroCurrentBpmText');
    if (curText) curText.innerText = this.metroCurrentBpm;

    this.metroNextBeatTime = this.audioCtx.currentTime + 0.05;
    this.metroTimerId = setInterval(() => this.schedulerLoop(), this.lookaheadMs);
  }

  stopMetronome() {
    this.isMetroRunning = false;
    if (this.metroTimerId) clearInterval(this.metroTimerId);
    this.metroTimerId = null;
    this.metroPhase = 'idle';
    this.metroBeatIndex = 0;
    this.clearBeatLights();
    this.updateCircleUI('idle');
  }

  resetMetronomeTempo() {
    this.metroCurrentBpm = Number(document.getElementById('metroStartBpm')?.value) || 60;
    const curText = document.getElementById('metroCurrentBpmText');
    if (curText) curText.innerText = this.metroCurrentBpm;
  }

  schedulerLoop() {
    if (!this.audioCtx || !this.isMetroRunning) return;
    while (this.metroNextBeatTime < this.audioCtx.currentTime + this.scheduleAheadSec) {
      this.scheduleCurrentBeat(this.metroNextBeatTime);
      this.advanceBeat();
    }
  }

  scheduleCurrentBeat(time) {
    const beatsPerBar = Number(document.getElementById('metroBeatsPerBar')?.value) || 4;
    const isAccent = (this.metroBeatIndex === 0);
    const scheduledBeat = this.metroBeatIndex;
    const scheduledPhase = this.metroPhase;
    const scheduledBpm = this.metroCurrentBpm;

    this.playClickSound(time, isAccent, scheduledPhase === 'leadin');

    const delayMs = Math.max(0, (time - this.audioCtx.currentTime) * 1000);
    setTimeout(() => {
      if (!this.isMetroRunning) return;
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

    this.metroNextBeatTime += (60.0 / this.metroCurrentBpm);
    this.metroBeatIndex++;

    if (this.metroBeatIndex >= beats) {
      this.metroBeatIndex = 0;
      if (this.metroPhase === 'leadin') {
        this.metroPhase = 'playing';
        this.metroMeasureIndexInCycle = 0;
      } else if (this.metroPhase === 'playing') {
        this.metroMeasureIndexInCycle++;
        if (this.metroMeasureIndexInCycle >= bars) {
          if (this.metroCurrentBpm < targetBpm) {
            this.metroCurrentBpm = Math.min(targetBpm, this.metroCurrentBpm + step);
            this.metroPhase = 'leadin';
          } else {
            this.metroPhase = 'goal';
          }
          this.metroMeasureIndexInCycle = 0;
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

  // --- KNIHOVNA & DOKUMENTY ---
  async initLibrary() {
    try {
      const all = await window.scoreDB.getAllScores();
      const span = document.getElementById('libCountSpan');
      if (span) span.innerText = all.length;
      this.renderLibraryList(all);
      if (all.length > 0) {
        all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        await this.loadScore(all[0].id, false);
      }
    } catch (_) {}
  }

  renderLibraryList(all) {
    const listEl = document.getElementById('libraryList');
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!all || all.length === 0) {
      listEl.innerHTML = '<div style="color:var(--text-muted); padding:16px; text-align:center;">V zařízení zatím nemáte žádné noty. Vyfoťte je ze stojanu nebo nahrajte soubor.</div>';
      return;
    }
    all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    all.forEach(s => {
      const item = document.createElement('div');
      item.className = 'library-item' + (this.currentScore?.id === s.id ? ' active' : '');
      item.onclick = () => this.loadScore(s.id, true);
      const pg = s.isPdf ? 'PDF' : `${(s.pages || [1]).length} str.`;
      item.innerHTML = `<div class="library-info"><div class="library-name">${s.name}</div><div class="library-meta">${pg} • V Laboratoři: ${(s.measures || []).length}</div></div><button class="btn btn-danger btn-sm" onclick="window.app.deleteScoreFromLibrary('${s.id}', event)">Smazat</button>`;
      listEl.appendChild(item);
    });
  }

  async loadScore(id, switchTab = true) {
    const score = await window.scoreDB.getScore(id);
    if (!score) return;
    this.stopMetronome();
    this.currentScore = score;
    this.currentPage = 1;
    this.pageCache.clear();
    this.resetActiveSelection();

    if (score.isPdf && score.pdfData) {
      try {
        const copy = new Uint8Array(score.pdfData.slice(0));
        this.pdfDoc = await pdfjsLib.getDocument({ data: copy }).promise;
        this.totalPages = this.pdfDoc.numPages;
      } catch (_) { this.totalPages = 1; }
    } else {
      this.totalPages = (score.pages?.length > 0) ? score.pages.length : 1;
    }

    const t1 = document.getElementById('scoreTitleDisplay');
    if (t1) t1.innerText = score.name || 'Skladba';
    const t2 = document.getElementById('labSongTitle');
    if (t2) t2.innerText = score.name || 'Skladba';

    const banner = document.getElementById('activeFileBanner');
    if (banner) banner.style.display = 'flex';
    
    const crop = document.getElementById('cropPaperBtn');
    if (crop) crop.style.display = score.isPdf ? 'none' : 'inline-flex';

    this.updateLabBadge();
    this.updateUI();

    if (switchTab) switchMode('edit');

    this.updatePageSwitcherUI();
    await this.renderCurrentPage();
    this.fitCanvasToScreen();
    
    const all = await window.scoreDB.getAllScores();
    this.renderLibraryList(all);
  }

  async saveNewScoreToLibrary(name, dataObj) {
    const id = 'score_' + Date.now();
    const score = { id, name, isPdf: dataObj.isPdf, pdfData: dataObj.pdfData || null, imageData: dataObj.imageData || null, pages: dataObj.pages || [dataObj.imageData], measures: [], keySignatures: [], updatedAt: Date.now() };
    await window.scoreDB.saveScore(score);
    await this.loadScore(id, true);
  }

  async deleteScoreFromLibrary(id, e) {
    if (e) e.stopPropagation();
    if (confirm('Opravdu smazat skladbu?')) {
      await window.scoreDB.deleteScore(id);
      const all = await window.scoreDB.getAllScores();
      const countEl = document.getElementById('libCountSpan');
      if (countEl) countEl.innerText = all.length;
      if (this.currentScore?.id === id) {
        if (all.length > 0) {
          await this.loadScore(all[0].id, false);
        } else {
          this.currentScore = null;
          this.pageCache.clear();
          if (this.scoreCtx) this.scoreCtx.clearRect(0,0,this.scoreCanvas.width,this.scoreCanvas.height);
          const b = document.getElementById('activeFileBanner');
          if (b) b.style.display = 'none';
        }
      }
      this.renderLibraryList(all);
    }
  }

  async renameCurrentScore() {
    if (!this.currentScore) {
      alert('Nejprve vyberte skladbu.');
      return;
    }
    const currentName = this.currentScore.name || 'Skladba';
    const newName = window.prompt('Zadejte nový název:', currentName);
    if (newName && newName.trim() && newName.trim() !== currentName) {
      this.currentScore.name = newName.trim();
      const t1 = document.getElementById('scoreTitleDisplay');
      if (t1) t1.innerText = this.currentScore.name;
      const t2 = document.getElementById('labSongTitle');
      if (t2) t2.innerText = this.currentScore.name;
      await this.persistCurrentScore();
      const all = await window.scoreDB.getAllScores();
      this.renderLibraryList(all);
    }
  }

  async exportBackupJSON() {
    try {
      const all = await window.scoreDB.getAllScores();
      if (!all || all.length === 0) {
        alert('Knihovna je prázdná.');
        return;
      }
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(all));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `noty_zaloha.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    } catch (err) { alert('Chyba: ' + err.message); }
  }

  async persistCurrentScore() {
    if (!this.currentScore) return;
    this.currentScore.updatedAt = Date.now();
    await window.scoreDB.saveScore(this.currentScore);
  }

  // --- RENDERING CANVASU ---
  async renderCurrentPage() {
    if (!this.currentScore) return;
    if (this.currentScore.isPdf && this.pdfDoc) {
      if (!this.pageCache.has(this.currentPage)) {
        const page = await this.pdfDoc.getPage(this.currentPage);
        const viewport = page.getViewport({ scale: 2.0 });
        const off = document.createElement('canvas');
        off.width = viewport.width; off.height = viewport.height;
        await page.render({ canvasContext: off.getContext('2d'), viewport }).promise;
        this.pageCache.set(this.currentPage, off);
      }
    } else {
      const url = (this.currentScore.pages && this.currentScore.pages[this.currentPage - 1]) || this.currentScore.imageData;
      if (!this.pageCache.has(this.currentPage) && url) {
        const img = new Image();
        await new Promise(res => {
          img.onload = () => {
            const off = document.createElement('canvas');
            off.width = img.width; off.height = img.height;
            off.getContext('2d').drawImage(img, 0, 0);
            this.pageCache.set(this.currentPage, off);
            res();
          };
          img.src = url;
        });
      }
    }
    const clean = this.pageCache.get(this.currentPage);
    if (clean && this.scoreCanvas) {
      this.scoreCanvas.width = clean.width;
      this.scoreCanvas.height = clean.height;
      this.renderScoreView();
    }
  }

  async getPageImage(pageNum) {
    if (this.pageCache.has(pageNum)) return this.pageCache.get(pageNum);
    const p = this.currentPage;
    this.currentPage = pageNum;
    await this.renderCurrentPage();
    const res = this.pageCache.get(pageNum);
    this.currentPage = p;
    return res;
  }

  renderScoreView() {
    const p = this.pageCache.get(this.currentPage);
    if (!p || !this.scoreCtx) return;
    this.scoreCtx.clearRect(0, 0, this.scoreCanvas.width, this.scoreCanvas.height);
    this.scoreCtx.drawImage(p, 0, 0);

    (this.currentScore?.measures || []).forEach(m => {
      if ((m.page || 1) !== this.currentPage || this.editingId === m.id) return;
      this.scoreCtx.fillStyle = 'rgba(239, 68, 68, 0.22)';
      this.scoreCtx.fillRect(m.box.left, m.box.top, m.box.width, m.box.height);
      this.scoreCtx.strokeStyle = '#ef4444';
      this.scoreCtx.lineWidth = 3.5;
      this.scoreCtx.strokeRect(m.box.left, m.box.top, m.box.width, m.box.height);
      this.scoreCtx.fillStyle = '#ef4444';
      this.scoreCtx.fillRect(m.box.left, m.box.top, 30, 20);
      this.scoreCtx.fillStyle = '#ffffff';
      this.scoreCtx.font = 'bold 12px sans-serif';
      this.scoreCtx.fillText(`${m.id}`, m.box.left + 6, m.box.top + 15);
    });
  }

  updateViewportTransform() {
    if (!this.canvasViewport) return;
    this.canvasViewport.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoomScale})`;
  }

  fitCanvasToScreen() {
    if (!this.scoreCanvas || this.scoreCanvas.width === 0 || !this.canvasBox) return;
    const rect = this.canvasBox.getBoundingClientRect();
    const w = rect.width > 0 ? rect.width : window.innerWidth;
    const h = rect.height > 0 ? rect.height : window.innerHeight * 0.75;
    this.zoomScale = Math.max(0.15, Math.min(w / this.scoreCanvas.width, h / this.scoreCanvas.height, 1.0));
    this.panX = Math.max(0, (w - this.scoreCanvas.width * this.zoomScale) / 2);
    this.panY = Math.max(8, (h - this.scoreCanvas.height * this.zoomScale) / 2);
    this.updateViewportTransform();
  }

  applyZoomAt(ns, cx, cy) {
    const f = ns / this.zoomScale;
    this.panX = cx - (cx - this.panX) * f;
    this.panY = cy - (cy - this.panY) * f;
    this.zoomScale = ns;
    this.updateViewportTransform();
  }

  // --- ZNAČKOVÁNÍ A DOTYK ---
  initTouchEngine() {
    const box = this.canvasBox;
    if (!box) return;
    let touches = new Map();
    let initP = 1;
    let isDrag = false, isPan = false;
    let startPoint = null;

    box.addEventListener('pointerdown', e => {
      // V režimu listování obsluhují dotyk zóny pro otáčení
      if (!this.isMarkingMode && e.target.classList.contains('page-turn-zone')) return;

      touches.set(e.pointerId, {x: e.clientX, y: e.clientY});
      if (touches.size === 1) {
        startPoint = { x: e.clientX, y: e.clientY };
        const c = this.screenToCanvasCoords(e.clientX, e.clientY);
        if (this.activeEditor) {
          const act = this.activeEditor.hitTest(c.x, c.y, 40 / this.zoomScale);
          if (act) {
            isDrag = true;
            this.activeEditor.startDrag(act, c.x, c.y, e.clientX, e.clientY);
            box.setPointerCapture(e.pointerId);
            return;
          }
        }
        isPan = true;
        box.setPointerCapture(e.pointerId);
      } else if (touches.size === 2) {
        isDrag = isPan = false;
        if (this.activeEditor) this.activeEditor.endDrag();
        const t = Array.from(touches.values());
        initP = Math.hypot(t[0].x - t[1].x, t[0].y - t[1].y);
        this.initScale = this.zoomScale;
      }
    });

    box.addEventListener('pointermove', e => {
      if (!touches.has(e.pointerId)) return;
      const dx = e.clientX - touches.get(e.pointerId).x;
      const dy = e.clientY - touches.get(e.pointerId).y;
      touches.set(e.pointerId, {x: e.clientX, y: e.clientY});
      
      if (touches.size === 2) {
        const t = Array.from(touches.values());
        const dist = Math.hypot(t[0].x - t[1].x, t[0].y - t[1].y);
        const rect = box.getBoundingClientRect();
        this.applyZoomAt(this.initScale * (dist / initP), (t[0].x + t[1].x) / 2 - rect.left, (t[0].y + t[1].y) / 2 - rect.top);
        this.panX += dx / 2;
        this.panY += dy / 2;
        this.updateViewportTransform();
      } else if (touches.size === 1) {
        if (isDrag && this.activeEditor) {
          const c = this.screenToCanvasCoords(e.clientX, e.clientY);
          this.activeEditor.moveDrag(c.x, c.y, e.clientX, e.clientY);
        } else if (isPan) {
          this.panX += dx;
          this.panY += dy;
          this.updateViewportTransform();
        }
      }
    });

    const end = e => {
      touches.delete(e.pointerId);
      if (touches.size === 0) {
        if (isDrag && this.activeEditor) this.activeEditor.endDrag();
        if (startPoint && !isDrag) {
          const dist = Math.hypot(e.clientX - startPoint.x, e.clientY - startPoint.y);
          // Klepnutí zpracujeme jen v režimu značkování
          if (dist < 8 && this.isMarkingMode) {
            this.handleCanvasTap(e.clientX, e.clientY);
          }
        }
        isDrag = isPan = false;
        startPoint = null;
      }
    };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
  }

  screenToCanvasCoords(clientX, clientY) {
    const rect = this.canvasBox.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.panX) / this.zoomScale,
      y: (clientY - rect.top - this.panY) / this.zoomScale
    };
  }

  handleCanvasTap(x, y) {
    const clean = this.pageCache.get(this.currentPage);
    if (!clean) return;
    const c = this.screenToCanvasCoords(x, y);
    const m = (this.currentScore?.measures || []).find(item => item.page === this.currentPage && c.x >= item.box.left && c.x <= item.box.left + item.box.width && c.y >= item.box.top && c.y <= item.box.top + item.box.height);
    
    if (m) {
      this.editingId = m.id;
      const s = scanStaffAndBarlinesFromCanvas(clean, c.x, c.y);
      if (this.activeEditor) this.activeEditor.destroy();
      this.activeEditor = new MeasureBoxEditor(this.scoreCanvas, () => this.renderScoreView(), m.box, () => {}, s.isBarLine);
    } else {
      this.editingId = null;
      const s = scanStaffAndBarlinesFromCanvas(clean, c.x, c.y);
      if (this.activeEditor) this.activeEditor.destroy();
      this.activeEditor = new MeasureBoxEditor(this.scoreCanvas, () => this.renderScoreView(), s.box, () => {}, s.isBarLine);
    }
    const sb = document.getElementById('editSubbar');
    if (sb) sb.style.display = 'flex';
    this.updateActiveControlButtons();
  }

  expandMeasure(dir) { if (this.activeEditor) this.activeEditor.expandMeasure(dir); }

  updateActiveControlButtons() {
    const addBtn = document.getElementById('addMeasureBtn');
    const delBtn = document.getElementById('deleteActiveBoxBtn');
    if (this.editingId && addBtn) addBtn.innerText = '✔ Upravit takt';
    else if (addBtn) addBtn.innerText = '✔ Uložit do Laboratoře';
    if (delBtn) delBtn.style.display = this.editingId ? 'inline-flex' : 'none';
  }

  async saveCurrentMeasure() {
    if (!this.activeEditor) return;
    if (!this.currentScore.measures) this.currentScore.measures = [];
    if (this.editingId) {
      const m = this.currentScore.measures.find(x => x.id === this.editingId);
      if (m) m.box = { ...this.activeEditor.box };
    } else {
      this.currentScore.measures.push({ id: this.currentScore.measures.length + 1, page: this.currentPage, box: { ...this.activeEditor.box } });
    }
    this.currentScore.measures.sort((a, b) => compareMusicPosition(a, b));
    this.currentScore.measures.forEach((x, i) => x.id = i + 1);
    await this.persistCurrentScore();
    this.resetActiveSelection();
    this.renderScoreView();
    this.updateLabBadge();
    this.updateUI();
  }

  async deleteActiveBox() {
    if (!this.editingId || !this.currentScore) return;
    this.currentScore.measures = this.currentScore.measures.filter(x => x.id !== this.editingId);
    this.currentScore.measures.forEach((x, i) => x.id = i + 1);
    await this.persistCurrentScore();
    this.resetActiveSelection();
    this.renderScoreView();
    this.updateLabBadge();
    this.updateUI();
  }

  resetActiveSelection() {
    if (this.activeEditor) this.activeEditor.destroy();
    this.activeEditor = null;
    this.editingId = null;
    const sb = document.getElementById('editSubbar');
    if (sb) sb.style.display = 'none';
  }

  // --- LABORATOŘ (MIKRO-DRILL) ---
  updateLabBadge() {
    const c = (this.currentScore?.measures || []).length;
    const b = document.getElementById('labBadgeCount');
    if (b) { b.innerText = c; b.style.display = c > 0 ? 'inline-block' : 'none'; }
  }

  updateUI() {
    const c = (this.currentScore?.measures || []).length;
    const span = document.getElementById('measureCountSpan');
    if (span) span.innerText = c;
    const btn = document.getElementById('clearMeasuresBtn');
    if (btn) btn.style.display = c > 0 ? 'inline-flex' : 'none';
  }

  async clearMeasures() {
    if (!this.currentScore) return;
    if (confirm('Opravdu vyprázdnit celou laboratoř pro tuto skladbu?')) {
      this.currentScore.measures = [];
      await this.persistCurrentScore();
      this.updateLabBadge();
      this.updateUI();
      this.renderScoreView();
    }
  }

  renderLabQueue() {
    const wrap = document.getElementById('labQueuePills');
    if (!wrap || !this.currentScore) return;
    wrap.innerHTML = '';
    const m = this.currentScore.measures || [];
    if (m.length === 0) { 
      wrap.innerHTML = '<span style="font-size:0.75rem; color:var(--text-dim);">Laboratoř je prázdná. Označte problémový takt v režimu Hraní.</span>'; 
      return; 
    }
    m.forEach(x => {
      const b = document.createElement('button');
      b.className = 'queue-pill' + (x.id === m[this.labCurrentIndex]?.id ? ' active' : '');
      b.innerText = `Takt #${x.id}`;
      b.onclick = () => { 
        this.labCurrentIndex = m.indexOf(x); 
        this.renderLabQueue(); 
        this.showMeasureInLab(this.labCurrentIndex); 
      };
      wrap.appendChild(b);
    });
  }

  setLabContext(ctx) {
    this.labContext = ctx;
    ['ctxSolo', 'ctxBefore', 'ctxAfter'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('active');
    });
    const activeId = ctx === 'solo' ? 'ctxSolo' : (ctx === 'before' ? 'ctxBefore' : 'ctxAfter');
    const actEl = document.getElementById(activeId);
    if (actEl) actEl.classList.add('active');
    this.showMeasureInLab(this.labCurrentIndex);
  }

  async showMeasureInLab(idx) {
    const measures = this.currentScore?.measures || [];
    if (measures.length === 0) {
      if (this.labCtx && this.labCanvas) this.labCtx.clearRect(0, 0, this.labCanvas.width, this.labCanvas.height);
      return;
    }
    this.labCurrentIndex = Math.max(0, Math.min(measures.length - 1, idx));
    const curM = measures[this.labCurrentIndex];
    const lbl = document.getElementById('loupeOpticLabel');
    if (lbl) lbl.innerText = `LUPA • TAKT #${curM.id}`;

    let items = [];
    if (this.labContext === 'before' && this.labCurrentIndex > 0) items.push(measures[this.labCurrentIndex - 1]);
    items.push(curM);
    if (this.labContext === 'after' && this.labCurrentIndex < measures.length - 1) items.push(measures[this.labCurrentIndex + 1]);

    const rendered = [];
    for (const m of items) rendered.push({ m, img: await this.getPageImage(m.page || 1) });
    
    let maxW = 0; rendered.forEach(i => { if (i.m.box.width > maxW) maxW = i.m.box.width; });
    let totalH = 0; const spacing = 12;
    const rows = rendered.map(i => {
      const sc = maxW / i.m.box.width;
      const h = Math.round(i.m.box.height * sc);
      const y = totalH; totalH += h + spacing;
      return { ...i, y, h };
    });
    totalH -= spacing;

    if (!this.labCanvas || !this.labCtx) return;
    this.labCanvas.width = maxW;
    this.labCanvas.height = Math.max(10, totalH);
    this.labCtx.fillStyle = '#ffffff';
    this.labCtx.fillRect(0, 0, maxW, totalH);

    rows.forEach(r => {
      if (r.img) this.labCtx.drawImage(r.img, r.m.box.left, r.m.box.top, r.m.box.width, r.m.box.height, 0, r.y, maxW, r.h);
      if (r.m.id !== curM.id) {
        this.labCtx.fillStyle = 'rgba(0,0,0,0.55)';
        this.labCtx.fillRect(0, r.y, maxW, r.h);
      }
    });
  }

  async resolveCurrentLabMeasure() {
    if (!this.currentScore || !this.currentScore.measures) return;
    const m = this.currentScore.measures[this.labCurrentIndex];
    if (m) {
      this.currentScore.measures.splice(this.labCurrentIndex, 1);
      this.currentScore.measures.forEach((x, i) => x.id = i + 1);
      await this.persistCurrentScore();
      this.updateLabBadge();
      if (this.labCurrentIndex >= this.currentScore.measures.length) {
        this.labCurrentIndex = Math.max(0, this.currentScore.measures.length - 1);
      }
      this.renderLabQueue();
      this.showMeasureInLab(this.labCurrentIndex);
      this.updateUI();
    }
  }

  // --- STRÁNKOVÁNÍ ---
  updatePageSwitcherUI() {
    const ind = document.getElementById('pageIndicator');
    if (ind) ind.innerText = `Strana ${this.currentPage}/${this.totalPages}`;
  }

  async changePage(delta) {
    const t = this.currentPage + delta;
    if (t < 1 || t > this.totalPages) return;
    this.currentPage = t;
    this.updatePageSwitcherUI();
    this.resetActiveSelection();
    await this.renderCurrentPage();
  }
}

// Zpřístupnění instance pro inline HTML event handlery
window.app = new GuitarTrainer();

// PŘEPÍNÁNÍ ZÁLOŽEK
function switchMode(mode) {
  ['tabLibrary', 'tabEdit', 'tabLab'].forEach(id => {
    const t = document.getElementById(id);
    if (t) t.classList.remove('active');
  });
  ['libraryView', 'editView', 'labView'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  
  const metro = document.getElementById('dockedMetronome');
  if (metro) metro.style.display = 'none';
  window.app.stopMetronome();

  if (mode === 'library') {
    const t = document.getElementById('tabLibrary'); if (t) t.classList.add('active');
    const v = document.getElementById('libraryView'); if (v) v.style.display = 'flex';
  } else if (mode === 'edit') {
    if (!window.app.currentScore) {
      alert('Nejprve vyberte skladbu.');
      return switchMode('library');
    }
    const t = document.getElementById('tabEdit'); if (t) t.classList.add('active');
    const v = document.getElementById('editView'); if (v) v.style.display = 'flex';
    window.app.renderScoreView();
    setTimeout(() => window.app.fitCanvasToScreen(), 20);
  } else if (mode === 'lab') {
    if (!window.app.currentScore) {
      alert('Nejprve vyberte skladbu.');
      return switchMode('library');
    }
    const t = document.getElementById('tabLab'); if (t) t.classList.add('active');
    const v = document.getElementById('labView'); if (v) v.style.display = 'flex';
    if (metro) metro.style.display = 'flex';
    if (window.wakeLockManager) try { window.wakeLockManager.request(); } catch (_) {}
    window.app.renderLabQueue();
    window.app.showMeasureInLab(window.app.labCurrentIndex);
  }
}

// NAHRÁVÁNÍ SOUBORŮ
const cameraInput = document.getElementById('cameraInput');
if (cameraInput) {
  cameraInput.addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    const n = prompt('Název skladby:', 'Noty ' + new Date().toLocaleDateString('cs-CZ')) || 'Nová skladba';
    try {
      const d = await processAndEnhancePhoto(f);
      await window.app.saveNewScoreToLibrary(n.trim(), {isPdf: false, imageData: d, pages: [d]});
    } catch (err) { alert('Chyba: ' + err.message); }
    e.target.value = '';
  });
}

const fileInput = document.getElementById('fileInput');
if (fileInput) {
  fileInput.addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    const n = f.name.replace(/\.[^/.]+$/, "");
    if (f.type === 'application/pdf' || n.toLowerCase().endsWith('.pdf')) {
      await window.app.saveNewScoreToLibrary(n, {isPdf: true, pdfData: await f.arrayBuffer()});
    } else {
      const d = await processAndEnhancePhoto(f);
      await window.app.saveNewScoreToLibrary(n, {isPdf: false, imageData: d, pages: [d]});
    }
    e.target.value = '';
  });
}