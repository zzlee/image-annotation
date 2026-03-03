# Image Annotation Tool

A lightweight FastAPI + vanilla JavaScript app for bounding-box annotation.

## Features

- Upload/capture images
- Draw, select, move, resize, and delete bounding boxes
- Multi-object annotation per image
  - Each object has its own `class_name` and `class_id`
- Annotation history grid with thumbnail overlays
  - Bounding boxes rendered directly on thumbnails
- Delete images
  - Single delete
  - Bulk delete (multi-select)
- Export dataset to YOLO format as a ZIP file

## Tech Stack

- Backend: FastAPI, SQLite
- Frontend: HTML/CSS/JavaScript (no framework)
- Runtime: Python 3.13+

## Project Structure

- `main.py`: API server + DB initialization/migration
- `static/index.html`: UI layout
- `static/style.css`: UI styles
- `static/script.js`: frontend logic
- `uploads/`: uploaded images
- `annotations.db`: SQLite database

## Setup

### 1. Install dependencies

Using `uv` (recommended):

```bash
uv sync
```

Or with pip:

```bash
pip install fastapi uvicorn python-multipart
```

### 2. Run the server

Using `uv`:

```bash
uv run python main.py
```

Or directly:

```bash
python3 main.py
```

### 3. Open in browser

- `http://localhost:8000`

## Database Notes

On startup, `init_db()` creates/migrates tables:

- `images`
- `annotations`

`annotations` includes:

- `annotation_uuid` (stable object id)
- `class_name`, `class_id`
- normalized bounding box fields: `bbox_x`, `bbox_y`, `bbox_w`, `bbox_h`
- ordering/metadata: `sort_order`, `created_at`, `updated_at`

## YOLO Export

Use **Export YOLO** in the history section (or call API endpoint below).

Generated ZIP includes:

- `images/` -> all image files
- `labels/` -> one `.txt` per image
- `data.yaml`

YOLO label line format:

```text
<class_id> <x_center> <y_center> <width> <height>
```

All coordinates are normalized to `[0, 1]`.

## API Endpoints

- `POST /upload`
  - Upload an image file
- `POST /annotate`
  - Save annotations for one image (replaces existing annotations for that image)
- `GET /images`
  - List images and annotations
- `DELETE /images/{image_uuid}`
  - Delete one image + related annotations + file
- `POST /images/delete`
  - Bulk delete images by UUID list
- `GET /export/yolo`
  - Export all images/annotations as YOLO ZIP

## Known Behavior

- Saving annotations for an image replaces all its prior annotations.
- If an image file is missing on disk, YOLO export skips copying that image file.
