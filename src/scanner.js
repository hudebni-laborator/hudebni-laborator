// Seřazení taktů a klíčů (shora dolů, zleva doprava)
function compareMusicPosition(a, b) {
  const pageA = a.page || 1;
  const pageB = b.page || 1;
  if (pageA !== pageB) return pageA - pageB;
  const avgH = (a.box.height + b.box.height) / 2;
  const rowDiff = a.box.top - b.box.top;
  if (Math.abs(rowDiff) > avgH * 0.55) return rowDiff;
  return a.box.left - b.box.left;
}

// Zpracování fotky: syté černé linky a přirozený tiskový papír bez vypálení
async function processAndEnhancePhoto(file, maxDim = 2400) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
        else { w = Math.round((w * maxDim) / h); h = maxDim; }
      }

      const cvs = document.createElement('canvas');
      cvs.width = w;
      cvs.height = h;
      const ctx = cvs.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      const data = ctx.getImageData(0, 0, w, h);
      const d = data.data;

      // Změříme průměrný jas scény
      let sum = 0, c = 0;
      for (let i = 0; i < d.length; i += 64) {
        sum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        c++;
      }
      const avg = c > 0 ? sum / c : 195;

      // Adaptivní prahy
      const wp = Math.min(250, Math.max(185, avg * 0.98));
      const bp = Math.min(135, Math.max(95, avg * 0.62));
      const range = Math.max(10, wp - bp);

      // Přírodní papír (neagresivní bílá) a sytý tiskařský inkoust
      const paperR = 244, paperG = 242, paperB = 236;
      const inkR = 15, inkG = 15, inkB = 18;

      for (let i = 0; i < d.length; i += 4) {
        const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;

        let norm;
        if (lum <= bp) {
          norm = 0.0;
        } else if (lum >= wp) {
          norm = 1.0;
        } else {
          norm = Math.pow((lum - bp) / range, 1.35);
        }

        d[i]     = Math.round(inkR + norm * (paperR - inkR));
        d[i + 1] = Math.round(inkG + norm * (paperG - inkG));
        d[i + 2] = Math.round(inkB + norm * (paperB - inkB));
      }

      ctx.putImageData(data, 0, 0);
      resolve(cvs.toDataURL('image/jpeg', 0.90));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// Analýza notové linky a ohraničení taktu
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
    for (let x = sampleLeft; x < sampleRight; x++) { if (isDarkRel(x, y)) darkCount++; }
    if (darkCount >= minLineFill) {
      currentBlock.push(y);
    } else {
      if (currentBlock.length > 0) {
        lineBlocks.push(Math.round(currentBlock.reduce((a, b) => a + b, 0) / currentBlock.length));
        currentBlock = [];
      }
    }
  }
  if (currentBlock.length > 0) lineBlocks.push(Math.round(currentBlock.reduce((a, b) => a + b, 0) / currentBlock.length));

  const lineRows = lineBlocks.map(y => y + scanTop);
  let currentStaff = null;
  for (let i = 0; i <= lineRows.length - 5; i++) {
    const group = lineRows.slice(i, i + 5);
    const spacings = [group[1] - group[0], group[2] - group[1], group[3] - group[2], group[4] - group[3]];
    const avgSpacing = spacings.reduce((a, b) => a + b) / 4;
    const isUniform = spacings.every(s => Math.abs(s - avgSpacing) <= 5 && s >= 4 && s <= 45);
    if (isUniform && clickY >= group[0] - 45 && clickY <= group[4] + 45) {
      currentStaff = { top: group[0], bottom: group[4], height: group[4] - group[0], lines: group, spacing: avgSpacing };
      break;
    }
  }

  if (!currentStaff) {
    return {
      isBarLine: () => false,
      box: { left: Math.max(0, Math.floor(clickX - 80)), top: Math.max(0, Math.floor(clickY - 50)), width: 160, height: 100 }
    };
  }

  const staffTopRel = currentStaff.top - scanTop;
  const staffBottomRel = currentStaff.bottom - scanTop;
  const linesRel = currentStaff.lines.map(y => y - scanTop);
  const spacing = currentStaff.spacing;

  const isBarLine = (col) => {
    let gapsPassed = 0;
    for (let i = 0; i < 4; i++) {
      let gapDark = 0, gapH = linesRel[i + 1] - linesRel[i] + 1;
      for (let y = linesRel[i]; y <= linesRel[i + 1]; y++) {
        if (isDarkRel(col, y) || isDarkRel(col - 1, y) || isDarkRel(col + 1, y)) gapDark++;
      }
      if (gapDark / gapH >= 0.60) gapsPassed++;
    }
    if (gapsPassed < 4) return false;

    const maxOvershoot = Math.max(4, Math.floor(spacing * 0.70));
    let oUp = 0; for (let y = staffTopRel - 1; y >= Math.max(0, staffTopRel - spacing * 2.5); y--) { if (isDarkRel(col, y) || isDarkRel(col - 1, y) || isDarkRel(col + 1, y)) oUp++; else break; }
    if (oUp > maxOvershoot) return false;

    let oDown = 0; for (let y = staffBottomRel + 1; y <= Math.min(scanH - 1, staffBottomRel + spacing * 2.5); y++) { if (isDarkRel(col, y) || isDarkRel(col - 1, y) || isDarkRel(col + 1, y)) oDown++; else break; }
    if (oDown > maxOvershoot) return false;

    const minW = Math.max(6, Math.floor(spacing * 0.65));
    for (const testY of [Math.round(staffTopRel + spacing * 0.45), Math.round(linesRel[1] + spacing * 0.5), Math.round(linesRel[2] + spacing * 0.5), Math.round(staffBottomRel - spacing * 0.45)]) {
      if (getHWidth(col, testY) >= minW) return false;
    }
    return true;
  };

  let leftX = Math.floor(clickX) - 5;
  for (let x = leftX; x >= Math.max(0, clickX - spacing * 18); x--) {
    if (isBarLine(x)) { leftX = x; break; }
  }
  let rightX = Math.floor(clickX) + 5;
  for (let x = rightX; x <= Math.min(width, clickX + spacing * 18); x++) {
    if (isBarLine(x)) { rightX = x; break; }
  }

  const gapMargin = Math.round(currentStaff.height * 0.65);
  return {
    isBarLine,
    box: {
      left: leftX,
      top: Math.max(0, currentStaff.top - gapMargin),
      width: Math.max(30, rightX - leftX),
      height: Math.max(30, (currentStaff.bottom + gapMargin) - Math.max(0, currentStaff.top - gapMargin))
    }
  };
}