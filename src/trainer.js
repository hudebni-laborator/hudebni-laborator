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
    this.cropEditor = null;
    this.isCropMode = false;

    this.labCurrentIndex = 0;
    this.isMarkingMode = false;

    this.editTool = 'pen';
    this.penColor = '#ef4444';
    this.penWidth = 2;
    this.showAnnotations = true;
    this.isDrawingStroke = false;
    this.isErasingStroke = false;
    this.currentStroke = null;

    this.zoomScale = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.hasUserAdjustedView = false;
    this.activeType = null;
    this.editingId = null;

    this.labZoomScale = 1.0;
    this.labPanX = 0;
    this.labPanY = 0;

    this.metronome = new MetronomeController();

    this.initLibrary();
    this.initTouchEngine();
    this.initLabTouchEngine();

    document.addEventListener('fullscreenchange', () => {
      const isFull = !!document.fullscreenElement;
      document.body.classList.toggle('is-fullscreen', isFull);
      const fsBtn = document.getElementById('floatingFsBtn');
      if (fsBtn) {
        fsBtn.innerHTML = isFull ? '✕' : '⛶';
      }
      setTimeout(() => this.fitCanvasToScreen(), 100);
    });

    window.addEventListener('resize', () => {
      if (document.getElementById('editView')?.style.display === 'flex' && !this.hasUserAdjustedView) {
        this.fitCanvasToScreen();
      }
      if (document.getElementById('labView')?.style.display === 'flex') {
        this.showMeasureInLab(this.labCurrentIndex);
      }
    });

    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (this.isCropMode) this.cancelPaperCrop();
        else this.resetActiveSelection();
      }
    });
  }

  togglePlayTempoPopup() {
    const popup = document.getElementById('playTempoPopup');
    if (!popup) return;
    popup.style.display = (popup.style.display === 'none') ? 'block' : 'none';
  }

  showAddPagePrompt() {
    const banner = document.getElementById('addPagePromptBanner');
    const text = document.getElementById('addPagePromptText');
    if (banner && text) {
      text.innerText = `Strana ${this.currentPage} uložena.`;
      banner.style.display = 'flex';
    }
  }

  dismissAddPagePrompt() {
    const banner = document.getElementById('addPagePromptBanner');
    if (banner) banner.style.display = 'none';
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {
          document.body.classList.toggle('is-fullscreen');
        });
      } else {
        document.body.classList.toggle('is-fullscreen');
      }
    } else {
      if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    }
    setTimeout(() => this.fitCanvasToScreen(), 120);
  }

  toggleInteractionMode() {
    this.isMarkingMode = !this.isMarkingMode;
    const btn = document.getElementById('toggleInteractionBtn');
    const zLeft = document.getElementById('zoneLeft');
    const zRight = document.getElementById('zoneRight');
    const drawBar = document.getElementById('editDrawBar');

    if (this.isMarkingMode) {
      if (btn) {
        btn.innerText = 'Edit';
        btn.className = 'btn btn-gold btn-sm fixed-mode-btn';
      }
      if (zLeft) zLeft.style.display = 'none';
      if (zRight) zRight.style.display = 'none';
      if (drawBar) drawBar.style.display = 'flex';
    } else {
      if (btn) {
        btn.innerText = 'Hraní';
        btn.className = 'btn btn-accent btn-sm fixed-mode-btn';
      }
      if (zLeft) zLeft.style.display = 'block';
      if (zRight) zRight.style.display = 'block';
      if (drawBar) drawBar.style.display = 'none';
      this.resetActiveSelection();
    }
    this.renderScoreView();
  }

  setEditTool(tool) {
    this.editTool = tool;
    ['toolBoxBtn'].forEach(id => document.getElementById(id)?.classList.toggle('active', tool === 'box'));
    ['toolPenBtn', 'labToolPenBtn'].forEach(id => document.getElementById(id)?.classList.toggle('active', tool === 'pen'));
    ['toolEraserBtn', 'labToolEraserBtn'].forEach(id => document.getElementById(id)?.classList.toggle('active', tool === 'eraser'));
    if (tool !== 'box') this.resetActiveSelection();
  }

  setPenColor(color) {
    this.penColor = color;
    document.querySelectorAll('.color-btn').forEach(btn => btn.classList.remove('active'));
    if (color === '#ef4444') {
      document.querySelector('.color-red')?.classList.add('active');
      document.getElementById('labColorRed')?.classList.add('active');
    }
    if (color === '#10b981') {
      document.querySelector('.color-green')?.classList.add('active');
      document.getElementById('labColorGreen')?.classList.add('active');
    }
    if (color === '#3b82f6') {
      document.querySelector('.color-blue')?.classList.add('active');
      document.getElementById('labColorBlue')?.classList.add('active');
    }
  }

  setPenWidth(width, btnIdx) {
    this.penWidth = width;
    [1, 2, 3].forEach(i => {
      document.getElementById(`widthBtn${i}`)?.classList.toggle('active', i === btnIdx);
      document.getElementById(`labWidthBtn${i}`)?.classList.toggle('active', i === btnIdx);
    });
  }

  toggleDrawingsVisibility() {
    this.showAnnotations = !this.showAnnotations;
    const opacity = this.showAnnotations ? '1.0' : '0.4';
    const b1 = document.getElementById('toggleDrawingsBtn');
    if (b1) b1.style.opacity = opacity;
    const b2 = document.getElementById('labToggleDrawingsBtn');
    if (b2) b2.style.opacity = opacity;

    this.renderScoreView();
    if (document.getElementById('labView')?.style.display === 'flex') {
      this.showMeasureInLab(this.labCurrentIndex);
    }
  }

  async undoLastDrawing() {
    if (!this.currentScore) return;
    const isLab = document.getElementById('labView')?.style.display === 'flex';
    const targetPage = isLab 
      ? (this.currentScore.measures?.[this.labCurrentIndex]?.page || 1)
      : this.currentPage;

    const key = `page_${targetPage}`;
    if (this.currentScore.drawings && this.currentScore.drawings[key] && this.currentScore.drawings[key].length > 0) {
      this.currentScore.drawings[key].pop();
      await this.persistCurrentScore();
      this.renderScoreView();
      if (isLab) this.showMeasureInLab(this.labCurrentIndex);
    }
  }

  eraseAt(cx, cy, targetPage = null) {
    if (!this.currentScore) return false;
    const pageNum = targetPage || this.currentPage;
    const key = `page_${pageNum}`;
    const strokes = this.currentScore.drawings?.[key];
    if (!strokes || strokes.length === 0) return false;

    const radius = Math.max(6, this.penWidth * 1.5);
    const rSq = radius * radius;
    let modified = false;
    const newStrokes = [];

    for (const stroke of strokes) {
      if (!stroke.points || stroke.points.length === 0) continue;
      let currentRun = [];
      for (const pt of stroke.points) {
        const distSq = (pt.x - cx) ** 2 + (pt.y - cy) ** 2;
        if (distSq <= rSq) {
          modified = true;
          if (currentRun.length > 1) {
            newStrokes.push({ ...stroke, points: currentRun });
          }
          currentRun = [];
        } else {
          currentRun.push(pt);
        }
      }
      if (currentRun.length > 1) {
        newStrokes.push({ ...stroke, points: currentRun });
      }
    }

    if (modified) {
      this.currentScore.drawings[key] = newStrokes;
      this.renderScoreView();
    }
    return modified;
  }

  toggleIncrementalMetronome() { this.metronome.toggle(); }
  resetMetronomeTempo() { this.metronome.resetTempo(); }
  stopMetronome() { this.metronome.stop(); }
  promptSetBpm() {
    const isLab = document.getElementById('labView')?.style.display === 'flex';
    const current = isLab ? this.metronome.labStartBpm : this.metronome.playStartBpm;
    const val = window.prompt('Zadejte tempo (BPM):', current);
    if (val && !isNaN(val)) {
      if (isLab) {
        this.metronome.onStartBpmInput(Number(val));
      } else {
        this.metronome.setPlayBpm(Number(val));
      }
    }
  }

  updateHeaderTitle() {
    const headerTitle = document.getElementById('headerSongTitle');
    if (!headerTitle) return;
    if (this.currentScore?.name) {
      headerTitle.innerText = this.currentScore.name;
      headerTitle.style.display = 'block';
    } else {
      headerTitle.style.display = 'none';
    }
  }

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
      item.innerHTML = `
        <div class="library-info">
          <div class="library-name">${s.name}</div>
          <div class="library-meta">${pg} • Taktů: ${takty} • Klíčů: ${klice}</div>
        </div>
        <div class="library-actions">
          <button class="btn btn-sm" onclick="window.app.renameScore('${s.id}', event)">✏ Přejmenovat</button>
          <button class="btn btn-danger btn-sm" onclick="window.app.deleteScoreFromLibrary('${s.id}', event)">Smazat</button>
        </div>
      `;
      listEl.appendChild(item);
    });
  }

  async loadScore(id, switchTab = true) {
    const score = await window.scoreDB.getScore(id);
    if (!score) return;
    this.stopMetronome();
    this.currentScore = score;
    if (!this.currentScore.drawings) this.currentScore.drawings = {};
    this.currentPage = 1;
    this.hasUserAdjustedView = false;
    this.pageCache.clear();
    this.resetActiveSelection();
    this.dismissAddPagePrompt();

    if (score.isPdf && score.pdfData) {
      try {
        const copy = new Uint8Array(score.pdfData.slice(0));
        this.pdfDoc = await pdfjsLib.getDocument({ data: copy }).promise;
        this.totalPages = this.pdfDoc.numPages;
      } catch (_) { this.totalPages = 1; }
    } else {
      this.totalPages = (score.pages?.length > 0) ? score.pages.length : 1;
    }

    this.updateHeaderTitle();

    const crop = document.getElementById('cropPaperBtn');
    if (crop) crop.style.display = score.isPdf ? 'none' : 'inline-flex';

    const addPg = document.getElementById('addPageLabel');
    if (addPg) addPg.style.display = score.isPdf ? 'none' : 'inline-flex';

    this.updateLabBadge();

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
      drawings: {},
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
          if (this.scoreCtx) this.scoreCtx.clearRect(0, 0, this.scoreCanvas.width, this.scoreCanvas.height);
          this.updateHeaderTitle();
        }
      }
      this.renderLibraryList(all);
    }
  }

  async renameScore(id, e) {
    if (e) e.stopPropagation();
    const score = await window.scoreDB.getScore(id);
    if (!score) return;
    const currentName = score.name || 'Skladba';
    const newName = window.prompt('Zadejte nový název skladby:', currentName);
    if (newName && newName.trim() && newName.trim() !== currentName) {
      score.name = newName.trim();
      score.updatedAt = Date.now();
      await window.scoreDB.saveScore(score);
      if (this.currentScore?.id === id) {
        this.currentScore.name = score.name;
        this.updateHeaderTitle();
      }
      const all = await window.scoreDB.getAllScores();
      this.renderLibraryList(all);
    }
  }

  async appendPageToCurrentScore(imageData) {
    if (!this.currentScore || this.currentScore.isPdf) return;
    if (!this.currentScore.pages || this.currentScore.pages.length === 0) {
      this.currentScore.pages = [this.currentScore.imageData];
    }
    this.currentScore.pages.push(imageData);
    this.totalPages = this.currentScore.pages.length;
    this.currentPage = this.totalPages;
    await this.persistCurrentScore();
    this.updatePageSwitcherUI();
    await this.renderCurrentPage();

    const all = await window.scoreDB.getAllScores();
    this.renderLibraryList(all);
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

  async importBackupJSON(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const importedScores = JSON.parse(text);
      if (!Array.isArray(importedScores)) throw new Error('Neplatný formát záložního souboru.');

      let count = 0;
      for (const score of importedScores) {
        if (score && score.id && score.name) {
          await window.scoreDB.saveScore(score);
          count++;
        }
      }
      alert(`Úspěšně obnoveno ${count} skladeb.`);
      const all = await window.scoreDB.getAllScores();
      this.renderLibraryList(all);
      document.getElementById('libCountSpan').innerText = all.length;
    } catch (err) {
      alert('Chyba při importu: ' + err.message);
    }
    e.target.value = '';
  }

  async persistCurrentScore() {
    if (!this.currentScore) return;
    this.currentScore.updatedAt = Date.now();
    await window.scoreDB.saveScore(this.currentScore);
  }

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
    const popup = document.getElementById('playTempoPopup');
    if (popup) popup.style.display = 'none';
    
    const p = this.pageCache.get(this.currentPage);
    if (!p || !this.scoreCtx) return;
    this.scoreCtx.clearRect(0, 0, this.scoreCanvas.width, this.scoreCanvas.height);
    this.scoreCtx.drawImage(p, 0, 0);

    if (this.showAnnotations && this.currentScore?.drawings) {
      const strokes = this.currentScore.drawings[`page_${this.currentPage}`] || [];
      this.scoreCtx.save();
      this.scoreCtx.lineCap = 'round';
      this.scoreCtx.lineJoin = 'round';
      strokes.forEach(stroke => {
        if (!stroke.points || stroke.points.length < 2) return;
        this.scoreCtx.strokeStyle = stroke.color || '#ef4444';
        this.scoreCtx.lineWidth = stroke.width || 2;
        this.scoreCtx.beginPath();
        this.scoreCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) {
          this.scoreCtx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }
        this.scoreCtx.stroke();
      });
      this.scoreCtx.restore();
    }

    if (!this.isMarkingMode) return;

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
    const h = rect.height > 0 ? rect.height : window.innerHeight;

    const scaleX = w / this.scoreCanvas.width;
    const scaleY = h / this.scoreCanvas.height;

    this.zoomScale = Math.min(scaleX, scaleY);
    this.panX = Math.round((w - this.scoreCanvas.width * this.zoomScale) / 2);
    this.panY = 0; // Přilepeno k hornímu okraji

    this.hasUserAdjustedView = false;
    this.updateViewportTransform();
  }

  applyZoomAt(ns, cx, cy) {
    const clampedScale = Math.max(0.15, Math.min(4.5, ns));
    const f = clampedScale / this.zoomScale;
    this.panX = cx - (cx - this.panX) * f;
    this.panY = cy - (cy - this.panY) * f;
    this.zoomScale = clampedScale;
    this.hasUserAdjustedView = true;
    this.updateViewportTransform();
  }

  // --- OŘEZ PAPÍRU (SPUSTIT / PROVÉST / ZRUŠIT) ---
  startPaperCrop() {
    if (!this.currentScore || this.currentScore.isPdf) return;
    this.resetActiveSelection();
    const cleanCanvas = this.pageCache.get(this.currentPage);
    if (!cleanCanvas) return;

    this.isCropMode = true;
    const cropToolbar = document.getElementById('cropToolbar');
    if (cropToolbar) cropToolbar.style.display = 'flex';

    const drawBar = document.getElementById('editDrawBar');
    if (drawBar) drawBar.style.display = 'none';

    const marginX = Math.round(cleanCanvas.width * 0.04);
    const marginY = Math.round(cleanCanvas.height * 0.04);
    const initBox = {
      left: marginX,
      top: marginY,
      width: cleanCanvas.width - marginX * 2,
      height: cleanCanvas.height - marginY * 2
    };

    this.cropEditor = new PaperCropEditor(
      this.scoreCanvas,
      () => this.renderScoreView(),
      initBox
    );
  }

  async applyPaperCrop() {
    if (!this.cropEditor || !this.isCropMode) return;
    const b = this.cropEditor.box;
    const cleanCanvas = this.pageCache.get(this.currentPage);
    if (!cleanCanvas) return;

    const cropX = Math.max(0, Math.round(b.left));
    const cropY = Math.max(0, Math.round(b.top));
    const cropW = Math.max(50, Math.min(cleanCanvas.width - cropX, Math.round(b.width)));
    const cropH = Math.max(50, Math.min(cleanCanvas.height - cropY, Math.round(b.height)));

    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = cropW;
    croppedCanvas.height = cropH;
    const cctx = croppedCanvas.getContext('2d');
    cctx.drawImage(cleanCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    const croppedDataUrl = croppedCanvas.toDataURL('image/jpeg', 0.92);

    if (this.currentScore.measures) {
      this.currentScore.measures.forEach(m => {
        if ((m.page || 1) === this.currentPage) {
          m.box.left = Math.max(0, m.box.left - cropX);
          m.box.top = Math.max(0, m.box.top - cropY);
        }
      });
    }

    if (this.currentScore.keySignatures) {
      this.currentScore.keySignatures.forEach(k => {
        if ((k.page || 1) === this.currentPage) {
          k.box.left = Math.max(0, k.box.left - cropX);
          k.box.top = Math.max(0, k.box.top - cropY);
        }
      });
    }

    const pageKey = `page_${this.currentPage}`;
    if (this.currentScore.drawings && this.currentScore.drawings[pageKey]) {
      this.currentScore.drawings[pageKey].forEach(stroke => {
        if (stroke.points) {
          stroke.points.forEach(pt => {
            pt.x -= cropX;
            pt.y -= cropY;
          });
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

    this.scoreCanvas.width = croppedCanvas.width;
    this.scoreCanvas.height = croppedCanvas.height;
    this.renderScoreView();
    this.fitCanvasToScreen();
  }

  cancelPaperCrop() {
    if (this.cropEditor) {
      this.cropEditor.destroy();
      this.cropEditor = null;
    }
    this.isCropMode = false;
    const cropToolbar = document.getElementById('cropToolbar');
    if (cropToolbar) cropToolbar.style.display = 'none';

    if (this.isMarkingMode) {
      const drawBar = document.getElementById('editDrawBar');
      if (drawBar) drawBar.style.display = 'flex';
    }
    this.renderScoreView();
  }

  // --- DOTYKOVÝ ENGINE V HRANÍ A EDITU ---
  initTouchEngine() {
    const box = this.canvasBox;
    if (!box) return;
    let ongoingTouches = new Map();
    let initialPinchDist = null;
    let initialPinchScale = 1.0;
    let isDrag = false, isPan = false;
    let startPoint = null;

    box.addEventListener('touchstart', (e) => {
      if (e.touches.length > 1) e.preventDefault();
    }, { passive: false });

    box.addEventListener('touchmove', (e) => {
      e.preventDefault();
    }, { passive: false });

    box.addEventListener('pointerdown', e => {
      if (e.target.id === 'floatingFsBtn') return;

      ongoingTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // 1. Ořez papíru
      if (this.isCropMode && this.cropEditor) {
        const c = this.screenToCanvasCoords(e.clientX, e.clientY);
        const act = this.cropEditor.hitTest(c.x, c.y);
        if (act) {
          isDrag = true;
          this.cropEditor.startDrag(act, c.x, c.y);
          box.setPointerCapture(e.pointerId);
        } else {
          isPan = true;
          box.setPointerCapture(e.pointerId);
        }
        return;
      }

      if (!this.isMarkingMode && e.target.classList.contains('page-turn-zone')) return;

      // 2. Guma
      if (this.isMarkingMode && this.editTool === 'eraser' && ongoingTouches.size === 1) {
        this.isErasingStroke = true;
        const c = this.screenToCanvasCoords(e.clientX, e.clientY);
        this.eraseAt(c.x, c.y);
        box.setPointerCapture(e.pointerId);
        return;
      }

      // 3. Kreslení tužkou
      if (this.isMarkingMode && this.editTool === 'pen' && ongoingTouches.size === 1) {
        this.isDrawingStroke = true;
        const c = this.screenToCanvasCoords(e.clientX, e.clientY);
        this.currentStroke = {
          color: this.penColor,
          width: this.penWidth,
          points: [{ x: c.x, y: c.y }]
        };
        box.setPointerCapture(e.pointerId);
        return;
      }

      // 4. Posun, zoom a úprava rámečku
      if (ongoingTouches.size === 1) {
        startPoint = { x: e.clientX, y: e.clientY };
        const c = this.screenToCanvasCoords(e.clientX, e.clientY);
        if (this.activeEditor) {
          const act = this.activeEditor.hitTest(c.x, c.y, this.activeEditor.touchTolerance / this.zoomScale);
          if (act) {
            isDrag = true;
            this.activeEditor.startDrag(act, c.x, c.y, e.clientX, e.clientY);
            box.setPointerCapture(e.pointerId);
            return;
          }
        }
        isPan = true;
        box.setPointerCapture(e.pointerId);
      } else if (ongoingTouches.size === 2) {
        isDrag = isPan = this.isDrawingStroke = this.isErasingStroke = false;
        if (this.activeEditor) this.activeEditor.endDrag();
        const t = Array.from(ongoingTouches.values());
        initialPinchDist = Math.hypot(t[0].x - t[1].x, t[0].y - t[1].y);
        initialPinchScale = this.zoomScale;
      }
    });

    box.addEventListener('pointermove', e => {
      if (!ongoingTouches.has(e.pointerId)) return;
      const prev = ongoingTouches.get(e.pointerId);
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      ongoingTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.isCropMode && this.cropEditor) {
        if (isDrag) {
          const c = this.screenToCanvasCoords(e.clientX, e.clientY);
          this.cropEditor.moveDrag(c.x, c.y);
        } else if (isPan) {
          this.panX += dx;
          this.panY += dy;
          this.updateViewportTransform();
        }
        return;
      }

      if (this.isErasingStroke) {
        const c = this.screenToCanvasCoords(e.clientX, e.clientY);
        this.eraseAt(c.x, c.y);
        return;
      }

      if (this.isDrawingStroke && this.currentStroke) {
        const c = this.screenToCanvasCoords(e.clientX, e.clientY);
        this.currentStroke.points.push({ x: c.x, y: c.y });
        if (this.scoreCtx) {
          this.scoreCtx.save();
          this.scoreCtx.strokeStyle = this.currentStroke.color;
          this.scoreCtx.lineWidth = this.currentStroke.width;
          this.scoreCtx.lineCap = 'round';
          this.scoreCtx.lineJoin = 'round';
          const pts = this.currentStroke.points;
          if (pts.length >= 2) {
            this.scoreCtx.beginPath();
            this.scoreCtx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
            this.scoreCtx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
            this.scoreCtx.stroke();
          }
          this.scoreCtx.restore();
        }
        return;
      }

      if (ongoingTouches.size === 2) {
        const t = Array.from(ongoingTouches.values());
        const dist = Math.hypot(t[0].x - t[1].x, t[0].y - t[1].y);
        const rect = box.getBoundingClientRect();
        const cx = (t[0].x + t[1].x) / 2 - rect.left;
        const cy = (t[0].y + t[1].y) / 2 - rect.top;
        if (initialPinchDist > 0) {
          this.applyZoomAt(initialPinchScale * (dist / initialPinchDist), cx, cy);
        }
        this.panX += dx / 2;
        this.panY += dy / 2;
        this.hasUserAdjustedView = true;
        this.updateViewportTransform();
      } else if (ongoingTouches.size === 1) {
        if (isDrag && this.activeEditor) {
          const c = this.screenToCanvasCoords(e.clientX, e.clientY);
          this.activeEditor.moveDrag(c.x, c.y, e.clientX, e.clientY);
        } else if (isPan) {
          this.panX += dx;
          this.panY += dy;
          this.hasUserAdjustedView = true;
          this.updateViewportTransform();
        }
      }
    });

    const end = async (e) => {
      ongoingTouches.delete(e.pointerId);

      if (this.isCropMode && this.cropEditor) {
        this.cropEditor.endDrag();
        isDrag = isPan = false;
        return;
      }

      if (this.isErasingStroke) {
        this.isErasingStroke = false;
        await this.persistCurrentScore();
        return;
      }

      if (this.isDrawingStroke && this.currentStroke) {
        this.isDrawingStroke = false;
        if (this.currentStroke.points.length > 1 && this.currentScore) {
          const key = `page_${this.currentPage}`;
          if (!this.currentScore.drawings) this.currentScore.drawings = {};
          if (!this.currentScore.drawings[key]) this.currentScore.drawings[key] = [];
          this.currentScore.drawings[key].push(this.currentStroke);
          await this.persistCurrentScore();
        }
        this.currentStroke = null;
        this.renderScoreView();
        return;
      }

      if (ongoingTouches.size === 0) {
        if (isDrag && this.activeEditor) this.activeEditor.endDrag();
        if (startPoint && !isDrag && !this.isCropMode) {
          const dist = Math.hypot(e.clientX - startPoint.x, e.clientY - startPoint.y);
          if (dist < 8 && this.isMarkingMode && this.editTool === 'box') {
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

  handleCanvasTap(clientX, clientY) {
    if (!this.currentScore) return;
    const clean = this.pageCache.get(this.currentPage);
    if (!clean) return;

    const c = this.screenToCanvasCoords(clientX, clientY);
    if (c.x < 0 || c.x > clean.width || c.y < 0 || c.y > clean.height) return;

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
      if (toggleCatBtn) { toggleCatBtn.style.display = 'inline-flex'; toggleCatBtn.innerText = '🔄 Na Klíč'; }
      if (delBtn) delBtn.style.display = 'inline-flex';
    } else if (this.activeType === 'keySig') {
      if (addBtn) addBtn.style.display = 'none';
      if (setKeyBtn) { setKeyBtn.style.display = 'inline-flex'; setKeyBtn.innerText = '✔ Upravit Klíč'; }
      if (toggleCatBtn) { toggleCatBtn.style.display = 'inline-flex'; toggleCatBtn.innerText = '🔄 Na Takt'; }
      if (delBtn) delBtn.style.display = 'inline-flex';
    } else {
      if (addBtn) { addBtn.style.display = 'inline-flex'; addBtn.innerText = '✔ Uložit takt'; }
      if (setKeyBtn) { setKeyBtn.style.display = 'inline-flex'; setKeyBtn.innerText = '🎼 Uložit jako Klíč'; }
      if (toggleCatBtn) toggleCatBtn.style.display = 'none';
      if (delBtn) delBtn.style.display = 'none';
    }
  }

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
  }

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
  }

  resetActiveSelection() {
    if (this.activeEditor) {
      this.activeEditor.destroy();
      this.activeEditor = null;
    }
    this.editingId = null;
    this.activeType = null;
    const sb = document.getElementById('editSubbar');
    if (sb) sb.style.display = 'none';
    this.renderScoreView();
  }

  getKeySignatureForMeasure(measureIndex) {
    const sigs = this.currentScore?.keySignatures;
    if (!sigs || sigs.length === 0) return null;
    const currentM = this.currentScore.measures[measureIndex];
    if (!currentM) return sigs[0];

    const precedingSigs = sigs.filter(sig => compareMusicPosition(sig, currentM) < 0);
    if (precedingSigs.length > 0) {
      precedingSigs.sort((a, b) => compareMusicPosition(a, b));
      return precedingSigs[precedingSigs.length - 1];
    }
    sigs.sort((a, b) => compareMusicPosition(a, b));
    return sigs[0];
  }

  updateLabTransform() {
    const vp = document.getElementById('labViewport');
    if (vp) {
      vp.style.transform = `translate(${this.labPanX}px, ${this.labPanY}px) scale(${this.labZoomScale})`;
    }
  }

  fitLabCanvas() {
    const lens = document.getElementById('rectLoupeLens');
    if (!lens || !this.labCanvas || this.labCanvas.width === 0 || this.labCanvas.height === 0) return;

    const lensRect = lens.getBoundingClientRect();
    const w = lensRect.width > 0 ? lensRect.width : lens.clientWidth;
    const h = lensRect.height > 0 ? lensRect.height : lens.clientHeight;

    if (w <= 0 || h <= 0) return;

    const scaleX = w / this.labCanvas.width;
    const scaleY = h / this.labCanvas.height;

    this.labZoomScale = Math.min(scaleX, scaleY);
    this.labPanX = Math.round((w - this.labCanvas.width * this.labZoomScale) / 2);
    this.labPanY = Math.round((h - this.labCanvas.height * this.labZoomScale) / 2);

    this.updateLabTransform();
  }

  initLabTouchEngine() {
    const lens = document.getElementById('rectLoupeLens');
    if (!lens || !this.labCanvas) return;

    let ongoingTouches = new Map();
    let initialPinchDist = null;
    let initialPinchScale = 1.0;
    let isLabDrawing = false;
    let isLabErasing = false;
    let isLabPanning = false;
    let currentLabStroke = null;

    lens.addEventListener('touchstart', e => {
      if (e.touches.length > 1) e.preventDefault();
    }, { passive: false });

    lens.addEventListener('touchmove', e => {
      e.preventDefault();
    }, { passive: false });

    lens.addEventListener('pointerdown', e => {
      const curM = this.currentScore?.measures?.[this.labCurrentIndex];
      if (!curM) return;

      ongoingTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (ongoingTouches.size === 1) {
        lens.setPointerCapture(e.pointerId);
        const pageCoords = this.labCanvasToPageCoords(e.clientX, e.clientY, curM);

        if (this.editTool === 'eraser') {
          if (pageCoords) {
            isLabErasing = true;
            this.eraseAt(pageCoords.x, pageCoords.y, curM.page || 1);
            this.showMeasureInLab(this.labCurrentIndex, false);
          }
        } else if (this.editTool === 'pen') {
          if (pageCoords) {
            isLabDrawing = true;
            currentLabStroke = {
              color: this.penColor,
              width: this.penWidth,
              points: [{ x: pageCoords.x, y: pageCoords.y }]
            };
          }
        } else {
          isLabPanning = true;
        }
      } else if (ongoingTouches.size === 2) {
        isLabDrawing = isLabErasing = isLabPanning = false;
        const t = Array.from(ongoingTouches.values());
        initialPinchDist = Math.hypot(t[0].x - t[1].x, t[0].y - t[1].y);
        initialPinchScale = this.labZoomScale;
      }
    });

    lens.addEventListener('pointermove', e => {
      if (!ongoingTouches.has(e.pointerId)) return;
      const prev = ongoingTouches.get(e.pointerId);
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      ongoingTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });

      const curM = this.currentScore?.measures?.[this.labCurrentIndex];
      if (!curM) return;

      if (ongoingTouches.size === 2) {
        const t = Array.from(ongoingTouches.values());
        const dist = Math.hypot(t[0].x - t[1].x, t[0].y - t[1].y);
        const rect = lens.getBoundingClientRect();
        const cx = (t[0].x + t[1].x) / 2 - rect.left;
        const cy = (t[0].y + t[1].y) / 2 - rect.top;

        if (initialPinchDist > 0) {
          const newScale = Math.max(0.2, Math.min(5.0, initialPinchScale * (dist / initialPinchDist)));
          const f = newScale / this.labZoomScale;
          this.labPanX = cx - (cx - this.labPanX) * f;
          this.labPanY = cy - (cy - this.labPanY) * f;
          this.labZoomScale = newScale;
        }
        this.labPanX += dx / 2;
        this.labPanY += dy / 2;
        this.updateLabTransform();
        return;
      }

      if (ongoingTouches.size === 1) {
        if (isLabPanning) {
          this.labPanX += dx;
          this.labPanY += dy;
          this.updateLabTransform();
          return;
        }

        const pageCoords = this.labCanvasToPageCoords(e.clientX, e.clientY, curM);
        if (!pageCoords) return;

        if (isLabErasing) {
          this.eraseAt(pageCoords.x, pageCoords.y, curM.page || 1);
          this.showMeasureInLab(this.labCurrentIndex, false);
          return;
        }

        if (isLabDrawing && currentLabStroke) {
          currentLabStroke.points.push({ x: pageCoords.x, y: pageCoords.y });

          if (this.labCtx) {
            const ratio = this.labScaleRatio || 1.0;
            this.labCtx.save();
            this.labCtx.strokeStyle = currentLabStroke.color;
            this.labCtx.lineWidth = currentLabStroke.width * ratio;
            this.labCtx.lineCap = 'round';
            this.labCtx.lineJoin = 'round';
            this.labCtx.scale(ratio, ratio);
            this.labCtx.translate(-curM.box.left, -curM.box.top);

            const pts = currentLabStroke.points;
            if (pts.length >= 2) {
              this.labCtx.beginPath();
              this.labCtx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
              this.labCtx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
              this.labCtx.stroke();
            }
            this.labCtx.restore();
          }
        }
      }
    });

    const finishLabPointer = async () => {
      const curM = this.currentScore?.measures?.[this.labCurrentIndex];
      if (isLabDrawing && currentLabStroke && curM) {
        isLabDrawing = false;
        if (currentLabStroke.points.length > 1 && this.currentScore) {
          const key = `page_${curM.page || 1}`;
          if (!this.currentScore.drawings) this.currentScore.drawings = {};
          if (!this.currentScore.drawings[key]) this.currentScore.drawings[key] = [];
          this.currentScore.drawings[key].push(currentLabStroke);
          await this.persistCurrentScore();
        }
        currentLabStroke = null;
        this.showMeasureInLab(this.labCurrentIndex, false);
      }
      isLabErasing = false;
      isLabPanning = false;
      ongoingTouches.clear();
    };

    lens.addEventListener('pointerup', finishLabPointer);
    lens.addEventListener('pointercancel', finishLabPointer);
  }

  labCanvasToPageCoords(clientX, clientY, curM) {
    const lens = document.getElementById('rectLoupeLens');
    if (!lens || !this.labCanvas) return null;
    const rect = lens.getBoundingClientRect();
    const ratio = this.labScaleRatio || 1.0;

    const localX = (clientX - rect.left - this.labPanX) / (this.labZoomScale * ratio);
    const localY = (clientY - rect.top - this.labPanY) / (this.labZoomScale * ratio);

    return {
      x: Math.round(curM.box.left + localX),
      y: Math.round(curM.box.top + localY)
    };
  }

  updateLabBadge() {
    const c = (this.currentScore?.measures || []).length;
    const b = document.getElementById('labBadgeCount');
    if (b) { b.innerText = c; b.style.display = c > 0 ? 'inline-block' : 'none'; }
  }

  renderLabQueue() {
    const wrap = document.getElementById('labQueuePills');
    if (!wrap || !this.currentScore) return;
    wrap.innerHTML = '';
    const m = this.currentScore.measures || [];
    if (m.length === 0) { 
      wrap.innerHTML = '<span style="font-size:0.75rem; color:var(--text-dim); padding:4px;">Laboratoř je prázdná. Označte takt v Hraní.</span>'; 
      return; 
    }
    m.forEach(x => {
      const b = document.createElement('button');
      b.className = 'queue-pill' + (x.id === m[this.labCurrentIndex]?.id ? ' active' : '');
      b.innerText = `#${x.id}`;
      b.onclick = () => { 
        this.labCurrentIndex = m.indexOf(x); 
        this.renderLabQueue(); 
        this.showMeasureInLab(this.labCurrentIndex); 
      };
      wrap.appendChild(b);
    });
  }

  nextLabMeasure() {
    const m = this.currentScore?.measures || [];
    if (m.length <= 1) return;
    this.labCurrentIndex = (this.labCurrentIndex + 1) % m.length;
    this.renderLabQueue();
    this.showMeasureInLab(this.labCurrentIndex, true);
  }

  prevLabMeasure() {
    const m = this.currentScore?.measures || [];
    if (m.length <= 1) return;
    this.labCurrentIndex = (this.labCurrentIndex - 1 + m.length) % m.length;
    this.renderLabQueue();
    this.showMeasureInLab(this.labCurrentIndex, true);
  }

  enhanceMeasurePixels(ctx, width, height) {
    const imgData = ctx.getImageData(0, 0, width, height);
    const src = imgData.data;
    const copy = new Uint8ClampedArray(src);
    const strength = 0.40;

    for (let y = 1; y < height - 1; y++) {
      const rowOffset = y * width;
      for (let x = 1; x < width - 1; x++) {
        const idx = (rowOffset + x) * 4;

        for (let c = 0; c < 3; c++) {
          const center = copy[idx + c];
          const up = copy[((y - 1) * width + x) * 4 + c];
          const down = copy[((y + 1) * width + x) * 4 + c];
          const left = copy[(rowOffset + x - 1) * 4 + c];
          const right = copy[(rowOffset + x + 1) * 4 + c];

          let val = center + strength * (4 * center - up - down - left - right);

          if (val < 135) {
            val = Math.max(12, val * 0.82);
          } else if (val > 195) {
            val = Math.min(255, val * 1.04);
          }

          src[idx + c] = val;
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  samplePaperColorFromImage(sourceCanvas, box) {
    const defaultColor = '#f4f2ec';
    if (!sourceCanvas || !box) return defaultColor;

    try {
      const ctx = sourceCanvas.getContext('2d');
      const offset = 4;
      const patchSize = 5;

      const samplePoints = [
        { x: box.left + offset, y: box.top + offset },
        { x: box.left + box.width - offset - patchSize, y: box.top + offset },
        { x: box.left + offset, y: box.top + box.height - offset - patchSize },
        { x: box.left + box.width - offset - patchSize, y: box.top + box.height - offset - patchSize }
      ];

      let bestBrightness = -1;
      let bestRgb = null;

      for (const pt of samplePoints) {
        const sx = Math.max(0, Math.min(sourceCanvas.width - patchSize, Math.floor(pt.x)));
        const sy = Math.max(0, Math.min(sourceCanvas.height - patchSize, Math.floor(pt.y)));
        const imgData = ctx.getImageData(sx, sy, patchSize, patchSize).data;

        let sumR = 0, sumG = 0, sumB = 0, count = 0;
        for (let i = 0; i < imgData.length; i += 4) {
          sumR += imgData[i];
          sumG += imgData[i + 1];
          sumB += imgData[i + 2];
          count++;
        }

        const avgR = Math.round(sumR / count);
        const avgG = Math.round(sumG / count);
        const avgB = Math.round(sumB / count);

        const brightness = 0.299 * avgR + 0.587 * avgG + 0.114 * avgB;

        if (brightness > bestBrightness && brightness > 140) {
          bestBrightness = brightness;
          bestRgb = { r: avgR, g: avgG, b: avgB };
        }
      }

      if (bestRgb) {
        return `rgb(${bestRgb.r}, ${bestRgb.g}, ${bestRgb.b})`;
      }
    } catch (_) {}

    return defaultColor;
  }

  async showMeasureInLab(idx, autoFit = true) {
    const measures = this.currentScore?.measures || [];
    const clefWrap = document.getElementById('labClefWrap');
    const ind = document.getElementById('labMeasureIndicator');

    if (measures.length === 0) {
      if (this.labCtx && this.labCanvas) this.labCtx.clearRect(0, 0, this.labCanvas.width, this.labCanvas.height);
      if (clefWrap) clefWrap.style.display = 'none';
      if (ind) ind.innerText = 'Prázdno';
      return;
    }

    this.labCurrentIndex = Math.max(0, Math.min(measures.length - 1, idx));
    const curM = measures[this.labCurrentIndex];
    if (ind) ind.innerText = `Takt #${curM.id}`;

    const lens = document.getElementById('rectLoupeLens');
    const container = document.querySelector('.rect-loupe-container');
    const lensW = lens ? lens.clientWidth : 800;
    const lensH = lens ? lens.clientHeight : 300;
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    // 1. Získání původního snímku pro dynamické vzorkování barvy
    const curImg = await this.getPageImage(curM.page || 1);
    const paperColor = this.samplePaperColorFromImage(curImg, curM.box);

    // Sjednocení pozadí čočky i rámečku
    if (lens) lens.style.backgroundColor = paperColor;
    if (container) container.style.backgroundColor = paperColor;

    // 2. KLÍČ & PŘEDZNAMENÁNÍ (Ostré vektorové vykreslení pro PDF)
    const keySig = this.getKeySignatureForMeasure(this.labCurrentIndex);
    if (keySig && this.labClefCanvas && this.labClefCtx) {
      if (this.currentScore?.isPdf && this.pdfDoc) {
        try {
          const keyPage = await this.pdfDoc.getPage(keySig.page || 1);
          const kScale = Math.min(8.0, 2.0 * dpr * 1.5);
          const kRatio = kScale / 2.0;
          const kW = Math.round(keySig.box.width * kRatio);
          const kH = Math.round(keySig.box.height * kRatio);
          const kX = Math.round(keySig.box.left * kRatio);
          const kY = Math.round(keySig.box.top * kRatio);

          this.labClefCanvas.width = kW;
          this.labClefCanvas.height = kH;
          this.labClefCtx.fillStyle = paperColor;
          this.labClefCtx.fillRect(0, 0, kW, kH);

          const kViewport = keyPage.getViewport({ scale: kScale });
          await keyPage.render({
            canvasContext: this.labClefCtx,
            viewport: kViewport,
            transform: [1, 0, 0, 1, -kX, -kY]
          }).promise;
          if (clefWrap) clefWrap.style.display = 'inline-flex';
        } catch (_) {}
      } else {
        const keyImg = await this.getPageImage(keySig.page || 1);
        if (keyImg) {
          if (clefWrap) clefWrap.style.display = 'inline-flex';
          this.labClefCanvas.width = keySig.box.width;
          this.labClefCanvas.height = keySig.box.height;
          this.labClefCtx.fillStyle = paperColor;
          this.labClefCtx.fillRect(0, 0, keySig.box.width, keySig.box.height);
          this.labClefCtx.drawImage(
            keyImg,
            keySig.box.left, keySig.box.top, keySig.box.width, keySig.box.height,
            0, 0, keySig.box.width, keySig.box.height
          );
        }
      }
    } else {
      if (clefWrap) clefWrap.style.display = 'none';
    }

    // 3. TAKT: Vykreslení podle typu zdroje (PDF vs Foto)
    if (!this.labCanvas || !this.labCtx) return;

    if (this.currentScore?.isPdf && this.pdfDoc) {
      const pageNum = curM.page || 1;
      const page = await this.pdfDoc.getPage(pageNum);

      const fitScale = Math.min(lensW / curM.box.width, lensH / curM.box.height);
      const targetScale = Math.min(10.0, Math.max(2.0, 2.0 * fitScale * dpr));
      const ratio = targetScale / 2.0;

      const cropW = Math.round(curM.box.width * ratio);
      const cropH = Math.round(curM.box.height * ratio);
      const cropX = Math.round(curM.box.left * ratio);
      const cropY = Math.round(curM.box.top * ratio);

      this.labCanvas.width = cropW;
      this.labCanvas.height = cropH;
      this.labScaleRatio = ratio;

      this.labCtx.fillStyle = paperColor;
      this.labCtx.fillRect(0, 0, cropW, cropH);

      const viewport = page.getViewport({ scale: targetScale });

      if (this.labRenderTask) {
        try { this.labRenderTask.cancel(); } catch (_) {}
        this.labRenderTask = null;
      }

      const renderTask = page.render({
        canvasContext: this.labCtx,
        viewport: viewport,
        transform: [1, 0, 0, 1, -cropX, -cropY]
      });
      this.labRenderTask = renderTask;

      try {
        await renderTask.promise;
      } catch (err) {
        if (err.name === 'RenderingCancelledException') return;
      }
    } else {
      if (!curImg) return;

      this.labScaleRatio = 1.0;
      this.labCanvas.width = curM.box.width;
      this.labCanvas.height = curM.box.height;

      this.labCtx.fillStyle = paperColor;
      this.labCtx.fillRect(0, 0, this.labCanvas.width, this.labCanvas.height);
      this.labCtx.imageSmoothingEnabled = true;
      this.labCtx.imageSmoothingQuality = 'high';
      this.labCtx.drawImage(
        curImg,
        curM.box.left, curM.box.top, curM.box.width, curM.box.height,
        0, 0, curM.box.width, curM.box.height
      );
    }

    // 4. VYKRESLENÍ PŘIPSANÝCH ZNAČEK
    const ratio = this.labScaleRatio || 1.0;
    if (this.showAnnotations && this.currentScore?.drawings) {
      const pageKey = `page_${curM.page || 1}`;
      const strokes = this.currentScore.drawings[pageKey] || [];
      if (strokes.length > 0) {
        this.labCtx.save();
        this.labCtx.lineCap = 'round';
        this.labCtx.lineJoin = 'round';
        this.labCtx.scale(ratio, ratio);
        this.labCtx.translate(-curM.box.left, -curM.box.top);
        strokes.forEach(stroke => {
          if (!stroke.points || stroke.points.length < 2) return;
          this.labCtx.strokeStyle = stroke.color || '#ef4444';
          this.labCtx.lineWidth = stroke.width || 2;
          this.labCtx.beginPath();
          this.labCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
          for (let i = 1; i < stroke.points.length; i++) {
            this.labCtx.lineTo(stroke.points[i].x, stroke.points[i].y);
          }
          this.labCtx.stroke();
        });
        this.labCtx.restore();
      }
    }

    if (autoFit) {
      this.fitLabCanvas();
    } else {
      this.updateLabTransform();
    }
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
      this.renderScoreView();
    }
  }

  updatePageSwitcherUI() {
    const ind = document.getElementById('pageIndicator');
    if (ind) ind.innerText = `${this.currentPage}/${this.totalPages}`;
    const prev = document.getElementById('prevPageBtn');
    if (prev) prev.disabled = this.currentPage <= 1;
    const next = document.getElementById('nextPageBtn');
    if (next) next.disabled = this.currentPage >= this.totalPages;
  }

  async changePage(delta) {
    const t = this.currentPage + delta;
    if (t < 1 || t > this.totalPages) return;
    this.currentPage = t;
    this.updatePageSwitcherUI();
    this.resetActiveSelection();
    this.dismissAddPagePrompt();
    
    await this.renderCurrentPage();
    this.updateViewportTransform();
  }
}