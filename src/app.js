// Konfigurace PDF.js
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// 1. Zvukový generátor metronomu (Web Audio API)
class MetronomeAudio {
  constructor() {
    this.audioCtx = null;
  }
  init() {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }
  playClick(isAccent = false) {
    this.init();
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(isAccent ? 1200 : 800, this.audioCtx.currentTime);

    gain.gain.setValueAtTime(1, this.audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.05);

    osc.connect(gain);
    gain.connect(this.audioCtx.destination);

    osc.start();
    osc.stop(this.audioCtx.currentTime + 0.05);
  }
}

// =========================================================================
// 2. VYSOCE PŘESNÁ DETEKCE TAKTOVÝCH ČAR A OSNOV
// =========================================================================
function scanStaffAndBarlines(canvas, clickX, clickY) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  // Adaptivní prahová hodnota pro dané okolí
  let totalB = 0, sampleCount = 0;
  for (let dy = -60; dy <= 60; dy += 6) {
    for (let dx = -80; dx <= 80; dx += 8) {
      const px = Math.min(width - 1, Math.max(0, Math.floor(clickX + dx)));
      const py = Math.min(height - 1, Math.max(0, Math.floor(clickY + dy)));
      const idx = (py * width + px) * 4;
      totalB += (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      sampleCount++;
    }
  }
  const localBg = totalB / sampleCount;
  const darkThreshold = Math.min(145, Math.max(60, localBg * 0.70));

  const isDark = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    const idx = (Math.floor(y) * width + Math.floor(x)) * 4;
    return (data[idx] + data[idx + 1] + data[idx + 2]) / 3 < darkThreshold;
  };

  const getHWidth = (x, y, maxDist = 35) => {
    if (!isDark(x, y)) return 0;
    let l = 0; while (l < maxDist && isDark(x - l - 1, y)) l++;
    let r = 0; while (r < maxDist && isDark(x + r + 1, y)) r++;
    return l + r + 1;
  };

  // 1. Detekce linek osnov
  const sampleLeft = Math.max(0, Math.floor(clickX - 200));
  const sampleRight = Math.min(width, Math.floor(clickX + 200));
  const sampleWidth = Math.max(1, sampleRight - sampleLeft);
  const minLineFill = sampleWidth * 0.35;

  const lineRows = [];
  for (let y = 0; y < height; y++) {
    let darkCount = 0;
    for (let x = sampleLeft; x < sampleRight; x++) {
      if (isDark(x, y)) darkCount++;
    }
    if (darkCount >= minLineFill) {
      if (lineRows.length === 0 || y - lineRows[lineRows.length - 1] > 2) {
        lineRows.push(y);
      }
    }
  }

  const staves = [];
  for (let i = 0; i <= lineRows.length - 5; i++) {
    const group = lineRows.slice(i, i + 5);
    const spacings = [
      group[1] - group[0],
      group[2] - group[1],
      group[3] - group[2],
      group[4] - group[3]
    ];
    const avgSpacing = spacings.reduce((a, b) => a + b) / 4;
    const isUniform = spacings.every(s => Math.abs(s - avgSpacing) <= 4 && s >= 4 && s <= 35);

    if (isUniform) {
      staves.push({
        top: group[0],
        bottom: group[4],
        height: group[4] - group[0],
        lines: group,
        spacing: avgSpacing
      });
      i += 4;
    }
  }

  if (staves.length === 0) {
    return {
      currentStaff: null,
      staves: [],
      isBarLine: () => false,
      box: { left: Math.max(0, clickX - 60), top: Math.max(0, clickY - 50), width: 120, height: 100 }
    };
  }

  let currentIndex = staves.findIndex(s => clickY >= s.top - 20 && clickY <= s.bottom + 20);
  if (currentIndex === -1) {
    let minDiff = Infinity;
    staves.forEach((s, idx) => {
      const center = (s.top + s.bottom) / 2;
      const diff = Math.abs(clickY - center);
      if (diff < minDiff) {
        minDiff = diff;
        currentIndex = idx;
      }
    });
  }

  const current = staves[currentIndex];
  const staffTop = current.top;
  const staffBottom = current.bottom;
  const lines = current.lines;
  const spacing = current.spacing;

  // Validátor taktové čáry
  const isBarLine = (col) => {
    let gapsPassed = 0;
    for (let i = 0; i < 4; i++) {
      const yA = lines[i];
      const yB = lines[i + 1];
      let gapDark = 0;
      let gapH = yB - yA + 1;

      for (let y = yA; y <= yB; y++) {
        if (isDark(col, y) || isDark(col - 1, y) || isDark(col + 1, y)) {
          gapDark++;
        }
      }
      if (gapDark / gapH >= 0.65) {
        gapsPassed++;
      }
    }
    if (gapsPassed < 4) return false;

    // Kontrola přesahu mimo osnovu
    const maxOvershoot = Math.max(4, Math.floor(spacing * 0.70));
    let overshootUp = 0;
    for (let y = staffTop - 1; y >= Math.max(0, staffTop - spacing * 2.5); y--) {
      if (isDark(col, y) || isDark(col - 1, y) || isDark(col + 1, y)) overshootUp++;
      else break;
    }
    if (overshootUp > maxOvershoot) return false;

    let overshootDown = 0;
    for (let y = staffBottom + 1; y <= Math.min(height - 1, staffBottom + spacing * 2.5); y++) {
      if (isDark(col, y) || isDark(col - 1, y) || isDark(col + 1, y)) overshootDown++;
      else break;
    }
    if (overshootDown > maxOvershoot) return false;

    // Kontrola hlaviček not
    const noteheadMinWidth = Math.max(6, Math.floor(spacing * 0.62));
    const testPointsY = [
      Math.round(staffTop + spacing * 0.45),
      Math.round(lines[1] + spacing * 0.5),
      Math.round(lines[2] + spacing * 0.5),
      Math.round(staffBottom - spacing * 0.45)
    ];

    for (const testY of testPointsY) {
      if (getHWidth(col, testY) >= noteheadMinWidth) return false;
    }

    return true;
  };

  // Nalezení nejbližších taktových čar vlevo a vpravo
  let leftX = Math.floor(clickX) - 5;
  let foundLeft = false;
  for (let x = leftX; x >= 0; x--) {
    if (isBarLine(x)) {
      leftX = x;
      foundLeft = true;
      for (let off = 2; off <= 7; off++) {
        if (x - off >= 0 && isBarLine(x - off)) leftX = x - off;
      }
      break;
    }
  }
  if (!foundLeft) leftX = Math.max(0, Math.floor(clickX - spacing * 8));

  let rightX = Math.floor(clickX) + 5;
  let foundRight = false;
  for (let x = rightX; x < width; x++) {
    if (isBarLine(x)) {
      rightX = x;
      foundRight = true;
      for (let off = 2; off <= 7; off++) {
        if (x + off < width && isBarLine(x + off)) rightX = x + off;
      }
      break;
    }
  }
  if (!foundRight) rightX = Math.min(width, Math.floor(clickX + spacing * 8));

  // Polovina mezer mezi osnovami
  const prev = currentIndex > 0 ? staves[currentIndex - 1] : null;
  const next = currentIndex < staves.length - 1 ? staves[currentIndex + 1] : null;

  let gapAbove = 0, gapBelow = 0;
  if (prev && next) {
    gapAbove = current.top - prev.bottom;
    gapBelow = next.top - current.bottom;
  } else if (!prev && next) {
    gapBelow = next.top - current.bottom;
    gapAbove = gapBelow;
  } else if (prev && !next) {
    gapAbove = current.top - prev.bottom;
    gapBelow = gapAbove;
  } else {
    gapAbove = current.height * 1.5;
    gapBelow = current.height * 1.5;
  }

  const topY = Math.max(0, current.top - Math.floor(gapAbove / 2));
  const bottomY = Math.min(height, current.bottom + Math.floor(gapBelow / 2));

  return {
    currentStaff: current,
    staves,
    isBarLine,
    box: {
      left: leftX,
      top: topY,
      width: Math.max(25, rightX - leftX),
      height: Math.max(25, bottomY - topY)
    }
  };
}

