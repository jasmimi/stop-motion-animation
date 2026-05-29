import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import {
  createIcons,
  Download,
  FileArchive,
  FileScan,
  FileText,
  FileVideo,
  Film,
  Images,
  Printer,
  ScanLine,
  Scissors,
  Video,
} from 'lucide';
import './styles.css';

const CORE_BASE_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
const DEFAULT_FPS = 12;
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const MAX_OUTPUT_WIDTH = 1920;
const MAX_OUTPUT_HEIGHT = 1080;
const A4_LANDSCAPE = { width: 841.89, height: 595.28 };
const PDF_GRID = { columns: 2, rows: 2 };
const PDF_MARGIN = 28;
const PDF_GUTTER = 20;
const PDF_CELL_PADDING = 14;
const PDF_LABEL_HEIGHT = 20;
const PDF_FRAME_ASPECT_RATIO = 16 / 9;
const PDF_FRAME_BORDER_WIDTH = 1.4;
const PDF_CROP_INSET = 2.5;
const PDF_MARKER_SIZE = 7;
const PDF_RENDER_SCALE = 4;

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const state = {
  busy: false,
  ffmpeg: null,
  ffmpegReady: false,
  activeStatus: null,
  activeProgress: null,
  framesUrl: null,
  pdfUrl: null,
  scannedFramesUrl: null,
  mp4Url: null,
};

const ui = {
  extractForm: document.querySelector('#extract-form'),
  printForm: document.querySelector('#print-form'),
  scanForm: document.querySelector('#scan-form'),
  compileForm: document.querySelector('#compile-form'),
  videoInput: document.querySelector('#video-input'),
  printZipInput: document.querySelector('#print-zip-input'),
  scanPdfInput: document.querySelector('#scan-pdf-input'),
  zipInput: document.querySelector('#zip-input'),
  extractFps: document.querySelector('#extract-fps'),
  compileFps: document.querySelector('#compile-fps'),
  videoFileName: document.querySelector('#video-file-name'),
  printZipFileName: document.querySelector('#print-zip-file-name'),
  scanPdfFileName: document.querySelector('#scan-pdf-file-name'),
  zipFileName: document.querySelector('#zip-file-name'),
  extractSubmit: document.querySelector('#extract-submit'),
  printSubmit: document.querySelector('#print-submit'),
  scanSubmit: document.querySelector('#scan-submit'),
  compileSubmit: document.querySelector('#compile-submit'),
  extractStatus: document.querySelector('#extract-status'),
  printStatus: document.querySelector('#print-status'),
  scanStatus: document.querySelector('#scan-status'),
  compileStatus: document.querySelector('#compile-status'),
  extractProgress: document.querySelector('#extract-progress'),
  printProgress: document.querySelector('#print-progress'),
  scanProgress: document.querySelector('#scan-progress'),
  compileProgress: document.querySelector('#compile-progress'),
  framesDownload: document.querySelector('#frames-download'),
  pdfDownload: document.querySelector('#pdf-download'),
  scanDownload: document.querySelector('#scan-download'),
  mp4Download: document.querySelector('#mp4-download'),
  videoPreview: document.querySelector('#video-preview'),
};

createIcons({
  icons: {
    Download,
    FileArchive,
    FileScan,
    FileText,
    FileVideo,
    Film,
    Images,
    Printer,
    ScanLine,
    Scissors,
    Video,
  },
});

ui.videoInput.addEventListener('change', () => {
  ui.videoFileName.textContent = ui.videoInput.files?.[0]?.name || 'Choose video';
});

ui.printZipInput.addEventListener('change', () => {
  ui.printZipFileName.textContent = ui.printZipInput.files?.[0]?.name || 'Choose frame ZIP';
});

ui.scanPdfInput.addEventListener('change', () => {
  ui.scanPdfFileName.textContent = ui.scanPdfInput.files?.[0]?.name || 'Choose scanned PDF';
});

ui.zipInput.addEventListener('change', () => {
  ui.zipFileName.textContent = ui.zipInput.files?.[0]?.name || 'Choose ZIP';
});

