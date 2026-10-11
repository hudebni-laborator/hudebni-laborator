import { saveScore, getAllScores, getScoreById, deleteScore, saveMeasures, getMeasuresByScore } from './db.js';
import { screenLock } from './wakeLock.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Globální stav
let currentScore = null;
let currentPdf = null;
let currentImageBitmap = null;
let currentImageThreshold = 145;
let currentMeasures = [];
let activeKeyBox = null;
let selectionMode = 'measure'; // 'key' | 'measure'
let practiceIndex = 0;

// Elementy rozhraní
const views = {
  library: document.getElementById('view-library'),
  editor: document.getElementById('view-editor'),
  practice: document.getElementById('view-practice')
};

const pdfCanvas = document.getElementById('pdf-canvas');
const selectionLayer = document.getElementById('selection-layer');
const practiceContainer = document.getElementById('practice-strips');
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
  practiceIndex = 0;

  document.getElementById('editor-title').textContent = currentScore.title;

  if (currentScore.type === 'pdf') {
    thresholdControl.style.display = 'none';
    currentPdf = await pdfjsLib.getDocument({ data: currentScore.buffer }).promise;
    currentImageBitmap = null;
    await renderEditorPdfPage(1);
  } else {
    thresholdControl.style.display = 'flex';
    currentPdf = null;
    const blob = new Blob([currentScore.buffer]);
    currentImageBitmap = await createImageBitmap(blob);
    renderEditorImage();
  }

  updateSelectionLayer();
  switchView('editor');
}

async function renderEditorPdfPage(pageNum) {
  const page = await currentPdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 2.0 });

  pdfCanvas.width = viewport.width;
  pdfCanvas.height = viewport.height;
  pdfCanvas.style.width = '100%';
  pdfCanvas.style.height = 'auto';

  const ctx = pdfCanvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
}

