window.app = new GuitarTrainer();

function switchMode(mode) {
  ['tabLibrary', 'tabEdit', 'tabLab'].forEach(id => {
    const t = document.getElementById(id);
    if (t) t.classList.remove('active');
  });
  ['libraryView', 'editView', 'labView'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  const metro = document.getElementById('dockedMetronome');

  if (mode === 'library') {
    const t = document.getElementById('tabLibrary'); if (t) t.classList.add('active');
    const v = document.getElementById('libraryView'); if (v) v.style.display = 'flex';
    const ht = document.getElementById('headerSongTitle'); if (ht) ht.style.display = 'none';
    if (metro) metro.style.display = 'none';
    window.app.stopMetronome();
    window.app.dismissAddPagePrompt();
  } else if (mode === 'edit') {
    if (!window.app.currentScore) {
      alert('Nejprve vyberte skladbu.');
      return switchMode('library');
    }
    const t = document.getElementById('tabEdit'); if (t) t.classList.add('active');
    const v = document.getElementById('editView'); if (v) v.style.display = 'flex';
    window.app.updateHeaderTitle();
    window.app.renderScoreView();
    if (metro) metro.style.display = 'none';
    setTimeout(() => {
      if (!window.app.hasUserAdjustedView) window.app.fitCanvasToScreen();
    }, 20);
  } else if (mode === 'lab') {
    if (!window.app.currentScore) {
      alert('Nejprve vyberte skladbu.');
      return switchMode('library');
    }
    const t = document.getElementById('tabLab'); if (t) t.classList.add('active');
    const v = document.getElementById('labView'); if (v) v.style.display = 'flex';
    const ht = document.getElementById('headerSongTitle'); if (ht) ht.style.display = 'none';
    window.app.dismissAddPagePrompt();
    if (metro) metro.style.display = 'flex';
    if (window.wakeLockManager) {
      try { window.wakeLockManager.request(); } catch (_) {}
    }
    window.app.renderLabQueue();
    window.app.showMeasureInLab(window.app.labCurrentIndex);
  }
}

window.switchMode = switchMode;

// 1. FOCENÍ PRVNÍ STRANY SKLADBY V KNIHOVNĚ
const cameraInput = document.getElementById('cameraInput');
if (cameraInput) {
  cameraInput.addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;

    try {
      const d = await processAndEnhancePhoto(f);
      const n = prompt('Název skladby:', 'Noty ' + new Date().toLocaleDateString('cs-CZ')) || 'Nová skladba';
      await window.app.saveNewScoreToLibrary(n.trim(), { isPdf: false, imageData: d, pages: [d] });

      // Zobrazí plovoucí banner s přímým tlačítkem pro další stranu
      window.app.showAddPagePrompt();
    } catch (err) {
      alert('Chyba při zpracování fotky: ' + err.message);
    }
    e.target.value = '';
  });
}

// SPOLEČNÉ ZPRACOVÁNÍ PŘIDANÉ DALŠÍ STRANY
async function handleAddNextPage(file) {
  if (!file || !window.app.currentScore || window.app.currentScore.isPdf) return;
  try {
    const d = await processAndEnhancePhoto(file);
    await window.app.appendPageToCurrentScore(d);
    window.app.showAddPagePrompt(); // Aktualizuje číslo strany na banneru
  } catch (err) {
    alert('Chyba při přidání strany: ' + err.message);
  }
}

// 2. FOCENÍ DALŠÍ STRANY Z BANNERU
const promptAddPageInput = document.getElementById('promptAddPageInput');
if (promptAddPageInput) {
  promptAddPageInput.addEventListener('change', async e => {
    await handleAddNextPage(e.target.files[0]);
    e.target.value = '';
  });
}

// 3. PŘIFOCENÍ STRANY Z LIŠTY V EDIT REŽIMU
const addPageInput = document.getElementById('addPageInput');
if (addPageInput) {
  addPageInput.addEventListener('change', async e => {
    await handleAddNextPage(e.target.files[0]);
    e.target.value = '';
  });
}

// 4. NAHRÁNÍ SOUBORU Z DISKU (PDF / Obrázek)
const fileInput = document.getElementById('fileInput');
if (fileInput) {
  fileInput.addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    const n = f.name.replace(/\.[^/.]+$/, "");
    try {
      if (f.type === 'application/pdf' || n.toLowerCase().endsWith('.pdf')) {
        await window.app.saveNewScoreToLibrary(n, { isPdf: true, pdfData: await f.arrayBuffer() });
      } else {
        const d = await processAndEnhancePhoto(f);
        await window.app.saveNewScoreToLibrary(n, { isPdf: false, imageData: d, pages: [d] });
      }
    } catch (err) {
      alert('Chyba při nahrání: ' + err.message);
    }
    e.target.value = '';
  });
}