// =========================================================================
// 3. EDITOR RÁMEČKU S LOUPE (ZVĚTŠOVACÍ SKLO NAD PRSTEM)
// =========================================================================
class MeasureBoxEditor {
  constructor(canvas, renderCallback, initialBox, onUpdate, isBarLineFn) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.renderCallback = renderCallback;
    this.box = { ...initialBox };
    this.onUpdate = onUpdate;
    this.isBarLineFn = isBarLineFn;
    this.touchTolerance = 34;

    this.activeAction = null;
    this.dragStart = { x: 0, y: 0 };
    this.initialBoxState = null;

    // Prvky lupy
    this.loupeEl = document.getElementById('touchLoupe');
    this.loupeCanvas = document.getElementById('loupeCanvas');
    this.loupeCtx = this.loupeCanvas ? this.loupeCanvas.getContext('2d') : null;

    this.onPointerDown = this.handlePointerDown.bind(this);
    this.onPointerMove = this.handlePointerMove.bind(this);
    this.onPointerUp = this.handlePointerUp.bind(this);

    this.bindEvents();
    this.render();
  }

  getCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
      tolerance: this.touchTolerance * scaleX
    };
  }

  hitTest(x, y, tol) {
    const b = this.box;
    const r = b.left + b.width;
    const bot = b.top + b.height;

    if (Math.abs(x - b.left) <= tol && Math.abs(y - b.top) <= tol) return 'corner-tl';
    if (Math.abs(x - r) <= tol && Math.abs(y - b.top) <= tol) return 'corner-tr';
    if (Math.abs(x - b.left) <= tol && Math.abs(y - bot) <= tol) return 'corner-bl';
    if (Math.abs(x - r) <= tol && Math.abs(y - bot) <= tol) return 'corner-br';

    const nearLeft = Math.abs(x - b.left) <= tol && y >= b.top - tol && y <= bot + tol;
    const nearRight = Math.abs(x - r) <= tol && y >= b.top - tol && y <= bot + tol;
    const nearTop = Math.abs(y - b.top) <= tol && x >= b.left - tol && x <= r + tol;
    const nearBottom = Math.abs(y - bot) <= tol && x >= b.left - tol && x <= r + tol;

    if (nearLeft) return 'left';
    if (nearRight) return 'right';
    if (nearTop) return 'top';
    if (nearBottom) return 'bottom';

    if (x > b.left && x < r && y > b.top && y < bot) return 'drag';
    return null;
  }

  bindEvents() {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
  }

  destroy() {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    if (this.loupeEl) this.loupeEl.style.display = 'none';
  }

  handlePointerDown(e) {
    const { x, y, tolerance } = this.getCoords(e);
    const action = this.hitTest(x, y, tolerance);

    if (action) {
      this.activeAction = action;
      this.dragStart = { x, y };
      this.initialBoxState = { ...this.box };
      this.canvas.setPointerCapture(e.pointerId);

      // Pokud taháme za hranu, zobrazíme zvětšovací lupu nad prstem
      if (action !== 'drag') {
        this.updateLoupe(e, x, y);
      }
    }
  }

  handlePointerMove(e) {
    if (!this.activeAction) return;

    const { x, y } = this.getCoords(e);
    const dx = x - this.dragStart.x;
    const dy = y - this.dragStart.y;
    const init = this.initialBoxState;

    switch (this.activeAction) {
      case 'drag':
        this.box.left = Math.max(0, Math.min(this.canvas.width - this.box.width, init.left + dx));
        this.box.top = Math.max(0, Math.min(this.canvas.height - this.box.height, init.top + dy));
        break;
      case 'left':
      case 'corner-tl':
      case 'corner-bl': {
        const newLeft = Math.min(init.left + dx, init.left + init.width - 20);
        this.box.left = Math.max(0, newLeft);
        this.box.width = init.width - (this.box.left - init.left);
        if (this.activeAction === 'corner-tl') {
          const newTop = Math.min(init.top + dy, init.top + init.height - 20);
          this.box.top = Math.max(0, newTop);
          this.box.height = init.height - (this.box.top - init.top);
        } else if (this.activeAction === 'corner-bl') {
          this.box.height = Math.max(20, Math.min(this.canvas.height - this.box.top, init.height + dy));
        }
        break;
      }
      case 'right':
      case 'corner-tr':
      case 'corner-br': {
        this.box.width = Math.max(20, Math.min(this.canvas.width - this.box.left, init.width + dx));
        if (this.activeAction === 'corner-tr') {
          const newTop = Math.min(init.top + dy, init.top + init.height - 20);
          this.box.top = Math.max(0, newTop);
          this.box.height = init.height - (this.box.top - init.top);
        } else if (this.activeAction === 'corner-br') {
          this.box.height = Math.max(20, Math.min(this.canvas.height - this.box.top, init.height + dy));
        }
        break;
      }
      case 'top': {
        const newTop = Math.min(init.top + dy, init.top + init.height - 20);
        this.box.top = Math.max(0, newTop);
        this.box.height = init.height - (this.box.top - init.top);
        break;
      }
      case 'bottom':
        this.box.height = Math.max(20, Math.min(this.canvas.height - this.box.top, init.height + dy));
        break;
    }

    this.render();
    if (this.activeAction !== 'drag') {
      let targetX = (this.activeAction.includes('left')) ? this.box.left : (this.box.left + this.box.width);
      let targetY = y;
      this.updateLoupe(e, targetX, targetY);
    }
    if (this.onUpdate) this.onUpdate(this.box);
  }

  handlePointerUp(e) {
    if (this.activeAction) {
      this.canvas.releasePointerCapture(e.pointerId);
      this.activeAction = null;
      if (this.loupeEl) this.loupeEl.style.display = 'none';
    }
  }

  // Vykreslení lupy nad prstem
  updateLoupe(e, targetCanvasX, targetCanvasY) {
    if (!this.loupeEl || !this.loupeCanvas || !this.loupeCtx) return;

    this.loupeEl.style.display = 'block';
    this.loupeEl.style.left = e.clientX + 'px';
    this.loupeEl.style.top = e.clientY + 'px';

    const lw = this.loupeCanvas.width;
    const lh = this.loupeCanvas.height;
    const zoom = 2.0;
    const cropW = lw / zoom;
    const cropH = lh / zoom;

    const sx = Math.max(0, Math.min(this.canvas.width - cropW, targetCanvasX - cropW / 2));
    const sy = Math.max(0, Math.min(this.canvas.height - cropH, targetCanvasY - cropH / 2));

    this.loupeCtx.clearRect(0, 0, lw, lh);
    // Vykreslíme výřez z podkladového plátna not
    this.loupeCtx.drawImage(this.canvas, sx, sy, cropW, cropH, 0, 0, lw, lh);

    // Červená zaměřovací ryska přesně na hranu
    this.loupeCtx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
    this.loupeCtx.lineWidth = 2;
    this.loupeCtx.beginPath();
    this.loupeCtx.moveTo(lw / 2, 0);
    this.loupeCtx.lineTo(lw / 2, lh);
    this.loupeCtx.stroke();
  }

  // Rozšíření rámečku o 1 takt doleva / doprava
  expandMeasure(direction) {
    if (!this.isBarLineFn) return;
    const step = 8;
    if (direction === 'right') {
      let curR = Math.floor(this.box.left + this.box.width);
      for (let x = curR + step; x < this.canvas.width; x++) {
        if (this.isBarLineFn(x)) {
          // Našli jsme další taktovou čáru doprava
          let newR = x;
          for (let off = 2; off <= 6; off++) {
            if (x + off < this.canvas.width && this.isBarLineFn(x + off)) newR = x + off;
          }
          this.box.width = newR - this.box.left;
          break;
        }
      }
    } else if (direction === 'left') {
      let curL = Math.floor(this.box.left);
      for (let x = curL - step; x >= 0; x--) {
        if (this.isBarLineFn(x)) {
          let newL = x;
          for (let off = 2; off <= 6; off++) {
            if (x - off >= 0 && this.isBarLineFn(x - off)) newL = x - off;
          }
          this.box.width += (this.box.left - newL);
          this.box.left = newL;
          break;
        }
      }
    }
    this.render();
    if (this.onUpdate) this.onUpdate(this.box);
  }

  // Zúžení rámečku o 1 takt zleva / zprava
  shrinkMeasure(direction) {
    if (!this.isBarLineFn) return;
    const step = 10;
    if (direction === 'right') {
      let curR = Math.floor(this.box.left + this.box.width);
      for (let x = curR - step; x > this.box.left + 30; x--) {
        if (this.isBarLineFn(x)) {
          this.box.width = x - this.box.left;
          break;
        }
      }
    } else if (direction === 'left') {
      let curL = Math.floor(this.box.left);
      for (let x = curL + step; x < this.box.left + this.box.width - 30; x++) {
        if (this.isBarLineFn(x)) {
          this.box.width -= (x - this.box.left);
          this.box.left = x;
          break;
        }
      }
    }
    this.render();
    if (this.onUpdate) this.onUpdate(this.box);
  }

  modifyWidth(delta) {
    const newWidth = Math.max(20, Math.min(this.canvas.width - this.box.left, this.box.width + delta));
    this.box.width = newWidth;
    this.render();
    if (this.onUpdate) this.onUpdate(this.box);
  }

  modifyEdge(edge, delta) {
    if (edge === 'left') {
      const newLeft = Math.max(0, Math.min(this.box.left + this.box.width - 20, this.box.left + delta));
      this.box.width += (this.box.left - newLeft);
      this.box.left = newLeft;
    } else if (edge === 'right') {
      this.box.width = Math.max(20, Math.min(this.canvas.width - this.box.left, this.box.width + delta));
    }
    this.render();
    if (this.onUpdate) this.onUpdate(this.box);
  }

  render() {
    this.renderCallback();

    const b = this.box;
    const c = this.ctx;

    c.save();
    c.fillStyle = 'rgba(37, 99, 235, 0.18)';
    c.fillRect(b.left, b.top, b.width, b.height);

    c.strokeStyle = '#2563eb';
    c.lineWidth = 3;
    c.strokeRect(b.left, b.top, b.width, b.height);

    c.fillStyle = '#ffffff';
    c.strokeStyle = '#2563eb';
    c.lineWidth = 3;

    const handles = [
      { x: b.left + b.width / 2, y: b.top },
      { x: b.left + b.width / 2, y: b.top + b.height },
      { x: b.left, y: b.top + b.height / 2 },
      { x: b.left + b.width, y: b.top + b.height / 2 },
      { x: b.left, y: b.top },
      { x: b.left + b.width, y: b.top },
      { x: b.left, y: b.top + b.height },
      { x: b.left + b.width, y: b.top + b.height }
    ];

    handles.forEach(h => {
      c.beginPath();
      c.arc(h.x, h.y, 8, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    });

    c.restore();
  }
}

