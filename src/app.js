import { saveScore, getAllScores, getScoreById, deleteScore, saveMeasures, getMeasuresByScore } from './db.js';
import { screenLock } from './wakeLock.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Globální stav aplikace
let currentScore = null;
let currentPdf = null;
let currentImageBitmap = null;
let currentImageThreshold = 145;
let currentMeasures = [];
let activeKeyBox = null;
let selectionMode = 'measure'; // 'key' | 'measure'
let touchTool = 'draw';        // 'draw' | 'pan'
let practiceIndex = 0;
let measuresPerView = 1;

// Vícestránkový stav
let totalPages = 1;
let currentPageNum = 1;
const pageCanvasCache = new Map();

// Stav přiblížení a posunu (Zoom & Pan)
let editorZoom = 1.0;
let editorPanX = 0;
let editorPanY = 0;
let initialPinchDistance = 0;
let initialPinchZoom = 1.0;
let initialPinchCenter = { x: 0, y: 0 };
let isPinching = false;

// Stav interakce obdélníků
let selectedMeasureId = null;
let editAction = null; // 'create' | 'move' | 'viewport-pan' | 'resize-tl' apod.
let dragTarget = null;
let initialPointerPos = { x: 0, y: 0 };
let originalBox = null;
let dragPreviewEl = null;

// DOM Elementy
const views = {
  library: document.getElementById('view-library'),
  editor: document.getElementById('view-editor'),
  practice: document.getElementById('view-practice')
};

const pdfCanvas = document.getElementById('pdf-canvas');
const selectionLayer = document.getElementById('selection-layer');
const canvasWrapper = document.querySelector('.canvas-wrapper');
const canvasViewport = document.getElementById('canvas-viewport');
const practiceContainer = document.getElementById('practice-strips');
const practiceKeyHeader = document.getElementById('practice-key-header');
const practiceKeyCanvas = document.getElementById('practice-key-canvas');
const pageControls = document.getElementById('page-controls');
const pageIndicator = document.getElementById('page-indicator');
const thresholdControl = document.getElementById('threshold-control');
const thresholdSlider = document.getElementById('threshold-slider');
const thresholdVal = document.getElementById('threshold-val');

window.addEventListener('DOMContentLoaded', async () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(console.error);
  }
  if (navigator.storage && navigator.storage.persist) {
    await navigator.storage.persist();
  }
  await loadLibrary();
  bindEvents();
});

function switchView(viewName) {
  Object.keys(views).forEach((k) => views[k].classList.remove('active'));
  views[viewName].classList.add('active');

  if (viewName === 'practice') {
    screenLock.enable();
  } else {
    screenLock.disable();
  }
}

async function loadLibrary() {
  const scores = await getAllScores();
  const listContainer = document.getElementById('scores-list');
  listContainer.innerHTML = '';

  if (scores.length === 0) {
    listContainer.innerHTML = `
      <div class="empty-state">
        <p>Žádné noty v paměti.</p>
        <p class="subtitle">Nahrajte PDF nebo vyfoťte papírové noty mobilem.</p>
      </div>`;
    return;
  }

  for (const s of scores) {
    const measures = await getMeasuresByScore(s.id);
    const card = document.createElement('div');
    card.className = 'score-card';

    const dateStr = new Date(s.updatedAt).toLocaleDateString('cs-CZ');
    const badgeType = s.type === 'pdf' ? 'PDF' : 'FOTO';

    card.innerHTML = `
      <div class="score-info">
        <span class="score-badge">${badgeType}</span>
        <div>
          <h3>${s.title}</h3>
          <p>${measures.length} připravených taktů • ${dateStr}</p>
        </div>
      </div>
      <div class="score-actions">
        <button class="btn btn-sm btn-open">Otevřít</button>
        <button class="btn btn-sm btn-danger btn-del">Smazat</button>
      </div>
    `;

    card.querySelector('.btn-open').addEventListener('click', () => openScore(s.id));
    card.querySelector('.btn-del').addEventListener('click', async () => {
      if (confirm(`Opravdu chcete smazat "${s.title}"?`)) {
        await deleteScore(s.id);
        await loadLibrary();
      }
    });

    listContainer.appendChild(card);
  }
}

