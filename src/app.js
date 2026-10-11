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

// 2. Detekce taktových čar a osnov s vertikálními mezerami
function detectMeasureWithStaffGaps(canvas, clickX, clickY) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  const isDark = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    const idx = (y * width + x) * 4;
    return (data[idx] + data[idx + 1] + data[idx + 2]) / 3 < 127;
  };

  const roughStaffHeight = 45;
  const localStartY = Math.max(0, Math.floor(clickY - roughStaffHeight));
  const localEndY = Math.min(height, Math.floor(clickY + roughStaffHeight));
  const requiredDarkH = (localEndY - localStartY) * 0.70;

  // Hledání levé taktové čáry
  let leftX = Math.floor(clickX);
  for (let x = leftX; x >= 0; x--) {
    let count = 0;
    for (let y = localStartY; y < localEndY; y++) {
      if (isDark(x, y)) count++;
    }
    if (count >= requiredDarkH) { leftX = x; break; }
  }

  // Hledání pravé taktové čáry
  let rightX = Math.floor(clickX);
  for (let x = rightX; x < width; x++) {
    let count = 0;
    for (let y = localStartY; y < localEndY; y++) {
      if (isDark(x, y)) count++;
    }
    if (count >= requiredDarkH) { rightX = x; break; }
  }

  // Detekce linek osnov
  const sampleLeft = Math.min(leftX + 8, rightX);
  const sampleRight = Math.max(leftX, rightX - 8);
  const sampleWidth = Math.max(1, sampleRight - sampleLeft);
  const minLineFill = sampleWidth * 0.45;

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
    const isUniform = spacings.every(s => Math.abs(s - avgSpacing) <= 3 && s >= 4 && s <= 22);

    if (isUniform) {
      staves.push({
        top: group[0],
        bottom: group[4],
        height: group[4] - group[0]
      });
      i += 4;
    }
  }

  if (staves.length === 0) {
    return {
      left: leftX,
      top: Math.max(0, Math.floor(clickY - 50)),
      width: Math.max(30, rightX - leftX),
      height: 100
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
  const prev = currentIndex > 0 ? staves[currentIndex - 1] : null;
  const next = currentIndex < staves.length - 1 ? staves[currentIndex + 1] : null;

  let gapAbove = 0;
  let gapBelow = 0;

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
    left: leftX,
    top: topY,
    width: Math.max(20, rightX - leftX),
    height: Math.max(20, bottomY - topY)
  };
}

// 3. Editor rámečku s Pointer Events a hitboxem pro dotyk
class MeasureBoxEditor {
  constructor(canvas, renderCallback, initialBox, onUpdate) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.renderCallback = renderCallback;
    this.box = { ...initialBox };
    this.onUpdate = onUpdate;
    this.touchTolerance = 28;

    this.activeAction = null;
    this.dragStart = { x: 0, y: 0 };
    this.initialBoxState = null;

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

    const nearLeft = Math.abs(x - b.left) <= tol && y >= b.top - tol && y <= bot + tol;
    const nearRight = Math.abs(x - r) <= tol && y >= b.top - tol && y <= bot + tol;
    const nearTop = Math.abs(y - b.top) <= tol && x >= b.left - tol && x <= r + tol;
    const nearBottom = Math.abs(y - bot) <= tol && x >= b.left - tol && x <= r + tol;

    if (nearTop) return 'top';
    if (nearBottom) return 'bottom';
    if (nearLeft) return 'left';
    if (nearRight) return 'right';

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
  }

  handlePointerDown(e) {
    const { x, y, tolerance } = this.getCoords(e);
    const action = this.hitTest(x, y, tolerance);

    if (action) {
      this.activeAction = action;
      this.dragStart = { x, y };
      this.initialBoxState = { ...this.box };
      this.canvas.setPointerCapture(e.pointerId);
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
      case 'top': {
        const newTop = Math.min(init.top + dy, init.top + init.height - 20);
        this.box.top = Math.max(0, newTop);
        this.box.height = init.height - (this.box.top - init.top);
        break;
      }
      case 'bottom':
        this.box.height = Math.max(20, Math.min(this.canvas.height - this.box.top, init.height + dy));
        break;
      case 'left': {
        const newLeft = Math.min(init.left + dx, init.left + init.width - 20);
        this.box.left = Math.max(0, newLeft);
        this.box.width = init.width - (this.box.left - init.left);
        break;
      }
      case 'right':
        this.box.width = Math.max(20, Math.min(this.canvas.width - this.box.left, init.width + dx));
        break;
    }

    this.render();
    if (this.onUpdate) this.onUpdate(this.box);
  }

  handlePointerUp(e) {
    if (this.activeAction) {
      this.canvas.releasePointerCapture(e.pointerId);
      this.activeAction = null;
    }
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
      { x: b.left + b.width, y: b.top + b.height / 2 }
    ];

    handles.forEach(h => {
      c.beginPath();
      c.arc(h.x, h.y, 9, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    });

    c.restore();
  }
}