// =========================================================================
// 4. HLAVNÍ APLIKACE S OPRAVENÝM PŘEPÍNÁNÍM A KNIHOVNOU
// =========================================================================
class GuitarTrainer {
  constructor() {
    this.scoreCanvas = document.getElementById('scoreCanvas');
    this.scoreCtx = this.scoreCanvas.getContext('2d');

    this.practiceCanvas = document.getElementById('practiceCanvas');
    this.practiceCtx = this.practiceCanvas.getContext('2d');

    this.metronome = new MetronomeAudio();

    this.currentScore = null;
    this.baseImage = null;
    this.currentIndex = 0;
    this.activeEditor = null;
    this.lastBarLineFn = null;

    this.isPlaying = false;
    this.timerId = null;
    this.currentBeat = 0;

    this.initLibrary();
    this.initCanvasClicks();
    this.initPracticeGestures();
  }

  async initLibrary() {
    try {
      const all = await window.scoreDB.getAllScores();
      document.getElementById('libCountSpan').innerText = all.length;

      if (all.length > 0) {
        all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        await this.loadScore(all[0].id);
      }
    } catch (e) {
      console.warn('Chyba při čtení z knihovny:', e);
    }
  }

  async loadScore(id) {
    const score = await window.scoreDB.getScore(id);
    if (!score) return;

    this.currentScore = score;
    this.currentIndex = 0;
    if (this.activeEditor) {
      this.activeEditor.destroy();
      this.activeEditor = null;
    }
    document.getElementById('editSubbar').style.display = 'none';

    if (score.imageData) {
      const img = new Image();
      img.onload = async () => {
        this.scoreCanvas.width = img.naturalWidth;
        this.scoreCanvas.height = img.naturalHeight;
        this.scoreCtx.drawImage(img, 0, 0);
        this.baseImage = await createImageBitmap(img);
        this.updateUI();
        this.renderScoreView();
        document.getElementById('statusHint').innerText = `Otevřena skladba: "${score.name}". Klepněte na takt pro ohraničení.`;
      };
      img.src = score.imageData;
    }
  }