function renderEditorImage() {
  if (!currentImageBitmap) return;

  pdfCanvas.width = currentImageBitmap.width;
  pdfCanvas.height = currentImageBitmap.height;
  pdfCanvas.style.width = '100%';
  pdfCanvas.style.height = 'auto';

  const ctx = pdfCanvas.getContext('2d');
  ctx.drawImage(currentImageBitmap, 0, 0);

  // Aplikace kontrastního prahu (binarizace)
  applyThresholdFilter(ctx, pdfCanvas.width, pdfCanvas.height, currentImageThreshold);
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

function updateSelectionLayer() {
  selectionLayer.innerHTML = '';
  currentMeasures.forEach((m) => {
    const box = document.createElement('div');
    box.className = 'measure-rect';
    box.style.left = `${(m.box.x / pdfCanvas.width) * 100}%`;
    box.style.top = `${(m.box.y / pdfCanvas.height) * 100}%`;
    box.style.width = `${(m.box.w / pdfCanvas.width) * 100}%`;
    box.style.height = `${(m.box.h / pdfCanvas.height) * 100}%`;
    box.innerHTML = `<span class="badge">T.${m.number}</span>`;
    selectionLayer.appendChild(box);
  });

  if (activeKeyBox) {
    const kBox = document.createElement('div');
    kBox.className = 'key-rect';
    kBox.style.left = `${(activeKeyBox.x / pdfCanvas.width) * 100}%`;
    kBox.style.top = `${(activeKeyBox.y / pdfCanvas.height) * 100}%`;
    kBox.style.width = `${(activeKeyBox.w / pdfCanvas.width) * 100}%`;
    kBox.style.height = `${(activeKeyBox.h / pdfCanvas.height) * 100}%`;
    kBox.innerHTML = `<span class="badge">Klíč</span>`;
    selectionLayer.appendChild(kBox);
  }
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

  // Tlačítka navigace
  document.getElementById('btn-back-lib').addEventListener('click', () => {
    loadLibrary();
    switchView('library');
  });

  document.getElementById('btn-exit-practice').addEventListener('click', () => {
    switchView('editor');
  });

  // Režimy výběru
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

  // Undo tlačítko
  document.getElementById('btn-undo').addEventListener('click', async () => {
    if (currentMeasures.length > 0) {
      currentMeasures.pop();
      await saveMeasures(currentScore.id, currentMeasures);
      updateSelectionLayer();
    }
  });

  // Posuvník pro kontrast fotky
  thresholdSlider.addEventListener('input', (e) => {
    currentImageThreshold = parseInt(e.target.value, 10);
    thresholdVal.textContent = currentImageThreshold;
    renderEditorImage();
  });

  // Výběr obdélníků (Touch i Mouse)
  let startX = 0, startY = 0, isSelecting = false;

  function getLayerCoordinates(e) {
    const rect = selectionLayer.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
      width: rect.width,
      height: rect.height
    };
  }

  function onPointerDown(e) {
    const coords = getLayerCoordinates(e);
    startX = coords.x;
    startY = coords.y;
    isSelecting = true;
  }

  async function onPointerUp(e) {
    if (!isSelecting) return;
    isSelecting = false;

    const coords = getLayerCoordinates(e.changedTouches ? e.changedTouches[0] : e);
    const endX = coords.x;
    const endY = coords.y;

    const scaleX = pdfCanvas.width / coords.width;
    const scaleY = pdfCanvas.height / coords.height;

    const box = {
      x: Math.min(startX, endX) * scaleX,
      y: Math.min(startY, endY) * scaleY,
      w: Math.abs(endX - startX) * scaleX,
      h: Math.abs(endY - startY) * scaleY
    };

    if (box.w < 25 || box.h < 25) return;

    if (selectionMode === 'key') {
      activeKeyBox = box;
      selectionMode = 'measure';
      btnMeasure.classList.add('active');
      btnKey.classList.remove('active');
      updateSelectionLayer();
    } else {
      const nextNumber = currentMeasures.length + 1;
      currentMeasures.push({
        id: `${currentScore.id}-m-${nextNumber}`,
        number: nextNumber,
        box,
        keyBox: activeKeyBox
      });
      await saveMeasures(currentScore.id, currentMeasures);
      updateSelectionLayer();
    }
  }

  selectionLayer.addEventListener('mousedown', onPointerDown);
  selectionLayer.addEventListener('mouseup', onPointerUp);

  selectionLayer.addEventListener('touchstart', onPointerDown, { passive: true });
  selectionLayer.addEventListener('touchend', onPointerUp);

  // Spuštění cvičení
  document.getElementById('btn-start-practice').addEventListener('click', () => {
    if (currentMeasures.length === 0) {
      alert('Nejprve označte alespoň jeden takt.');
      return;
    }
    practiceIndex = 0;
    renderPractice();
    switchView('practice');
  });

  // Tlačítka navigace v cvičení
  document.getElementById('btn-prev-measure').addEventListener('click', () => shiftMeasure(-1));
  document.getElementById('btn-next-measure').addEventListener('click', () => shiftMeasure(1));

  // Klávesnice & Bluetooth pedál
  window.addEventListener('keydown', (e) => {
    if (!views.practice.classList.contains('active')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
      shiftMeasure(1);
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      shiftMeasure(-1);
    }
  });

  // Znovuvykreslení při změně orientace displeje
  window.addEventListener('resize', () => {
    if (views.practice.classList.contains('active')) {
      renderPractice();
    }
  });
}

function shiftMeasure(dir) {
  const next = practiceIndex + dir;
  if (next >= 0 && next < currentMeasures.length) {
    practiceIndex = next;
    renderPractice();
  }
}

function renderPractice() {
  practiceContainer.innerHTML = '';
  const measure = currentMeasures[practiceIndex];
  if (!measure) return;

  document.getElementById('practice-nav-info').textContent = 
    `Takt ${measure.number} (${practiceIndex + 1} z ${currentMeasures.length})`;

  const row = document.createElement('div');
  row.className = 'practice-strip-row';

  // 1. Klíč a předznamenání
  if (measure.keyBox) {
    const keyCanvas = document.createElement('canvas');
    keyCanvas.className = 'strip-key';
    sliceCanvas(pdfCanvas, measure.keyBox, keyCanvas);
    row.appendChild(keyCanvas);
  }

  // 2. Vybraný takt roztažený přes zbytek šířky
  const measureCanvas = document.createElement('canvas');
  measureCanvas.className = 'strip-measure';
  sliceCanvas(pdfCanvas, measure.box, measureCanvas);
  row.appendChild(measureCanvas);

  const badge = document.createElement('div');
  badge.className = 'measure-badge';
  badge.textContent = `T.${measure.number}`;
  row.appendChild(badge);

  practiceContainer.appendChild(row);
}

function sliceCanvas(source, crop, target) {
  target.width = crop.w;
  target.height = crop.h;
  const ctx = target.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
}