async function openScore(id) {
  currentScore = await getScoreById(id);
  currentMeasures = await getMeasuresByScore(id);
  activeKeyBox = null;
  selectedMeasureId = null;
  practiceIndex = 0;
  currentPageNum = 1;
  pageCanvasCache.clear();
  resetZoom();

  document.getElementById('editor-title').textContent = currentScore.title;

  if (currentScore.type === 'pdf') {
    thresholdControl.style.display = 'none';
    currentPdf = await pdfjsLib.getDocument({ data: currentScore.buffer }).promise;
    totalPages = currentPdf.numPages;
    if (pageControls) {
      pageControls.style.display = totalPages > 1 ? 'inline-flex' : 'none';
    }
    currentImageBitmap = null;
    await renderEditorPdfPage(currentPageNum);
  } else {
    thresholdControl.style.display = 'flex';
    if (pageControls) {
      pageControls.style.display = 'none';
    }
    currentPdf = null;
    totalPages = 1;
    const blob = new Blob([currentScore.buffer]);
    currentImageBitmap = await createImageBitmap(blob);
    renderEditorImage();
  }

  updateSelectionLayer();
  switchView('editor');
}

async function renderEditorPdfPage(pageNum) {
  currentPageNum = pageNum;
  if (pageIndicator) {
    pageIndicator.textContent = `${currentPageNum} / ${totalPages}`;
  }

  const page = await currentPdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 2.0 });

  pdfCanvas.width = viewport.width;
  pdfCanvas.height = viewport.height;

  const ctx = pdfCanvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;

  pageCanvasCache.set(pageNum, await createImageBitmap(pdfCanvas));
  updateSelectionLayer();
}

function renderEditorImage() {
  if (!currentImageBitmap) return;

  pdfCanvas.width = currentImageBitmap.width;
  pdfCanvas.height = currentImageBitmap.height;

  const ctx = pdfCanvas.getContext('2d');
  ctx.drawImage(currentImageBitmap, 0, 0);

  applyThresholdFilter(ctx, pdfCanvas.width, pdfCanvas.height, currentImageThreshold);
  updateSelectionLayer();
}

function applyThresholdFilter(ctx, width, height, threshold) {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  for (let i = 0; i < data.length; i += 4) {
    const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const val = luminance > threshold ? 255 : 0;
    data[i] = val;
    data[i + 1] = val;
    data[i + 2] = val;
  }
  ctx.putImageData(imgData, 0, 0);
}

// Logika transformace (Pinch-to-zoom a Pan)
function applyCanvasTransform() {
  if (!canvasWrapper) return;
  editorZoom = Math.min(Math.max(editorZoom, 1.0), 4.0);

  if (editorZoom === 1.0) {
    editorPanX = 0;
    editorPanY = 0;
  } else if (canvasViewport) {
    const viewW = canvasViewport.clientWidth;
    const viewH = canvasViewport.clientHeight;
    const maxPanX = 0;
    const minPanX = viewW - (canvasWrapper.offsetWidth * editorZoom);
    const maxPanY = 0;
    const minPanY = viewH - (canvasWrapper.offsetHeight * editorZoom);

    editorPanX = Math.min(maxPanX, Math.max(minPanX, editorPanX));
    editorPanY = Math.min(maxPanY, Math.max(minPanY, editorPanY));
  }

  canvasWrapper.style.transform = `translate(${editorPanX}px, ${editorPanY}px) scale(${editorZoom})`;

  const resetBtn = document.getElementById('btn-zoom-reset');
  if (resetBtn) {
    resetBtn.textContent = `🔍 ${Math.round(editorZoom * 100)}%`;
  }
}

function resetZoom() {
  editorZoom = 1.0;
  editorPanX = 0;
  editorPanY = 0;
  applyCanvasTransform();
}

function getTouchDistance(touch1, touch2) {
  return Math.hypot(touch1.clientX - touch2.clientX, touch1.clientY - touch2.clientY);
}

function getTouchMidpoint(touch1, touch2) {
  return {
    x: (touch1.clientX + touch2.clientX) / 2,
    y: (touch1.clientY + touch2.clientY) / 2
  };
}