  async saveNewScoreToLibrary(name, imageData) {
    const id = 'score_' + Date.now();
    const score = {
      id,
      name: name || 'Skladba ' + new Date().toLocaleDateString('cs-CZ'),
      imageData: imageData,
      measures: [],
      updatedAt: Date.now()
    };
    await window.scoreDB.saveScore(score);
    await this.initLibrary();
    await this.loadScore(id);
  }

  async persistCurrentScore() {
    if (!this.currentScore) return;
    this.currentScore.updatedAt = Date.now();
    await window.scoreDB.saveScore(this.currentScore);
    await this.initLibrary();
  }

  async deleteScoreFromLibrary(id, e) {
    if (e) e.stopPropagation();
    if (confirm('Opravdu chcete smazat tuto skladbu z knihovny?')) {
      await window.scoreDB.deleteScore(id);
      const all = await window.scoreDB.getAllScores();
      if (this.currentScore && this.currentScore.id === id) {
        if (all.length > 0) {
          await this.loadScore(all[0].id);
        } else {
          this.currentScore = null;
          this.baseImage = null;
          this.scoreCtx.clearRect(0, 0, this.scoreCanvas.width, this.scoreCanvas.height);
          this.updateUI();
        }
      }
      this.openLibraryModal();
    }
  }

