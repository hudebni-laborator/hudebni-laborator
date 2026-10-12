class GuitarTrainer {
  constructor() {
    this.scoreCanvas = document.getElementById('scoreCanvas');
    this.scoreCtx = this.scoreCanvas ? this.scoreCanvas.getContext('2d') : null;
    this.canvasBox = document.getElementById('canvasBox');
    this.canvasViewport = document.getElementById('canvasViewport');

    this.labCanvas = document.getElementById('labCanvas');
    this.labCtx = this.labCanvas ? this.labCanvas.getContext('2d') : null;

    this.labClefCanvas = document.getElementById('labClefCanvas');
    this.labClefCtx = this.labClefCanvas ? this.labClefCanvas.getContext('2d') : null;

    this.currentScore = null;
    this.pdfDoc = null;
    this.pageCache = new Map();
    this.currentPage = 1;
    this.totalPages = 1;

    this.activeEditor = null;
    this.labCurrentIndex = 0;
    this.labContext = 'solo';
    this.isMarkingMode = false;

    this.zoomScale = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.activeType = null; // 'measure' | 'keySig' | 'new'
    this.editingId = null;

    this.metronome = new MetronomeController();

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

  // --- METRONOM PROPOJENÍ ---
  toggleIncrementalMetronome() { this.metronome.toggle(); }
  resetMetronomeTempo() { this.metronome.resetTempo(); }
  stopMetronome() { this.metronome.stop(); }

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
    if (all.length === 0) {
      listEl.innerHTML = '<div style="color:var(--text-muted); padding:16px; text-align:center;">V zařízení zatím nemáte žádné noty. Vyfoťte je ze stojanu nebo nahrajte soubor.</div>';
      return;
    }
    all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    all.forEach(s => {
      const item = document.createElement('div');
      item.className = 'library-item' + (this.currentScore?.id === s.id ? ' active' : '');
      item.onclick = () => this.loadScore(s.id, true);
      const pg = s.isPdf ? 'PDF' : `${(s.pages || [1]).length} str.`;
      const klice = (s.keySignatures || []).length;
      const takty = (s.measures || []).length;
      item.innerHTML = `<div class="library-info"><div class="library-name">${s.name}</div><div class="library-meta">${pg} • Taktů: ${takty} • Klíčů: ${klice}</div></div><button class="btn btn-danger btn-sm" onclick="window.app.deleteScoreFromLibrary('${s.id}', event)">Smazat</button>`;
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
    const page = this.pageCache.get(this.currentPage);
    if (!page || !this.scoreCtx) return;
    this.scoreCtx.clearRect(0, 0, this.scoreCanvas.width, this.scoreCanvas.height);
    this.scoreCtx.drawImage(page, 0, 0);

    // 1. Zlaté Klíče a předznamenání
    (this.currentScore?.keySignatures || []).forEach(k => {
      if ((k.page || 1) !== this.currentPage || (this.activeType === 'keySig' && this.editingId === k.id)) return;
      this.scoreCtx.fillStyle = 'rgba(245, 158, 11, 0.18)';
      this.scoreCtx.fillRect(k.box.left, k.box.top, k.box.width, k.box.height);
      this.scoreCtx.strokeStyle = '#d97706';
      this.scoreCtx.lineWidth = 3.5;
      this.scoreCtx.strokeRect(k.box.left, k.box.top, k.box.width, k.box.height);

      this.scoreCtx.fillStyle = '#d97706';
      this.scoreCtx.fillRect(k.box.left, k.box.top, 56, 20);
      this.scoreCtx.fillStyle = '#ffffff';
      this.scoreCtx.font = 'bold 12px sans-serif';
      this.scoreCtx.fillText('🎼 Klíč', k.box.left + 6, k.box.top + 15);
    });

    // 2. Červené takty
    (this.currentScore?.measures || []).forEach(m => {
      if ((m.page || 1) !== this.currentPage || (this.activeType === 'measure' && this.editingId === m.id)) return;
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
    let ongoingTouches = new Map();
    let initialPinchDist = null;
    let initialPinchScale = 1.0;
    let isDraggingHandle = false;
    let isPanningOneFinger = false;
    let startPoint = null;

    box.addEventListener('pointerdown', e => {
      if (!this.isMarkingMode && e.target.classList.contains('page-turn-zone')) return;

      ongoingTouches.set(e.pointerId, {x: e.clientX, y: e.clientY});
      if (ongoingTouches.size === 1) {
        startPoint = { x: e.clientX, y: e.clientY };
        const coords = this.screenToCanvasCoords(e.clientX, e.clientY);
        if (this.activeEditor) {
          const action = this.activeEditor.hitTest(coords.x, coords.y, this.activeEditor.touchTolerance / this.zoomScale);
          if (action) {
            isDraggingHandle = true;
            this.activeEditor.startDrag(action, coords.x, coords.y, e.clientX, e.clientY);
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
        const touches = Array.from(ongoingTouches.values());
        initialPinchDist = Math.hypot(touches[0].x - touches[1].x, touches[0].y - touches[1].y);
        initialPinchScale = this.zoomScale;
      }
    });

    box.addEventListener('pointermove', e => {
      if (!ongoingTouches.has(e.pointerId)) return;
      const prev = ongoingTouches.get(e.pointerId);
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      ongoingTouches.set(e.pointerId, {x: e.clientX, y: e.clientY});

      if (ongoingTouches.size === 2) {
        const touches = Array.from(ongoingTouches.values());
        const dist = Math.hypot(touches[0].x - touches[1].x, touches[0].y - touches[1].y);
        const rect = box.getBoundingClientRect();
        const cx = (touches[0].x + touches[1].x) / 2 - rect.left;
        const cy = (touches[0].y + touches[1].y) / 2 - rect.top;
        if (initialPinchDist > 0) this.applyZoomAt(initialPinchScale * (dist / initialPinchDist), cx, cy);
        this.panX += dx / 2;
        this.panY += dy / 2;
        this.updateViewportTransform();
      } else if (ongoingTouches.size === 1) {
        if (isDraggingHandle && this.activeEditor) {
          const coords = this.screenToCanvasCoords(e.clientX, e.clientY);
          this.activeEditor.moveDrag(coords.x, coords.y, e.clientX, e.clientY);
        } else if (isPanningOneFinger) {
          this.panX += dx;
          this.panY += dy;
          this.updateViewportTransform();
        }
      }
    });

    const end = e => {
      ongoingTouches.delete(e.pointerId);
      if (ongoingTouches.size === 0) {
        if (isDraggingHandle && this.activeEditor) this.activeEditor.endDrag();
        if (startPoint && !isDraggingHandle) {
          const dist = Math.hypot(e.clientX - startPoint.x, e.clientY - startPoint.y);
          if (dist < 8 && this.isMarkingMode) {
            this.handleCanvasTap(e.clientX, e.clientY);
          }
        }
        isDraggingHandle = false;
        isPanningOneFinger = false;
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

  handleCanvasTap(clientX, clientY) {
    if (!this.currentScore) return;
    const clean = this.pageCache.get(this.currentPage);
    if (!clean) return;

    const c = this.screenToCanvasCoords(clientX, clientY);
    if (c.x < 0 || c.x > clean.width || c.y < 0 || c.y > clean.height) return;

    // 1. Klepnutí na existující Takt
    const clickedMeasure = (this.currentScore.measures || []).find(item => item.page === this.currentPage && c.x >= item.box.left && c.x <= item.box.left + item.box.width && c.y >= item.box.top && c.y <= item.box.top + item.box.height);
    if (clickedMeasure) {
      this.activeType = 'measure';
      this.editingId = clickedMeasure.id;
      const s = scanStaffAndBarlinesFromCanvas(clean, c.x, c.y);
      if (this.activeEditor) this.activeEditor.destroy();
      this.activeEditor = new MeasureBoxEditor(this.scoreCanvas, () => this.renderScoreView(), clickedMeasure.box, () => {}, s.isBarLine);
      const sb = document.getElementById('editSubbar');
      if (sb) sb.style.display = 'flex';
      this.updateActiveControlButtons();
      return;
    }

    // 2. Klepnutí na existující Klíč
    const clickedKey = (this.currentScore.keySignatures || []).find(item => item.page === this.currentPage && c.x >= item.box.left && c.x <= item.box.left + item.box.width && c.y >= item.box.top && c.y <= item.box.top + item.box.height);
    if (clickedKey) {
      this.activeType = 'keySig';
      this.editingId = clickedKey.id;
      const s = scanStaffAndBarlinesFromCanvas(clean, c.x, c.y);
      if (this.activeEditor) this.activeEditor.destroy();
      this.activeEditor = new MeasureBoxEditor(this.scoreCanvas, () => this.renderScoreView(), clickedKey.box, () => {}, s.isBarLine);
      const sb = document.getElementById('editSubbar');
      if (sb) sb.style.display = 'flex';
      this.updateActiveControlButtons();
      return;
    }

    // 3. Nový rámeček
    this.activeType = 'new';
    this.editingId = null;
    const s = scanStaffAndBarlinesFromCanvas(clean, c.x, c.y);
    if (this.activeEditor) this.activeEditor.destroy();
    this.activeEditor = new MeasureBoxEditor(this.scoreCanvas, () => this.renderScoreView(), s.box, () => {}, s.isBarLine);
    const sb = document.getElementById('editSubbar');
    if (sb) sb.style.display = 'flex';
    this.updateActiveControlButtons();
  }

  expandMeasure(dir) { if (this.activeEditor) this.activeEditor.expandMeasure(dir); }

  updateActiveControlButtons() {
    const addBtn = document.getElementById('addMeasureBtn');
    const setKeyBtn = document.getElementById('setKeySigBtn');
    const toggleCatBtn = document.getElementById('toggleCategoryBtn');
    const delBtn = document.getElementById('deleteActiveBoxBtn');

    if (this.activeType === 'measure') {
      if (addBtn) { addBtn.style.display = 'inline-flex'; addBtn.innerText = `✔ Upravit takt #${this.editingId}`; }
      if (setKeyBtn) setKeyBtn.style.display = 'none';
      if (toggleCatBtn) { toggleCatBtn.style.display = 'inline-flex'; toggleCatBtn.innerText = '🔄 Změnit na Klíč'; }
      if (delBtn) delBtn.style.display = 'inline-flex';
    } else if (this.activeType === 'keySig') {
      if (addBtn) addBtn.style.display = 'none';
      if (setKeyBtn) { setKeyBtn.style.display = 'inline-flex'; setKeyBtn.innerText = '✔ Upravit Klíč'; }
      if (toggleCatBtn) { toggleCatBtn.style.display = 'inline-flex'; toggleCatBtn.innerText = '🔄 Změnit na Takt'; }
      if (delBtn) delBtn.style.display = 'inline-flex';
    } else {
      if (addBtn) { addBtn.style.display = 'inline-flex'; addBtn.innerText = '✔ Uložit takt'; }
      if (setKeyBtn) { setKeyBtn.style.display = 'inline-flex'; setKeyBtn.innerText = '🎼 Uložit jako Klíč'; }
      if (toggleCatBtn) toggleCatBtn.style.display = 'none';
      if (delBtn) delBtn.style.display = 'none';
    }
  }

  // Uložení rámečku jako Takt
  async saveCurrentMeasure() {
    if (!this.activeEditor || !this.currentScore) return;
    if (!this.currentScore.measures) this.currentScore.measures = [];

    if (this.activeType === 'measure' && this.editingId != null) {
      const m = this.currentScore.measures.find(x => x.id === this.editingId);
      if (m) { m.box = { ...this.activeEditor.box }; m.page = this.currentPage; }
    } else {
      this.currentScore.measures.push({
        id: this.currentScore.measures.length + 1,
        page: this.currentPage,
        box: { ...this.activeEditor.box }
      });
    }

    this.currentScore.measures.sort((a, b) => compareMusicPosition(a, b));
    this.currentScore.measures.forEach((x, i) => x.id = i + 1);

    await this.persistCurrentScore();
    this.resetActiveSelection();
    this.renderScoreView();
    this.updateLabBadge();
    this.updateUI();
  }

  // Uložení rámečku jako Klíč / Předznamenání
  async saveCurrentAsKeySignature() {
    if (!this.activeEditor || !this.currentScore) return;
    if (!this.currentScore.keySignatures) this.currentScore.keySignatures = [];

    if (this.activeType === 'keySig' && this.editingId != null) {
      const k = this.currentScore.keySignatures.find(x => x.id === this.editingId);
      if (k) { k.box = { ...this.activeEditor.box }; k.page = this.currentPage; }
    } else {
      this.currentScore.keySignatures.push({
        id: 'key_' + Date.now(),
        page: this.currentPage,
        box: { ...this.activeEditor.box }
      });
    }

    this.currentScore.keySignatures.sort((a, b) => compareMusicPosition(a, b));

    await this.persistCurrentScore();
    this.resetActiveSelection();
    this.renderScoreView();
  }

  // Přepnutí kategorie mezi Taktem a Klíčem
  async toggleActiveCategory() {
    if (!this.activeEditor || !this.currentScore) return;

    if (this.activeType === 'measure') {
      const idx = this.currentScore.measures.findIndex(m => m.id === this.editingId);
      if (idx !== -1) {
        this.currentScore.measures.splice(idx, 1);
        if (!this.currentScore.keySignatures) this.currentScore.keySignatures = [];
        this.currentScore.keySignatures.push({
          id: 'key_' + Date.now(),
          page: this.currentPage,
          box: { ...this.activeEditor.box }
        });
        this.currentScore.keySignatures.sort((a, b) => compareMusicPosition(a, b));
        this.currentScore.measures.forEach((m, i) => m.id = i + 1);
        await this.persistCurrentScore();
        this.resetActiveSelection();
        this.renderScoreView();
        this.updateLabBadge();
      }
    } else if (this.activeType === 'keySig') {
      const idx = this.currentScore.keySignatures.findIndex(k => k.id === this.editingId);
      if (idx !== -1) {
        this.currentScore.keySignatures.splice(idx, 1);
        if (!this.currentScore.measures) this.currentScore.measures = [];
        this.currentScore.measures.push({
          id: this.currentScore.measures.length + 1,
          page: this.currentPage,
          box: { ...this.activeEditor.box }
        });
        this.currentScore.measures.sort((a, b) => compareMusicPosition(a, b));
        this.currentScore.measures.forEach((m, i) => m.id = i + 1);
        await this.persistCurrentScore();
        this.resetActiveSelection();
        this.renderScoreView();
        this.updateLabBadge();
      }
    }
  }

  async deleteActiveBox() {
    if (!this.editingId || !this.currentScore) return;
    if (this.activeType === 'measure') {
      this.currentScore.measures = this.currentScore.measures.filter(x => x.id !== this.editingId);
      this.currentScore.measures.forEach((x, i) => x.id = i + 1);
    } else if (this.activeType === 'keySig') {
      this.currentScore.keySignatures = this.currentScore.keySignatures.filter(x => x.id !== this.editingId);
    }
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
    this.activeType = null;
    const sb = document.getElementById('editSubbar');
    if (sb) sb.style.display = 'none';
  }

  // --- HLEDÁNÍ PŘÍSLUŠNÉHO KLÍČE PRO TAKT ---
  getKeySignatureForMeasure(measureIndex) {
    const sigs = this.currentScore?.keySignatures;
    if (!sigs || sigs.length === 0) return null;
    const currentM = this.currentScore.measures[measureIndex];
    if (!currentM) return sigs[0];

    // Najdeme klíč předcházející tomuto taktu
    const precedingSigs = sigs.filter(sig => compareMusicPosition(sig, currentM) < 0);
    if (precedingSigs.length > 0) {
      precedingSigs.sort((a, b) => compareMusicPosition(a, b));
      return precedingSigs[precedingSigs.length - 1];
    }
    // Pokud před ním není žádný, vezmeme první v celé skladbě
    sigs.sort((a, b) => compareMusicPosition(a, b));
    return sigs[0];
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
      this.currentScore.keySignatures = [];
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
      const clefWrap = document.getElementById('labClefWrap');
      if (clefWrap) clefWrap.style.display = 'none';
      return;
    }
    this.labCurrentIndex = Math.max(0, Math.min(measures.length - 1, idx));
    const curM = measures[this.labCurrentIndex];
    const lbl = document.getElementById('loupeOpticLabel');
    if (lbl) lbl.innerText = `LUPA • TAKT #${curM.id}`;

    // 1. Zobrazení Klíče a předznamenání nad lupou
    const keySig = this.getKeySignatureForMeasure(this.labCurrentIndex);
    const clefWrap = document.getElementById('labClefWrap');
    if (keySig && this.labClefCanvas && this.labClefCtx) {
      const keyImg = await this.getPageImage(keySig.page || 1);
      if (keyImg) {
        if (clefWrap) clefWrap.style.display = 'flex';
        this.labClefCanvas.width = keySig.box.width;
        this.labClefCanvas.height = keySig.box.height;
        this.labClefCtx.clearRect(0, 0, keySig.box.width, keySig.box.height);
        this.labClefCtx.drawImage(keyImg, keySig.box.left, keySig.box.top, keySig.box.width, keySig.box.height, 0, 0, keySig.box.width, keySig.box.height);
      }
    } else {
      if (clefWrap) clefWrap.style.display = 'none';
    }

    // 2. Kontextové zobrazení taktů pod optickou lupou
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
      this.renderScoreView();
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