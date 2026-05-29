import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import JSZip from 'jszip';
import { createIcons, Clapperboard, Download, FileArchive, FileVideo, Film, Images, Scissors, Video } from 'lucide';
import './styles.css';

const CORE_BASE_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
const DEFAULT_FPS = 12;
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const MAX_OUTPUT_WIDTH = 1920;
const MAX_OUTPUT_HEIGHT = 1080;

const state = {
  busy: false,
  ffmpeg: null,
  ffmpegReady: false,
  activeStatus: null,
  activeProgress: null,
  framesUrl: null,
  mp4Url: null,
};

const ui = {
  extractForm: document.querySelector('#extract-form'),
  compileForm: document.querySelector('#compile-form'),
  videoInput: document.querySelector('#video-input'),
  zipInput: document.querySelector('#zip-input'),
  extractFps: document.querySelector('#extract-fps'),
  compileFps: document.querySelector('#compile-fps'),
  videoFileName: document.querySelector('#video-file-name'),
  zipFileName: document.querySelector('#zip-file-name'),
  extractSubmit: document.querySelector('#extract-submit'),
  compileSubmit: document.querySelector('#compile-submit'),
  extractStatus: document.querySelector('#extract-status'),
  compileStatus: document.querySelector('#compile-status'),
  extractProgress: document.querySelector('#extract-progress'),
  compileProgress: document.querySelector('#compile-progress'),
  framesDownload: document.querySelector('#frames-download'),
  mp4Download: document.querySelector('#mp4-download'),
  videoPreview: document.querySelector('#video-preview'),
};

createIcons({
  icons: {
    Clapperboard,
    Download,
    FileArchive,
    FileVideo,
    Film,
    Images,
    Scissors,
    Video,
  },
});

ui.videoInput.addEventListener('change', () => {
  ui.videoFileName.textContent = ui.videoInput.files?.[0]?.name || 'Choose video';
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
    const zipBlob = await buildFramesZip(frameFiles);

    state.framesUrl = replaceObjectUrl(state.framesUrl, zipBlob);
    ui.framesDownload.href = state.framesUrl;
    ui.framesDownload.download = `${cleanBaseName(file.name)}-frames.zip`;
    ui.framesDownload.classList.remove('is-hidden');
    setProgress(ui.extractProgress, 100);
    setStatus(ui.extractStatus, `${frameFiles.length} frame${frameFiles.length === 1 ? '' : 's'} ready.`);
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

async function buildFramesZip(frameFiles) {
  const zip = new JSZip();

  for (const frame of frameFiles) {
    zip.file(frame.name, frame.bytes);
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }, (metadata) => {
    const progress = 50 + Math.round(metadata.percent / 2);
    setProgress(ui.extractProgress, progress);
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
  for (const element of [ui.extractSubmit, ui.compileSubmit, ui.videoInput, ui.zipInput, ui.extractFps, ui.compileFps]) {
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
