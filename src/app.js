// Globální instance dostupná pro inline handlery a modulární funkce
window.app = new GuitarTrainer();

// PŘEPÍNÁNÍ ZÁLOŽEK (KNIHOVNA | HRANÍ | LABORATOŘ)
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
  if (metro) metro.style.display = 'none';
  window.app.stopMetronome();

  if (mode === 'library') {
    const t = document.getElementById('tabLibrary'); if (t) t.classList.add('active');
    const v = document.getElementById('libraryView'); if (v) v.style.display = 'flex';
    const ht = document.getElementById('headerSongTitle'); if (ht) ht.style.display = 'none';
  } else if (mode === 'edit') {
    if (!window.app.currentScore) {
      alert('Nejprve vyberte skladbu.');
      return switchMode('library');
    }
    const t = document.getElementById('tabEdit'); if (t) t.classList.add('active');
    const v = document.getElementById('editView'); if (v) v.style.display = 'flex';
    window.app.updateHeaderTitle();
    window.app.renderScoreView();
    setTimeout(() => window.app.fitCanvasToScreen(), 20);
  } else if (mode === 'lab') {
    if (!window.app.currentScore) {
      alert('Nejprve vyberte skladbu.');
      return switchMode('library');
    }
    const t = document.getElementById('tabLab'); if (t) t.classList.add('active');
    const v = document.getElementById('labView'); if (v) v.style.display = 'flex';
    const ht = document.getElementById('headerSongTitle'); if (ht) ht.style.display = 'none';
    if (metro) metro.style.display = 'flex';
    if (window.wakeLockManager) try { window.wakeLockManager.request(); } catch (_) {}
    window.app.renderLabQueue();
    window.app.showMeasureInLab(window.app.labCurrentIndex);
  }
}

window.switchMode = switchMode;

// OBSLUHA NAHRÁVÁNÍ SOUBORŮ A FOCENÍ
const cameraInput = document.getElementById('cameraInput');
if (cameraInput) {
  cameraInput.addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    const n = prompt('Název skladby:', 'Noty ' + new Date().toLocaleDateString('cs-CZ')) || 'Nová skladba';
    try {
      const d = await processAndEnhancePhoto(f);
      await window.app.saveNewScoreToLibrary(n.trim(), {isPdf: false, imageData: d, pages: [d]});
    } catch (err) { alert('Chyba: ' + err.message); }
    e.target.value = '';
  });
}

const fileInput = document.getElementById('fileInput');
if (fileInput) {
  fileInput.addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    const n = f.name.replace(/\.[^/.]+$/, "");
    if (f.type === 'application/pdf' || n.toLowerCase().endsWith('.pdf')) {
      await window.app.saveNewScoreToLibrary(n, {isPdf: true, pdfData: await f.arrayBuffer()});
    } else {
      const d = await processAndEnhancePhoto(f);
      await window.app.saveNewScoreToLibrary(n, {isPdf: false, imageData: d, pages: [d]});
    }
    e.target.value = '';
  });
}

const addPageInput = document.getElementById('addPageInput');
if (addPageInput) {
  addPageInput.addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = await processAndEnhancePhoto(f);
      await window.app.appendPageToCurrentScore(d);
    } catch (err) { alert('Chyba: ' + err.message); }
    e.target.value = '';
  });
}