  async openLibraryModal() {
    const listEl = document.getElementById('libraryList');
    listEl.innerHTML = '';
    const all = await window.scoreDB.getAllScores();
    document.getElementById('libCountSpan').innerText = all.length;

    if (all.length === 0) {
      listEl.innerHTML = '<div style="color:var(--text-muted); padding:10px; text-align:center;">V knihovně zatím nemáte žádné noty. Nahrajte nové souborem nahoře.</div>';
    } else {
      all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      all.forEach(s => {
        const item = document.createElement('div');
        item.className = 'library-item';
        item.onclick = () => {
          this.loadScore(s.id);
          this.closeLibraryModal();
        };

        const isCurrent = this.currentScore && this.currentScore.id === s.id;
        item.innerHTML = `
          <div class="library-info">
            <div class="library-name">${s.name} ${isCurrent ? '⭐' : ''}</div>
            <div class="library-meta">${(s.measures || []).length} taktů • ${new Date(s.updatedAt).toLocaleDateString('cs-CZ')}</div>
          </div>
          <div class="library-actions">
            <button class="btn btn-danger" style="padding:4px 8px; font-size:0.75rem;" onclick="app.deleteScoreFromLibrary('${s.id}', event)">Smazat</button>
          </div>
        `;
        listEl.appendChild(item);
      });
    }

    document.getElementById('libraryModal').style.display = 'flex';
  }

