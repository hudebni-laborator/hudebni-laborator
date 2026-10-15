class MeasureBoxEditor {
  constructor(canvas, renderCallback, initialBox, onUpdate, isBarLineFn) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.renderCallback = renderCallback;
    this.box = { ...initialBox };
    this.isBarLineFn = isBarLineFn;
    this.activeAction = null;
    this.dragStart = { x: 0, y: 0 };
    this.initBox = { ...initialBox };
    this.loupeEl = document.getElementById('touchLoupe');
    this.loupeCanvas = document.getElementById('loupeCanvas');
    this.loupeCtx = this.loupeCanvas ? this.loupeCanvas.getContext('2d') : null;
    this.render();
  }

  getHandleScale() {
    const rect = this.canvas.getBoundingClientRect();
    const displayW = rect.width > 0 ? rect.width : window.innerWidth;
    return Math.max(1, this.canvas.width / displayW);
  }

  hitTest(x, y, tol) {
    const scale = this.getHandleScale();
    const effectiveTol = Math.max(tol || 32, 28 * scale);
    const b = this.box;
    const r = b.left + b.width;
    const bot = b.top + b.height;

    if (Math.abs(x - b.left) <= effectiveTol && Math.abs(y - b.top) <= effectiveTol) return 'corner-tl';
    if (Math.abs(x - r) <= effectiveTol && Math.abs(y - b.top) <= effectiveTol) return 'corner-tr';
    if (Math.abs(x - b.left) <= effectiveTol && Math.abs(y - bot) <= effectiveTol) return 'corner-bl';
    if (Math.abs(x - r) <= effectiveTol && Math.abs(y - bot) <= effectiveTol) return 'corner-br';
    if (Math.abs(x - b.left) <= effectiveTol && y >= b.top && y <= bot) return 'left';
    if (Math.abs(x - r) <= effectiveTol && y >= b.top && y <= bot) return 'right';
    if (Math.abs(y - b.top) <= effectiveTol && x >= b.left && x <= r) return 'top';
    if (Math.abs(y - bot) <= effectiveTol && x >= b.left && x <= r) return 'bottom';
    if (x > b.left && x < r && y > b.top && y < bot) return 'drag';
    return null;
  }

  startDrag(action, x, y, cx, cy) {
    this.activeAction = action;
    this.dragStart = { x, y };
    this.initBox = { ...this.box };
    if (action !== 'drag') this.updateLoupe(cx, cy, x, y);
  }

  moveDrag(x, y, cx, cy) {
    if (!this.activeAction) return;
    const dx = x - this.dragStart.x;
    const dy = y - this.dragStart.y;
    const init = this.initBox;
    const minW = 20 * this.getHandleScale();
    const minH = 20 * this.getHandleScale();

    switch (this.activeAction) {
      case 'drag':
        this.box.left = Math.max(0, init.left + dx);
        this.box.top = Math.max(0, init.top + dy);
        break;
      case 'left':
      case 'corner-tl':
      case 'corner-bl': {
        const nL = Math.min(init.left + dx, init.left + init.width - minW);
        this.box.left = Math.max(0, nL);
        this.box.width = init.width - (this.box.left - init.left);
        if (this.activeAction === 'corner-tl') {
          this.box.top = Math.max(0, Math.min(init.top + dy, init.top + init.height - minH));
          this.box.height = init.height - (this.box.top - init.top);
        } else if (this.activeAction === 'corner-bl') {
          this.box.height = Math.max(minH, init.height + dy);
        }
        break;
      }
      case 'right':
      case 'corner-tr':
      case 'corner-br':
        this.box.width = Math.max(minW, init.width + dx);
        if (this.activeAction === 'corner-tr') {
          this.box.top = Math.max(0, Math.min(init.top + dy, init.top + init.height - minH));
          this.box.height = init.height - (this.box.top - init.top);
        } else if (this.activeAction === 'corner-br') {
          this.box.height = Math.max(minH, init.height + dy);
        }
        break;
      case 'top':
        this.box.top = Math.max(0, Math.min(init.top + dy, init.top + init.height - minH));
        this.box.height = init.height - (this.box.top - init.top);
        break;
      case 'bottom':
        this.box.height = Math.max(minH, init.height + dy);
        break;
    }
    this.render();
    if (this.activeAction !== 'drag') {
      const tx = this.activeAction.includes('left') ? this.box.left : (this.box.left + this.box.width);
      this.updateLoupe(cx, cy, tx, y);
    }
  }

  endDrag() {
    this.activeAction = null;
    if (this.loupeEl) this.loupeEl.style.display = 'none';
  }

  destroy() {
    if (this.loupeEl) this.loupeEl.style.display = 'none';
  }

  updateLoupe(cx, cy, tx, ty) {
    if (!this.loupeEl || !this.loupeCtx) return;
    this.loupeEl.style.display = 'block';
    this.loupeEl.style.left = cx + 'px';
    this.loupeEl.style.top = cy + 'px';
    const lw = this.loupeCanvas.width;
    const lh = this.loupeCanvas.height;
    const z = 2.0;
    const cw = lw / z;
    const ch = lh / z;
    const sx = Math.max(0, Math.min(this.canvas.width - cw, tx - cw / 2));
    const sy = Math.max(0, Math.min(this.canvas.height - ch, ty - ch / 2));
    this.loupeCtx.clearRect(0, 0, lw, lh);
    this.loupeCtx.drawImage(this.canvas, sx, sy, cw, ch, 0, 0, lw, lh);
    this.loupeCtx.strokeStyle = 'rgba(239,68,68,0.9)';
    this.loupeCtx.lineWidth = 2;
    this.loupeCtx.beginPath();
    this.loupeCtx.moveTo(lw / 2, 0);
    this.loupeCtx.lineTo(lw / 2, lh);
    this.loupeCtx.stroke();
  }

  expandMeasure(dir) {
    const step = 8;
    if (dir === 'right') {
      const curR = Math.floor(this.box.left + this.box.width);
      let f = false;
      if (this.isBarLineFn) {
        for (let x = curR + step; x < this.canvas.width; x++) {
          if (this.isBarLineFn(x)) { this.box.width = x - this.box.left; f = true; break; }
        }
      }
      if (!f) this.box.width += 140 * this.getHandleScale();
    } else {
      const curL = Math.floor(this.box.left);
      let f = false;
      if (this.isBarLineFn) {
        for (let x = curL - step; x >= 0; x--) {
          if (this.isBarLineFn(x)) { this.box.width += (this.box.left - x); this.box.left = x; f = true; break; }
        }
      }
      if (!f) {
        const stepW = 140 * this.getHandleScale();
        const nL = Math.max(0, this.box.left - stepW);
        this.box.width += (this.box.left - nL);
        this.box.left = nL;
      }
    }
    this.render();
  }

  render() {
    this.renderCallback();
    const c = this.ctx;
    const scale = this.getHandleScale();

    c.save();
    c.fillStyle = 'rgba(37, 99, 235, 0.22)';
    c.fillRect(this.box.left, this.box.top, this.box.width, this.box.height);
    c.strokeStyle = '#1d4ed8';
    c.lineWidth = Math.max(2, 3 * scale);
    c.strokeRect(this.box.left, this.box.top, this.box.width, this.box.height);

    c.fillStyle = '#ffffff';
    c.strokeStyle = '#1d4ed8';
    c.lineWidth = Math.max(1.5, 2 * scale);
    const rDot = Math.max(6, 8 * scale);

    const hs = [
      { x: this.box.left + this.box.width / 2, y: this.box.top },
      { x: this.box.left + this.box.width / 2, y: this.box.top + this.box.height },
      { x: this.box.left, y: this.box.top + this.box.height / 2 },
      { x: this.box.left + this.box.width, y: this.box.top + this.box.height / 2 },
      { x: this.box.left, y: this.box.top },
      { x: this.box.left + this.box.width, y: this.box.top },
      { x: this.box.left, y: this.box.top + this.box.height },
      { x: this.box.left + this.box.width, y: this.box.top + this.box.height }
    ];
    hs.forEach(h => {
      c.beginPath();
      c.arc(h.x, h.y, rDot, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    });
    c.restore();
  }
}