ui.extractForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.busy) return;

  const file = ui.videoInput.files?.[0];
  const fps = parseFps(ui.extractFps.value);

  if (!file) {
    setStatus(ui.extractStatus, 'Choose a video first.', true);
    return;
  }

  if (!fps) {
    setStatus(ui.extractStatus, 'FPS must be a positive whole number.', true);
    return;
  }

  await runJob(ui.extractStatus, ui.extractProgress, async () => {
    clearDownload('frames');
    setStatus(ui.extractStatus, 'Loading video tools...');
    const ffmpeg = await ensureFfmpeg();
    setStatus(ui.extractStatus, 'Extracting frames...');
    const frameFiles = await extractFrames(ffmpeg, file, fps);
    setStatus(ui.extractStatus, `Packing ${frameFiles.length} frame${frameFiles.length === 1 ? '' : 's'}...`);
    const zipBlob = await buildFramesZip(frameFiles, ui.extractProgress, 50, 100);

    state.framesUrl = replaceObjectUrl(state.framesUrl, zipBlob);
    ui.framesDownload.href = state.framesUrl;
    ui.framesDownload.download = `${cleanBaseName(file.name)}-frames.zip`;
    ui.framesDownload.classList.remove('is-hidden');
    setProgress(ui.extractProgress, 100);
    setStatus(ui.extractStatus, `${frameFiles.length} frame${frameFiles.length === 1 ? '' : 's'} ready.`);
  });
});

ui.printForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.busy) return;

  const file = ui.printZipInput.files?.[0];

  if (!file) {
    setStatus(ui.printStatus, 'Choose a frame ZIP first.', true);
    return;
  }

  await runJob(ui.printStatus, ui.printProgress, async () => {
    clearDownload('pdf');
    setStatus(ui.printStatus, 'Reading frames...');
    const frames = await readZipFrames(file);
    setStatus(ui.printStatus, `Laying out ${frames.length} frame${frames.length === 1 ? '' : 's'}...`);
    const pdfBlob = await buildPrintablePdf(frames);

    state.pdfUrl = replaceObjectUrl(state.pdfUrl, pdfBlob);
    ui.pdfDownload.href = state.pdfUrl;
    ui.pdfDownload.download = `${cleanBaseName(file.name)}-a4-frames.pdf`;
    ui.pdfDownload.classList.remove('is-hidden');
    setProgress(ui.printProgress, 100);
    setStatus(ui.printStatus, `${frames.length} frame${frames.length === 1 ? '' : 's'} placed on A4 PDF.`);
  });
});

ui.scanForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.busy) return;

  const file = ui.scanPdfInput.files?.[0];

  if (!file) {
    setStatus(ui.scanStatus, 'Choose a scanned PDF first.', true);
    return;
  }

  if (fileExtension(file.name) !== 'pdf' && file.type !== 'application/pdf') {
    setStatus(ui.scanStatus, 'Choose a PDF file.', true);
    return;
  }

  await runJob(ui.scanStatus, ui.scanProgress, async () => {
    clearDownload('scan');
    setStatus(ui.scanStatus, 'Reading scanned PDF...');
    const frameFiles = await recoverFramesFromPdf(file);
    setStatus(ui.scanStatus, `Packing ${frameFiles.length} frame${frameFiles.length === 1 ? '' : 's'}...`);
    const zipBlob = await buildFramesZip(frameFiles, ui.scanProgress, 84, 100);

    state.scannedFramesUrl = replaceObjectUrl(state.scannedFramesUrl, zipBlob);
    ui.scanDownload.href = state.scannedFramesUrl;
    ui.scanDownload.download = `${cleanBaseName(file.name)}-scanned-frames.zip`;
    ui.scanDownload.classList.remove('is-hidden');
    setProgress(ui.scanProgress, 100);
    setStatus(ui.scanStatus, `${frameFiles.length} PNG frame${frameFiles.length === 1 ? '' : 's'} recovered.`);
  });
});

