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

// ==========================================================
// ZPRACOVÁNÍ FOTKY S LOKÁLNÍ ELIMINACÍ STÍNŮ RUKY A TELEFONU:
// 1. Zjistí lokální mapu osvětlení (box blur na zmenšeném obraze)
// 2. Vydělí každý pixel lokálním pozadím (odstraní stíny i gradienty)
// 3. Převede na přirozeně teplý bílý papír a sytě černý tisk s antialiasingem
// ==========================================================
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

      const srcImg = ctx.getImageData(0, 0, w, h);
      const d = srcImg.data;
      const gray = new Uint8Array(w * h);

      // 1. Převod na odstíny šedi (luminance)
      for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        gray[p] = Math.round(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
      }

      // 2. Rychlý odhad pozadí přes zmenšený box blur (downscale 1/8)
      const downScale = 8;
      const dw = Math.max(16, Math.floor(w / downScale));
      const dh = Math.max(16, Math.floor(h / downScale));
      const downGray = new Uint8Array(dw * dh);

      for (let dy = 0; dy < dh; dy++) {
        const sy = Math.min(h - 1, dy * downScale);
        for (let dx = 0; dx < dw; dx++) {
          const sx = Math.min(w - 1, dx * downScale);
          downGray[dy * dw + dx] = gray[sy * w + sx];
        }
      }

      const blurR = 12; // odpovídá cca 100px v plném rozlišení
      const blurHoriz = new Uint8Array(dw * dh);
      const bgDown = new Uint8Array(dw * dh);

      // Horizontální rozostření pozadí
      for (let y = 0; y < dh; y++) {
        let sum = 0, count = 0;
        for (let x = 0; x < dw; x++) {
          if (x === 0) {
            for (let k = -blurR; k <= blurR; k++) {
              const px = Math.min(dw - 1, Math.max(0, k));
              sum += downGray[y * dw + px];
              count++;
            }
          } else {
            const addX = Math.min(dw - 1, x + blurR);
            const remX = Math.max(0, x - blurR - 1);
            sum += downGray[y * dw + addX] - downGray[y * dw + remX];
          }
          blurHoriz[y * dw + x] = Math.round(sum / count);
        }
      }

      // Vertikální rozostření pozadí
      for (let x = 0; x < dw; x++) {
        let sum = 0, count = 0;
        for (let y = 0; y < dh; y++) {
          if (y === 0) {
            for (let k = -blurR; k <= blurR; k++) {
              const py = Math.min(dh - 1, Math.max(0, k));
              sum += blurHoriz[py * dw + x];
              count++;
            }
          } else {
            const addY = Math.min(dh - 1, y + blurR);
            const remY = Math.max(0, y - blurR - 1);
            sum += blurHoriz[addY * dw + x] - blurHoriz[remY * dw + x];
          }
          bgDown[y * dw + x] = Math.round(sum / count);
        }
      }

      // 3. Normalizace pixelů: příjemný hudební papír a sytý tiskařský inkoust
      const paperR = 246, paperG = 244, paperB = 238;
      const inkR = 18, inkG = 18, inkB = 20;

      for (let y = 0; y < h; y++) {
        const dy = Math.min(dh - 1, Math.floor(y / downScale));
        const rowOffset = y * w;
        const bgRowOffset = dy * dw;

        for (let x = 0; x < w; x++) {
          const dx = Math.min(dw - 1, Math.floor(x / downScale));
          const localBg = bgDown[bgRowOffset + dx] || 200;
          const pixelVal = gray[rowOffset + x];

          // Kontrastní poměr vůči stínu/osvětlení v tomto konkrétním bodě
          const ratio = pixelVal / Math.max(1, localBg);

          // Plynulý přechod:
          // - nad 0.86 je čistý papír (stín telefonu zmizí)
          // - pod 0.65 je plná čerň not
          // - mezi tím je jemný antialiasing
          let inkWeight = 0;
          if (ratio < 0.65) {
            inkWeight = 1.0;
          } else if (ratio < 0.86) {
            const t = (0.86 - ratio) / (0.86 - 0.65);
            inkWeight = t * t * (3 - 2 * t);
          }

          const idx = (rowOffset + x) * 4;
          d[idx]     = Math.round(paperR + (inkR - paperR) * inkWeight);
          d[idx + 1] = Math.round(paperG + (inkG - paperG) * inkWeight);
          d[idx + 2] = Math.round(paperB + (inkB - paperB) * inkWeight);
          d[idx + 3] = 255;
        }
      }

      ctx.putImageData(srcImg, 0, 0);
      resolve(cvs.toDataURL('image/jpeg', 0.90));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function scanStaffAndBarlinesFromCanvas(sourceCanvas, clickX, clickY) {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const ctx = sourceCanvas.getContext('2d');

  // 1. Záchyt širšího okolí kliknutí pro zachycení i sousedních osnov (nahoře i dole)
  const scanTop = Math.max(0, Math.floor(clickY - 450));
  const scanH = Math.min(height - scanTop, 900);
  const imgData = ctx.getImageData(0, scanTop, width, scanH);
  const data = imgData.data;

  // Průměrný jas papíru v okolí klepnutí
  let sumB = 0, countSample = 0;
  for (let y = 0; y < scanH; y += 8) {
    for (let x = Math.max(0, clickX - 140); x < Math.min(width, clickX + 140); x += 8) {
      const idx = (y * width + Math.floor(x)) * 4;
      sumB += (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      countSample++;
    }
  }
  const bgBright = countSample > 0 ? (sumB / countSample) : 235;
  const darkThreshold = Math.min(145, Math.max(65, bgBright * 0.72));

  const isDark = (x, localY) => {
    if (x < 0 || x >= width || localY < 0 || localY >= scanH) return false;
    const idx = (localY * width + Math.floor(x)) * 4;
    return ((data[idx] + data[idx + 1] + data[idx + 2]) / 3) < darkThreshold;
  };

  // 2. Nalezení všech linek notových osnov v celém prohledávaném vertikálním pásu
  const sampleLeft = Math.max(0, Math.floor(clickX - 180));
  const sampleRight = Math.min(width, Math.floor(clickX + 180));
  const minLineFill = (sampleRight - sampleLeft) * 0.35;

  const lineBlocks = [];
  let currentBlock = [];
  for (let y = 0; y < scanH; y++) {
    let darkCount = 0;
    for (let x = sampleLeft; x < sampleRight; x++) {
      if (isDark(x, y)) darkCount++;
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

  // 3. Rekonstrukce všech osnov (skupin po 5 linkách)
  const allStaffs = [];
  let i = 0;
  while (i <= lineRows.length - 5) {
    const group = lineRows.slice(i, i + 5);
    const spacings = [
      group[1] - group[0],
      group[2] - group[1],
      group[3] - group[2],
      group[4] - group[3]
    ];
    const avgSpacing = spacings.reduce((a, b) => a + b) / 4;
    const isUniform = spacings.every(s => Math.abs(s - avgSpacing) <= 6 && s >= 4 && s <= 45);

    if (isUniform) {
      allStaffs.push({
        top: group[0],
        bottom: group[4],
        lines: group,
        spacing: avgSpacing
      });
      i += 5; // Posun na další osnovu
    } else {
      i++;
    }
  }

  // Najdeme aktuální osnovu, do které uživatel klepl
  let curIndex = -1;
  for (let idx = 0; idx < allStaffs.length; idx++) {
    const s = allStaffs[idx];
    if (clickY >= s.top - 60 && clickY <= s.bottom + 60) {
      curIndex = idx;
      break;
    }
  }

  // Pokud jsme nenašli osnovu přesným rozsahem, zvolíme nejbližší podle středu
  if (curIndex === -1 && allStaffs.length > 0) {
    let minD = Infinity;
    allStaffs.forEach((s, idx) => {
      const mid = (s.top + s.bottom) / 2;
      const d = Math.abs(clickY - mid);
      if (d < minD) { minD = d; curIndex = idx; }
    });
  }

  const currentStaff = curIndex !== -1 ? allStaffs[curIndex] : null;

  if (!currentStaff) {
    return {
      isBarLine: () => false,
      box: {
        left: Math.max(0, Math.floor(clickX - 90)),
        top: Math.max(0, Math.floor(clickY - 50)),
        width: 180,
        height: 100
      }
    };
  }

  // 4. Výpočet horního a dolního okraje přesně do poloviny mezer mezi osnovami
  const prevStaff = curIndex > 0 ? allStaffs[curIndex - 1] : null;
  const nextStaff = curIndex < allStaffs.length - 1 ? allStaffs[curIndex + 1] : null;

  let topY, bottomY;

  // Horní mezera
  if (prevStaff) {
    topY = Math.round((prevStaff.bottom + currentStaff.top) / 2);
  } else if (nextStaff) {
    const gapBelow = nextStaff.top - currentStaff.bottom;
    topY = Math.max(0, Math.round(currentStaff.top - gapBelow / 2));
  } else {
    const fallbackMargin = Math.round(currentStaff.spacing * 3.5);
    topY = Math.max(0, currentStaff.top - fallbackMargin);
  }

  // Dolní mezera
  if (nextStaff) {
    bottomY = Math.round((currentStaff.bottom + nextStaff.top) / 2);
  } else if (prevStaff) {
    const gapAbove = currentStaff.top - prevStaff.bottom;
    bottomY = Math.min(height, Math.round(currentStaff.bottom + gapAbove / 2));
  } else {
    const fallbackMargin = Math.round(currentStaff.spacing * 3.5);
    bottomY = Math.min(height, currentStaff.bottom + fallbackMargin);
  }

  const lRel = currentStaff.lines.map(y => y - scanTop);
  const sp = currentStaff.spacing;
  const staffHeightRel = lRel[4] - lRel[0];

  // 5. Test taktové čáry se skórováním
  const scoreColumnAsBarline = (col) => {
    if (col < 2 || col >= width - 2) return 0;

    let gapChecksPassed = 0;
    for (let i = 0; i < 4; i++) {
      const yA = Math.round(lRel[i] + sp * 0.2);
      const yMid = Math.round((lRel[i] + lRel[i + 1]) / 2);
      const yB = Math.round(lRel[i + 1] - sp * 0.2);

      const hasDark = (isDark(col, yA) || isDark(col - 1, yA) || isDark(col + 1, yA)) &&
                      (isDark(col, yMid) || isDark(col - 1, yMid) || isDark(col + 1, yMid)) &&
                      (isDark(col, yB) || isDark(col - 1, yB) || isDark(col + 1, yB));

      if (hasDark) gapChecksPassed++;
    }
    if (gapChecksPassed < 4) return 0;

    let darkCount = 0;
    for (let y = lRel[0]; y <= lRel[4]; y++) {
      if (isDark(col, y) || isDark(col - 1, y) || isDark(col + 1, y)) darkCount++;
    }
    const fillRatio = darkCount / (staffHeightRel + 1);
    if (fillRatio < 0.82) return 0;

    let overshootUp = 0;
    for (let y = lRel[0] - 2; y >= Math.max(0, lRel[0] - Math.round(sp * 2.0)); y--) {
      if (isDark(col, y) || isDark(col - 1, y) || isDark(col + 1, y)) overshootUp++;
    }
    if (overshootUp > sp * 0.35) return 0;

    let overshootDown = 0;
    for (let y = lRel[4] + 2; y <= Math.min(scanH - 1, lRel[4] + Math.round(sp * 2.0)); y++) {
      if (isDark(col, y) || isDark(col - 1, y) || isDark(col + 1, y)) overshootDown++;
    }
    if (overshootDown > sp * 0.35) return 0;

    let sideNoise = 0;
    const testOffsets = [-Math.round(sp * 0.7), Math.round(sp * 0.7)];
    for (const off of testOffsets) {
      for (let i = 0; i < 4; i++) {
        const midY = Math.round((lRel[i] + lRel[i + 1]) / 2);
        if (isDark(col + off, midY)) sideNoise++;
      }
    }

    return (fillRatio * 100) - (sideNoise * 15);
  };

  // 6. Hledání taktových čar vlevo a vpravo
  const minClearance = Math.round(sp * 2.2);
  const maxRange = Math.round(sp * 34);

  let bestLeftX = null;
  let bestLeftScore = 0;
  for (let x = Math.floor(clickX) - minClearance; x >= Math.max(0, clickX - maxRange); x--) {
    const score = scoreColumnAsBarline(x);
    if (score > 60 && score > bestLeftScore) {
      let edgeX = x;
      while (edgeX > 0 && scoreColumnAsBarline(edgeX - 1) > 40) edgeX--;
      bestLeftScore = score;
      bestLeftX = edgeX;
      break;
    }
  }

  let bestRightX = null;
  let bestRightScore = 0;
  for (let x = Math.floor(clickX) + minClearance; x <= Math.min(width - 1, clickX + maxRange); x++) {
    const score = scoreColumnAsBarline(x);
    if (score > 60 && score > bestRightScore) {
      let edgeX = x;
      while (edgeX < width - 1 && scoreColumnAsBarline(edgeX + 1) > 40) edgeX++;
      bestRightScore = score;
      bestRightX = edgeX;
      break;
    }
  }

  const leftX = bestLeftX !== null ? bestLeftX : Math.max(0, Math.floor(clickX - sp * 10));
  const rightX = bestRightX !== null ? bestRightX : Math.min(width, Math.floor(clickX + sp * 10));

  return {
    isBarLine: (col) => scoreColumnAsBarline(col) > 60,
    box: {
      left: leftX,
      top: topY,
      width: Math.max(40, rightX - leftX),
      height: Math.max(40, bottomY - topY)
    }
  };
}