function updateSelectionLayer() {
  selectionLayer.innerHTML = '';
  const deleteBtn = document.getElementById('btn-delete-selected');
  if (deleteBtn) {
    deleteBtn.style.display = selectedMeasureId ? 'inline-flex' : 'none';
  }

  const pageMeasures = currentMeasures.filter((m) => (m.page || 1) === currentPageNum);

  pageMeasures.forEach((m) => {
    const isSelected = selectedMeasureId === m.id;
    const boxEl = createBoxElement(m.box, `T.${m.number}`, 'measure-rect', isSelected, m.id);
    selectionLayer.appendChild(boxEl);
  });

  if (activeKeyBox && (activeKeyBox.page || 1) === currentPageNum) {
    const isSelected = selectedMeasureId === 'KEY';
    const keyEl = createBoxElement(activeKeyBox, 'Klíč', 'key-rect', isSelected, 'KEY');
    selectionLayer.appendChild(keyEl);
  }
}

function createBoxElement(box, label, className, isSelected, id) {
  const el = document.createElement('div');
  el.className = `${className} ${isSelected ? 'selected' : ''}`;
  el.style.left = `${(box.x / pdfCanvas.width) * 100}%`;
  el.style.top = `${(box.y / pdfCanvas.height) * 100}%`;
  el.style.width = `${(box.w / pdfCanvas.width) * 100}%`;
  el.style.height = `${(box.h / pdfCanvas.height) * 100}%`;
  el.dataset.id = id;

  el.innerHTML = `<span class="badge">${label}</span>`;

  if (isSelected) {
    const handles = ['tl', 'tr', 'bl', 'br', 'tm', 'bm', 'ml', 'mr'];
    handles.forEach((h) => {
      const handleEl = document.createElement('div');
      handleEl.className = `handle ${h}`;
      handleEl.dataset.handle = h;
      el.appendChild(handleEl);
    });
  }

  return el;
}

function bindEvents() {
  const fileInput = document.getElementById('file-input');
  const cameraInput = document.getElementById('camera-input');

  fileInput.addEventListener('change', handleFileSelected);
  cameraInput.addEventListener('change', handleFileSelected);

  async function handleFileSelected(e) {
    const file = e.target.files[0];
    if (!file) return;

    const isPdf = file.type === 'application/pdf';
    const id = crypto.randomUUID();
    const title = file.name.replace(/\.[^/.]+$/, '') || `Noty ${new Date().toLocaleTimeString('cs')}`;
    const buffer = await file.arrayBuffer();

    await saveScore({
      id,
      title,
      type: isPdf ? 'pdf' : 'image',
      buffer
    });

    await loadLibrary();
    openScore(id);
    e.target.value = '';
  }

  document.getElementById('btn-back-lib').addEventListener('click', () => {
    loadLibrary();
    switchView('library');
  });

  document.getElementById('btn-exit-practice').addEventListener('click', () => {
    switchView('editor');
  });

  // Režimy kreslení a posunu
  const btnToolDraw = document.getElementById('btn-tool-draw');
  const btnToolPan = document.getElementById('btn-tool-pan');

  btnToolDraw.addEventListener('click', () => {
    touchTool = 'draw';
    btnToolDraw.classList.add('active');
    btnToolPan.classList.remove('active');
    selectionLayer.className = 'mode-draw';
  });

  btnToolPan.addEventListener('click', () => {
    touchTool = 'pan';
    btnToolPan.classList.add('active');
    btnToolDraw.classList.remove('active');
    selectionLayer.className = 'mode-pan';
    selectedMeasureId = null;
    updateSelectionLayer();
  });

  const btnZoomReset = document.getElementById('btn-zoom-reset');
  if (btnZoomReset) {
    btnZoomReset.addEventListener('click', resetZoom);
  }

  const btnKey = document.getElementById('btn-mode-key');
  const btnMeasure = document.getElementById('btn-mode-measure');

  btnKey.addEventListener('click', () => {
    selectionMode = 'key';
    btnKey.classList.add('active');
    btnMeasure.classList.remove('active');
  });

  btnMeasure.addEventListener('click', () => {
    selectionMode = 'measure';
    btnMeasure.classList.add('active');
    btnKey.classList.remove('active');
  });

  document.getElementById('btn-undo').addEventListener('click', async () => {
    if (currentMeasures.length > 0) {
      currentMeasures.pop();
      selectedMeasureId = null;
      await saveMeasures(currentScore.id, currentMeasures);
      updateSelectionLayer();
    }
  });

  const deleteBtn = document.getElementById('btn-delete-selected');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      if (!selectedMeasureId) return;

      if (selectedMeasureId === 'KEY') {
        activeKeyBox = null;
      } else {
        currentMeasures = currentMeasures.filter((m) => m.id !== selectedMeasureId);
        currentMeasures.forEach((m, idx) => (m.number = idx + 1));
        await saveMeasures(currentScore.id, currentMeasures);
      }
      selectedMeasureId = null;
      updateSelectionLayer();
    });
  }

  const prevPageBtn = document.getElementById('btn-prev-page');
  const nextPageBtn = document.getElementById('btn-next-page');

  if (prevPageBtn) {
    prevPageBtn.addEventListener('click', async () => {
      if (currentPageNum > 1) {
        selectedMeasureId = null;
        resetZoom();
        await renderEditorPdfPage(currentPageNum - 1);
      }
    });
  }

  if (nextPageBtn) {
    nextPageBtn.addEventListener('click', async () => {
      if (currentPageNum < totalPages) {
        selectedMeasureId = null;
        resetZoom();
        await renderEditorPdfPage(currentPageNum + 1);
      }
    });
  }

  thresholdSlider.addEventListener('input', (e) => {
    currentImageThreshold = parseInt(e.target.value, 10);
    thresholdVal.textContent = currentImageThreshold;
    renderEditorImage();
  });

  const countButtons = document.querySelectorAll('.measure-count-selector button');
  countButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      countButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      measuresPerView = parseInt(btn.dataset.count, 10);
      renderPractice();
    });
  });

  initSelectionInteraction();

  document.getElementById('btn-start-practice').addEventListener('click', () => {
    if (currentMeasures.length === 0) {
      alert('Nejprve označte alespoň jeden takt.');
      return;
    }
    practiceIndex = 0;
    renderPractice();
    switchView('practice');
  });

  document.getElementById('btn-prev-measure').addEventListener('click', () => shiftMeasure(-1));
  document.getElementById('btn-next-measure').addEventListener('click', () => shiftMeasure(1));

  window.addEventListener('keydown', (e) => {
    if (!views.practice.classList.contains('active')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
      shiftMeasure(1);
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      shiftMeasure(-1);
    }
  });

  window.addEventListener('resize', () => {
    if (views.practice.classList.contains('active')) {
      renderPractice();
    }
  });
}