ui.compileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.busy) return;

  const file = ui.zipInput.files?.[0];
  const fps = parseFps(ui.compileFps.value);

  if (!file) {
    setStatus(ui.compileStatus, 'Choose a ZIP first.', true);
    return;
  }

  if (!fps) {
    setStatus(ui.compileStatus, 'FPS must be a positive whole number.', true);
    return;
  }

  await runJob(ui.compileStatus, ui.compileProgress, async () => {
    clearDownload('mp4');
    setStatus(ui.compileStatus, 'Reading frames...');
    const frames = await readZipFrames(file);
    setStatus(ui.compileStatus, `Loading ${frames.length} frame${frames.length === 1 ? '' : 's'}...`);
    const firstFrameSize = await getImageSize(frames[0].bytes, frames[0].mime);
    const outputSize = fitEvenSize(firstFrameSize.width, firstFrameSize.height);
    const ffmpeg = await ensureFfmpeg();
    setStatus(ui.compileStatus, 'Rendering MP4...');
    const mp4Blob = await compileFrames(ffmpeg, frames, fps, outputSize);

    state.mp4Url = replaceObjectUrl(state.mp4Url, mp4Blob);
    ui.mp4Download.href = state.mp4Url;
    ui.mp4Download.download = `${cleanBaseName(file.name)}.mp4`;
    ui.videoPreview.src = state.mp4Url;
    ui.videoPreview.classList.remove('is-hidden');
    ui.mp4Download.classList.remove('is-hidden');
    setProgress(ui.compileProgress, 100);
    setStatus(ui.compileStatus, `MP4 ready at ${fps} FPS.`);
  });
});

async function runJob(statusEl, progressEl, job) {
  state.busy = true;
  state.activeStatus = statusEl;
  state.activeProgress = progressEl;
  setControlsDisabled(true);
  setProgress(progressEl, 4);

  try {
    await job();
  } catch (error) {
    console.error(error);
    setProgress(progressEl, 0);
    setStatus(statusEl, friendlyError(error), true);
  } finally {
    state.busy = false;
    state.activeStatus = null;
    state.activeProgress = null;
    setControlsDisabled(false);
  }
}

async function ensureFfmpeg() {
  if (state.ffmpegReady) return state.ffmpeg;

  const ffmpeg = state.ffmpeg || new FFmpeg();
  state.ffmpeg = ffmpeg;

  ffmpeg.on('log', ({ message }) => {
    if (!message || !state.activeStatus) return;
    const lowered = message.toLowerCase();
    if (lowered.includes('error') || lowered.includes('invalid')) {
      setStatus(state.activeStatus, message, true);
    }
  });

  ffmpeg.on('progress', ({ progress }) => {
    if (!state.activeProgress || Number.isNaN(progress)) return;
    setProgress(state.activeProgress, Math.max(8, Math.min(96, Math.round(progress * 100))));
  });

  await ffmpeg.load({
    coreURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, 'application/wasm'),
  });

  state.ffmpegReady = true;
  return ffmpeg;
}

async function extractFrames(ffmpeg, file, fps) {
  const jobId = createJobId('extract');
  const inputName = `${jobId}.${fileExtension(file.name) || 'mp4'}`;
  const outputPrefix = `${jobId}_frame_`;
  const outputPattern = `${outputPrefix}%06d.png`;
  const cleanup = [inputName];

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file));
    await runFfmpeg(ffmpeg, ['-i', inputName, '-vf', `fps=${fps}`, '-vsync', '0', outputPattern]);

    const entries = await ffmpeg.listDir('/');
    const frameNames = entries
      .map((entry) => entry.name)
      .filter((name) => name.startsWith(outputPrefix) && name.endsWith('.png'))
      .sort(naturalSort);

    if (!frameNames.length) {
      throw new Error('No frames were generated from that video.');
    }

    const frameFiles = [];
    for (const [index, name] of frameNames.entries()) {
      const bytes = await ffmpeg.readFile(name);
      const zipName = `frame_${String(index + 1).padStart(6, '0')}.png`;
      frameFiles.push({ name: zipName, bytes });
      cleanup.push(name);
    }

    return frameFiles;
  } finally {
    await cleanupFiles(ffmpeg, cleanup);
  }
}

