# Stop Motion Studio

A simple static website for making stop motion assets in the browser.

## Features

- Extract PNG frames from an uploaded video at a chosen FPS.
- Download extracted frames as a ZIP.
- Upload a ZIP of image frames and compile them into an MP4 at a chosen FPS.
- Runs locally in the browser with FFmpeg.wasm and JSZip. Files are not uploaded to a server.

## Local Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

The production files are written to `dist/`.

## GitHub Pages

This repo includes a GitHub Actions workflow at `.github/workflows/deploy.yml`.

1. Push the repo to GitHub.
2. In repository settings, enable GitHub Pages with **GitHub Actions** as the source.
3. Push to `main`; the workflow builds and deploys the static site.

## Notes

Video processing happens in the browser, so large files may take a while or hit memory limits depending on the device.