// Samostatný editor ořezu s poloprůhlednou maskou a zřetelnými madly
class PaperCropEditor {
  constructor(canvas, renderCallback, initialBox) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.renderCallback = renderCallback;
    this.box = { ...initialBox };
    this.activeAction = null;
    this.dragStart = { x: 0, y: 0 };
    this.initBox = { ...initialBox };
    this.render();
  }

  getHandleScale() {
    const rect = this.canvas.getBoundingClientRect();
    const displayW = rect.width > 0 ? rect.width : window.innerWidth;
    return Math.max(1, this.canvas.width / displayW);
  }

  hitTest(x, y) {
    const scale = this.getHandleScale();
    const tol = Math.max(35, 30 * scale);
    const b = this.box;
    const r = b.left + b.width;
    const bot = b.top + b.height;

    if (Math.abs(x - b.left) <= tol && Math.abs(y - b.top) <= tol) return 'corner-tl';
    if (Math.abs(x - r) <= tol && Math.abs(y - b.top) <= tol) return 'corner-tr';
    if (Math.abs(x - b.left) <= tol && Math.abs(y - bot) <= tol) return 'corner-bl';
    if (Math.abs(x - r) <= tol && Math.abs(y - bot) <= tol) return 'corner-br';

    if (Math.abs(x - b.left) <= tol && y >= b.top && y <= bot) return 'left';
    if (Math.abs(x - r) <= tol && y >= b.top && y <= bot) return 'right';
    if (Math.abs(y - b.top) <= tol && x >= b.left && x <= r) return 'top';
    if (Math.abs(y - bot) <= tol && x >= b.left && x <= r) return 'bottom';

    if (x > b.left && x < r && y > b.top && y < bot) return 'drag';
    return null;
  }

  startDrag(action, x, y) {
    this.activeAction = action;
    this.dragStart = { x, y };
    this.initBox = { ...this.box };
  }

  moveDrag(x, y) {
    if (!this.activeAction) return;
    const dx = x - this.dragStart.x;
    const dy = y - this.dragStart.y;
    const init = this.initBox;
    const minSize = 60 * this.getHandleScale();

    switch (this.activeAction) {
      case 'drag':
        this.box.left = Math.max(0, Math.min(this.canvas.width - init.width, init.left + dx));
        this.box.top = Math.max(0, Math.min(this.canvas.height - init.height, init.top + dy));
        break;
      case 'left':
      case 'corner-tl':
      case 'corner-bl': {
        const nL = Math.max(0, Math.min(init.left + dx, init.left + init.width - minSize));
        this.box.left = nL;
        this.box.width = init.width - (nL - init.left);
        if (this.activeAction === 'corner-tl') {
          const nT = Math.max(0, Math.min(init.top + dy, init.top + init.height - minSize));
          this.box.top = nT;
          this.box.height = init.height - (nT - init.top);
        } else if (this.activeAction === 'corner-bl') {
          this.box.height = Math.max(minSize, Math.min(this.canvas.height - init.top, init.height + dy));
        }
        break;
      }
      case 'right':
      case 'corner-tr':
      case 'corner-br': {
        this.box.width = Math.max(minSize, Math.min(this.canvas.width - init.left, init.width + dx));
        if (this.activeAction === 'corner-tr') {
          const nT = Math.max(0, Math.min(init.top + dy, init.top + init.height - minSize));
          this.box.top = nT;
          this.box.height = init.height - (nT - init.top);
        } else if (this.activeAction === 'corner-br') {
          this.box.height = Math.max(minSize, Math.min(this.canvas.height - init.top, init.height + dy));
        }
        break;
      }
      case 'top': {
        const nT = Math.max(0, Math.min(init.top + dy, init.top + init.height - minSize));
        this.box.top = nT;
        this.box.height = init.height - (nT - init.top);
        break;
      }
      case 'bottom':
        this.box.height = Math.max(minSize, Math.min(this.canvas.height - init.top, init.height + dy));
        break;
    }
    this.render();
  }

  endDrag() {
    this.activeAction = null;
  }

  destroy() {}

  render() {
    this.renderCallback();
    const c = this.ctx;
    const b = this.box;
    const scale = this.getHandleScale();

    c.save();

    // 1. Ztmavení plochy, která bude odříznuta
    c.fillStyle = 'rgba(0, 0, 0, 0.55)';
    c.fillRect(0, 0, this.canvas.width, b.top);
    c.fillRect(0, b.top + b.height, this.canvas.width, this.canvas.height - (b.top + b.height));
    c.fillRect(0, b.top, b.left, b.height);
    c.fillRect(b.left + b.width, b.top, this.canvas.width - (b.left + b.width), b.height);

    // 2. Ohraničení výřezu
    c.strokeStyle = '#38bdf8';
    c.lineWidth = Math.max(2, 3 * scale);
    c.strokeRect(b.left, b.top, b.width, b.height);

    // 3. Zřetelná rohová madla (bílé L-rohy)
    const armLen = Math.max(20, 32 * scale);
    c.strokeStyle = '#ffffff';
    c.lineWidth = Math.max(4, 6 * scale);
    c.lineCap = 'square';

    c.beginPath(); // TL
    c.moveTo(b.left, b.top + armLen);
    c.lineTo(b.left, b.top);
    c.lineTo(b.left + armLen, b.top);
    c.stroke();

    c.beginPath(); // TR
    c.moveTo(b.left + b.width - armLen, b.top);
    c.lineTo(b.left + b.width, b.top);
    c.lineTo(b.left + b.width, b.top + armLen);
    c.stroke();

    c.beginPath(); // BL
    c.moveTo(b.left, b.top + b.height - armLen);
    c.lineTo(b.left, b.top + b.height);
    c.lineTo(b.left + armLen, b.top + b.height);
    c.stroke();

    c.beginPath(); // BR
    c.moveTo(b.left + b.width - armLen, b.top + b.height);
    c.lineTo(b.left + b.width, b.top + b.height);
    c.lineTo(b.left + b.width, b.top + b.height - armLen);
    c.stroke();

    // 4. Středové body hran
    const midPoints = [
      { x: b.left + b.width / 2, y: b.top },
      { x: b.left + b.width / 2, y: b.top + b.height },
      { x: b.left, y: b.top + b.height / 2 },
      { x: b.left + b.width, y: b.top + b.height / 2 }
    ];
    const rDot = Math.max(6, 8 * scale);
    c.fillStyle = '#38bdf8';
    c.strokeStyle = '#ffffff';
    c.lineWidth = Math.max(1.5, 2.5 * scale);
    midPoints.forEach(p => {
      c.beginPath();
      c.arc(p.x, p.y, rDot, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    });

    c.restore();
  }
}