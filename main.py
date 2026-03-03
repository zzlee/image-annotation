import os
import sqlite3
import shutil
import tempfile
import uuid
import zipfile
from datetime import datetime
from typing import List, Optional
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel

app = FastAPI()

# Configuration
UPLOAD_DIR = "uploads"
DB_PATH = "annotations.db"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Database Setup
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS images (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT UNIQUE,
                filename TEXT,
                path TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS annotations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                image_id INTEGER,
                annotation_uuid TEXT UNIQUE,
                class_name TEXT,
                class_id INTEGER,
                bbox_x REAL,
                bbox_y REAL,
                bbox_w REAL,
                bbox_h REAL,
                sort_order INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (image_id) REFERENCES images (id)
            )
        """)
        columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(annotations)").fetchall()
        }
        if "annotation_uuid" not in columns:
            conn.execute("ALTER TABLE annotations ADD COLUMN annotation_uuid TEXT")
        if "sort_order" not in columns:
            conn.execute("ALTER TABLE annotations ADD COLUMN sort_order INTEGER DEFAULT 0")
        if "created_at" not in columns:
            conn.execute(
                "ALTER TABLE annotations ADD COLUMN created_at TIMESTAMP"
            )
        if "updated_at" not in columns:
            conn.execute(
                "ALTER TABLE annotations ADD COLUMN updated_at TIMESTAMP"
            )

        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_annotations_uuid ON annotations(annotation_uuid)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_annotations_image_order ON annotations(image_id, sort_order)"
        )

        rows = conn.execute(
            "SELECT id FROM annotations WHERE annotation_uuid IS NULL OR annotation_uuid = ''"
        ).fetchall()
        for row in rows:
            conn.execute(
                "UPDATE annotations SET annotation_uuid = ? WHERE id = ?",
                (str(uuid.uuid4()), row["id"]),
            )

        conn.execute(
            """
            UPDATE annotations
            SET class_name = COALESCE(NULLIF(class_name, ''), 'Unknown'),
                class_id = COALESCE(class_id, 0),
                sort_order = COALESCE(sort_order, id),
                updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP),
                created_at = COALESCE(created_at, CURRENT_TIMESTAMP)
            """
        )
    print("Database initialized.")

init_db()

# Models
class BoundingBox(BaseModel):
    annotation_uuid: Optional[str] = None
    class_name: str = "Unknown"
    class_id: int = 0
    bbox_x: float
    bbox_y: float
    bbox_w: float
    bbox_h: float

class AnnotationUpdate(BaseModel):
    image_uuid: str
    annotations: List[BoundingBox]

class ImageDeleteRequest(BaseModel):
    image_uuids: List[str]

# API Endpoints
@app.post("/upload")
async def upload_image(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename)[1]
    image_uuid = str(uuid.uuid4())
    filename = f"{image_uuid}{ext}"
    file_path = os.path.join(UPLOAD_DIR, filename)
    
    with open(file_path, "wb") as f:
        f.write(await file.read())
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO images (uuid, filename, path) VALUES (?, ?, ?)",
            (image_uuid, filename, file_path)
        )
        image_id = cursor.lastrowid
        conn.commit()
    
    return {"image_uuid": image_uuid, "id": image_id}

@app.post("/annotate")
async def save_annotations(data: AnnotationUpdate):
    with get_db() as conn:
        cursor = conn.cursor()
        # Get image ID
        cursor.execute("SELECT id FROM images WHERE uuid = ?", (data.image_uuid,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Image not found")
        image_id = row['id']
        
        # Clear existing annotations for this image
        cursor.execute("DELETE FROM annotations WHERE image_id = ?", (image_id,))
        
        # Insert new annotations
        for sort_order, bbox in enumerate(data.annotations):
            annotation_uuid = bbox.annotation_uuid or str(uuid.uuid4())
            cursor.execute("""
                INSERT INTO annotations (
                    image_id, annotation_uuid, class_name, class_id,
                    bbox_x, bbox_y, bbox_w, bbox_h, sort_order, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """, (
                image_id,
                annotation_uuid,
                bbox.class_name or "Unknown",
                bbox.class_id,
                bbox.bbox_x,
                bbox.bbox_y,
                bbox.bbox_w,
                bbox.bbox_h,
                sort_order,
            ))
        
        conn.commit()
    return {"status": "success"}

@app.get("/images")
async def get_images():
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM images ORDER BY created_at DESC")
        images = [dict(row) for row in cursor.fetchall()]
        
        for img in images:
            cursor.execute(
                "SELECT * FROM annotations WHERE image_id = ? ORDER BY sort_order ASC, id ASC",
                (img['id'],),
            )
            img['annotations'] = [dict(row) for row in cursor.fetchall()]
            
    return images

@app.delete("/images/{image_uuid}")
async def delete_image(image_uuid: str):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, path FROM images WHERE uuid = ?", (image_uuid,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Image not found")

        image_id = row["id"]
        image_path = row["path"]
        cursor.execute("DELETE FROM annotations WHERE image_id = ?", (image_id,))
        cursor.execute("DELETE FROM images WHERE id = ?", (image_id,))
        conn.commit()

    if image_path and os.path.exists(image_path):
        os.remove(image_path)

    return {"status": "success", "deleted": 1}

@app.post("/images/delete")
async def delete_images(data: ImageDeleteRequest):
    unique_uuids = list(dict.fromkeys([uuid for uuid in data.image_uuids if uuid]))
    if not unique_uuids:
        return {"status": "success", "deleted": 0}

    with get_db() as conn:
        cursor = conn.cursor()
        placeholders = ",".join("?" for _ in unique_uuids)
        cursor.execute(
            f"SELECT id, path, uuid FROM images WHERE uuid IN ({placeholders})",
            unique_uuids,
        )
        rows = cursor.fetchall()

        if not rows:
            return {"status": "success", "deleted": 0}

        image_ids = [row["id"] for row in rows]
        id_placeholders = ",".join("?" for _ in image_ids)
        cursor.execute(
            f"DELETE FROM annotations WHERE image_id IN ({id_placeholders})",
            image_ids,
        )
        cursor.execute(
            f"DELETE FROM images WHERE id IN ({id_placeholders})",
            image_ids,
        )
        conn.commit()

    for row in rows:
        image_path = row["path"]
        if image_path and os.path.exists(image_path):
            os.remove(image_path)

    return {"status": "success", "deleted": len(rows)}

@app.get("/export/yolo")
async def export_yolo():
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, uuid, filename, path FROM images ORDER BY created_at DESC")
        images = [dict(row) for row in cursor.fetchall()]
        if not images:
            raise HTTPException(status_code=404, detail="No images to export")

        cursor.execute(
            """
            SELECT image_id, class_id, class_name, bbox_x, bbox_y, bbox_w, bbox_h
            FROM annotations
            ORDER BY image_id ASC, sort_order ASC, id ASC
            """
        )
        annotation_rows = [dict(row) for row in cursor.fetchall()]

    annotations_by_image = {}
    class_map = {}
    max_class_id = 0
    for ann in annotation_rows:
        image_id = ann["image_id"]
        annotations_by_image.setdefault(image_id, []).append(ann)
        class_id = int(ann["class_id"] or 0)
        max_class_id = max(max_class_id, class_id)
        class_map.setdefault(class_id, ann["class_name"] or f"class_{class_id}")

    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    export_zip_path = os.path.join(tempfile.gettempdir(), f"yolo_export_{timestamp}.zip")
    export_root = tempfile.mkdtemp(prefix="yolo_export_")
    images_dir = os.path.join(export_root, "images")
    labels_dir = os.path.join(export_root, "labels")
    os.makedirs(images_dir, exist_ok=True)
    os.makedirs(labels_dir, exist_ok=True)

    for img in images:
        image_path = img["path"] or os.path.join(UPLOAD_DIR, img["filename"])
        if not os.path.exists(image_path):
            continue

        target_image = os.path.join(images_dir, img["filename"])
        shutil.copy2(image_path, target_image)

        label_name = f"{os.path.splitext(img['filename'])[0]}.txt"
        label_path = os.path.join(labels_dir, label_name)
        lines = []
        for ann in annotations_by_image.get(img["id"], []):
            class_id = int(ann["class_id"] or 0)
            x = float(ann["bbox_x"] or 0.0)
            y = float(ann["bbox_y"] or 0.0)
            w = float(ann["bbox_w"] or 0.0)
            h = float(ann["bbox_h"] or 0.0)
            x_center = x + (w / 2.0)
            y_center = y + (h / 2.0)
            lines.append(
                f"{class_id} {x_center:.6f} {y_center:.6f} {w:.6f} {h:.6f}"
            )

        with open(label_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))

    names = []
    for class_id in range(max_class_id + 1):
        names.append(class_map.get(class_id, f"class_{class_id}"))
    data_yaml = os.path.join(export_root, "data.yaml")
    with open(data_yaml, "w", encoding="utf-8") as f:
        f.write("path: .\n")
        f.write("train: images\n")
        f.write("val: images\n")
        f.write(f"nc: {len(names)}\n")
        f.write("names:\n")
        for name in names:
            f.write(f"  - {name}\n")

    with zipfile.ZipFile(export_zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(export_root):
            for file_name in files:
                full_path = os.path.join(root, file_name)
                rel_path = os.path.relpath(full_path, export_root)
                zf.write(full_path, rel_path)

    shutil.rmtree(export_root, ignore_errors=True)

    return FileResponse(
        export_zip_path,
        media_type="application/zip",
        filename=f"yolo_export_{timestamp}.zip",
    )

# Static Files
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def index():
    try:
        with open("static/index.html", "r") as f:
            return HTMLResponse(content=f.read())
    except FileNotFoundError:
        return HTMLResponse(content="Frontend not found. Please wait while I create it.")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
