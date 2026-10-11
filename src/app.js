if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// 1. ZPRACOVÁNÍ A KONTRAST FOTKY
async function processAndEnhancePhoto(file, maxDimension = 2400) {
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

      const imgData = ctx.getImageData(0, 0, w, h);
      const data = imgData.data;

      let sampleSum = 0, sampleCount = 0;
      for (let i = 0; i < data.length; i += 64) {
        const lum = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
        sampleSum += lum;
        sampleCount++;
      }
      const avgPaper = sampleCount > 0 ? (sampleSum / sampleCount) : 200;
      const whitePoint = Math.min(255, Math.max(160, avgPaper * 0.92));
      const blackPoint = 75;

      for (let i = 0; i < data.length; i += 4) {
        let lum = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
        let enhanced;
        if (lum >= whitePoint) {
          enhanced = 255;
        } else if (lum <= blackPoint) {
          enhanced = 0;
        } else {
          enhanced = Math.round(((lum - blackPoint) / (whitePoint - blackPoint)) * 255);
        }
        data[i] = enhanced;
        data[i+1] = enhanced;
        data[i+2] = enhanced;
      }

      ctx.putImageData(imgData, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', 0.90));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// 2. DETEKCE TAKTOVÝCH ČAR A OSNOV
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

// 3. EDITOR RÁMEČKU
class MeasureBoxEditor {
  constructor(canvas, renderCallback, initialBox, onUpdate, isBarLineFn, isCropBox = false) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.renderCallback = renderCallback;
    this.box = { ...initialBox };
    this.onUpdate = onUpdate;
    this.isBarLineFn = isBarLineFn;
    this.isCropBox = isCropBox;
    this.touchTolerance = 36;

    this.activeAction = null;
    this.dragStart = { x: 0, y: 0 };
    this.initialBoxState = null;

    this.loupeEl = document.getElementById('touchLoupe');
    this.loupeCanvas = document.getElementById('loupeCanvas');
    this.loupeCtx = this.loupeCanvas ? this.loupeCanvas.getContext('2d') : null;

    this.render();
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

  startDrag(action, canvasX, canvasY, clientX, clientY) {
    this.activeAction = action;
    this.dragStart = { x: canvasX, y: canvasY };
    this.initialBoxState = { ...this.box };

    if (action !== 'drag') {
      this.updateLoupe(clientX, clientY, canvasX, canvasY);
    }
  }

  moveDrag(canvasX, canvasY, clientX, clientY) {
    if (!this.activeAction) return;
    const dx = canvasX - this.dragStart.x;
    const dy = canvasY - this.dragStart.y;
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
      this.updateLoupe(clientX, clientY, targetX, canvasY);
    }
    if (this.onUpdate) this.onUpdate(this.box);
  }

  endDrag() {
    if (this.activeAction) {
      this.activeAction = null;
      if (this.loupeEl) this.loupeEl.style.display = 'none';
    }
  }

  destroy() {
    if (this.loupeEl) this.loupeEl.style.display = 'none';
  }

  updateLoupe(clientX, clientY, targetCanvasX, targetCanvasY) {
    if (!this.loupeEl || !this.loupeCanvas || !this.loupeCtx) return;

    this.loupeEl.style.display = 'block';
    this.loupeEl.style.left = clientX + 'px';
    this.loupeEl.style.top = clientY + 'px';

    const lw = this.loupeCanvas.width;
    const lh = this.loupeCanvas.height;
    const zoom = 2.0;
    const cropW = lw / zoom;
    const cropH = lh / zoom;

    const sx = Math.max(0, Math.min(this.canvas.width - cropW, targetCanvasX - cropW / 2));
    const sy = Math.max(0, Math.min(this.canvas.height - cropH, targetCanvasY - cropH / 2));

    this.loupeCtx.clearRect(0, 0, lw, lh);
    this.loupeCtx.drawImage(this.canvas, sx, sy, cropW, cropH, 0, 0, lw, lh);

    this.loupeCtx.strokeStyle = 'rgba(239, 68, 68, 0.9)';
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
    if (this.isCropBox) {
      c.fillStyle = 'rgba(0, 0, 0, 0.60)';
      c.fillRect(0, 0, this.canvas.width, b.top);
      c.fillRect(0, b.top + b.height, this.canvas.width, this.canvas.height - (b.top + b.height));
      c.fillRect(0, b.top, b.left, b.height);
      c.fillRect(b.left + b.width, b.top, this.canvas.width - (b.left + b.width), b.height);

      c.strokeStyle = '#38bdf8';
      c.lineWidth = 3.5;
      c.setLineDash([8, 6]);
      c.strokeRect(b.left, b.top, b.width, b.height);
      c.setLineDash([]);
    } else {
      c.fillStyle = 'rgba(37, 99, 235, 0.22)';
      c.fillRect(b.left, b.top, b.width, b.height);

      c.strokeStyle = '#1d4ed8';
      c.lineWidth = 4;
      c.strokeRect(b.left, b.top, b.width, b.height);
    }

    c.fillStyle = '#ffffff';
    c.strokeStyle = this.isCropBox ? '#0284c7' : '#1d4ed8';
    c.lineWidth = 3.5;

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
      c.arc(h.x, h.y, 9.5, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    });

    c.restore();
  }
}