// Interakce kreslení, editace rámečků, pinch-zoom a panování
function initSelectionInteraction() {
  function getCanvasCoords(clientX, clientY) {
    const rect = selectionLayer.getBoundingClientRect();
    const factorX = pdfCanvas.width / rect.width;
    const factorY = pdfCanvas.height / rect.height;

    return {
      x: Math.round((clientX - rect.left) * factorX),
      y: Math.round((clientY - rect.top) * factorY)
    };
  }

  function handleStart(clientX, clientY, targetEl) {
    const handle = targetEl ? targetEl.closest('.handle') : null;
    const boxEl = targetEl ? targetEl.closest('.measure-rect, .key-rect') : null;
    const coords = getCanvasCoords(clientX, clientY);
    initialPointerPos = coords;

    if (handle) {
      editAction = `resize-${handle.dataset.handle}`;
      const parentId = handle.parentElement.dataset.id;
      dragTarget = parentId === 'KEY' ? activeKeyBox : currentMeasures.find((m) => m.id === parentId).box;
      originalBox = { ...dragTarget };
    } else if (boxEl) {
      selectedMeasureId = boxEl.dataset.id;
      editAction = 'move';
      dragTarget = selectedMeasureId === 'KEY' ? activeKeyBox : currentMeasures.find((m) => m.id === selectedMeasureId).box;
      originalBox = { ...dragTarget };
      updateSelectionLayer();
    } else {
      selectedMeasureId = null;
      editAction = 'create';
      dragTarget = { x: coords.x, y: coords.y, w: 0, h: 0 };
      updateSelectionLayer();

      dragPreviewEl = document.createElement('div');
      dragPreviewEl.className = `active-drag-rect ${selectionMode === 'key' ? 'key-drag' : ''}`;
      selectionLayer.appendChild(dragPreviewEl);
    }
  }

  function handleMove(clientX, clientY) {
    if (!editAction || !dragTarget) return;

    const coords = getCanvasCoords(clientX, clientY);
    const dx = coords.x - initialPointerPos.x;
    const dy = coords.y - initialPointerPos.y;

    if (editAction === 'move') {
      dragTarget.x = Math.max(0, Math.min(pdfCanvas.width - dragTarget.w, originalBox.x + dx));
      dragTarget.y = Math.max(0, Math.min(pdfCanvas.height - dragTarget.h, originalBox.y + dy));
      updateSelectionLayer();
    } else if (editAction.startsWith('resize-')) {
      const type = editAction.replace('resize-', '');
      if (type.includes('r')) dragTarget.w = Math.max(20, originalBox.w + dx);
      if (type.includes('b')) dragTarget.h = Math.max(20, originalBox.h + dy);
      if (type.includes('l')) {
        const newW = originalBox.w - dx;
        if (newW > 20) {
          dragTarget.x = originalBox.x + dx;
          dragTarget.w = newW;
        }
      }
      if (type.includes('t')) {
        const newH = originalBox.h - dy;
        if (newH > 20) {
          dragTarget.y = originalBox.y + dy;
          dragTarget.h = newH;
        }
      }
      updateSelectionLayer();
    } else if (editAction === 'create') {
      dragTarget.x = Math.min(initialPointerPos.x, coords.x);
      dragTarget.y = Math.min(initialPointerPos.y, coords.y);
      dragTarget.w = Math.abs(coords.x - initialPointerPos.x);
      dragTarget.h = Math.abs(coords.y - initialPointerPos.y);

      if (dragPreviewEl) {
        dragPreviewEl.style.left = `${(dragTarget.x / pdfCanvas.width) * 100}%`;
        dragPreviewEl.style.top = `${(dragTarget.y / pdfCanvas.height) * 100}%`;
        dragPreviewEl.style.width = `${(dragTarget.w / pdfCanvas.width) * 100}%`;
        dragPreviewEl.style.height = `${(dragTarget.h / pdfCanvas.height) * 100}%`;
      }
    }
  }

  async function handleEnd() {
    if (dragPreviewEl) {
      dragPreviewEl.remove();
      dragPreviewEl = null;
    }

    if (!editAction) return;

    if (editAction === 'create') {
      if (dragTarget && dragTarget.w > 25 && dragTarget.h > 25) {
        if (selectionMode === 'key') {
          activeKeyBox = { ...dragTarget, page: currentPageNum };
          selectionMode = 'measure';
          document.getElementById('btn-mode-measure').classList.add('active');
          document.getElementById('btn-mode-key').classList.remove('active');
        } else {
          const nextNumber = currentMeasures.length + 1;
          const newM = {
            id: `${currentScore.id}-m-${nextNumber}`,
            number: nextNumber,
            page: currentPageNum,
            box: { ...dragTarget },
            keyBox: activeKeyBox ? { ...activeKeyBox } : null
          };
          currentMeasures.push(newM);
          selectedMeasureId = newM.id;
        }
      }
    }

    if (currentScore) {
      await saveMeasures(currentScore.id, currentMeasures);
    }

    editAction = null;
    dragTarget = null;
    originalBox = null;
    updateSelectionLayer();
  }

  // Myš (Desktop)
  selectionLayer.addEventListener('mousedown', (e) => {
    if (touchTool === 'pan') return;
    handleStart(e.clientX, e.clientY, e.target);
  });

  window.addEventListener('mousemove', (e) => {
    handleMove(e.clientX, e.clientY);
  });

  window.addEventListener('mouseup', handleEnd);

  // Dotyk (Mobil / Tablet)
  if (canvasViewport) {
    canvasViewport.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        // Pinch-to-zoom začátek
        isPinching = true;
        if (dragPreviewEl) {
          dragPreviewEl.remove();
          dragPreviewEl = null;
        }
        editAction = null;
        dragTarget = null;

        initialPinchDistance = getTouchDistance(e.touches[0], e.touches[1]);
        initialPinchZoom = editorZoom;
        initialPinchCenter = getTouchMidpoint(e.touches[0], e.touches[1]);
        return;
      }

      if (touchTool === 'pan' && e.touches.length === 1) {
        isPinching = false;
        editAction = 'viewport-pan';
        initialPointerPos = { x: e.touches[0].clientX - editorPanX, y: e.touches[0].clientY - editorPanY };
        return;
      }

      if (touchTool === 'draw' && e.touches.length === 1) {
        isPinching = false;
        const touch = e.touches[0];
        const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
        handleStart(touch.clientX, touch.clientY, targetEl);
      }
    }, { passive: false });

    canvasViewport.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && isPinching) {
        e.preventDefault();
        const currentDist = getTouchDistance(e.touches[0], e.touches[1]);
        const currentCenter = getTouchMidpoint(e.touches[0], e.touches[1]);

        const scaleFactor = currentDist / initialPinchDistance;
        editorZoom = initialPinchZoom * scaleFactor;

        editorPanX += currentCenter.x - initialPinchCenter.x;
        editorPanY += currentCenter.y - initialPinchCenter.y;

        initialPinchDistance = currentDist;
        initialPinchCenter = currentCenter;

        applyCanvasTransform();
        return;
      }

      if (editAction === 'viewport-pan' && e.touches.length === 1) {
        e.preventDefault();
        editorPanX = e.touches[0].clientX - initialPointerPos.x;
        editorPanY = e.touches[0].clientY - initialPointerPos.y;
        applyCanvasTransform();
        return;
      }

      if (touchTool === 'draw' && e.touches.length === 1 && !isPinching) {
        handleMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: false });

    canvasViewport.addEventListener('touchend', (e) => {
      if (isPinching && e.touches.length < 2) {
        isPinching = false;
      }
      if (editAction === 'viewport-pan') {
        editAction = null;
        return;
      }
      if (touchTool === 'draw') {
        handleEnd();
      }
    });
  }
}