// 4. Správa trenažéru
class GuitarTrainer {
  constructor() {
    this.scoreCanvas = document.getElementById('scoreCanvas');
    this.scoreCtx = this.scoreCanvas.getContext('2d');

    this.practiceCanvas = document.getElementById('practiceCanvas');
    this.practiceCtx = this.practiceCanvas.getContext('2d');

    this.metronome = new MetronomeAudio();

    this.currentScoreId = 'active_song';
    this.baseImage = null;
    this.measures = [];
    this.currentIndex = 0;
    this.activeEditor = null;

    this.isPlaying = false;
    this.timerId = null;
    this.currentBeat = 0;

    this.initAsyncData();
    this.initCanvasClicks();
  }

  async initAsyncData() {
    try {
      if (window.scoreDB) {
        const savedScore = await window.scoreDB.getScore(this.currentScoreId);
        if (savedScore) {
          this.measures = savedScore.measures || [];
          if (savedScore.imageData) {
            const img = new Image();
            img.onload = async () => {
              this.scoreCanvas.width = img.naturalWidth;
              this.scoreCanvas.height = img.naturalHeight;
              this.scoreCtx.drawImage(img, 0, 0);
              this.baseImage = await createImageBitmap(img);
              this.renderScoreView();
            };
            img.src = savedScore.imageData;
          }
        }
      }
    } catch (e) {
      console.warn('Chyba při načítání z IndexedDB:', e);
    }
    this.updateUI();
  }

  async persistCurrentScore() {
    if (!window.scoreDB) return;
    try {
      const dataToSave = {
        id: this.currentScoreId,
        measures: this.measures,
        updatedAt: Date.now()
      };
      if (this.baseImage) {
        dataToSave.imageData = this.scoreCanvas.toDataURL('image/jpeg', 0.85);
      }
      await window.scoreDB.saveScore(dataToSave);
    } catch (e) {
      console.warn('Chyba při ukládání do IndexedDB:', e);
    }
  }

  initCanvasClicks() {
    this.scoreCanvas.addEventListener('click', (e) => {
      if (!this.baseImage) return;
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

      const detected = detectMeasureWithStaffGaps(this.scoreCanvas, clickX, clickY);

      if (this.activeEditor) this.activeEditor.destroy();
      this.activeEditor = new MeasureBoxEditor(
        this.scoreCanvas,
        () => this.renderScoreView(),
        detected,
        () => {}
      );

      document.getElementById('addMeasureBtn').style.display = 'inline-flex';
      document.getElementById('nextMeasureNum').innerText = this.measures.length + 1;
      document.getElementById('statusHint').innerText = 'Rámeček můžete upravit táhly. Klepněte na "+ Přidat takt".';
    });
  }

  async saveCurrentMeasure() {
    if (!this.activeEditor) return;

    this.measures.push({
      id: this.measures.length + 1,
      box: { ...this.activeEditor.box }
    });

    await this.persistCurrentScore();

    this.activeEditor.destroy();
    this.activeEditor = null;
    document.getElementById('addMeasureBtn').style.display = 'none';

    this.updateUI();
    this.renderScoreView();
  }

  async clearMeasures() {
    if (confirm('Opravdu chcete smazat všechny označené takty?')) {
      this.measures = [];
      await this.persistCurrentScore();
      if (this.activeEditor) {
        this.activeEditor.destroy();
        this.activeEditor = null;
      }
      this.updateUI();
      this.renderScoreView();
    }
  }