// 4. HLAVNÍ APLIKACE S ROBUSTNÍM ZOOMEM A POSUVEM
class GuitarTrainer {
  constructor() {
    this.scoreCanvas = document.getElementById('scoreCanvas');
    this.scoreCtx = this.scoreCanvas.getContext('2d');
    this.canvasBox = document.getElementById('canvasBox');
    this.canvasViewport = document.getElementById('canvasViewport');

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

    // Viewport transformace: měřítko a souřadnice
    this.zoomScale = 1.0;
    this.panX = 0;
    this.panY = 0;

    this.activeType = null;
    this.editingId = null;

    this.isCropMode = false;
    this.cropEditor = null;

    this.stackCount = 1;

    this.initLibrary();
    this.initTouchEngine();
    this.initPracticeGestures();
  }

  updateViewportTransform() {
    if (!this.canvasViewport) return;
    this.canvasViewport.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoomScale})`;
    const indicator = document.getElementById('zoomLevelSpan');
    if (indicator) {
      indicator.innerText = Math.round(this.zoomScale * 100) + '%';
    }
  }

  zoomScore(delta) {
    const boxRect = this.canvasBox.getBoundingClientRect();
    const cx = boxRect.width / 2;
    const cy = boxRect.height / 2;
    this.applyZoomAt(this.zoomScale + delta, cx, cy);
  }

  resetZoom() {
    this.fitCanvasToScreen();
  }

  fitCanvasToScreen() {
    if (!this.scoreCanvas || this.scoreCanvas.width === 0) return;
    const boxRect = this.canvasBox.getBoundingClientRect();

    // Přesný výpočet pro zobrazení celé stránky bez ořezu na výšku i šířku
    const scaleX = (boxRect.width - 24) / this.scoreCanvas.width;
    const scaleY = (boxRect.height - 24) / this.scoreCanvas.height;
    this.zoomScale = Math.min(scaleX, scaleY, 1.0);

    // Vycentrování na střed kontejneru
    this.panX = (boxRect.width - this.scoreCanvas.width * this.zoomScale) / 2;
    this.panY = Math.max(8, (boxRect.height - this.scoreCanvas.height * this.zoomScale) / 2);

    this.updateViewportTransform();
  }

  applyZoomAt(newScale, centerScreenX, centerScreenY) {
    // Snížená minimální hranice na 0.15 pro stoprocentní jistotu oddálení
    const clampedScale = Math.max(0.15, Math.min(4.0, newScale));
    const factor = clampedScale / this.zoomScale;

    this.panX = centerScreenX - (centerScreenX - this.panX) * factor;
    this.panY = centerScreenY - (centerScreenY - this.panY) * factor;
    this.zoomScale = clampedScale;
    this.updateViewportTransform();
  }

  screenToCanvasCoords(clientX, clientY) {
    const boxRect = this.canvasBox.getBoundingClientRect();
    const xInBox = clientX - boxRect.left;
    const yInBox = clientY - boxRect.top;

    return {
      x: (xInBox - this.panX) / this.zoomScale,
      y: (yInBox - this.panY) / this.zoomScale
    };
  }

  initTouchEngine() {
    const box = this.canvasBox;
    const ongoingTouches = new Map();
    let initialPinchDist = null;
    let initialPinchScale = 1.0;
    let isDraggingHandle = false;
    let isPanningOneFinger = false;
    let startPoint = null;
    let lastTapTime = 0;

    box.addEventListener('pointerdown', (e) => {
      ongoingTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (ongoingTouches.size === 1) {
        startPoint = { x: e.clientX, y: e.clientY };
        const canvasCoords = this.screenToCanvasCoords(e.clientX, e.clientY);
        const activeEditor = this.isCropMode ? this.cropEditor : this.activeEditor;

        if (activeEditor) {
          const tol = activeEditor.touchTolerance / this.zoomScale;
          const action = activeEditor.hitTest(canvasCoords.x, canvasCoords.y, tol);
          if (action) {
            isDraggingHandle = true;
            activeEditor.startDrag(action, canvasCoords.x, canvasCoords.y, e.clientX, e.clientY);
            box.setPointerCapture(e.pointerId);
            return;
          }
        }
        isPanningOneFinger = true;
        box.setPointerCapture(e.pointerId);
      } else if (ongoingTouches.size === 2) {
        isDraggingHandle = false;
        isPanningOneFinger = false;
        if (this.activeEditor) this.activeEditor.endDrag();
        if (this.cropEditor) this.cropEditor.endDrag();

        const touches = Array.from(ongoingTouches.values());
        initialPinchDist = Math.hypot(touches[0].x - touches[1].x, touches[0].y - touches[1].y);
        initialPinchScale = this.zoomScale;
      }
    });

    box.addEventListener('pointermove', (e) => {
      if (!ongoingTouches.has(e.pointerId)) return;
      const prev = ongoingTouches.get(e.pointerId);
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      ongoingTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (ongoingTouches.size === 2) {
        const touches = Array.from(ongoingTouches.values());
        const currentDist = Math.hypot(touches[0].x - touches[1].x, touches[0].y - touches[1].y);
        const boxRect = box.getBoundingClientRect();
        const centerScreenX = (touches[0].x + touches[1].x) / 2 - boxRect.left;
        const centerScreenY = (touches[0].y + touches[1].y) / 2 - boxRect.top;

        if (initialPinchDist > 0) {
          const targetScale = initialPinchScale * (currentDist / initialPinchDist);
          this.applyZoomAt(targetScale, centerScreenX, centerScreenY);
        }
        this.panX += dx / 2;
        this.panY += dy / 2;
        this.updateViewportTransform();
        return;
      }

      if (ongoingTouches.size === 1) {
        if (isDraggingHandle) {
          const canvasCoords = this.screenToCanvasCoords(e.clientX, e.clientY);
          const activeEditor = this.isCropMode ? this.cropEditor : this.activeEditor;
          if (activeEditor) {
            activeEditor.moveDrag(canvasCoords.x, canvasCoords.y, e.clientX, e.clientY);
          }
        } else if (isPanningOneFinger) {
          this.panX += dx;
          this.panY += dy;
          this.updateViewportTransform();
        }
      }
    });

    const finishPointer = (e) => {
      if (ongoingTouches.has(e.pointerId)) {
        ongoingTouches.delete(e.pointerId);
      }

      if (ongoingTouches.size === 0) {
        if (isDraggingHandle) {
          isDraggingHandle = false;
          if (this.activeEditor) this.activeEditor.endDrag();
          if (this.cropEditor) this.cropEditor.endDrag();
        }

        if (startPoint && !this.isCropMode) {
          const movedDist = Math.hypot(e.clientX - startPoint.x, e.clientY - startPoint.y);
          if (movedDist < 8 && !isDraggingHandle) {
            const currentTime = Date.now();
            // DOUBLE-TAP: Rychlé dvojkliknutí vrátí zobrazení celé obrazovky
            if (currentTime - lastTapTime < 280) {
              this.fitCanvasToScreen();
              lastTapTime = 0;
            } else {
              lastTapTime = currentTime;
              this.handleCanvasTap(e.clientX, e.clientY);
            }
          }
        }
        isPanningOneFinger = false;
        startPoint = null;
        initialPinchDist = null;
      }
    };

    box.addEventListener('pointerup', finishPointer);
    box.addEventListener('pointercancel', finishPointer);
  }

  handleCanvasTap(clientX, clientY) {
    if (!this.currentScore) return;
    const cleanCanvas = this.pageCache.get(this.currentPage);
    if (!cleanCanvas) return;

    const coords = this.screenToCanvasCoords(clientX, clientY);
    const clickX = coords.x;
    const clickY = coords.y;

    if (clickX < 0 || clickX > cleanCanvas.width || clickY < 0 || clickY > cleanCanvas.height) return;

    // 1. Klepnutí do existujícího uloženého TAKTU
    const measures = this.currentScore.measures || [];
    const clickedMeasure = measures.find(m => {
      if ((m.page || 1) !== this.currentPage) return false;
      const b = m.box;
      return (clickX >= b.left && clickX <= b.left + b.width &&
              clickY >= b.top && clickY <= b.top + b.height);
    });

    if (clickedMeasure) {
      this.activeType = 'measure';
      this.editingId = clickedMeasure.id;

      const scanResult = scanStaffAndBarlinesFromCanvas(cleanCanvas, clickX, clickY);

      if (this.activeEditor) this.activeEditor.destroy();
      this.activeEditor = new MeasureBoxEditor(
        this.scoreCanvas,
        () => this.renderScoreView(),
        clickedMeasure.box,
        () => {},
        scanResult.isBarLine
      );

      this.updateActiveControlButtons();
      document.getElementById('statusHint').innerText = `Označen takt #${clickedMeasure.id}. Můžete upravit, smazat nebo změnit na Klíč.`;
      return;
    }

    // 2. Klepnutí do existujícího uloženého KLÍČE
    const keySigs = this.currentScore.keySignatures || [];
    const clickedKeySig = keySigs.find(k => {
      if ((k.page || 1) !== this.currentPage) return false;
      const b = k.box;
      return (clickX >= b.left && clickX <= b.left + b.width &&
              clickY >= b.top && clickY <= b.top + b.height);
    });

    if (clickedKeySig) {
      this.activeType = 'keySig';
      this.editingId = clickedKeySig.id;

      const scanResult = scanStaffAndBarlinesFromCanvas(cleanCanvas, clickX, clickY);

      if (this.activeEditor) this.activeEditor.destroy();
      this.activeEditor = new MeasureBoxEditor(
        this.scoreCanvas,
        () => this.renderScoreView(),
        clickedKeySig.box,
        () => {},
        scanResult.isBarLine
      );

      this.updateActiveControlButtons();
      document.getElementById('statusHint').innerText = `Označen Klíč/Předznamenání. Můžete upravit, smazat nebo převést na Takt.`;
      return;
    }

    // 3. Nový výběr podle osnovy
    this.activeType = 'new';
    this.editingId = null;

    const scanResult = scanStaffAndBarlinesFromCanvas(cleanCanvas, clickX, clickY);

    if (this.activeEditor) this.activeEditor.destroy();
    this.activeEditor = new MeasureBoxEditor(
      this.scoreCanvas,
      () => this.renderScoreView(),
      scanResult.box,
      () => {},
      scanResult.isBarLine
    );

    this.updateActiveControlButtons();
    document.getElementById('statusHint').innerText = 'Místo ohraničeno. Uložte jako takt, nebo jako Klíč/Předznamenání.';
  }

  async initLibrary() {
    try {
      const all = await window.scoreDB.getAllScores();
      document.getElementById('libCountSpan').innerText = all.length;
      this.renderLibraryList(all);

      if (all.length > 0) {
        all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        await this.loadScore(all[0].id, false);
      }
    } catch (e) {
      console.warn('Chyba při čtení knihovny:', e);
    }
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
      const isCurrent = this.currentScore && this.currentScore.id === s.id;
      item.className = 'library-item' + (isCurrent ? ' active' : '');
      item.onclick = async () => {
        await this.loadScore(s.id, true);
      };

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

  async exportBackupJSON() {
    try {
      const all = await window.scoreDB.getAllScores();
      if (!all || all.length === 0) {
        alert('Knihovna je prázdná, není co exportovat.');
        return;
      }
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(all));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `notovy_trenazer_zaloha_${new Date().toISOString().slice(0,10)}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    } catch (err) {
      alert('Chyba při exportu: ' + err.message);
    }
  }

  async loadScore(id, switchTabToEdit = true) {
    const score = await window.scoreDB.getScore(id);
    if (!score) return;

    this.currentScore = score;
    this.currentIndex = 0;
    this.currentPage = 1;
    this.pageCache.clear();
    this.pdfDoc = null;

    this.resetActiveSelection();

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

    const titleEl = document.getElementById('scoreTitleDisplay');
    if (titleEl) titleEl.innerText = score.name || 'Notový Trenažér';
    document.getElementById('activeFileBanner').style.display = 'flex';

    document.getElementById('renameScoreBtn').style.display = 'inline-flex';
    document.getElementById('cropPaperBtn').style.display = score.isPdf ? 'none' : 'inline-flex';
    document.getElementById('addPageBtn').style.display = score.isPdf ? 'none' : 'inline-flex';

    this.updatePageSwitcherUI();
    await this.renderCurrentPage();
    this.fitCanvasToScreen();
    this.updateUI();

    const all = await window.scoreDB.getAllScores();
    this.renderLibraryList(all);

    if (switchTabToEdit) {
      switchMode('edit');
    }
  }

  resetActiveSelection() {
    if (this.activeEditor) {
      this.activeEditor.destroy();
      this.activeEditor = null;
    }
    this.activeType = null;
    this.editingId = null;

    document.getElementById('editSubbar').style.display = 'none';
    document.getElementById('addMeasureBtn').style.display = 'none';
    document.getElementById('setKeySigBtn').style.display = 'none';
    document.getElementById('toggleCategoryBtn').style.display = 'none';
    document.getElementById('deleteActiveBoxBtn').style.display = 'none';
  }

  async renameCurrentScore() {
    if (!this.currentScore) return;
    const currentName = this.currentScore.name || 'Skladba';
    const newName = prompt('Zadejte nový název skladby:', currentName);
    if (newName && newName.trim() && newName.trim() !== currentName) {
      this.currentScore.name = newName.trim();
      document.getElementById('scoreTitleDisplay').innerText = this.currentScore.name;
      await this.persistCurrentScore();
      const all = await window.scoreDB.getAllScores();
      this.renderLibraryList(all);
    }
  }

  startPaperCrop() {
    if (!this.currentScore || this.currentScore.isPdf) return;
    this.resetActiveSelection();

    const cleanCanvas = this.pageCache.get(this.currentPage);
    if (!cleanCanvas) return;

    switchMode('edit');
    this.isCropMode = true;
    document.getElementById('editToolbar').style.display = 'none';
    document.getElementById('cropToolbar').style.display = 'flex';
    document.getElementById('statusHint').innerText = 'Nastavte rohy rámečku k okrajům papíru a klepněte na "✔ Použít ořez".';

    const marginX = Math.round(cleanCanvas.width * 0.05);
    const marginY = Math.round(cleanCanvas.height * 0.05);
    const initBox = {
      left: marginX,
      top: marginY,
      width: cleanCanvas.width - marginX * 2,
      height: cleanCanvas.height - marginY * 2
    };

    this.cropEditor = new MeasureBoxEditor(
      this.scoreCanvas,
      () => this.renderScoreView(),
      initBox,
      () => {},
      null,
      true
    );
  }

  async applyPaperCrop() {
    if (!this.cropEditor || !this.isCropMode) return;
    const b = this.cropEditor.box;
    const cleanCanvas = this.pageCache.get(this.currentPage);
    if (!cleanCanvas) return;

    const cropW = Math.max(50, Math.round(b.width));
    const cropH = Math.max(50, Math.round(b.height));

    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = cropW;
    croppedCanvas.height = cropH;
    const cctx = croppedCanvas.getContext('2d');

    cctx.drawImage(cleanCanvas, b.left, b.top, b.width, b.height, 0, 0, cropW, cropH);

    const croppedDataUrl = croppedCanvas.toDataURL('image/jpeg', 0.90);
    const shiftX = Math.round(b.left);
    const shiftY = Math.round(b.top);

    if (this.currentScore.measures) {
      this.currentScore.measures.forEach(m => {
        if ((m.page || 1) === this.currentPage) {
          m.box.left = Math.max(0, m.box.left - shiftX);
          m.box.top = Math.max(0, m.box.top - shiftY);
        }
      });
    }

    if (this.currentScore.keySignatures) {
      this.currentScore.keySignatures.forEach(k => {
        if ((k.page || 1) === this.currentPage) {
          k.box.left = Math.max(0, k.box.left - shiftX);
          k.box.top = Math.max(0, k.box.top - shiftY);
        }
      });
    }

    this.pageCache.set(this.currentPage, croppedCanvas);

    if (this.currentScore.pages && this.currentScore.pages.length > 0) {
      this.currentScore.pages[this.currentPage - 1] = croppedDataUrl;
    } else {
      this.currentScore.imageData = croppedDataUrl;
    }

    await this.persistCurrentScore();
    this.cancelPaperCrop();
    await this.renderCurrentPage();
    this.fitCanvasToScreen();
    document.getElementById('statusHint').innerText = 'Papír byl úspěšně oříznut.';
  }

  cancelPaperCrop() {
    if (this.cropEditor) {
      this.cropEditor.destroy();
      this.cropEditor = null;
    }
    this.isCropMode = false;
    document.getElementById('cropToolbar').style.display = 'none';
    document.getElementById('editToolbar').style.display = 'flex';
    this.renderScoreView();
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

    this.resetActiveSelection();
    this.currentPage = target;
    this.updatePageSwitcherUI();
    await this.renderCurrentPage();
    this.fitCanvasToScreen();
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
    document.getElementById('libCountSpan').innerText = all.length;
    await this.loadScore(id, true);
  }

  async appendPageToCurrentScore(imageData) {
    if (!this.currentScore) return;
    if (this.currentScore.isPdf) {
      alert('K PDF dokumentu nelze přidávat vyfocené strany.');
      return;
    }

    if (!this.currentScore.pages || this.currentScore.pages.length === 0) {
      this.currentScore.pages = [this.currentScore.imageData];
    }
    this.currentScore.pages.push(imageData);
    this.totalPages = this.currentScore.pages.length;
    this.currentPage = this.totalPages;

    await this.persistCurrentScore();
    this.updatePageSwitcherUI();
    await this.renderCurrentPage();
    this.fitCanvasToScreen();
    document.getElementById('statusHint').innerText = `Přidána vyfocená strana ${this.currentPage}.`;
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
          await this.loadScore(all[0].id, false);
        } else {
          this.currentScore = null;
          this.pdfDoc = null;
          this.pageCache.clear();
          this.scoreCtx.clearRect(0, 0, this.scoreCanvas.width, this.scoreCanvas.height);
          this.updatePageSwitcherUI();
          this.updateUI();
          document.getElementById('scoreTitleDisplay').innerText = 'Není vybrána žádná skladba';
          document.getElementById('activeFileBanner').style.display = 'none';
          document.getElementById('cropPaperBtn').style.display = 'none';
          document.getElementById('renameScoreBtn').style.display = 'none';
          document.getElementById('addPageBtn').style.display = 'none';
        }
      }
      this.renderLibraryList(all);
    }
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

  updateActiveControlButtons() {
    const addBtn = document.getElementById('addMeasureBtn');
    const setKeyBtn = document.getElementById('setKeySigBtn');
    const toggleCatBtn = document.getElementById('toggleCategoryBtn');
    const delBtn = document.getElementById('deleteActiveBoxBtn');
    const subbar = document.getElementById('editSubbar');

    subbar.style.display = 'flex';
    delBtn.style.display = 'inline-flex';

    if (this.activeType === 'measure') {
      addBtn.style.display = 'inline-flex';
      addBtn.innerHTML = `✔ Aktualizovat takt <span>${this.editingId}</span>`;
      setKeyBtn.style.display = 'none';

      toggleCatBtn.style.display = 'inline-flex';
      toggleCatBtn.innerHTML = `🔄 Změnit na Klíč`;
    } else if (this.activeType === 'keySig') {
      addBtn.style.display = 'none';
      setKeyBtn.style.display = 'inline-flex';
      setKeyBtn.innerHTML = `✔ Aktualizovat Klíč`;

      toggleCatBtn.style.display = 'inline-flex';
      toggleCatBtn.innerHTML = `🔄 Změnit na Takt`;
    } else {
      addBtn.style.display = 'inline-flex';
      addBtn.innerHTML = `✔ Uložit takt <span>${(this.currentScore.measures || []).length + 1}</span>`;

      setKeyBtn.style.display = 'inline-flex';
      setKeyBtn.innerHTML = `🎼 Uložit jako Klíč`;
      toggleCatBtn.style.display = 'none';
    }
  }

  async deleteActiveBox() {
    if (!this.activeEditor || !this.currentScore) return;

    if (this.activeType === 'measure' && this.editingId != null) {
      if (confirm(`Opravdu chcete smazat takt #${this.editingId}?`)) {
        this.currentScore.measures = this.currentScore.measures.filter(m => m.id !== this.editingId);
        this.currentScore.measures.forEach((m, idx) => m.id = idx + 1);
        await this.persistCurrentScore();
        this.resetActiveSelection();
        this.updateUI();
        this.renderScoreView();
        document.getElementById('statusHint').innerText = 'Takt byl smazán a zbývající takty přečíslovány.';
      }
    } else if (this.activeType === 'keySig' && this.editingId != null) {
      if (confirm('Opravdu chcete smazat tento Klíč / Předznamenání?')) {
        this.currentScore.keySignatures = (this.currentScore.keySignatures || []).filter(k => k.id !== this.editingId);
        await this.persistCurrentScore();
        this.resetActiveSelection();
        this.renderScoreView();
        document.getElementById('statusHint').innerText = 'Klíč / Předznamenání bylo smazáno.';
      }
    } else {
      this.resetActiveSelection();
      this.renderScoreView();
      document.getElementById('statusHint').innerText = 'Výběr zrušen.';
    }
  }

  async toggleActiveCategory() {
    if (!this.activeEditor || !this.currentScore) return;

    if (this.activeType === 'measure') {
      const mIdx = this.currentScore.measures.findIndex(m => m.id === this.editingId);
      if (mIdx !== -1) {
        this.currentScore.measures.splice(mIdx, 1);
        this.currentScore.measures.forEach((m, idx) => m.id = idx + 1);

        if (!this.currentScore.keySignatures) this.currentScore.keySignatures = [];
        const newKeySig = {
          id: 'key_' + Date.now(),
          page: this.currentPage,
          fromMeasureIndex: Math.max(0, mIdx),
          box: { ...this.activeEditor.box }
        };
        this.currentScore.keySignatures.push(newKeySig);
        this.currentScore.keySignatures.sort((a, b) => a.fromMeasureIndex - b.fromMeasureIndex);

        await this.persistCurrentScore();
        this.resetActiveSelection();
        this.updateUI();
        this.renderScoreView();
        document.getElementById('statusHint').innerText = 'Změněno na Klíč/Předznamenání.';
      }
    } else if (this.activeType === 'keySig') {
      const kIdx = (this.currentScore.keySignatures || []).findIndex(k => k.id === this.editingId);
      if (kIdx !== -1) {
        this.currentScore.keySignatures.splice(kIdx, 1);

        if (!this.currentScore.measures) this.currentScore.measures = [];
        const newMeasure = {
          id: this.currentScore.measures.length + 1,
          page: this.currentPage,
          box: { ...this.activeEditor.box }
        };
        this.currentScore.measures.push(newMeasure);

        await this.persistCurrentScore();
        this.resetActiveSelection();
        this.updateUI();
        this.renderScoreView();
        document.getElementById('statusHint').innerText = `Změněno na Takt #${newMeasure.id}.`;
      }
    }
  }

  async saveCurrentAsKeySignature() {
    if (!this.activeEditor || !this.currentScore) return;
    if (!this.currentScore.keySignatures) this.currentScore.keySignatures = [];

    const fromMeasure = (this.activeType === 'measure' && this.editingId != null) 
      ? (this.editingId - 1) 
      : ((this.currentScore.measures || []).length);

    if (this.activeType === 'keySig' && this.editingId != null) {
      const k = this.currentScore.keySignatures.find(item => item.id === this.editingId);
      if (k) {
        k.box = { ...this.activeEditor.box };
        k.page = this.currentPage;
      }
      document.getElementById('statusHint').innerText = 'Klíč aktualizován.';
    } else {
      const keySig = {
        id: 'key_' + Date.now(),
        page: this.currentPage,
        fromMeasureIndex: Math.max(0, fromMeasure),
        box: { ...this.activeEditor.box }
      };
      this.currentScore.keySignatures.push(keySig);
      this.currentScore.keySignatures.sort((a, b) => a.fromMeasureIndex - b.fromMeasureIndex);
      document.getElementById('statusHint').innerText = `Uloženo jako Klíč/Předznamenání (platí od taktu #${fromMeasure + 1}).`;
    }

    await this.persistCurrentScore();
    this.resetActiveSelection();
    this.renderScoreView();
  }

  async saveCurrentMeasure() {
    if (!this.activeEditor || !this.currentScore) return;
    if (!this.currentScore.measures) this.currentScore.measures = [];

    if (this.activeType === 'measure' && this.editingId != null) {
      const m = this.currentScore.measures.find(item => item.id === this.editingId);
      if (m) {
        m.box = { ...this.activeEditor.box };
        m.page = this.currentPage;
      }
      document.getElementById('statusHint').innerText = `Takt #${this.editingId} byl aktualizován.`;
    } else {
      this.currentScore.measures.push({
        id: this.currentScore.measures.length + 1,
        page: this.currentPage,
        box: { ...this.activeEditor.box }
      });
      document.getElementById('statusHint').innerText = 'Takt uložen. Můžete označit další.';
    }

    await this.persistCurrentScore();
    this.resetActiveSelection();
    this.updateUI();
    this.renderScoreView();
  }

  async clearMeasures() {
    if (!this.currentScore) return;
    if (confirm('Opravdu chcete smazat všechny označené takty pro celou tuto skladbu?')) {
      this.currentScore.measures = [];
      this.currentScore.keySignatures = [];
      this.currentIndex = 0;
      await this.persistCurrentScore();
      this.resetActiveSelection();
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

  // VYKRESLENÍ VÝRAZNÝCH RÁMEČKŮ
  renderScoreView() {
    const pageCanvas = this.pageCache.get(this.currentPage);
    if (!pageCanvas) return;

    this.scoreCtx.clearRect(0, 0, this.scoreCanvas.width, this.scoreCanvas.height);
    this.scoreCtx.drawImage(pageCanvas, 0, 0);

    // 1. Klíče a předznamenání
    if (this.currentScore && this.currentScore.keySignatures) {
      this.currentScore.keySignatures.forEach((k) => {
        if ((k.page || 1) !== this.currentPage) return;
        if (this.activeType === 'keySig' && this.editingId === k.id) return;

        this.scoreCtx.fillStyle = 'rgba(234, 179, 8, 0.16)';
        this.scoreCtx.fillRect(k.box.left, k.box.top, k.box.width, k.box.height);

        this.scoreCtx.strokeStyle = '#ca8a04';
        this.scoreCtx.lineWidth = 3.5;
        this.scoreCtx.strokeRect(k.box.left, k.box.top, k.box.width, k.box.height);

        this.scoreCtx.fillStyle = '#ca8a04';
        this.scoreCtx.fillRect(k.box.left, k.box.top, 54, 22);
        this.scoreCtx.fillStyle = '#ffffff';
        this.scoreCtx.font = 'bold 13px sans-serif';
        this.scoreCtx.fillText('🎼 Klíč', k.box.left + 5, k.box.top + 16);
      });
    }

    // 2. Takty
    if (this.currentScore && this.currentScore.measures) {
      this.currentScore.measures.forEach((m) => {
        if ((m.page || 1) !== this.currentPage) return;
        if (this.activeType === 'measure' && this.editingId === m.id) return;

        this.scoreCtx.fillStyle = 'rgba(34, 197, 94, 0.16)';
        this.scoreCtx.fillRect(m.box.left, m.box.top, m.box.width, m.box.height);

        this.scoreCtx.strokeStyle = '#16a34a';
        this.scoreCtx.lineWidth = 3.5;
        this.scoreCtx.strokeRect(m.box.left, m.box.top, m.box.width, m.box.height);

        const numText = `${m.id}`;
        const badgeW = Math.max(28, numText.length * 11 + 12);
        this.scoreCtx.fillStyle = '#16a34a';
        this.scoreCtx.fillRect(m.box.left, m.box.top, badgeW, 22);
        this.scoreCtx.fillStyle = '#ffffff';
        this.scoreCtx.font = 'bold 14px sans-serif';
        this.scoreCtx.fillText(numText, m.box.left + 6, m.box.top + 16);
      });
    }
  }

  // --- REŽIM CVIČENÍ ---
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

  getKeySignatureForMeasure(measureIndex, pageNum) {
    if (!this.currentScore || !this.currentScore.keySignatures || this.currentScore.keySignatures.length === 0) {
      return null;
    }
    const sigs = this.currentScore.keySignatures;
    let match = null;
    for (const sig of sigs) {
      if (sig.fromMeasureIndex <= measureIndex || (sig.page || 1) <= pageNum) {
        match = sig;
      }
    }
    return match || sigs[0];
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

    // Klíč v záhlaví
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

    // Takty pod sebou
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
    const prevIdx = (this.currentIndex - 1 + count) % count;
    this.showMeasureInTrainer(prevIdx);
  }
}

const app = new GuitarTrainer();

// PŘEPÍNÁNÍ ZÁLOŽEK
function switchMode(mode) {
  const tabLib = document.getElementById('tabLibrary');
  const tabEdit = document.getElementById('tabEdit');
  const tabPractice = document.getElementById('tabPractice');

  const libView = document.getElementById('libraryView');
  const editView = document.getElementById('editView');
  const practiceView = document.getElementById('practiceView');
  const editSubbar = document.getElementById('editSubbar');

  [tabLib, tabEdit, tabPractice].forEach(t => t.classList.remove('active'));
  [libView, editView, practiceView].forEach(v => v.style.display = 'none');
  editSubbar.style.display = 'none';

  if (mode === 'library') {
    tabLib.classList.add('active');
    libView.style.display = 'flex';
  } else if (mode === 'edit') {
    if (!app.currentScore) {
      alert('Nejprve vyberte nebo nahrajte skladbu.');
      switchMode('library');
      return;
    }
    tabEdit.classList.add('active');
    editView.style.display = 'flex';
    app.renderScoreView();
    app.fitCanvasToScreen();
  } else if (mode === 'practice') {
    if (!app.currentScore || !app.currentScore.measures || app.currentScore.measures.length === 0) {
      alert('Nejprve označte a uložte alespoň jeden takt.');
      switchMode('edit');
      return;
    }
    tabPractice.classList.add('active');
    practiceView.style.display = 'flex';

    if (window.wakeLockManager) {
      window.wakeLockManager.request();
    }
    app.showMeasureInTrainer(app.currentIndex);
  }
}

// 5. NAHRÁVÁNÍ SOUBORŮ A FOCENÍ
document.getElementById('cameraInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const defaultName = 'Noty ' + new Date().toLocaleDateString('cs-CZ') + ' ' + new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
  const userChosenName = prompt('Zadejte název skladby:', defaultName) || defaultName;

  try {
    const enhancedDataUrl = await processAndEnhancePhoto(file);
    await app.saveNewScoreToLibrary(userChosenName.trim(), {
      isPdf: false,
      imageData: enhancedDataUrl,
      pages: [enhancedDataUrl]
    });
  } catch (err) {
    console.error('Chyba fotoaparátu:', err);
    alert('Chyba při zpracování fotky: ' + err.message);
  } finally {
    e.target.value = '';
  }
});

document.getElementById('addPageInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const enhancedDataUrl = await processAndEnhancePhoto(file);
    await app.appendPageToCurrentScore(enhancedDataUrl);
  } catch (err) {
    console.error('Chyba při focení další strany:', err);
    alert('Chyba při focení strany: ' + err.message);
  } finally {
    e.target.value = '';
  }
});

document.getElementById('fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

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
      const enhancedDataUrl = await processAndEnhancePhoto(file);
      await app.saveNewScoreToLibrary(songName, {
        isPdf: false,
        imageData: enhancedDataUrl,
        pages: [enhancedDataUrl]
      });
    }
  } catch (err) {
    console.error('Chyba nahrávání:', err);
    alert('Chyba při zpracování souboru: ' + err.message);
  } finally {
    e.target.value = '';
  }
});