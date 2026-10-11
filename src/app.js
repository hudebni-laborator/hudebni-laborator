if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// 1. Zmenšení vyfocené fotografie na rozumnou velikost pro plynulý chod mobilu
async function compressImageFile(file, maxDimension = 2400) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;

      if (w > maxDimension || h > maxDimension) {
        if (w > h) {
          h = Math.round((h * maxDimension) / w);
          w = maxDimension;
        } else {
          w = Math.round((w * maxDimension) / h);
          h = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      resolve(canvas.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// 2. Detekce taktových čar a osnov z čistého podkladu
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
    for (let x = sampleLeft; x < sampleRight; x++) {
      if (isDarkRel(x, y)) darkCount++;
    }
    if (darkCount >= minLineFill) {
      currentBlock.push(y);
    } else {
      if (currentBlock.length > 0) {
        const centerY = Math.round(currentBlock.reduce((a, b) => a + b, 0) / currentBlock.length);
        lineBlocks.push(centerY);
        currentBlock = [];
      }
    }
  }
  if (currentBlock.length > 0) {
    const centerY = Math.round(currentBlock.reduce((a, b) => a + b, 0) / currentBlock.length);
    lineBlocks.push(centerY);
  }

  const lineRows = lineBlocks.map(y => y + scanTop);

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
    const isUniform = spacings.every(s => Math.abs(s - avgSpacing) <= 5 && s >= 4 && s <= 45);

    if (isUniform) {
      const top = group[0];
      const bottom = group[4];
      if (clickY >= top - 45 && clickY <= bottom + 45) {
        currentStaff = { top, bottom, height: bottom - top, lines: group, spacing: avgSpacing };
        break;
      }
    }
  }

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
      if (gapDark / gapH >= 0.60) gapsPassed++;
    }
    if (gapsPassed < 4) return false;

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

    const noteheadMinWidth = Math.max(6, Math.floor(spacing * 0.65));
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

  let leftX = Math.floor(clickX) - 5;
  for (let x = leftX; x >= Math.max(0, clickX - spacing * 18); x--) {
    if (isBarLine(x)) {
      leftX = x;
      for (let off = 2; off <= 7; off++) {
        if (x - off >= 0 && isBarLine(x - off)) leftX = x - off;
      }
      break;
    }
  }

  let rightX = Math.floor(clickX) + 5;
  for (let x = rightX; x <= Math.min(width, clickX + spacing * 18); x++) {
    if (isBarLine(x)) {
      rightX = x;
      for (let off = 2; off <= 7; off++) {
        if (x + off < width && isBarLine(x + off)) rightX = x + off;
      }
      break;
    }
  }

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