  closeLibraryModal() {
    document.getElementById('libraryModal').style.display = 'none';
  }

  // Funkce tlačítek pro změnu a rozšiřování taktů
  expandMeasure(direction) {
    if (this.activeEditor) this.activeEditor.expandMeasure(direction);
  }

  shrinkMeasure(direction) {
    if (this.activeEditor) this.activeEditor.shrinkMeasure(direction);
  }

  adjustActiveWidth(delta) {
    if (this.activeEditor) this.activeEditor.modifyWidth(delta);
  }

  adjustActiveEdge(edge, delta) {
    if (this.activeEditor) this.activeEditor.modifyEdge(edge, delta);
  }

  initCanvasClicks() {
    this.scoreCanvas.addEventListener('click', (e) => {
      if (!this.baseImage || !this.currentScore) return;
      if (this.activeEditor && this.activeEditor.activeAction) return;

      const rect = this.scoreCanvas.getBoundingClientRect();
      const scaleX = this.scoreCanvas.width / rect.width;
      const scaleY = this.scoreCanvas.height / rect.height;
      const clickX = (e.clientX - rect.left) * scaleX;
      const clickY = (e.clientY - rect.top) * scaleY;

      if (this.activeEditor) {
        const { x, y, tolerance } = this.activeEditor.getCoords(e);
        if (this.activeEditor.hitTest(x, y, tolerance)) return;
      }

      const scanResult = scanStaffAndBarlines(this.scoreCanvas, clickX, clickY);
      this.lastBarLineFn = scanResult.isBarLine;

      if (this.activeEditor) this.activeEditor.destroy();
      this.activeEditor = new MeasureBoxEditor(
        this.scoreCanvas,
        () => this.renderScoreView(),
        scanResult.box,
        () => {},
        scanResult.isBarLine
      );

      document.getElementById('addMeasureBtn').style.display = 'inline-flex';
      document.getElementById('editSubbar').style.display = 'flex';
      document.getElementById('nextMeasureNum').innerText = (this.currentScore.measures || []).length + 1;
      document.getElementById('statusHint').innerText = 'Pod prstem vidíte zvětšenou lupu. Tlačítky nahoře můžete přidat další takt do stejného cvičení.';
    });
  }

  // Gesta v režimu cvičení: klepnutí vlevo / vpravo na trenažér
  initPracticeGestures() {
    const disp = document.getElementById('practiceDisplay');
    disp.addEventListener('click', (e) => {
      const rect = disp.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      if (clickX < rect.width * 0.4) {
        this.prevMeasure();
      } else {
        this.nextMeasure(true);
      }
    });
  }

  async saveCurrentMeasure() {
    if (!this.activeEditor || !this.currentScore) return;

    if (!this.currentScore.measures) this.currentScore.measures = [];
    this.currentScore.measures.push({
      id: this.currentScore.measures.length + 1,
      box: { ...this.activeEditor.box }
    });

    await this.persistCurrentScore();

    this.activeEditor.destroy();
    this.activeEditor = null;
    document.getElementById('addMeasureBtn').style.display = 'none';
    document.getElementById('editSubbar').style.display = 'none';

    this.updateUI();
    this.renderScoreView();
  }