async function buildFramesZip(frameFiles, progressEl, startProgress = 50, endProgress = 100) {
  const zip = new JSZip();

  for (const frame of frameFiles) {
    zip.file(frame.name, frame.bytes);
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }, (metadata) => {
    const span = endProgress - startProgress;
    const progress = startProgress + Math.round((metadata.percent / 100) * span);
    setProgress(progressEl, progress);
  });
}

async function readZipFrames(file) {
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir && IMAGE_EXTENSIONS.has(fileExtension(entry.name)))
    .sort((a, b) => naturalSort(a.name, b.name));

  if (!entries.length) {
    throw new Error('That ZIP does not contain supported image frames.');
  }

  const frames = [];
  for (const entry of entries) {
    const ext = fileExtension(entry.name);
    const bytes = await entry.async('uint8array');
    frames.push({
      sourceName: entry.name,
      safeName: '',
      ext,
      bytes,
      mime: imageMime(ext),
    });
  }

  return frames;
}

async function buildPrintablePdf(frames) {
  const pdfDoc = await PDFDocument.create();
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const slots = getPrintSlots(A4_LANDSCAPE.width, A4_LANDSCAPE.height);
  const pageCount = Math.ceil(frames.length / slots.length);

  pdfDoc.setTitle('Stop Motion A4 Frames');
  pdfDoc.setCreator('Stop Motion Studio');

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const page = pdfDoc.addPage([A4_LANDSCAPE.width, A4_LANDSCAPE.height]);
    drawRegistrationMarks(page, A4_LANDSCAPE.width, A4_LANDSCAPE.height);

    for (const [slotIndex, slot] of slots.entries()) {
      const frameIndex = pageIndex * slots.length + slotIndex;
      const frame = frames[frameIndex];
      if (!frame) continue;

      const image = await embedFrameImage(pdfDoc, frame);
      drawPrintableFrame(page, slot, image, frameIndex + 1, boldFont);
      setProgress(ui.printProgress, Math.max(6, Math.round(((frameIndex + 1) / frames.length) * 88)));
    }
  }

  setStatus(ui.printStatus, 'Saving PDF...');
  setProgress(ui.printProgress, 94);
  const bytes = await pdfDoc.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

async function embedFrameImage(pdfDoc, frame) {
  const extension = frame.ext === 'jpeg' ? 'jpg' : frame.ext;

  try {
    if (extension === 'jpg') {
      return await pdfDoc.embedJpg(frame.bytes);
    }
    if (extension === 'png') {
      return await pdfDoc.embedPng(frame.bytes);
    }
  } catch {
    // Fall through to canvas rasterization for uncommon PNG/JPEG variants.
  }

  const pngBytes = await rasterizeImageToPng(frame.bytes, frame.mime);
  return pdfDoc.embedPng(pngBytes);
}

function drawPrintableFrame(page, slot, image, frameNumber, font) {
  const ink = rgb(0.13, 0.11, 0.1);
  const mutedInk = rgb(0.36, 0.31, 0.28);
  const fitted = fitInside(image.width, image.height, slot.cropBox.width, slot.cropBox.height);

  page.drawRectangle({
    x: slot.cropBox.x,
    y: slot.cropBox.y,
    width: slot.cropBox.width,
    height: slot.cropBox.height,
    color: rgb(1, 1, 1),
  });
  page.drawImage(image, {
    x: slot.cropBox.x + fitted.x,
    y: slot.cropBox.y + fitted.y,
    width: fitted.width,
    height: fitted.height,
  });
  page.drawRectangle({
    x: slot.frameBox.x,
    y: slot.frameBox.y,
    width: slot.frameBox.width,
    height: slot.frameBox.height,
    borderColor: ink,
    borderWidth: PDF_FRAME_BORDER_WIDTH,
  });
  drawCropMarks(page, slot.frameBox, ink);
  page.drawRectangle({
    x: slot.markerBox.x,
    y: slot.markerBox.y,
    width: slot.markerBox.width,
    height: slot.markerBox.height,
    color: ink,
  });
  page.drawText(`Frame ${String(frameNumber).padStart(4, '0')}`, {
    x: slot.labelX,
    y: slot.labelY,
    size: 8.5,
    font,
    color: mutedInk,
  });
}

