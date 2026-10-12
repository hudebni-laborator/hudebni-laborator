class MeasureBoxEditor {
  constructor(canvas, renderCallback, initialBox, onUpdate, isBarLineFn) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.renderCallback = renderCallback;
    this.box = { ...initialBox };
    this.isBarLineFn = isBarLineFn;
    this.touchTolerance = 36;
    this.activeAction = null;
    this.dragStart = { x: 0, y: 0 };
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
    this.activeAction = action;
    this.dragStart = { x, y };
    this.initBox = { ...this.box };
    if (action !== 'drag') this.updateLoupe(cx, cy, x, y);
  }

  moveDrag(x, y, cx, cy) {
    if (!this.activeAction) return;
    const dx = x - this.dragStart.x, dy = y - this.dragStart.y, init = this.initBox;
    switch (this.activeAction) {
      case 'drag':
        this.box.left = Math.max(0, init.left + dx);
        this.box.top = Math.max(0, init.top + dy);
        break;
      case 'left': case 'corner-tl': case 'corner-bl':
        const nL = Math.min(init.left + dx, init.left + init.width - 20);
        this.box.left = Math.max(0, nL);
        this.box.width = init.width - (this.box.left - init.left);
        if (this.activeAction === 'corner-tl') {
          this.box.top = Math.max(0, Math.min(init.top + dy, init.top + init.height - 20));
          this.box.height = init.height - (this.box.top - init.top);
        } else if (this.activeAction === 'corner-bl') {
          this.box.height = Math.max(20, init.height + dy);
        }
        break;
      case 'right': case 'corner-tr': case 'corner-br':
        this.box.width = Math.max(20, init.width + dx);
        if (this.activeAction === 'corner-tr') {
          this.box.top = Math.max(0, Math.min(init.top + dy, init.top + init.height - 20));
          this.box.height = init.height - (this.box.top - init.top);
        } else if (this.activeAction === 'corner-br') {
          this.box.height = Math.max(20, init.height + dy);
        }
        break;
      case 'top':
        this.box.top = Math.max(0, Math.min(init.top + dy, init.top + init.height - 20));
        this.box.height = init.height - (this.box.top - init.top);
        break;
      case 'bottom':
        this.box.height = Math.max(20, init.height + dy);
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
    const lw = this.loupeCanvas.width, lh = this.loupeCanvas.height, z = 2.0, cw = lw/z, ch = lh/z;
    const sx = Math.max(0, Math.min(this.canvas.width - cw, tx - cw/2));
    const sy = Math.max(0, Math.min(this.canvas.height - ch, ty - ch/2));
    this.loupeCtx.clearRect(0,0,lw,lh);
    this.loupeCtx.drawImage(this.canvas, sx, sy, cw, ch, 0, 0, lw, lh);
    this.loupeCtx.strokeStyle = 'rgba(239,68,68,0.9)';
    this.loupeCtx.lineWidth = 2;
    this.loupeCtx.beginPath();
    this.loupeCtx.moveTo(lw/2, 0);
    this.loupeCtx.lineTo(lw/2, lh);
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
      if (!f) this.box.width += 140;
    } else {
      const curL = Math.floor(this.box.left);
      let f = false;
      if (this.isBarLineFn) {
        for (let x = curL - step; x >= 0; x--) {
          if (this.isBarLineFn(x)) { this.box.width += (this.box.left - x); this.box.left = x; f = true; break; }
        }
      }
      if (!f) {
        const nL = Math.max(0, this.box.left - 140);
        this.box.width += (this.box.left - nL);
        this.box.left = nL;
      }
    }
    this.render();
  }

  render() {
    this.renderCallback();
    const c = this.ctx;
    c.save();
    c.fillStyle = 'rgba(37, 99, 235, 0.22)';
    c.fillRect(this.box.left, this.box.top, this.box.width, this.box.height);
    c.strokeStyle = '#1d4ed8';
    c.lineWidth = 4;
    c.strokeRect(this.box.left, this.box.top, this.box.width, this.box.height);
    c.fillStyle = '#ffffff';
    c.lineWidth = 3.5;
    const hs = [
      {x:this.box.left+this.box.width/2, y:this.box.top},
      {x:this.box.left+this.box.width/2, y:this.box.top+this.box.height},
      {x:this.box.left, y:this.box.top+this.box.height/2},
      {x:this.box.left+this.box.width, y:this.box.top+this.box.height/2},
      {x:this.box.left, y:this.box.top},
      {x:this.box.left+this.box.width, y:this.box.top},
      {x:this.box.left, y:this.box.top+this.box.height},
      {x:this.box.left+this.box.width, y:this.box.top+this.box.height}
    ];
    hs.forEach(h => { c.beginPath(); c.arc(h.x, h.y, 9.5, 0, Math.PI*2); c.fill(); c.stroke(); });
    c.restore();
  }
}