  async clearMeasures() {
    if (!this.currentScore) return;
    if (confirm('Opravdu chcete smazat všechny označené takty pro tuto skladbu?')) {
      this.currentScore.measures = [];
      this.currentIndex = 0;
      await this.persistCurrentScore();
      if (this.activeEditor) {
        this.activeEditor.destroy();
        this.activeEditor = null;
        document.getElementById('editSubbar').style.display = 'none';
      }
      this.updateUI();
      this.renderScoreView();
    }
  }

  updateUI() {
    const count = (this.currentScore && this.currentScore.measures) ? this.currentScore.measures.length : 0;
    document.getElementById('measureCountSpan').innerText = count;
    document.getElementById('clearMeasuresBtn').style.display = count > 0 ? 'inline-flex' : 'none';
    document.getElementById('nextMeasureNum').innerText = count + 1;

    const loopFrom = document.getElementById('loopFrom');
    const loopTo = document.getElementById('loopTo');
    loopFrom.max = Math.max(1, count);
    loopTo.max = Math.max(1, count);

    // DŮLEŽITÉ: loopTo musí vždy odpovídat celkovému počtu taktů, aby nezablokoval přepínání!
    if (count > 0 && (Number(loopTo.value) <= 1 || Number(loopTo.value) < count)) {
      loopTo.value = count;
    }
    if (Number(loopFrom.value) < 1) loopFrom.value = 1;
  }

  renderScoreView() {
    if (!this.baseImage) return;
    this.scoreCtx.clearRect(0, 0, this.scoreCanvas.width, this.scoreCanvas.height);
    this.scoreCtx.drawImage(this.baseImage, 0, 0);

    if (this.currentScore && this.currentScore.measures) {
      this.currentScore.measures.forEach((m, idx) => {
        this.scoreCtx.strokeStyle = 'rgba(34, 197, 94, 0.85)';
        this.scoreCtx.lineWidth = 2.5;
        this.scoreCtx.strokeRect(m.box.left, m.box.top, m.box.width, m.box.height);

        this.scoreCtx.fillStyle = '#22c55e';
        this.scoreCtx.font = 'bold 18px sans-serif';
        this.scoreCtx.fillText(`${idx + 1}`, m.box.left + 6, m.box.top + 22);
      });
    }
  }

  // =========================================================================
  // OPRAVENÉ PŘEPÍNÁNÍ TAKTŮ V REŽIMU CVIČENÍ
  // =========================================================================
  showMeasureInTrainer(index) {
    if (!this.currentScore || !this.currentScore.measures || this.currentScore.measures.length === 0) return;
    const measures = this.currentScore.measures;
    const count = measures.length;

    // Normalizace indexu
    if (index < 0) index = 0;
    if (index >= count) index = count - 1;

    this.currentIndex = index;
    const m = measures[index];

    this.practiceCanvas.width = m.box.width;
    this.practiceCanvas.height = m.box.height;

    this.practiceCtx.drawImage(
      this.baseImage,
      m.box.left, m.box.top, m.box.width, m.box.height,
      0, 0, m.box.width, m.box.height
    );

    document.getElementById('practiceMeasureTitle').innerText = `Takt ${index + 1} / ${count}`;
  }

  nextMeasure(isManual = false) {
    if (!this.currentScore || !this.currentScore.measures || this.currentScore.measures.length === 0) return;
    const count = this.currentScore.measures.length;

    if (isManual) {
      // Při manuálním kliknutí na "Další ▶" přecházíme plynule na další takt
      const nextIdx = (this.currentIndex + 1) % count;
      this.showMeasureInTrainer(nextIdx);
      return;
    }

    // Při automatickém posunu metronomem dodržujeme smyčku
    let loopFrom = Math.max(1, Math.min(count, Number(document.getElementById('loopFrom').value) || 1)) - 1;
    let loopTo = Math.max(1, Math.min(count, Number(document.getElementById('loopTo').value) || count)) - 1;
    if (loopTo < loopFrom) loopTo = count - 1;

    let nextIdx = this.currentIndex + 1;
    if (nextIdx > loopTo || nextIdx >= count) {
      nextIdx = loopFrom;
    }
    this.showMeasureInTrainer(nextIdx);
  }

  prevMeasure() {
    if (!this.currentScore || !this.currentScore.measures || this.currentScore.measures.length === 0) return;
    const count = this.currentScore.measures.length;
    const prevIdx = (this.currentIndex - 1 + count) % count;
    this.showMeasureInTrainer(prevIdx);
  }