function drawCropMarks(page, box, color) {
  const markLength = 10;
  const gap = 4;
  const thickness = 0.8;
  const corners = [
    { x: box.x, y: box.y, xDir: -1, yDir: -1 },
    { x: box.x + box.width, y: box.y, xDir: 1, yDir: -1 },
    { x: box.x, y: box.y + box.height, xDir: -1, yDir: 1 },
    { x: box.x + box.width, y: box.y + box.height, xDir: 1, yDir: 1 },
  ];

  for (const corner of corners) {
    page.drawLine({
      start: { x: corner.x + gap * corner.xDir, y: corner.y },
      end: { x: corner.x + (gap + markLength) * corner.xDir, y: corner.y },
      thickness,
      color,
    });
    page.drawLine({
      start: { x: corner.x, y: corner.y + gap * corner.yDir },
      end: { x: corner.x, y: corner.y + (gap + markLength) * corner.yDir },
      thickness,
      color,
    });
  }
}

function drawRegistrationMarks(page, pageWidth, pageHeight) {
  const color = rgb(0.13, 0.11, 0.1);
  const length = 18;
  const inset = 12;
  const thickness = 1;
  const corners = [
    { x: inset, y: inset, xDir: 1, yDir: 1 },
    { x: pageWidth - inset, y: inset, xDir: -1, yDir: 1 },
    { x: inset, y: pageHeight - inset, xDir: 1, yDir: -1 },
    { x: pageWidth - inset, y: pageHeight - inset, xDir: -1, yDir: -1 },
  ];

  for (const corner of corners) {
    page.drawLine({
      start: { x: corner.x, y: corner.y },
      end: { x: corner.x + length * corner.xDir, y: corner.y },
      thickness,
      color,
    });
    page.drawLine({
      start: { x: corner.x, y: corner.y },
      end: { x: corner.x, y: corner.y + length * corner.yDir },
      thickness,
      color,
    });
  }
}

async function recoverFramesFromPdf(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const frameFiles = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      setStatus(ui.scanStatus, `Scanning page ${pageNumber} of ${pdf.numPages}...`);
      const page = await pdf.getPage(pageNumber);
      const unitViewport = page.getViewport({ scale: 1 });
      const renderViewport = page.getViewport({ scale: PDF_RENDER_SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(renderViewport.width);
      canvas.height = Math.ceil(renderViewport.height);
      const context = canvas.getContext('2d', { willReadFrequently: true });

      if (!context) {
        throw new Error('This browser could not prepare a PDF canvas.');
      }

      await page.render({ canvasContext: context, viewport: renderViewport }).promise;

      const slots = getPrintSlots(unitViewport.width, unitViewport.height);
      for (const slot of slots) {
        const markerBox = pdfBoxToCanvasBox(slot.markerBox, canvas, unitViewport);
        if (!hasFrameMarker(context, markerBox)) continue;

        const cropBox = pdfBoxToCanvasBox(slot.cropBox, canvas, unitViewport);
        const bytes = await cropCanvasToPng(canvas, cropBox);
        frameFiles.push({
          name: `frame_${String(frameFiles.length + 1).padStart(6, '0')}.png`,
          bytes,
        });
      }

      page.cleanup();
      canvas.width = 0;
      canvas.height = 0;
      setProgress(ui.scanProgress, Math.max(6, Math.round((pageNumber / pdf.numPages) * 80)));
    }

    if (!frameFiles.length) {
      throw new Error('No generated frame markers were found in that PDF.');
    }

    return frameFiles;
  } finally {
    await pdf.destroy();
  }
}