  updateUI() {
    const count = this.measures.length;
    document.getElementById('measureCountSpan').innerText = count;
    document.getElementById('clearMeasuresBtn').style.display = count > 0 ? 'inline-flex' : 'none';
    document.getElementById('nextMeasureNum').innerText = count + 1;

    const loopFrom = document.getElementById('loopFrom');
    const loopTo = document.getElementById('loopTo');
    loopFrom.max = Math.max(1, count);
    loopTo.max = Math.max(1, count);
    if (count > 0 && Number(loopTo.value) <= 1) {
      loopTo.value = count;
    }
  }

  renderScoreView() {
    if (!this.baseImage) return;
    this.scoreCtx.clearRect(0, 0, this.scoreCanvas.width, this.scoreCanvas.height);
    this.scoreCtx.drawImage(this.baseImage, 0, 0);

    this.measures.forEach((m, idx) => {
      this.scoreCtx.strokeStyle = 'rgba(34, 197, 94, 0.85)';
      this.scoreCtx.lineWidth = 2.5;
      this.scoreCtx.strokeRect(m.box.left, m.box.top, m.box.width, m.box.height);

      this.scoreCtx.fillStyle = '#22c55e';
      this.scoreCtx.font = 'bold 18px sans-serif';
      this.scoreCtx.fillText(`${idx + 1}`, m.box.left + 6, m.box.top + 22);
    });
  }

  showMeasureInTrainer(index) {
    if (this.measures.length === 0) return;
    if (index < 0) index = 0;
    if (index >= this.measures.length) index = this.measures.length - 1;

    this.currentIndex = index;
    const m = this.measures[index];

    this.practiceCanvas.width = m.box.width;
    this.practiceCanvas.height = m.box.height;

    this.practiceCtx.drawImage(
      this.baseImage,
      m.box.left, m.box.top, m.box.width, m.box.height,
      0, 0, m.box.width, m.box.height
    );

    document.getElementById('practiceMeasureTitle').innerText = `Takt ${index + 1} / ${this.measures.length}`;
  }

  nextMeasure() {
    const loopTo = Number(document.getElementById('loopTo').value) - 1;
    const loopFrom = Number(document.getElementById('loopFrom').value) - 1;

    let nextIdx = this.currentIndex + 1;
    if (nextIdx > loopTo || nextIdx >= this.measures.length) {
      nextIdx = Math.max(0, loopFrom);
    }
    this.showMeasureInTrainer(nextIdx);
  }

  prevMeasure() {
    if (this.currentIndex > 0) {
      this.showMeasureInTrainer(this.currentIndex - 1);
    }
  }

  async togglePlay() {
    if (this.isPlaying) {
      this.stop();
    } else {
      await this.start();
    }
  }

  async start() {
    if (this.measures.length === 0) {
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
        this.nextMeasure();
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
    if (app.measures.length === 0) {
      alert('Nejprve označte a přidejte alespoň jeden takt.');
      return;
    }
    tabEdit.classList.remove('active');
    tabPractice.classList.add('active');
    editView.style.display = 'none';
    practiceView.style.display = 'flex';
    editToolbar.style.display = 'none';
    badge.innerText = 'Cvičení';
    app.showMeasureInTrainer(app.currentIndex);
  }
}

document.getElementById('fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const hint = document.getElementById('statusHint');
  hint.innerText = 'Načítám noty...';

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

      app.baseImage = await createImageBitmap(app.scoreCanvas);
      hint.innerText = 'Klepněte na takt pro ohraničení.';
      await app.persistCurrentScore();
      app.renderScoreView();
    };
    reader.readAsArrayBuffer(file);
  } else {
    const img = new Image();
    img.onload = async () => {
      app.scoreCanvas.width = img.naturalWidth;
      app.scoreCanvas.height = img.naturalHeight;
      app.scoreCtx.drawImage(img, 0, 0);
      app.baseImage = await createImageBitmap(img);
      hint.innerText = 'Klepněte na takt pro ohraničení.';
      await app.persistCurrentScore();
      app.renderScoreView();
    };
    img.src = URL.createObjectURL(file);
  }
});