// 3. Editor rámečku s lupou nad prstem
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
    const step = 8;
    if (direction === 'right') {
      const curR = Math.floor(this.box.left + this.box.width);
      let found = false;
      if (this.isBarLineFn) {
        for (let x = curR + step; x < this.canvas.width; x++) {
          if (this.isBarLineFn(x)) {
            let newR = x;
            for (let off = 2; off <= 6; off++) {
              if (x + off < this.canvas.width && this.isBarLineFn(x + off)) newR = x + off;
            }
            this.box.width = newR - this.box.left;
            found = true;
            break;
          }
        }
      }
      if (!found) this.box.width += 140;
    } else if (direction === 'left') {
      const curL = Math.floor(this.box.left);
      let found = false;
      if (this.isBarLineFn) {
        for (let x = curL - step; x >= 0; x--) {
          if (this.isBarLineFn(x)) {
            let newL = x;
            for (let off = 2; off <= 6; off++) {
              if (x - off >= 0 && this.isBarLineFn(x - off)) newL = x - off;
            }
            this.box.width += (this.box.left - newL);
            this.box.left = newL;
            found = true;
            break;
          }
        }
      }
      if (!found) {
        const newL = Math.max(0, this.box.left - 140);
        this.box.width += (this.box.left - newL);
        this.box.left = newL;
      }
    }
    this.render();
    if (this.onUpdate) this.onUpdate(this.box);
  }

  shrinkMeasure(direction) {
    const step = 10;
    if (direction === 'right') {
      const curR = Math.floor(this.box.left + this.box.width);
      let found = false;
      if (this.isBarLineFn) {
        for (let x = curR - step; x > this.box.left + 35; x--) {
          if (this.isBarLineFn(x)) {
            this.box.width = x - this.box.left;
            found = true;
            break;
          }
        }
      }
      if (!found) this.box.width = Math.max(40, this.box.width - 100);
    } else if (direction === 'left') {
      const curL = Math.floor(this.box.left);
      let found = false;
      if (this.isBarLineFn) {
        for (let x = curL + step; x < this.box.left + this.box.width - 35; x++) {
          if (this.isBarLineFn(x)) {
            this.box.width -= (x - this.box.left);
            this.box.left = x;
            found = true;
            break;
          }
        }
      }
      if (!found) {
        const delta = Math.min(100, this.box.width - 40);
        this.box.left += delta;
        this.box.width -= delta;
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

// 4. Hlavní aplikace trenažéru
class GuitarTrainer {
  constructor() {
    this.scoreCanvas = document.getElementById('scoreCanvas');
    this.scoreCtx = this.scoreCanvas.getContext('2d');

    this.practiceCanvas = document.getElementById('practiceCanvas');
    this.practiceCtx = this.practiceCanvas.getContext('2d');

    this.clefCanvas = document.getElementById('clefCanvas');
    this.clefCtx = this.clefCanvas ? this.clefCanvas.getContext('2d') : null;

    this.currentScore = null;
    this.pdfDoc = null;
    this.pageCache = new Map();
    this.currentPage = 1;
    this.totalPages = 1;

    this.currentIndex = 0;
    this.activeEditor = null;
    this.editingMeasureId = null;

    this.stackCount = 1;

    this.initLibrary();
    this.initTouchMarking();
    this.initPracticeGestures();
  }

  async initLibrary() {
    try {
      const all = await window.scoreDB.getAllScores();
      document.querySelectorAll('.lib-count-span').forEach(el => el.innerText = all.length);

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
    this.currentPage = 1;
    this.pageCache.clear();
    this.pdfDoc = null;

    if (this.activeEditor) {
      this.activeEditor.destroy();
      this.activeEditor = null;
    }
    this.editingMeasureId = null;
    document.getElementById('editSubbar').style.display = 'none';
    document.getElementById('addMeasureBtn').style.display = 'none';
    document.getElementById('setKeySigBtn').style.display = 'none';
    document.getElementById('deleteSelectedMeasureBtn').style.display = 'none';

    if (score.isPdf && score.pdfData) {
      try {
        const copyBuffer = new Uint8Array(score.pdfData.slice(0));
        this.pdfDoc = await pdfjsLib.getDocument({ data: copyBuffer }).promise;
        this.totalPages = this.pdfDoc.numPages;
      } catch (err) {
        console.error('Chyba načítání PDF:', err);
        this.totalPages = 1;
      }
    } else if (score.pages && score.pages.length > 0) {
      this.totalPages = score.pages.length;
    } else {
      this.totalPages = 1;
    }

    document.getElementById('addPageBtn').style.display = score.isPdf ? 'none' : 'inline-flex';

    this.updatePageSwitcherUI();
    await this.renderCurrentPage();
    this.updateUI();
    document.getElementById('statusHint').innerText = `Otevřeno: "${score.name}". Klepněte na takt pro ohraničení, nebo na začátek osnovy pro uložení Klíče.`;
  }

  async renderCurrentPage() {
    if (!this.currentScore) return;

    if (this.currentScore.isPdf && this.pdfDoc) {
      if (!this.pageCache.has(this.currentPage)) {
        const page = await this.pdfDoc.getPage(this.currentPage);
        const viewport = page.getViewport({ scale: 2.0 });

        const offCanvas = document.createElement('canvas');
        offCanvas.width = viewport.width;
        offCanvas.height = viewport.height;
        const offCtx = offCanvas.getContext('2d');

        await page.render({ canvasContext: offCtx, viewport }).promise;
        this.pageCache.set(this.currentPage, offCanvas);
      }

      const cleanCanvas = this.pageCache.get(this.currentPage);
      this.scoreCanvas.width = cleanCanvas.width;
      this.scoreCanvas.height = cleanCanvas.height;
      this.renderScoreView();
    } else {
      // Vícestránkové vyfocené noty nebo samostatný obrázek
      const targetDataUrl = (this.currentScore.pages && this.currentScore.pages[this.currentPage - 1]) 
        || this.currentScore.imageData;

      if (!this.pageCache.has(this.currentPage)) {
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = () => {
            const offCanvas = document.createElement('canvas');
            offCanvas.width = img.naturalWidth || img.width;
            offCanvas.height = img.naturalHeight || img.height;
            offCanvas.getContext('2d').drawImage(img, 0, 0);
            this.pageCache.set(this.currentPage, offCanvas);
            resolve();
          };
          img.onerror = reject;
          img.src = targetDataUrl;
        });
      }

      const cleanCanvas = this.pageCache.get(this.currentPage);
      this.scoreCanvas.width = cleanCanvas.width;
      this.scoreCanvas.height = cleanCanvas.height;
      this.renderScoreView();
    }
  }

  async getPageImage(pageNum) {
    if (this.pageCache.has(pageNum)) {
      return this.pageCache.get(pageNum);
    }
    if (this.currentScore && this.currentScore.isPdf && this.pdfDoc) {
      const page = await this.pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 2.0 });
      const offCanvas = document.createElement('canvas');
      offCanvas.width = viewport.width;
      offCanvas.height = viewport.height;
      const offCtx = offCanvas.getContext('2d');
      await page.render({ canvasContext: offCtx, viewport }).promise;
      this.pageCache.set(pageNum, offCanvas);
      return offCanvas;
    } else if (this.currentScore) {
      const targetDataUrl = (this.currentScore.pages && this.currentScore.pages[pageNum - 1]) 
        || this.currentScore.imageData;
      if (targetDataUrl) {
        const img = new Image();
        await new Promise((res) => {
          img.onload = () => {
            const offCanvas = document.createElement('canvas');
            offCanvas.width = img.naturalWidth || img.width;
            offCanvas.height = img.naturalHeight || img.height;
            offCanvas.getContext('2d').drawImage(img, 0, 0);
            this.pageCache.set(pageNum, offCanvas);
            res();
          };
          img.src = targetDataUrl;
        });
        return this.pageCache.get(pageNum);
      }
    }
    return this.pageCache.get(1) || null;
  }

  updatePageSwitcherUI() {
    const switcher = document.getElementById('pageSwitcher');
    if (this.totalPages > 1) {
      switcher.style.display = 'inline-flex';
      document.getElementById('pageIndicator').innerText = `Strana ${this.currentPage}/${this.totalPages}`;
      document.getElementById('prevPageBtn').disabled = (this.currentPage <= 1);
      document.getElementById('nextPageBtn').disabled = (this.currentPage >= this.totalPages);
    } else {
      switcher.style.display = 'none';
    }
  }

  async changePage(delta) {
    const target = this.currentPage + delta;
    if (target < 1 || target > this.totalPages) return;

    if (this.activeEditor) {
      this.activeEditor.destroy();
      this.activeEditor = null;
      this.editingMeasureId = null;
      document.getElementById('editSubbar').style.display = 'none';
      document.getElementById('addMeasureBtn').style.display = 'none';
      document.getElementById('setKeySigBtn').style.display = 'none';
      document.getElementById('deleteSelectedMeasureBtn').style.display = 'none';
    }

    this.currentPage = target;
    this.updatePageSwitcherUI();
    await this.renderCurrentPage();
  }

  async saveNewScoreToLibrary(name, dataObj) {
    const id = 'score_' + Date.now();
    const score = {
      id,
      name: name || 'Skladba ' + new Date().toLocaleDateString('cs-CZ'),
      isPdf: dataObj.isPdf,
      pdfData: dataObj.pdfData || null,
      imageData: dataObj.imageData || null,
      pages: dataObj.pages || (dataObj.imageData ? [dataObj.imageData] : []),
      measures: [],
      keySignatures: [],
      updatedAt: Date.now()
    };
    await window.scoreDB.saveScore(score);
    const all = await window.scoreDB.getAllScores();
    document.querySelectorAll('.lib-count-span').forEach(el => el.innerText = all.length);
    await this.loadScore(id);
  }

  // Přidání další vyfocené strany k právě otevřené skladbě
  async appendPageToCurrentScore(imageData) {
    if (!this.currentScore) return;
    if (this.currentScore.isPdf) {
      alert('K PDF dokumentu nelze přidávat vyfocené strany. Vytvořte novou skladbu focením.');
      return;
    }

    if (!this.currentScore.pages || this.currentScore.pages.length === 0) {
      this.currentScore.pages = [this.currentScore.imageData];
    }
    this.currentScore.pages.push(imageData);
    this.totalPages = this.currentScore.pages.length;
    this.currentPage = this.totalPages; // Přejdeme na novou vyfocenou stranu

    await this.persistCurrentScore();
    this.updatePageSwitcherUI();
    await this.renderCurrentPage();
    document.getElementById('statusHint').innerText = `Přidána vyfocená strana ${this.currentPage}. Můžete na ní označovat takty.`;
  }

  async persistCurrentScore() {
    if (!this.currentScore) return;
    this.currentScore.updatedAt = Date.now();
    await window.scoreDB.saveScore(this.currentScore);
    const all = await window.scoreDB.getAllScores();
    document.querySelectorAll('.lib-count-span').forEach(el => el.innerText = all.length);
  }

  async deleteScoreFromLibrary(id, e) {
    if (e) e.stopPropagation();
    if (confirm('Opravdu chcete smazat tuto skladbu z knihovny?')) {
      await window.scoreDB.deleteScore(id);
      const all = await window.scoreDB.getAllScores();
      document.querySelectorAll('.lib-count-span').forEach(el => el.innerText = all.length);

      if (this.currentScore && this.currentScore.id === id) {
        if (all.length > 0) {
          await this.loadScore(all[0].id);
        } else {
          this.currentScore = null;
          this.pdfDoc = null;
          this.pageCache.clear();
          this.scoreCtx.clearRect(0, 0, this.scoreCanvas.width, this.scoreCanvas.height);
          this.updatePageSwitcherUI();
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
    document.querySelectorAll('.lib-count-span').forEach(el => el.innerText = all.length);

    if (all.length === 0) {
      listEl.innerHTML = '<div style="color:var(--text-muted); padding:10px; text-align:center;">Knihovna je prázdná. Vyfoťte noty tlačítkem nahoře.</div>';
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
        const pageCount = s.isPdf ? 'PDF' : `${(s.pages || [1]).length} str.`;
        item.innerHTML = `
          <div class="library-info">
            <div class="library-name">${s.name} ${isCurrent ? '⭐' : ''}</div>
            <div class="library-meta">${pageCount} • ${(s.measures || []).length} taktů • ${new Date(s.updatedAt).toLocaleDateString('cs-CZ')}</div>
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

  initTouchMarking() {
    let downPos = null;

    this.scoreCanvas.addEventListener('pointerdown', (e) => {
      downPos = { x: e.clientX, y: e.clientY };
    });

    this.scoreCanvas.addEventListener('pointerup', (e) => {
      if (!downPos) return;
      const dist = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      downPos = null;

      if (dist > 8) return;

      if (!this.currentScore) {
        alert('Nejprve vyfoťte noty nebo vyberte skladbu z Knihovny.');
        return;
      }

      const cleanCanvas = this.pageCache.get(this.currentPage);
      if (!cleanCanvas) return;

      const rect = this.scoreCanvas.getBoundingClientRect();
      const scaleX = cleanCanvas.width / rect.width;
      const scaleY = cleanCanvas.height / rect.height;
      const clickX = (e.clientX - rect.left) * scaleX;
      const clickY = (e.clientY - rect.top) * scaleY;

      if (this.activeEditor) {
        const { x, y, tolerance } = this.activeEditor.getCoords(e);
        if (this.activeEditor.hitTest(x, y, tolerance)) return;
      }

      // 1. Zkouška: klepnutí do existujícího uloženého taktu
      const measures = this.currentScore.measures || [];
      const clickedMeasure = measures.find(m => {
        const mPage = m.page || 1;
        if (mPage !== this.currentPage) return false;
        const b = m.box;
        return (clickX >= b.left && clickX <= b.left + b.width &&
                clickY >= b.top && clickY <= b.top + b.height);
      });

      if (clickedMeasure) {
        this.editingMeasureId = clickedMeasure.id;
        const scanResult = scanStaffAndBarlinesFromCanvas(cleanCanvas, clickX, clickY);

        if (this.activeEditor) this.activeEditor.destroy();
        this.activeEditor = new MeasureBoxEditor(
          this.scoreCanvas,
          () => this.renderScoreView(),
          clickedMeasure.box,
          () => {},
          scanResult.isBarLine
        );

        const addBtn = document.getElementById('addMeasureBtn');
        addBtn.style.display = 'inline-flex';
        addBtn.innerHTML = `✔ Aktualizovat takt <span>${clickedMeasure.id}</span>`;

        document.getElementById('setKeySigBtn').style.display = 'inline-flex';
        document.getElementById('deleteSelectedMeasureBtn').style.display = 'inline-flex';
        document.getElementById('editSubbar').style.display = 'flex';
        document.getElementById('statusHint').innerText = `Editace taktu #${clickedMeasure.id}. Upravte rámeček nebo klepněte na "✔ Aktualizovat takt".`;
        return;
      }

      // 2. Ohraničení nového místa
      this.editingMeasureId = null;
      const scanResult = scanStaffAndBarlinesFromCanvas(cleanCanvas, clickX, clickY);

      if (this.activeEditor) this.activeEditor.destroy();
      this.activeEditor = new MeasureBoxEditor(
        this.scoreCanvas,
        () => this.renderScoreView(),
        scanResult.box,
        () => {},
        scanResult.isBarLine
      );

      const addBtn = document.getElementById('addMeasureBtn');
      addBtn.style.display = 'inline-flex';
      addBtn.innerHTML = `✔ Uložit takt <span>${measures.length + 1}</span>`;

      document.getElementById('setKeySigBtn').style.display = 'inline-flex';
      document.getElementById('deleteSelectedMeasureBtn').style.display = 'none';
      document.getElementById('editSubbar').style.display = 'flex';
      document.getElementById('statusHint').innerText = 'Místo ohraničeno. Můžete uložit jako takt, nebo jako Klíč/Předznamenání.';
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

    // Podpora šipek na klávesnici nebo bluetooth pedálu
    window.addEventListener('keydown', (e) => {
      if (document.getElementById('practiceView').style.display === 'flex') {
        if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
          this.nextMeasure(true);
        } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
          this.prevMeasure();
        }
      }
    });
  }

  async saveCurrentAsKeySignature() {
    if (!this.activeEditor || !this.currentScore) return;

    if (!this.currentScore.keySignatures) {
      this.currentScore.keySignatures = [];
    }

    const fromMeasure = this.editingMeasureId != null ? 
      (this.editingMeasureId - 1) : 
      ((this.currentScore.measures || []).length);

    const keySig = {
      id: 'key_' + Date.now(),
      page: this.currentPage,
      fromMeasureIndex: Math.max(0, fromMeasure),
      box: { ...this.activeEditor.box }
    };

    this.currentScore.keySignatures = this.currentScore.keySignatures.filter(
      k => !(k.page === this.currentPage && k.fromMeasureIndex === fromMeasure)
    );
    this.currentScore.keySignatures.push(keySig);
    this.currentScore.keySignatures.sort((a, b) => a.fromMeasureIndex - b.fromMeasureIndex);

    await this.persistCurrentScore();

    this.activeEditor.destroy();
    this.activeEditor = null;
    this.editingMeasureId = null;

    document.getElementById('addMeasureBtn').style.display = 'none';
    document.getElementById('setKeySigBtn').style.display = 'none';
    document.getElementById('deleteSelectedMeasureBtn').style.display = 'none';
    document.getElementById('editSubbar').style.display = 'none';

    this.renderScoreView();
    document.getElementById('statusHint').innerText = `Klíč a předznamenání bylo uloženo (platí od taktu #${fromMeasure + 1}).`;
  }

  getKeySignatureForMeasure(measureIndex, pageNum) {
    if (!this.currentScore || !this.currentScore.keySignatures || this.currentScore.keySignatures.length === 0) {
      return null;
    }
    const sigs = this.currentScore.keySignatures;
    let match = null;
    for (const sig of sigs) {
      if (sig.fromMeasureIndex <= measureIndex || sig.page <= pageNum) {
        match = sig;
      }
    }
    return match || sigs[0];
  }

  async saveCurrentMeasure() {
    if (!this.activeEditor || !this.currentScore) return;

    if (!this.currentScore.measures) this.currentScore.measures = [];

    if (this.editingMeasureId != null) {
      const m = this.currentScore.measures.find(item => item.id === this.editingMeasureId);
      if (m) {
        m.box = { ...this.activeEditor.box };
        m.page = this.currentPage;
      }
      document.getElementById('statusHint').innerText = `Takt #${this.editingMeasureId} byl aktualizován.`;
    } else {
      this.currentScore.measures.push({
        id: this.currentScore.measures.length + 1,
        page: this.currentPage,
        box: { ...this.activeEditor.box }
      });
      document.getElementById('statusHint').innerText = 'Takt uložen. Můžete klepnout na další takt.';
    }

    await this.persistCurrentScore();

    this.activeEditor.destroy();
    this.activeEditor = null;
    this.editingMeasureId = null;

    document.getElementById('addMeasureBtn').style.display = 'none';
    document.getElementById('setKeySigBtn').style.display = 'none';
    document.getElementById('deleteSelectedMeasureBtn').style.display = 'none';
    document.getElementById('editSubbar').style.display = 'none';

    this.updateUI();
    this.renderScoreView();
  }

  async deleteSelectedMeasure() {
    if (!this.currentScore || this.editingMeasureId == null) return;

    if (confirm(`Opravdu chcete smazat takt #${this.editingMeasureId}?`)) {
      this.currentScore.measures = this.currentScore.measures.filter(m => m.id !== this.editingMeasureId);

      this.currentScore.measures.forEach((m, idx) => {
        m.id = idx + 1;
      });

      await this.persistCurrentScore();

      if (this.activeEditor) {
        this.activeEditor.destroy();
        this.activeEditor = null;
      }
      this.editingMeasureId = null;

      document.getElementById('addMeasureBtn').style.display = 'none';
      document.getElementById('setKeySigBtn').style.display = 'none';
      document.getElementById('deleteSelectedMeasureBtn').style.display = 'none';
      document.getElementById('editSubbar').style.display = 'none';

      this.updateUI();
      this.renderScoreView();
      document.getElementById('statusHint').innerText = 'Takt byl smazán a zbývající takty přečíslovány.';
    }
  }

  async clearMeasures() {
    if (!this.currentScore) return;
    if (confirm('Opravdu chcete smazat všechny označené takty pro celou tuto skladbu?')) {
      this.currentScore.measures = [];
      this.currentScore.keySignatures = [];
      this.currentIndex = 0;
      await this.persistCurrentScore();
      if (this.activeEditor) {
        this.activeEditor.destroy();
        this.activeEditor = null;
      }
      this.editingMeasureId = null;
      document.getElementById('editSubbar').style.display = 'none';
      document.getElementById('addMeasureBtn').style.display = 'none';
      document.getElementById('setKeySigBtn').style.display = 'none';
      document.getElementById('deleteSelectedMeasureBtn').style.display = 'none';
      this.updateUI();
      this.renderScoreView();
    }
  }

  updateUI() {
    const count = (this.currentScore && this.currentScore.measures) ? this.currentScore.measures.length : 0;
    document.getElementById('measureCountSpan').innerText = count;
    document.getElementById('clearMeasuresBtn').style.display = count > 0 ? 'inline-flex' : 'none';

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
    const pageCanvas = this.pageCache.get(this.currentPage);
    if (!pageCanvas) return;

    this.scoreCtx.clearRect(0, 0, this.scoreCanvas.width, this.scoreCanvas.height);
    this.scoreCtx.drawImage(pageCanvas, 0, 0);

    // Vykreslení klíčů/předznamenání
    if (this.currentScore && this.currentScore.keySignatures) {
      this.currentScore.keySignatures.forEach((k) => {
        if (k.page !== this.currentPage) return;
        this.scoreCtx.strokeStyle = 'rgba(234, 179, 8, 0.9)';
        this.scoreCtx.lineWidth = 2.5;
        this.scoreCtx.strokeRect(k.box.left, k.box.top, k.box.width, k.box.height);

        this.scoreCtx.fillStyle = '#eab308';
        this.scoreCtx.font = 'bold 15px sans-serif';
        this.scoreCtx.fillText('🎼 Klíč', k.box.left + 5, k.box.top + 18);
      });
    }

    // Vykreslení taktů
    if (this.currentScore && this.currentScore.measures) {
      this.currentScore.measures.forEach((m) => {
        const mPage = m.page || 1;
        if (mPage !== this.currentPage) return;

        if (this.editingMeasureId === m.id) return;

        this.scoreCtx.strokeStyle = 'rgba(34, 197, 94, 0.85)';
        this.scoreCtx.lineWidth = 2.5;
        this.scoreCtx.strokeRect(m.box.left, m.box.top, m.box.width, m.box.height);

        this.scoreCtx.fillStyle = '#22c55e';
        this.scoreCtx.font = 'bold 18px sans-serif';
        this.scoreCtx.fillText(`${m.id}`, m.box.left + 6, m.box.top + 22);
      });
    }
  }

  updatePracticeStackCount() {
    const sel = document.getElementById('stackCountSelect').value;
    this.stackCount = sel === 'loop' ? 'loop' : Number(sel);
    this.showMeasureInTrainer(this.currentIndex);
  }

  async showMeasureInTrainer(index) {
    if (!this.currentScore || !this.currentScore.measures || this.currentScore.measures.length === 0) return;
    const measures = this.currentScore.measures;
    const count = measures.length;

    if (index < 0) index = 0;
    if (index >= count) index = count - 1;
    this.currentIndex = index;

    const currentM = measures[index];
    const targetPage = currentM.page || 1;

    // 1. Zobrazení klíče a předznamenání
    const keySig = this.getKeySignatureForMeasure(index, targetPage);
    const clefEmptyHint = document.getElementById('clefEmptyHint');
    const clefPreviewWrap = document.getElementById('clefPreviewWrap');

    if (keySig && this.clefCtx) {
      clefEmptyHint.style.display = 'none';
      clefPreviewWrap.style.display = 'flex';

      const keyPageImg = await this.getPageImage(keySig.page || 1);
      if (keyPageImg) {
        this.clefCanvas.width = keySig.box.width;
        this.clefCanvas.height = keySig.box.height;
        this.clefCtx.clearRect(0, 0, keySig.box.width, keySig.box.height);
        this.clefCtx.drawImage(
          keyPageImg,
          keySig.box.left, keySig.box.top, keySig.box.width, keySig.box.height,
          0, 0, keySig.box.width, keySig.box.height
        );
      }
    } else {
      clefEmptyHint.style.display = 'inline';
      clefPreviewWrap.style.display = 'none';
    }

    // 2. Příprava taktů k zobrazení pod sebou
    let measuresToStack = [];
    if (this.stackCount === 'loop') {
      const loopFrom = Math.max(1, Math.min(count, Number(document.getElementById('loopFrom').value) || 1)) - 1;
      const loopTo = Math.max(1, Math.min(count, Number(document.getElementById('loopTo').value) || count)) - 1;
      for (let i = loopFrom; i <= loopTo; i++) {
        measuresToStack.push(measures[i]);
      }
    } else {
      const num = Math.min(this.stackCount, count);
      for (let i = 0; i < num; i++) {
        const mIdx = (index + i) % count;
        measuresToStack.push(measures[mIdx]);
      }
    }

    // 3. Vykreslení taktů čistě pod sebou bez modrých rámečků
    let maxWidth = 0;
    const renderedImages = [];
    for (const m of measuresToStack) {
      const pImg = await this.getPageImage(m.page || 1);
      renderedImages.push({ m, pImg });
      if (m.box.width > maxWidth) maxWidth = m.box.width;
    }
    if (maxWidth < 200) maxWidth = 200;

    const rowSpacing = 16;
    let totalCanvasHeight = 0;

    renderedImages.forEach(item => {
      totalCanvasHeight += item.m.box.height + rowSpacing;
    });

    this.practiceCanvas.width = maxWidth;
    this.practiceCanvas.height = Math.max(160, totalCanvasHeight);
    this.practiceCtx.fillStyle = '#ffffff';
    this.practiceCtx.fillRect(0, 0, this.practiceCanvas.width, this.practiceCanvas.height);

    let currentY = 8;
    renderedImages.forEach(({ m, pImg }) => {
      if (pImg) {
        this.practiceCtx.drawImage(
          pImg,
          m.box.left, m.box.top, m.box.width, m.box.height,
          0, currentY, m.box.width, m.box.height
        );
      }
      currentY += m.box.height + rowSpacing;
    });

    const pageStr = this.totalPages > 1 ? ` (strana ${targetPage})` : '';
    document.getElementById('practiceMeasureTitle').innerText = `Takt ${index + 1} / ${count}${pageStr}`;
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

    // Aktivace WakeLock při přechodu do cvičení
    if (window.wakeLockManager) {
      window.wakeLockManager.request();
    }

    app.showMeasureInTrainer(app.currentIndex);
  }
}

// 5. OBSLUHA FOCENÍ A NAHRÁVÁNÍ SOUBORŮ

// A) Vyfocení nové skladby fotoaparátem přímo z pultu
document.getElementById('cameraInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const hint = document.getElementById('statusHint');
  hint.innerText = 'Zpracovávám vyfocené noty...';
  const songName = 'Noty ' + new Date().toLocaleDateString('cs-CZ') + ' ' + new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });

  try {
    const compressedDataUrl = await compressImageFile(file);
    await app.saveNewScoreToLibrary(songName, {
      isPdf: false,
      imageData: compressedDataUrl,
      pages: [compressedDataUrl]
    });
  } catch (err) {
    console.error('Chyba fotoaparátu:', err);
    hint.innerText = 'Chyba při zpracování fotky: ' + err.message;
  } finally {
    e.target.value = '';
  }
});

// B) Přidání další vyfocené strany k otevřené skladbě
document.getElementById('addPageInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const hint = document.getElementById('statusHint');
  hint.innerText = 'Ukládám další vyfocenou stranu...';

  try {
    const compressedDataUrl = await compressImageFile(file);
    await app.appendPageToCurrentScore(compressedDataUrl);
  } catch (err) {
    console.error('Chyba při focení další strany:', err);
    hint.innerText = 'Chyba při focení strany: ' + err.message;
  } finally {
    e.target.value = '';
  }
});

// C) Nahrání souboru (PDF nebo obrázek) z disku
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
      await app.saveNewScoreToLibrary(songName, {
        isPdf: true,
        pdfData: arrayBuffer
      });
    } else {
      const compressedDataUrl = await compressImageFile(file);
      await app.saveNewScoreToLibrary(songName, {
        isPdf: false,
        imageData: compressedDataUrl,
        pages: [compressedDataUrl]
      });
    }
  } catch (err) {
    console.error('Chyba nahrávání:', err);
    hint.innerText = 'Chyba při zpracování souboru: ' + err.message;
  } finally {
    e.target.value = '';
  }
});