function getPrintSlots(pageWidth, pageHeight) {
  const scaleX = pageWidth / A4_LANDSCAPE.width;
  const scaleY = pageHeight / A4_LANDSCAPE.height;
  const marginX = PDF_MARGIN * scaleX;
  const marginY = PDF_MARGIN * scaleY;
  const gutterX = PDF_GUTTER * scaleX;
  const gutterY = PDF_GUTTER * scaleY;
  const paddingX = PDF_CELL_PADDING * scaleX;
  const paddingY = PDF_CELL_PADDING * scaleY;
  const labelHeight = PDF_LABEL_HEIGHT * scaleY;
  const cropInsetX = PDF_CROP_INSET * scaleX;
  const cropInsetY = PDF_CROP_INSET * scaleY;
  const markerSize = PDF_MARKER_SIZE * Math.min(scaleX, scaleY);
  const cellWidth = (pageWidth - marginX * 2 - gutterX * (PDF_GRID.columns - 1)) / PDF_GRID.columns;
  const cellHeight = (pageHeight - marginY * 2 - gutterY * (PDF_GRID.rows - 1)) / PDF_GRID.rows;
  const frameAspectInUnits = PDF_FRAME_ASPECT_RATIO * (scaleX / scaleY);
  const slots = [];

  for (let row = 0; row < PDF_GRID.rows; row += 1) {
    const cellTop = pageHeight - marginY - row * (cellHeight + gutterY);
    const cellY = cellTop - cellHeight;

    for (let column = 0; column < PDF_GRID.columns; column += 1) {
      const cellX = marginX + column * (cellWidth + gutterX);
      const maxFrameWidth = cellWidth - paddingX * 2;
      const maxFrameHeight = cellHeight - labelHeight - paddingY * 2;
      let frameWidth = maxFrameWidth;
      let frameHeight = frameWidth / frameAspectInUnits;

      if (frameHeight > maxFrameHeight) {
        frameHeight = maxFrameHeight;
        frameWidth = frameHeight * frameAspectInUnits;
      }

      const frameX = cellX + (cellWidth - frameWidth) / 2;
      const frameY = cellY + labelHeight + paddingY + (maxFrameHeight - frameHeight) / 2;

      slots.push({
        frameBox: { x: frameX, y: frameY, width: frameWidth, height: frameHeight },
        cropBox: {
          x: frameX + cropInsetX,
          y: frameY + cropInsetY,
          width: frameWidth - cropInsetX * 2,
          height: frameHeight - cropInsetY * 2,
        },
        markerBox: {
          x: frameX,
          y: cellY + paddingY * 0.45,
          width: markerSize,
          height: markerSize,
        },
        labelX: frameX + markerSize + 6 * scaleX,
        labelY: cellY + paddingY * 0.35,
      });
    }
  }

  return slots;
}

function pdfBoxToCanvasBox(box, canvas, unitViewport) {
  const scaleX = canvas.width / unitViewport.width;
  const scaleY = canvas.height / unitViewport.height;

  return {
    x: box.x * scaleX,
    y: canvas.height - (box.y + box.height) * scaleY,
    width: box.width * scaleX,
    height: box.height * scaleY,
  };
}

function hasFrameMarker(context, box) {
  const sample = expandCanvasBox(box, 3);
  const x = Math.max(0, Math.floor(sample.x));
  const y = Math.max(0, Math.floor(sample.y));
  const width = Math.min(context.canvas.width - x, Math.ceil(sample.width));
  const height = Math.min(context.canvas.height - y, Math.ceil(sample.height));

  if (width <= 0 || height <= 0) return false;

  const data = context.getImageData(x, y, width, height).data;
  let darkPixels = 0;
  const totalPixels = width * height;

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    if (alpha < 120) continue;
    const luminance = data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
    if (luminance < 95) darkPixels += 1;
  }

  return darkPixels / totalPixels > 0.12;
}

