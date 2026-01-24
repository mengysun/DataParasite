# JSONL-Parasite Curation Helper

A Chrome Extension for side-by-side curation of JSONL datasets. It allows you to load a JSONL file, navigate URLs/citations in the main browser window, and annotate the correctness of fields.

## Features
- **Side-by-Side View**: Uses Chrome's Side Panel API.
- **JSONL Support**: Load `.jsonl` files (newline-delimited JSON).
- **Annotation**: Mark fields as Correct/Incorrect and add comments.
- **Smart Linking**: Click on Markdown links `[label](url)` or plain URLs to open them in the main window.
- **Export**: Save annotated data back to `{original}_annotated.jsonl`.

## Development / Installation

### 1. Prerequisites
- Node.js (v14+)
- npm

### 2. Setup
```bash
# Navigate to this directory
cd eval_apps/jsonl_extension

# Install dependencies
npm install
```

### 3. Build
```bash
# Build the extension (generates 'dist' folder)
npm run build
```

### 4. Load in Chrome
1.  Open Chrome and go to `chrome://extensions`.
2.  Enable **Developer mode** (top right).
3.  Click **Load unpacked**.
4.  Select the `dist` folder inside this directory (`eval_apps/jsonl_extension/dist`).

## Usage
1.  Click the extension icon to open the side panel.
2.  Load a `.jsonl` file from your disk.
3.  Verify and annotate entries.
4.  Click **Save** to download the results.
