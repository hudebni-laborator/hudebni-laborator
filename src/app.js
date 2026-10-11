if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// 1. Zvukový generátor metronomu
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

// 2. Detekce taktových čar a osnov
function scanStaffAndBarlines(canvas, clickX, clickY) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;

  // Skenujeme jen vertikální pruh kolem klepnutí kvůli rychlosti
  const scanTop = Math.max(0, Math.floor(clickY - 250));
  const scanH = Math.min(height - scanTop, 500);
  const imgData = ctx.getImageData(0, scanTop, width, scanH);
  const data = imgData.data;

  const isDarkRel = (x, localY) => {
    if (x < 0 || x >= width || localY < 0 || localY >= scanH) return false;
    const idx = (localY * width + Math.floor(x)) * 4;
    return (data[idx] + data[idx + 1] + data[idx + 2]) / 3 < 135;
  };

  const getHWidth = (x, localY, maxDist = 35) => {
    if (!isDarkRel(x, localY)) return 0;
    let l = 0; while (l < maxDist && isDarkRel(x - l - 1, localY)) l++;
    let r = 0; while (r < maxDist && isDarkRel(x + r + 1, localY)) r++;
    return l + r + 1;
  };

  // Nalezení horizontálních linek v okolí
  const sampleLeft = Math.max(0, Math.floor(clickX - 160));
  const sampleRight = Math.min(width, Math.floor(clickX + 160));
  const minLineFill = (sampleRight - sampleLeft) * 0.35;

  const lineRowsRel = [];
  for (let y = 0; y < scanH; y++) {
    let darkCount = 0;
    for (let x = sampleLeft; x < sampleRight; x++) {
      if (isDarkRel(x, y)) darkCount++;
    }
    if (darkCount >= minLineFill) {
      if (lineRowsRel.length === 0 || y - lineRowsRel[lineRowsRel.length - 1] > 2) {
        lineRowsRel.push(y);
      }
    }
  }

  // Přepočet na globální souřadnice
  const lineRows = lineRowsRel.map(y => y + scanTop);

  // Seskupení linek
  let currentStaff = null;
  for (let i = 0; i <= lineRows.length - 5; i++) {
    const group = lineRows.slice(i, i + 5);
    const spacings = [
      group[1] - group[0],
      group[2] - group[1],
      group[3] - group[2],
      group[4] - group[3]
    ];
    const avgSpacing = spacings.reduce((a, b) => a + b) / 4;
    const isUniform = spacings.every(s => Math.abs(s - avgSpacing) <= 5 && s >= 4 && s <= 40);

    if (isUniform) {
      const top = group[0];
      const bottom = group[4];
      if (clickY >= top - 40 && clickY <= bottom + 40) {
        currentStaff = { top, bottom, height: bottom - top, lines: group, spacing: avgSpacing };
        break;
      }
    }
  }

  // Bezpečný záložní výřez, pokud se nepodaří najít osnovu přesně
  if (!currentStaff) {
    const estTop = Math.max(0, Math.floor(clickY - 50));
    return {
      isBarLine: () => false,
      box: { left: Math.max(0, Math.floor(clickX - 80)), top: estTop, width: 160, height: 100 }
    };
  }

  const staffTopRel = currentStaff.top - scanTop;
  const staffBottomRel = currentStaff.bottom - scanTop;
  const linesRel = currentStaff.lines.map(y => y - scanTop);
  const spacing = currentStaff.spacing;

  const isBarLine = (col) => {
    let gapsPassed = 0;
    for (let i = 0; i < 4; i++) {
      const yA = linesRel[i];
      const yB = linesRel[i + 1];
      let gapDark = 0;
      let gapH = yB - yA + 1;

      for (let y = yA; y <= yB; y++) {
        if (isDarkRel(col, y) || isDarkRel(col - 1, y) || isDarkRel(col + 1, y)) gapDark++;
      }
      if (gapDark / gapH >= 0.65) gapsPassed++;
    }
    if (gapsPassed < 4) return false;

    // Kontrola přesahu mimo osnovu
    const maxOvershoot = Math.max(4, Math.floor(spacing * 0.70));
    let overshootUp = 0;
    for (let y = staffTopRel - 1; y >= Math.max(0, staffTopRel - spacing * 2.5); y--) {
      if (isDarkRel(col, y) || isDarkRel(col - 1, y) || isDarkRel(col + 1, y)) overshootUp++;
      else break;
    }
    if (overshootUp > maxOvershoot) return false;

    let overshootDown = 0;
    for (let y = staffBottomRel + 1; y <= Math.min(scanH - 1, staffBottomRel + spacing * 2.5); y++) {
      if (isDarkRel(col, y) || isDarkRel(col - 1, y) || isDarkRel(col + 1, y)) overshootDown++;
      else break;
    }
    if (overshootDown > maxOvershoot) return false;

    // Kontrola hlaviček not
    const noteheadMinWidth = Math.max(6, Math.floor(spacing * 0.62));
    const testPointsY = [
      Math.round(staffTopRel + spacing * 0.45),
      Math.round(linesRel[1] + spacing * 0.5),
      Math.round(linesRel[2] + spacing * 0.5),
      Math.round(staffBottomRel - spacing * 0.45)
    ];

    for (const testY of testPointsY) {
      if (getHWidth(col, testY) >= noteheadMinWidth) return false;
    }

    return true;
  };

  // Hledání levé a pravé taktové čáry
  let leftX = Math.floor(clickX) - 5;
  let foundLeft = false;
  for (let x = leftX; x >= Math.max(0, clickX - spacing * 18); x--) {
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
  for (let x = rightX; x <= Math.min(width, clickX + spacing * 18); x++) {
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

  const gapMargin = Math.round(currentStaff.height * 0.65);
  const topY = Math.max(0, currentStaff.top - gapMargin);
  const bottomY = Math.min(height, currentStaff.bottom + gapMargin);

  return {
    isBarLine,
    box: {
      left: leftX,
      top: topY,
      width: Math.max(30, rightX - leftX),
      height: Math.max(30, bottomY - topY)
    }
  };
}

// 3. Editor rámečku s lupou
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

    if (Math.abs(x - b.left) <= tol && y >= b.top - tol && y <= bot + tol) return 'left';
    if (Math.abs(x - r) <= tol && y >= b.top - tol && y <= bot + tol) return 'right';
    if (Math.abs(y - b.top) <= tol && x >= b.left - tol && x <= r + tol) return 'top';
    if (Math.abs(y - bot) <= tol && x >= b.left - tol && x <= r + tol) return 'bottom';

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
      const targetX = this.activeAction.includes('left') ? this.box.left : (this.box.left + this.box.width);
      this.updateLoupe(e, targetX, y);
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
    this.loupeCtx.drawImage(this.canvas, sx, sy, cropW, cropH, 0, 0, lw, lh);

    this.loupeCtx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
    this.loupeCtx.lineWidth = 2;
    this.loupeCtx.beginPath();
    this.loupeCtx.moveTo(lw / 2, 0);
    this.loupeCtx.lineTo(lw / 2, lh);
    this.loupeCtx.stroke();
  }

  expandMeasure(direction) {
    if (!this.isBarLineFn) return;
    const step = 8;
    if (direction === 'right') {
      const curR = Math.floor(this.box.left + this.box.width);
      for (let x = curR + step; x < this.canvas.width; x++) {
        if (this.isBarLineFn(x)) {
          let newR = x;
          for (let off = 2; off <= 6; off++) {
            if (x + off < this.canvas.width && this.isBarLineFn(x + off)) newR = x + off;
          }
          this.box.width = newR - this.box.left;
          break;
        }
      }
    } else if (direction === 'left') {
      const curL = Math.floor(this.box.left);
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

  shrinkMeasure(direction) {
    if (!this.isBarLineFn) return;
    const step = 10;
    if (direction === 'right') {
      const curR = Math.floor(this.box.left + this.box.width);
      for (let x = curR - step; x > this.box.left + 30; x--) {
        if (this.isBarLineFn(x)) {
          this.box.width = x - this.box.left;
          break;
        }
      }
    } else if (direction === 'left') {
      const curL = Math.floor(this.box.left);
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
    this.box.width = Math.max(20, Math.min(this.canvas.width - this.box.left, this.box.width + delta));
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

// 4. Hlavní aplikace
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

    this.isPlaying = false;
    this.timerId = null;
    this.currentBeat = 0;

    this.initLibrary();
    this.initTouchMarking();
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
      console.warn('Chyba při čtení knihovny:', e);
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
    document.getElementById('addMeasureBtn').style.display = 'none';

    if (score.imageData) {
      const img = new Image();
      img.onload = () => {
        this.scoreCanvas.width = img.naturalWidth;
        this.scoreCanvas.height = img.naturalHeight;
        this.baseImage = img;
        this.updateUI();
        this.renderScoreView();
        document.getElementById('statusHint').innerText = `Otevřeno: "${score.name}". Klepněte prstem na libovolný takt.`;
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
    const all = await window.scoreDB.getAllScores();
    document.getElementById('libCountSpan').innerText = all.length;
    await this.loadScore(id);
  }

  async persistCurrentScore() {
    if (!this.currentScore) return;
    this.currentScore.updatedAt = Date.now();
    await window.scoreDB.saveScore(this.currentScore);
    const all = await window.scoreDB.getAllScores();
    document.getElementById('libCountSpan').innerText = all.length;
  }

  async deleteScoreFromLibrary(id, e) {
    if (e) e.stopPropagation();
    if (confirm('Opravdu chcete smazat tuto skladbu z knihovny?')) {
      await window.scoreDB.deleteScore(id);
      const all = await window.scoreDB.getAllScores();
      document.getElementById('libCountSpan').innerText = all.length;

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
      listEl.innerHTML = '<div style="color:var(--text-muted); padding:10px; text-align:center;">Knihovna je prázdná. Nahrajte noty tlačítkem nahoře.</div>';
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

  expandMeasure(dir) {
    if (this.activeEditor) this.activeEditor.expandMeasure(dir);
  }
  shrinkMeasure(dir) {
    if (this.activeEditor) this.activeEditor.shrinkMeasure(dir);
  }
  adjustActiveWidth(delta) {
    if (this.activeEditor) this.activeEditor.modifyWidth(delta);
  }
  adjustActiveEdge(edge, delta) {
    if (this.activeEditor) this.activeEditor.modifyEdge(edge, delta);
  }

  // SPOLEHLIVÉ ZNAČKOVÁNÍ NA MOBILU (Tap detekce)
  initTouchMarking() {
    let downPos = null;

    this.scoreCanvas.addEventListener('pointerdown', (e) => {
      downPos = { x: e.clientX, y: e.clientY };
    });

    this.scoreCanvas.addEventListener('pointerup', (e) => {
      if (!downPos) return;
      const dist = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      downPos = null;

      // Pokud prst popojel více než 8 px, šlo o tažení rámečku, nikoliv nové klepnutí
      if (dist > 8) return;

      if (!this.baseImage || !this.currentScore) {
        alert('Nejprve nahrajte skladbu nebo ji vyberte z Knihovny.');
        return;
      }

      const rect = this.scoreCanvas.getBoundingClientRect();
      const scaleX = this.scoreCanvas.width / rect.width;
      const scaleY = this.scoreCanvas.height / rect.height;
      const clickX = (e.clientX - rect.left) * scaleX;
      const clickY = (e.clientY - rect.top) * scaleY;

      // Pokud uživatel klikl na stávající táhlo rámečku, necháme ho editovat
      if (this.activeEditor) {
        const { x, y, tolerance } = this.activeEditor.getCoords(e);
        if (this.activeEditor.hitTest(x, y, tolerance)) return;
      }

      const scanResult = scanStaffAndBarlines(this.scoreCanvas, clickX, clickY);

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
      document.getElementById('statusHint').innerText = 'Upravte rámeček prstem (s lupou) nebo tlačítky a klepněte na "✔ Uložit takt".';
    });
  }

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
    document.getElementById('statusHint').innerText = 'Takt uložen. Můžete klepnout na další takt.';
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
        document.getElementById('addMeasureBtn').style.display = 'none';
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

  showMeasureInTrainer(index) {
    if (!this.currentScore || !this.currentScore.measures || this.currentScore.measures.length === 0) return;
    const measures = this.currentScore.measures;
    const count = measures.length;

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
      this.showMeasureInTrainer((this.currentIndex + 1) % count);
      return;
    }

    let loopFrom = Math.max(1, Math.min(count, Number(document.getElementById('loopFrom').value) || 1)) - 1;
    let loopTo = Math.max(1, Math.min(count, Number(document.getElementById('loopTo').value) || count)) - 1;
    if (loopTo < loopFrom) loopTo = count - 1;

    let nextIdx = this.currentIndex + 1;
    if (nextIdx > loopTo || nextIdx >= count) nextIdx = loopFrom;
    this.showMeasureInTrainer(nextIdx);
  }

  prevMeasure() {
    if (!this.currentScore || !this.currentScore.measures || this.currentScore.measures.length === 0) return;
    const count = this.currentScore.measures.length;
    this.showMeasureInTrainer((this.currentIndex - 1 + count) % count);
  }

  async togglePlay() {
    if (this.isPlaying) this.stop();
    else await this.start();
  }

  async start() {
    if (!this.currentScore || !this.currentScore.measures || this.currentScore.measures.length === 0) {
      alert('Nejprve označte alespoň jeden takt v záložce "Značkování".');
      return;
    }
    this.isPlaying = true;
    this.currentBeat = 0;
    document.getElementById('playBtn').innerText = '⏸ Zastavit';

    if (window.wakeLockManager) await window.wakeLockManager.request();
    this.scheduleNextTick();
  }

  async stop() {
    this.isPlaying = false;
    clearTimeout(this.timerId);
    document.getElementById('playBtn').innerText = '▶ Start Metronom';
    document.getElementById('beatDot').classList.remove('active');

    if (window.wakeLockManager) await window.wakeLockManager.release();
  }

  scheduleNextTick() {
    if (!this.isPlaying) return;

    const bpm = Number(document.getElementById('bpmInput').value) || 80;
    const beatsPerMeasure = Number(document.getElementById('beatsPerMeasure').value) || 4;
    const intervalMs = (60 / bpm) * 1000;

    this.metronome.playClick(this.currentBeat === 0);

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

// SPOLEHLIVÉ NAHRÁVÁNÍ SOUBORŮ (PDF i Obrázky včetně Android MIME typů)
document.getElementById('fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const hint = document.getElementById('statusHint');
  hint.innerText = 'Načítám noty a ukládám do knihovny...';
  const songName = file.name ? file.name.replace(/\.[^/.]+$/, "") : 'Nová skladba';

  const isPdf = file.type === 'application/pdf' || 
                (file.name && file.name.toLowerCase().endsWith('.pdf'));

  try {
    if (isPdf) {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const page = await pdf.getPage(1);

      const viewport = page.getViewport({ scale: 2.0 });
      app.scoreCanvas.width = viewport.width;
      app.scoreCanvas.height = viewport.height;

      await page.render({ canvasContext: app.scoreCtx, viewport }).promise;
      const imageData = app.scoreCanvas.toDataURL('image/jpeg', 0.85);
      await app.saveNewScoreToLibrary(songName, imageData);
    } else {
      const img = new Image();
      img.onload = async () => {
        app.scoreCanvas.width = img.naturalWidth;
        app.scoreCanvas.height = img.naturalHeight;
        app.scoreCtx.drawImage(img, 0, 0);

        const imageData = app.scoreCanvas.toDataURL('image/jpeg', 0.85);
        await app.saveNewScoreToLibrary(songName, imageData);
      };
      img.onerror = () => {
        hint.innerText = 'Chyba: Obrázek se nepodařilo načíst.';
      };
      img.src = URL.createObjectURL(file);
    }
  } catch (err) {
    console.error('Chyba nahrávání:', err);
    hint.innerText = 'Chyba při zpracování souboru: ' + err.message;
  }
});