async function cropCanvasToPng(sourceCanvas, box) {
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const width = Math.min(sourceCanvas.width - x, Math.floor(box.width));
  const height = Math.min(sourceCanvas.height - y, Math.floor(box.height));

  if (width <= 0 || height <= 0) {
    throw new Error('A scanned frame could not be cropped.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('This browser could not prepare a frame canvas.');
  }

  context.drawImage(sourceCanvas, x, y, width, height, 0, 0, width, height);
  const blob = await canvasToBlob(canvas, 'image/png');
  canvas.width = 0;
  canvas.height = 0;
  return new Uint8Array(await blob.arrayBuffer());
}

async function rasterizeImageToPng(bytes, mime) {
  const image = await loadImageFromBytes(bytes, mime);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('This browser could not prepare an image canvas.');
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  const blob = await canvasToBlob(canvas, 'image/png');
  canvas.width = 0;
  canvas.height = 0;
  return new Uint8Array(await blob.arrayBuffer());
}

function loadImageFromBytes(bytes, mime) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('An image frame could not be read.'));
    };

    image.src = url;
  });
}

function canvasToBlob(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error('This browser could not export a canvas image.'));
    }, type);
  });
}

function fitInside(sourceWidth, sourceHeight, maxWidth, maxHeight) {
  const ratio = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
  const width = sourceWidth * ratio;
  const height = sourceHeight * ratio;

  return {
    x: (maxWidth - width) / 2,
    y: (maxHeight - height) / 2,
    width,
    height,
  };
}

function expandCanvasBox(box, amount) {
  return {
    x: box.x - amount,
    y: box.y - amount,
    width: box.width + amount * 2,
    height: box.height + amount * 2,
  };
}