function shiftMeasure(dir) {
  const next = practiceIndex + dir;
  if (next >= 0 && next < currentMeasures.length) {
    practiceIndex = next;
    renderPractice();
  }
}

async function getPageSource(pageNum) {
  if (currentScore.type !== 'pdf') {
    return pdfCanvas;
  }

  if (pageCanvasCache.has(pageNum)) {
    return pageCanvasCache.get(pageNum);
  }

  const page = await currentPdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 2.0 });

  const offscreen = document.createElement('canvas');
  offscreen.width = viewport.width;
  offscreen.height = viewport.height;
  const ctx = offscreen.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;

  const bitmap = await createImageBitmap(offscreen);
  pageCanvasCache.set(pageNum, bitmap);
  return bitmap;
}

async function renderPractice() {
  practiceContainer.innerHTML = '';
  practiceContainer.dataset.count = measuresPerView;

  const visibleMeasures = currentMeasures.slice(practiceIndex, practiceIndex + measuresPerView);
  if (visibleMeasures.length === 0) return;

  const firstM = visibleMeasures[0];
  const lastM = visibleMeasures[visibleMeasures.length - 1];
  const rangeText = firstM.number === lastM.number ? `Takt ${firstM.number}` : `Takty ${firstM.number}–${lastM.number}`;

  document.getElementById('practice-nav-info').textContent = 
    `${rangeText} (str. ${firstM.page || 1}) • (${practiceIndex + 1} z ${currentMeasures.length})`;

  // Klíč a předznamenání nahoře v pevném záhlaví
  if (firstM.keyBox && firstM.keyBox.w > 0 && firstM.keyBox.h > 0) {
    practiceKeyHeader.style.display = 'flex';
    const keySource = await getPageSource(firstM.keyBox.page || firstM.page || 1);
    sliceCanvas(keySource, firstM.keyBox, practiceKeyCanvas);
  } else {
    practiceKeyHeader.style.display = 'none';
  }

  // Vykreslení taktů roztažených přes celou šířku
  for (const measure of visibleMeasures) {
    const row = document.createElement('div');
    row.className = 'practice-strip-row';

    const measureCanvas = document.createElement('canvas');
    measureCanvas.className = 'strip-measure';

    const measureSource = await getPageSource(measure.page || 1);
    sliceCanvas(measureSource, measure.box, measureCanvas);
    row.appendChild(measureCanvas);

    const badge = document.createElement('div');
    badge.className = 'measure-badge';
    badge.textContent = `T.${measure.number} (str. ${measure.page || 1})`;
    row.appendChild(badge);

    practiceContainer.appendChild(row);
  }
}

function sliceCanvas(source, crop, target) {
  const sx = Math.max(0, Math.round(crop.x));
  const sy = Math.max(0, Math.round(crop.y));
  const sw = Math.min(source.width - sx, Math.round(crop.w));
  const sh = Math.min(source.height - sy, Math.round(crop.h));

  target.width = sw;
  target.height = sh;

  const ctx = target.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
}