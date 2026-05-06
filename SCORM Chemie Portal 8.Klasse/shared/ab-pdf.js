/* ============================================================
   AB-PDF — generische PDF-Export-Funktionen
   ============================================================
   Aufruf:
     ABPdf.export({
       titel: 'Reibungselektrizität',
       untertitel: 'Was passiert mit den Atomen?',
       fach: 'Chemie',
       klasse: '8c',
       datum: '30. April 2026',
       dateiname: 'Reibungselektrizitaet_Klasse_8c.pdf',
       inhalt: (h) => {
         h.section('Der Versuch');
         h.paragraph('Aufbau: ein Luftballon ...');
         h.simSnapshot(document.getElementById('sim-x'), 'Abb. 1', 'Beschreibung');
         h.aufgabe(1, 'Beschreibe', 'deine Beobachtungen ...');
         h.canvasFeld('a1');
         h.merke('Atome bestehen aus ...');
       }
     });
*/
(function() {
'use strict';

window.ABPdf = {
  async export(opts) {
    const overlay = document.getElementById('overlay');
    const overlayText = document.getElementById('overlay-text');
    if (overlay) overlay.classList.add('aktiv');
    if (overlayText) overlayText.textContent = 'PDF wird erstellt …';
    await new Promise(r => setTimeout(r, 50));

    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });

      const PAGE_W = 210, PAGE_H = 297;
      const MARGIN_L = 18, MARGIN_R = 18, MARGIN_T = 22, MARGIN_B = 18;
      const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;

      const COL_DARK = [26, 58, 92];
      const COL_CYAN = [0, 176, 240];
      const COL_CYAN_DARK = [0, 128, 176];
      const COL_TEXT = [45, 42, 38];
      const COL_GREY = [120, 120, 120];
      const COL_LINE = [216, 216, 216];
      const COL_HEFT = [181, 199, 216];

      let y = MARGIN_T;
      let pageNum = 1;

      function setFill(c) { doc.setFillColor(c[0], c[1], c[2]); }
      function setText(c) { doc.setTextColor(c[0], c[1], c[2]); }
      function setDraw(c) { doc.setDrawColor(c[0], c[1], c[2]); }

      function ensureSpace(needed) {
        if (y + needed <= PAGE_H - MARGIN_B - 14) return;
        drawFooter();
        doc.addPage();
        pageNum++;
        y = MARGIN_T;
        drawTopBar();
      }

      function drawTopBar() {
        setFill(COL_CYAN);
        doc.rect(0, 0, PAGE_W, 4, 'F');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        setText(COL_GREY);
        doc.text(`${opts.titel} · Klasse ${opts.klasse}`, MARGIN_L, 14);
        doc.text(opts.datum, PAGE_W - MARGIN_R, 14, { align: 'right' });
        y = 22;
      }

      function drawFooter() {
        const fy = PAGE_H - 12;
        setDraw(COL_LINE);
        doc.setLineWidth(0.2);
        doc.line(MARGIN_L, fy, PAGE_W - MARGIN_R, fy);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        setText(COL_GREY);
        doc.text(`Klasse ${opts.klasse} · ${opts.titel}`, MARGIN_L, fy + 5);
        doc.text(`Seite ${pageNum}`, PAGE_W - MARGIN_R, fy + 5, { align: 'right' });
      }

      function drawTitleHeader() {
        setFill(COL_CYAN);
        doc.rect(0, 0, PAGE_W, 6, 'F');

        const badgeX = MARGIN_L, badgeY = 14;
        const badgeW = 24, badgeH = 9;
        setFill(COL_CYAN);
        doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 1.5, 1.5, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        setText([255,255,255]);
        doc.text(`Klasse ${opts.klasse}`, badgeX + badgeW/2, badgeY + 6.2, { align: 'center' });

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        setText(COL_GREY);
        doc.text(opts.datum, PAGE_W - MARGIN_R, badgeY + 6.2, { align: 'right' });

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(22);
        setText(COL_DARK);
        const titleLines = doc.splitTextToSize(opts.titel, CONTENT_W);
        doc.text(titleLines, MARGIN_L, badgeY + 22);

        if (opts.untertitel) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(13);
          setText(COL_GREY);
          doc.text(opts.untertitel, MARGIN_L, badgeY + 22 + (titleLines.length * 8));
        }

        setDraw(COL_LINE);
        doc.setLineWidth(0.3);
        const lineY = badgeY + 22 + ((titleLines.length) * 8) + (opts.untertitel ? 5 : 5);
        doc.line(MARGIN_L, lineY, PAGE_W - MARGIN_R, lineY);

        y = lineY + 8;
      }

      // ===== HELPERS für Inhalts-Aufruf =====
      const h = {
        section(titel) {
          ensureSpace(15);
          y += 2; // Top-Abstand
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(13);
          setText(COL_DARK);
          // text() nutzt baseline-y; bei FontSize 13 → ~5mm Höhe, ~4mm Ascent
          doc.text(titel, MARGIN_L, y + 4.5);
          y += 6.5; // Schrifthöhe + kleiner Abstand
          setDraw(COL_CYAN);
          doc.setLineWidth(0.5);
          doc.line(MARGIN_L, y, MARGIN_L + 30, y);
          y += 5;
        },
        paragraph(text, o = {}) {
          if (o.italic) doc.setFont('helvetica', 'italic');
          else doc.setFont('helvetica', 'normal');
          doc.setFontSize(10.5);
          setText(o.muted ? COL_GREY : COL_TEXT);
          const lines = doc.splitTextToSize(text, CONTENT_W);
          const lineH = 5;
          ensureSpace(lines.length * lineH + 3);
          // Baseline der ersten Zeile bei y + 3.7 (Ascent für 10.5pt ≈ 3.7mm)
          for (let i = 0; i < lines.length; i++) {
            doc.text(lines[i], MARGIN_L, y + 3.7 + lineH * i);
          }
          y += lines.length * lineH + 3;
        },
        aufgabe(nr, op, rest) {
          // Aufgaben werden als hellgrauer Block mit cyan-Akzent links dargestellt —
          // visuell konsistent zu infoBox und merke.
          const innerW = CONTENT_W - 12;
          const praefix = `${nr ? nr + '. ' : ''}${op} `;

          // Vorab Layout berechnen
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(10.5);
          const praefixW = doc.getTextWidth(praefix);
          doc.setFont('helvetica', 'normal');

          // Erste Zeile berechnen mit Platz fürs fette Präfix
          const ersteW = innerW - praefixW;
          const woerter = rest.split(' ');
          let ersteText = '';
          for (const w of woerter) {
            const probe = ersteText ? ersteText + ' ' + w : w;
            if (doc.getTextWidth(probe) > ersteW) break;
            ersteText = probe;
          }
          const restAb = rest.substring(ersteText.length).trim();
          const folgeZeilen = restAb ? doc.splitTextToSize(restAb, innerW) : [];
          const gesamtZeilen = 1 + folgeZeilen.length;

          const padTop = 4, padBot = 4, lineH = 5.2;
          const blockH = padTop + gesamtZeilen * lineH + padBot;
          ensureSpace(blockH + 5);

          // Block-Hintergrund + Akzent
          setFill([240, 246, 250]);
          doc.rect(MARGIN_L, y, CONTENT_W, blockH, 'F');
          setFill(COL_CYAN);
          doc.rect(MARGIN_L, y, 3, blockH, 'F');

          // Texte schreiben — Zeilen einzeln rendern, damit Y-Position
          // exakt gleich bleibt (Array-Mode in jsPDF nutzt eigenen lineHeight).
          const startY = y + padTop + 3.5;
          doc.setFont('helvetica', 'bold');
          setText(COL_DARK);
          doc.text(praefix, MARGIN_L + 7, startY);
          doc.setFont('helvetica', 'normal');
          setText(COL_TEXT);
          doc.text(ersteText, MARGIN_L + 7 + praefixW, startY);
          for (let i = 0; i < folgeZeilen.length; i++) {
            doc.text(folgeZeilen[i], MARGIN_L + 7, startY + lineH * (i + 1));
          }
          y += blockH + 4;
        },
        canvasFeld(canvasId) {
          const state = window.ABEngine.getCanvasState(canvasId);
          if (!state) return;
          const hasContent = state.paths.length > 0;
          const canvas = state.canvas;
          const aspect = canvas.height / canvas.width;
          const imgW = CONTENT_W;
          // Leeres Canvas: nur 22mm hoch (kleines Notiz-Feld). Mit Inhalt:
          // proportional zur tatsächlichen Canvas-Höhe.
          const fullImgH = hasContent ? Math.max(28, imgW * aspect) : 22;

          const availH = (PAGE_H - MARGIN_B - 14) - y;
          if (fullImgH <= availH) {
            zeichneCanvasBlock(canvas, hasContent, MARGIN_L, y, imgW, fullImgH, 0, 1);
            y += fullImgH + 6;
            return;
          }
          if (availH < 25) {
            drawFooter();
            doc.addPage(); pageNum++; y = MARGIN_T; drawTopBar();
            zeichneCanvasBlock(canvas, hasContent, MARGIN_L, y, imgW, fullImgH, 0, 1);
            y += fullImgH + 6;
            return;
          }
          const ratio1 = availH / fullImgH;
          zeichneCanvasBlock(canvas, hasContent, MARGIN_L, y, imgW, availH, 0, ratio1);
          const restH = fullImgH - availH;
          drawFooter();
          doc.addPage(); pageNum++; y = MARGIN_T; drawTopBar();
          zeichneCanvasBlock(canvas, hasContent, MARGIN_L, y, imgW, restH, ratio1, 1 - ratio1);
          y += restH + 6;
        },
        simSnapshot(canvasEl, captionTitle, captionText) {
          if (!canvasEl) return;
          const aspect = canvasEl.height / canvasEl.width;
          const imgW = CONTENT_W * 0.86;
          const imgH = imgW * aspect;
          // Caption-Höhe vorab berechnen, damit ensureSpace alles berücksichtigt
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(8.5);
          const captionLines = doc.splitTextToSize(captionText, CONTENT_W * 0.85);
          const captionH = 6 + captionLines.length * 3.8 + 6; // Title + Lines + Bottom-Padding
          ensureSpace(imgH + captionH + 4);

          const xCenter = MARGIN_L + (CONTENT_W - imgW) / 2;
          setFill([245, 248, 251]);
          doc.rect(xCenter + 1, y + 1, imgW, imgH, 'F');
          setFill([255, 255, 255]);
          doc.rect(xCenter, y, imgW, imgH, 'F');
          try {
            doc.addImage(canvasEl.toDataURL('image/png'), 'PNG', xCenter, y, imgW, imgH);
          } catch(e) { console.warn('simSnapshot toDataURL failed', e); }
          setDraw(COL_LINE);
          doc.setLineWidth(0.4);
          doc.rect(xCenter, y, imgW, imgH);

          y += imgH + 5;
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8.5);
          setText(COL_CYAN_DARK);
          const tx = MARGIN_L + CONTENT_W / 2;
          // Caption-Title mit Baseline + 3mm
          doc.text(captionTitle, tx, y + 3, { align: 'center' });
          y += 4.5;
          doc.setFont('helvetica', 'italic');
          setText(COL_GREY);
          for (let i = 0; i < captionLines.length; i++) {
            doc.text(captionLines[i], tx, y + 3 + 3.8 * i, { align: 'center' });
          }
          y += captionLines.length * 3.8 + 8;
        },
        // Zwei Sim-Snapshots nebeneinander, jeder mit eigener Caption.
        // Bilder kompakter (jedes nimmt ~48% der Breite). Praktisch z.B. für
        // Vergleich Erwartung↔Realität bei Streuversuch.
        simSnapshotPair(canvasA, captionA, textA, canvasB, captionB, textB) {
          if (!canvasA || !canvasB) return;
          const gap = 6;
          const imgW = (CONTENT_W - gap) / 2;
          const aspectA = canvasA.height / canvasA.width;
          const aspectB = canvasB.height / canvasB.width;
          const imgHA = imgW * aspectA;
          const imgHB = imgW * aspectB;
          const imgH = Math.max(imgHA, imgHB);
          // Caption vorab berechnen
          doc.setFontSize(8);
          const linesA = doc.splitTextToSize(textA, imgW - 2);
          const linesB = doc.splitTextToSize(textB, imgW - 2);
          const captionLines = Math.max(linesA.length, linesB.length);
          const captionH = 5 + captionLines * 3.4 + 5;
          ensureSpace(imgH + captionH + 4);

          // Bilder
          const xA = MARGIN_L;
          const xB = MARGIN_L + imgW + gap;
          [
            [canvasA, xA, imgHA],
            [canvasB, xB, imgHB],
          ].forEach(([c, x, h]) => {
            setFill([245, 248, 251]);
            doc.rect(x + 1, y + 1, imgW, h, 'F');
            setFill([255, 255, 255]);
            doc.rect(x, y, imgW, h, 'F');
            try {
              doc.addImage(c.toDataURL('image/png'), 'PNG', x, y, imgW, h);
            } catch(e) { console.warn('simSnapshotPair toDataURL', e); }
            setDraw(COL_LINE);
            doc.setLineWidth(0.4);
            doc.rect(x, y, imgW, h);
          });

          y += imgH + 5;
          // Captions: zentriert pro Bild, Baseline +3mm
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8);
          setText(COL_CYAN_DARK);
          doc.text(captionA, xA + imgW / 2, y + 3, { align: 'center' });
          doc.text(captionB, xB + imgW / 2, y + 3, { align: 'center' });
          y += 4;
          doc.setFont('helvetica', 'italic');
          setText(COL_GREY);
          for (let i = 0; i < linesA.length; i++) {
            doc.text(linesA[i], xA + imgW / 2, y + 3 + 3.4 * i, { align: 'center' });
          }
          for (let i = 0; i < linesB.length; i++) {
            doc.text(linesB[i], xB + imgW / 2, y + 3 + 3.4 * i, { align: 'center' });
          }
          y += captionLines * 3.4 + 7;
        },
        merke(text) {
          const innerW = CONTENT_W - 12;
          const lines = doc.splitTextToSize(text, innerW);
          const padTop = 5, padBot = 4, lineH = 5;
          const blockH = padTop + 6 + lines.length * lineH + padBot; // 6mm für "Merke"-Label
          ensureSpace(blockH + 6);
          setFill([240, 250, 254]);
          doc.rect(MARGIN_L, y, CONTENT_W, blockH, 'F');
          setFill(COL_CYAN);
          doc.rect(MARGIN_L, y, 3, blockH, 'F');

          doc.setFont('helvetica', 'bold');
          doc.setFontSize(10.5);
          setText(COL_CYAN_DARK);
          doc.text('Merke', MARGIN_L + 7, y + padTop + 3);
          doc.setFont('helvetica', 'normal');
          setText(COL_TEXT);
          for (let i = 0; i < lines.length; i++) {
            doc.text(lines[i], MARGIN_L + 7, y + padTop + 9 + lineH * i);
          }
          y += blockH + 6;
        },
        infoBox(text) {
          const innerW = CONTENT_W - 12;
          const lines = doc.splitTextToSize(text, innerW);
          const padTop = 4, padBot = 4, lineH = 5;
          const blockH = padTop + lines.length * lineH + padBot;
          ensureSpace(blockH + 6);
          setFill([255, 248, 225]);
          doc.rect(MARGIN_L, y, CONTENT_W, blockH, 'F');
          setFill([240, 180, 0]);
          doc.rect(MARGIN_L, y, 3, blockH, 'F');
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          setText(COL_TEXT);
          for (let i = 0; i < lines.length; i++) {
            doc.text(lines[i], MARGIN_L + 7, y + padTop + 3.5 + lineH * i);
          }
          y += blockH + 6;
        },
        // Erzwingt einen Seitenumbruch (für Aufgaben, die zusammen bleiben sollen).
        pageBreak() {
          drawFooter();
          doc.addPage();
          pageNum++;
          y = MARGIN_T;
          drawTopBar();
        },
        // Mindmap-Snapshot zentriert in passender Größe für eine Seite.
        // Größer als simSnapshot, ohne Caption — passt die ganze Aufgabe 3 auf
        // eine Seite ein.
        mindmapImage(canvasEl) {
          if (!canvasEl) return;
          // Verfügbare Höhe auf aktueller Seite
          const verfH = (PAGE_H - MARGIN_B - 14) - y - 4;
          const aspect = canvasEl.height / canvasEl.width; // ~1.43 für 700x1000
          // Berechne Größe: möglichst breit, aber max. verfügbare Höhe
          let imgW = CONTENT_W * 0.92;
          let imgH = imgW * aspect;
          if (imgH > verfH) {
            imgH = verfH;
            imgW = imgH / aspect;
          }
          const xCenter = MARGIN_L + (CONTENT_W - imgW) / 2;
          setFill([255, 255, 255]);
          doc.rect(xCenter, y, imgW, imgH, 'F');
          try {
            doc.addImage(canvasEl.toDataURL('image/png'), 'PNG', xCenter, y, imgW, imgH);
          } catch(e) { console.warn('mindmapImage toDataURL failed', e); }
          setDraw(COL_LINE);
          doc.setLineWidth(0.4);
          doc.rect(xCenter, y, imgW, imgH);
          y += imgH + 6;
        }
      };

      function zeichneCanvasBlock(canvas, hasContent, x, yPos, w, h, vRatioStart, vRatioPart) {
        setFill([252, 253, 254]);
        doc.rect(x, yPos, w, h, 'F');
        // Karo-Muster (5mm) statt Heftlinien — passend zum kariertem Canvas im AB
        setDraw(COL_HEFT);
        doc.setLineWidth(0.15);
        const KARO = 5;
        for (let yl = yPos + KARO; yl < yPos + h - 0.5; yl += KARO) {
          doc.line(x + 1, yl, x + w - 1, yl);
        }
        for (let xl = x + KARO; xl < x + w - 0.5; xl += KARO) {
          doc.line(xl, yPos + 1, xl, yPos + h - 1);
        }
        if (hasContent) {
          try {
            const srcY = Math.floor(canvas.height * vRatioStart);
            const srcH = Math.ceil(canvas.height * vRatioPart);
            const tmp = document.createElement('canvas');
            tmp.width = canvas.width;
            tmp.height = srcH;
            const tctx = tmp.getContext('2d');
            tctx.drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH);
            doc.addImage(tmp.toDataURL('image/png'), 'PNG', x, yPos, w, h);
          } catch(e) { console.warn('Canvas split fail', e); }
        }
        setDraw(COL_LINE);
        doc.setLineWidth(0.3);
        doc.rect(x, yPos, w, h);
      }

      // INHALT
      drawTitleHeader();
      if (overlayText) overlayText.textContent = 'Inhalt wird erzeugt …';
      await new Promise(r => setTimeout(r, 30));
      opts.inhalt(h);
      drawFooter();

      if (overlayText) overlayText.textContent = 'PDF wird gespeichert …';
      await new Promise(r => setTimeout(r, 50));
      doc.save(opts.dateiname);
    } catch(err) {
      console.error(err);
      alert('Fehler beim PDF-Export: ' + err.message);
    } finally {
      if (overlay) overlay.classList.remove('aktiv');
    }
  }
};

})();