  async togglePlay() {
    if (this.isPlaying) {
      this.stop();
    } else {
      await this.start();
    }
  }

  async start() {
    if (!this.currentScore || !this.currentScore.measures || this.currentScore.measures.length === 0) {
      alert('Nejprve označte alespoň jeden takt v záložce "Značkování".');
      return;
    }
    this.isPlaying = true;
    this.currentBeat = 0;
    document.getElementById('playBtn').innerText = '⏸ Zastavit';

    if (window.wakeLockManager) {
      await window.wakeLockManager.request();
    }

    this.scheduleNextTick();
  }

  async stop() {
    this.isPlaying = false;
    clearTimeout(this.timerId);
    document.getElementById('playBtn').innerText = '▶ Start Metronom';
    document.getElementById('beatDot').classList.remove('active');

    if (window.wakeLockManager) {
      await window.wakeLockManager.release();
    }
  }

  scheduleNextTick() {
    if (!this.isPlaying) return;

    const bpm = Number(document.getElementById('bpmInput').value) || 80;
    const beatsPerMeasure = Number(document.getElementById('beatsPerMeasure').value) || 4;
    const intervalMs = (60 / bpm) * 1000;

    const isAccent = (this.currentBeat === 0);
    this.metronome.playClick(isAccent);

    const dot = document.getElementById('beatDot');
    dot.classList.add('active');
    setTimeout(() => dot.classList.remove('active'), 120);

    this.currentBeat++;
    if (this.currentBeat >= beatsPerMeasure) {
      this.currentBeat = 0;
      if (document.getElementById('autoAdvance').checked) {
        this.nextMeasure(false);
      }
    }

    this.timerId = setTimeout(() => this.scheduleNextTick(), intervalMs);
  }
}

const app = new GuitarTrainer();

function switchMode(mode) {
  const tabEdit = document.getElementById('tabEdit');
  const tabPractice = document.getElementById('tabPractice');
  const editView = document.getElementById('editView');
  const practiceView = document.getElementById('practiceView');
  const editToolbar = document.getElementById('editToolbar');
  const editSubbar = document.getElementById('editSubbar');
  const badge = document.getElementById('appModeBadge');

  if (mode === 'edit') {
    tabEdit.classList.add('active');
    tabPractice.classList.remove('active');
    editView.style.display = 'flex';
    practiceView.style.display = 'none';
    editToolbar.style.display = 'flex';
    badge.innerText = 'Příprava';
    app.stop();
    app.renderScoreView();
  } else {
    if (!app.currentScore || !app.currentScore.measures || app.currentScore.measures.length === 0) {
      alert('Nejprve označte a přidejte alespoň jeden takt.');
      return;
    }
    tabEdit.classList.remove('active');
    tabPractice.classList.add('active');
    editView.style.display = 'none';
    practiceView.style.display = 'flex';
    editToolbar.style.display = 'none';
    editSubbar.style.display = 'none';
    badge.innerText = 'Cvičení';
    app.showMeasureInTrainer(app.currentIndex);
  }
}

// Nahrání nového souboru
document.getElementById('fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const hint = document.getElementById('statusHint');
  hint.innerText = 'Načítám noty a ukládám do knihovny...';
  const songName = file.name.replace(/\.[^/.]+$/, "");

  if (file.type === 'application/pdf') {
    const reader = new FileReader();
    reader.onload = async function() {
      const typedarray = new Uint8Array(this.result);
      const pdf = await pdfjsLib.getDocument(typedarray).promise;
      const page = await pdf.getPage(1);

      const viewport = page.getViewport({ scale: 2.0 });
      app.scoreCanvas.width = viewport.width;
      app.scoreCanvas.height = viewport.height;

      const renderContext = { canvasContext: app.scoreCtx, viewport: viewport };
      await page.render(renderContext).promise;

      const imageData = app.scoreCanvas.toDataURL('image/jpeg', 0.85);
      await app.saveNewScoreToLibrary(songName, imageData);
    };
    reader.readAsArrayBuffer(file);
  } else {
    const img = new Image();
    img.onload = async () => {
      app.scoreCanvas.width = img.naturalWidth;
      app.scoreCanvas.height = img.naturalHeight;
      app.scoreCtx.drawImage(img, 0, 0);

      const imageData = app.scoreCanvas.toDataURL('image/jpeg', 0.85);
      await app.saveNewScoreToLibrary(songName, imageData);
    };
    img.src = URL.createObjectURL(file);
  }
});