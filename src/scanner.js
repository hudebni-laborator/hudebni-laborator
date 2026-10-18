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
// Robustnější detekce osnovy a taktových čar s podporou dvojčar a konců řádků
function scanStaffAndBarlinesFromCanvas(sourceCanvas, clickX, clickY) {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const ctx = sourceCanvas.getContext('2d');

  // Vertikální výřez kolem kliknutí (dostatečný pro zachycení celé osnovy)
  const scanTop = Math.max(0, Math.floor(clickY - 260));
  const scanH = Math.min(height - scanTop, 520);
  const imgData = ctx.getImageData(0, scanTop, width, scanH);
  const data = imgData.data;

  // 1. Zjištění lokálního jasu papíru v okolí kliknutí
  let sumB = 0, countSample = 0;
  for (let y = 0; y < scanH; y += 6) {
    for (let x = Math.max(0, clickX - 150); x < Math.min(width, clickX + 150); x += 6) {
      const idx = (y * width + Math.floor(x)) * 4;
      sumB += (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      countSample++;
    }
  }
  const bgBright = countSample > 0 ? (sumB / countSample) : 235;
  const darkThreshold = Math.min(150, Math.max(60, bgBright * 0.72));

  const isDarkRel = (x, localY) => {
    if (x < 0 || x >= width || localY < 0 || localY >= scanH) return false;
    const idx = (localY * width + Math.floor(x)) * 4;
    return ((data[idx] + data[idx + 1] + data[idx + 2]) / 3) < darkThreshold;
  };

  // 2. Nalezení 5 linek notové osnovy v daném řádku
  const sampleLeft = Math.max(0, Math.floor(clickX - 180));
  const sampleRight = Math.min(width, Math.floor(clickX + 180));
  const minLineFill = (sampleRight - sampleLeft) * 0.32;

  const lineBlocks = [];
  let currentBlock = [];
  for (let y = 0; y < scanH; y++) {
    let darkCount = 0;
    for (let x = sampleLeft; x < sampleRight; x++) {
      if (isDarkRel(x, y)) darkCount++;
    }
    if (darkCount >= minLineFill) {
      currentBlock.push(y);
    } else {
      if (currentBlock.length > 0) {
        lineBlocks.push(Math.round(currentBlock.reduce((a, b) => a + b, 0) / currentBlock.length));
        currentBlock = [];
      }
    }
  }
  if (currentBlock.length > 0) {
    lineBlocks.push(Math.round(currentBlock.reduce((a, b) => a + b, 0) / currentBlock.length));
  }

  const lineRows = lineBlocks.map(y => y + scanTop);
  let currentStaff = null;

  for (let i = 0; i <= lineRows.length - 5; i++) {
    const group = lineRows.slice(i, i + 5);
    const spacings = [
      group[1] - group[0],
      group[2] - group[1],
      group[3] - group[2],
      group[4] - group[3]
    ];
    const avgSpacing = spacings.reduce((a, b) => a + b) / 4;
    const isUniform = spacings.every(s => Math.abs(s - avgSpacing) <= 6 && s >= 4 && s <= 45);

    if (isUniform && clickY >= group[0] - 50 && clickY <= group[4] + 50) {
      currentStaff = {
        top: group[0],
        bottom: group[4],
        height: group[4] - group[0],
        lines: group,
        spacing: avgSpacing
      };
      break;
    }
  }

  // Fallback, pokud osnova nebyla spolehlivě zachycena
  if (!currentStaff) {
    return {
      isBarLine: () => false,
      box: {
        left: Math.max(0, Math.floor(clickX - 80)),
        top: Math.max(0, Math.floor(clickY - 50)),
        width: 160,
        height: 100
      }
    };
  }

  const staffTopRel = currentStaff.top - scanTop;
  const staffBottomRel = currentStaff.bottom - scanTop;
  const spacing = currentStaff.spacing;
  const staffH = currentStaff.height;

  // 3. Robustní funkce pro ověření taktové čáry na sloupci col
  const isBarLine = (col) => {
    if (col < 2 || col >= width - 2) return false;

    // Spočítáme vertikální pokrytí uvnitř osnovy (s tolerancí +/- 1 px do šířky)
    let darkPixelsInside = 0;
    for (let y = staffTopRel; y <= staffBottomRel; y++) {
      if (isDarkRel(col, y) || isDarkRel(col - 1, y) || isDarkRel(col + 1, y)) {
        darkPixelsInside++;
      }
    }
    const coverageInside = darkPixelsInside / (staffH + 1);
    if (coverageInside < 0.70) return false; // Musí pokrývat alespoň 70 % výšky osnovy

    // Ověření přesahu nahoru a dolů (nožičky not a ligatury přesahují výrazně, taktová čára ne)
    const maxOvershoot = Math.max(4, Math.floor(spacing * 0.75));
    let oUp = 0;
    for (let y = staffTopRel - 1; y >= Math.max(0, staffTopRel - spacing * 2.5); y--) {
      if (isDarkRel(col, y) || isDarkRel(col - 1, y) || isDarkRel(col + 1, y)) oUp++;
      else break;
    }
    if (oUp > maxOvershoot) return false;

    let oDown = 0;
    for (let y = staffBottomRel + 1; y <= Math.min(scanH - 1, staffBottomRel + spacing * 2.5); y++) {
      if (isDarkRel(col, y) || isDarkRel(col - 1, y) || isDarkRel(col + 1, y)) oDown++;
      else break;
    }
    if (oDown > maxOvershoot) return false;

    return true;
  };

  // 4. Hledání levé taktové čáry směrem doleva od kliknutí
  let leftX = Math.floor(clickX) - 5;
  let foundLeft = false;
  for (let x = leftX; x >= Math.max(0, clickX - spacing * 25); x--) {
    if (isBarLine(x)) {
      // Pokud jde o dvojčáru, posuneme se až na její vnější hranu
      while (x > 0 && isBarLine(x - 1)) x--;
      leftX = x;
      foundLeft = true;
      break;
    }
  }

  // 5. Hledání pravé taktové čáry směrem doprava od kliknutí
  let rightX = Math.floor(clickX) + 5;
  let foundRight = false;
  for (let x = rightX; x <= Math.min(width, clickX + spacing * 25); x++) {
    if (isBarLine(x)) {
      while (x < width - 1 && isBarLine(x + 1)) x++;
      rightX = x;
      foundRight = true;
      break;
    }
  }

  // Bezpečné výchozí šířky, pokud nebyla nalezena některá čára
  if (!foundLeft) leftX = Math.max(0, Math.floor(clickX - spacing * 8));
  if (!foundRight) rightX = Math.min(width, Math.floor(clickX + spacing * 8));

  // Odsazení nahoru a dolů, aby se do taktu vešly i prstoklady a ligatury nad/pod osnovou
  const verticalMargin = Math.round(currentStaff.height * 0.65);
  const topY = Math.max(0, currentStaff.top - verticalMargin);
  const bottomY = Math.min(height, currentStaff.bottom + verticalMargin);

  return {
    isBarLine,
    box: {
      left: leftX,
      top: topY,
      width: Math.max(35, rightX - leftX),
      height: Math.max(35, bottomY - topY)
    }
  };
}