async function compileFrames(ffmpeg, frames, fps, outputSize) {
  const jobId = createJobId('compile');
  const listName = `${jobId}_frames.txt`;
  const outputName = `${jobId}_output.mp4`;
  const cleanup = [listName, outputName];
  const duration = (1 / fps).toFixed(8);

  try {
    for (const [index, frame] of frames.entries()) {
      const extension = frame.ext === 'jpeg' ? 'jpg' : frame.ext;
      const safeName = `${jobId}_frame_${String(index + 1).padStart(6, '0')}.${extension}`;
      frame.safeName = safeName;
      cleanup.push(safeName);
      await ffmpeg.writeFile(safeName, frame.bytes);
      setProgress(ui.compileProgress, Math.max(5, Math.round(((index + 1) / frames.length) * 28)));
    }

    const concatList = buildConcatList(frames.map((frame) => frame.safeName), duration);
    await ffmpeg.writeFile(listName, new TextEncoder().encode(concatList));

    const commonArgs = [
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listName,
      '-vf',
      `scale=${outputSize.width}:${outputSize.height}:force_original_aspect_ratio=decrease,pad=${outputSize.width}:${outputSize.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
      '-r',
      String(fps),
      '-an',
      '-movflags',
      'faststart',
    ];

    try {
      await runFfmpeg(ffmpeg, [...commonArgs, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', outputName]);
    } catch (error) {
      await deleteFileIfExists(ffmpeg, outputName);
      await runFfmpeg(ffmpeg, [...commonArgs, '-c:v', 'mpeg4', '-q:v', '4', outputName]);
    }

    const data = await ffmpeg.readFile(outputName);
    return new Blob([data], { type: 'video/mp4' });
  } finally {
    await cleanupFiles(ffmpeg, cleanup);
  }
}

async function runFfmpeg(ffmpeg, args) {
  const exitCode = await ffmpeg.exec(args);
  if (exitCode !== 0) {
    throw new Error(`FFmpeg exited with code ${exitCode}.`);
  }
}

function buildConcatList(fileNames, duration) {
  const lines = ['ffconcat version 1.0'];
  for (const name of fileNames) {
    lines.push(`file '${name}'`);
    lines.push(`duration ${duration}`);
  }
  lines.push(`file '${fileNames[fileNames.length - 1]}'`);
  return `${lines.join('\n')}\n`;
}

function getImageSize(bytes, mime) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const image = new Image();

    image.onload = () => {
      const size = { width: image.naturalWidth, height: image.naturalHeight };
      URL.revokeObjectURL(url);
      if (!size.width || !size.height) {
        reject(new Error('The first image frame could not be measured.'));
        return;
      }
      resolve(size);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The first image frame could not be read.'));
    };

    image.src = url;
  });
}

function fitEvenSize(width, height) {
  const ratio = Math.min(1, MAX_OUTPUT_WIDTH / width, MAX_OUTPUT_HEIGHT / height);
  const fittedWidth = Math.max(2, Math.floor((width * ratio) / 2) * 2);
  const fittedHeight = Math.max(2, Math.floor((height * ratio) / 2) * 2);

  return {
    width: fittedWidth,
    height: fittedHeight,
  };
}

function parseFps(value) {
  const fps = Number(value);
  if (!Number.isInteger(fps) || fps < 1) return null;
  return fps;
}

function setControlsDisabled(disabled) {
  for (const element of [
    ui.extractSubmit,
    ui.printSubmit,
    ui.scanSubmit,
    ui.compileSubmit,
    ui.videoInput,
    ui.printZipInput,
    ui.scanPdfInput,
    ui.zipInput,
    ui.extractFps,
    ui.compileFps,
  ]) {
    element.disabled = disabled;
  }
}

function setStatus(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle('is-error', isError);
}

function setProgress(element, value) {
  element.style.inlineSize = `${Math.max(0, Math.min(100, value))}%`;
}

function replaceObjectUrl(previousUrl, blob) {
  if (previousUrl) URL.revokeObjectURL(previousUrl);
  return URL.createObjectURL(blob);
}

function clearDownload(type) {
  if (type === 'frames') {
    if (state.framesUrl) URL.revokeObjectURL(state.framesUrl);
    state.framesUrl = null;
    ui.framesDownload.classList.add('is-hidden');
    ui.framesDownload.removeAttribute('href');
    return;
  }

  if (type === 'pdf') {
    if (state.pdfUrl) URL.revokeObjectURL(state.pdfUrl);
    state.pdfUrl = null;
    ui.pdfDownload.classList.add('is-hidden');
    ui.pdfDownload.removeAttribute('href');
    return;
  }

  if (type === 'scan') {
    if (state.scannedFramesUrl) URL.revokeObjectURL(state.scannedFramesUrl);
    state.scannedFramesUrl = null;
    ui.scanDownload.classList.add('is-hidden');
    ui.scanDownload.removeAttribute('href');
    return;
  }

  if (state.mp4Url) URL.revokeObjectURL(state.mp4Url);
  state.mp4Url = null;
  ui.mp4Download.classList.add('is-hidden');
  ui.mp4Download.removeAttribute('href');
  ui.videoPreview.removeAttribute('src');
  ui.videoPreview.load();
  ui.videoPreview.classList.add('is-hidden');
}

async function cleanupFiles(ffmpeg, names) {
  await Promise.all([...new Set(names)].map((name) => deleteFileIfExists(ffmpeg, name)));
}

async function deleteFileIfExists(ffmpeg, name) {
  try {
    await ffmpeg.deleteFile(name);
  } catch {
    // Best-effort cleanup keeps the in-browser FFmpeg filesystem from growing between jobs.
  }
}

function createJobId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function cleanBaseName(name) {
  return name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'stop-motion';
}

function fileExtension(name) {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

function imageMime(extension) {
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  return 'image/png';
}

function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function friendlyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/SharedArrayBuffer|cross-origin/i.test(message)) {
    return 'This browser blocked the video engine. Try a current Chrome, Edge, or Firefox browser.';
  }
  if (/memory|allocation/i.test(message)) {
    return 'That file is too large for this browser session.';
  }
  return message || 'Something went wrong.';
}

ui.extractFps.value = DEFAULT_FPS;
ui.compileFps.value = DEFAULT_FPS;
