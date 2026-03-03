const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const cameraInput = document.getElementById('cameraInput');
const batchUploadInput = document.getElementById('batchUploadInput');
const captureBtn = document.getElementById('captureBtn');
const batchUploadBtn = document.getElementById('batchUploadBtn');
const saveBtn = document.getElementById('saveBtn');
const cancelBtn = document.getElementById('cancelBtn');
const clearAllBtn = document.getElementById('clearAllBtn');
const drawModeBtn = document.getElementById('drawModeBtn');
const selectModeBtn = document.getElementById('selectModeBtn');
const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
const activeTagSelect = document.getElementById('activeTagSelect');
const tagModal = document.getElementById('tagModal');
const openTagModalBtn = document.getElementById('openTagModalBtn');
const closeTagModalBtn = document.getElementById('closeTagModalBtn');
const newTagInput = document.getElementById('newTagInput');
const renameTagInput = document.getElementById('renameTagInput');
const addTagBtn = document.getElementById('addTagBtn');
const renameTagBtn = document.getElementById('renameTagBtn');
const deleteTagBtn = document.getElementById('deleteTagBtn');
const boxList = document.getElementById('boxList');
const boxCountBadge = document.getElementById('boxCountBadge');
const selectedBadge = document.getElementById('selectedBadge');
const editorHint = document.getElementById('editorHint');
const historyCount = document.getElementById('historyCount');
const historySelected = document.getElementById('historySelected');
const selectAllImages = document.getElementById('selectAllImages');
const deleteSelectedImagesBtn = document.getElementById('deleteSelectedImagesBtn');
const exportYoloBtn = document.getElementById('exportYoloBtn');
const editor = document.getElementById('editor');
const imageList = document.getElementById('imageList');

const HANDLE_RADIUS = 7;
const MIN_BOX_SIZE_PX = 8;

let currentImage = null;
let currentImageUuid = null;
let annotations = [];
let tags = [];
let mode = 'draw';
let selectedBoxIndex = -1;
let interaction = null;
let historyImages = [];
let selectedImageUuids = new Set();

captureBtn.onclick = () => cameraInput.click();
batchUploadBtn.onclick = () => batchUploadInput.click();
cameraInput.onchange = handleCaptureUpload;
batchUploadInput.onchange = handleBatchUpload;
saveBtn.onclick = saveAnnotations;
cancelBtn.onclick = closeEditor;
clearAllBtn.onclick = clearAllBoxes;
drawModeBtn.onclick = () => setMode('draw');
selectModeBtn.onclick = () => setMode('select');
deleteSelectedBtn.onclick = () => deleteBox(selectedBoxIndex);
deleteSelectedImagesBtn.onclick = deleteSelectedImages;
exportYoloBtn.onclick = exportYoloDataset;
addTagBtn.onclick = addTag;
renameTagBtn.onclick = renameActiveTag;
deleteTagBtn.onclick = deleteActiveTag;
openTagModalBtn.onclick = openTagModal;
closeTagModalBtn.onclick = closeTagModal;

tagModal.addEventListener('click', (e) => {
    if (e.target.matches('[data-close-tag-modal=\"true\"]')) {
        closeTagModal();
    }
});

activeTagSelect.onchange = () => {
    const tag = getActiveTag();
    renameTagInput.value = tag ? tag.name : '';
};

selectAllImages.onchange = () => {
    if (selectAllImages.checked) {
        historyImages.forEach((img) => selectedImageUuids.add(img.uuid));
    } else {
        selectedImageUuids.clear();
    }
    updateHistorySelectionUI();
    renderHistoryGrid();
};

canvas.addEventListener('mousedown', onPointerDown);
canvas.addEventListener('mousemove', onPointerMove);
canvas.addEventListener('mouseup', onPointerUp);
canvas.addEventListener('mouseleave', onPointerUp);
canvas.addEventListener('touchstart', onPointerDown, { passive: false });
canvas.addEventListener('touchmove', onPointerMove, { passive: false });
canvas.addEventListener('touchend', onPointerUp, { passive: false });
canvas.addEventListener('touchcancel', onPointerUp, { passive: false });

window.addEventListener('resize', () => {
    if (currentImage && !editor.classList.contains('hidden')) {
        setupCanvas();
    }
});

document.addEventListener('keydown', (e) => {
    if (!tagModal.classList.contains('hidden') && e.key === 'Escape') {
        closeTagModal();
        return;
    }
    if (editor.classList.contains('hidden')) {
        return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedBoxIndex >= 0) {
        e.preventDefault();
        deleteBox(selectedBoxIndex);
    }
});

boxList.addEventListener('click', (e) => {
    const selectButton = e.target.closest('[data-select-index]');
    if (selectButton) {
        selectBox(Number.parseInt(selectButton.dataset.selectIndex, 10));
        setMode('select');
        return;
    }

    const deleteButton = e.target.closest('[data-delete-index]');
    if (deleteButton) {
        deleteBox(Number.parseInt(deleteButton.dataset.deleteIndex, 10));
    }
});

boxList.addEventListener('change', (e) => {
    const tagSelect = e.target.closest('[data-tag-index]');
    if (!tagSelect) {
        return;
    }

    const index = Number.parseInt(tagSelect.dataset.tagIndex, 10);
    const tagId = Number.parseInt(tagSelect.value, 10);
    if (Number.isNaN(index) || Number.isNaN(tagId) || !annotations[index]) {
        return;
    }

    const tag = getTagById(tagId);
    if (!tag) {
        return;
    }

    annotations[index].class_id = tag.id;
    annotations[index].class_name = tag.name;
    redraw();
});

function makeUuid() {
    if (window.crypto?.randomUUID) {
        return window.crypto.randomUUID();
    }
    return `obj-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function openTagModal() {
    const tag = getActiveTag();
    renameTagInput.value = tag ? tag.name : '';
    tagModal.classList.remove('hidden');
}

function closeTagModal() {
    tagModal.classList.add('hidden');
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function getTagById(tagId) {
    return tags.find((t) => t.id === tagId) || null;
}

function getActiveTag() {
    const id = Number.parseInt(activeTagSelect.value, 10);
    if (Number.isNaN(id)) {
        return null;
    }
    return getTagById(id);
}

function ensureTagLocally(tagId, tagName) {
    if (tagId == null) {
        return;
    }
    if (getTagById(tagId)) {
        return;
    }
    tags.push({ id: tagId, name: tagName || `Tag ${tagId}` });
    tags.sort((a, b) => a.id - b.id);
}

function renderActiveTagSelect(preferredTagId = null) {
    const currentValueId = Number.parseInt(activeTagSelect.value, 10);
    const selectedId = preferredTagId ?? (Number.isNaN(currentValueId) ? (tags[0] ? tags[0].id : null) : currentValueId);
    activeTagSelect.innerHTML = tags
        .map((tag) => `<option value="${tag.id}" ${tag.id === selectedId ? 'selected' : ''}>${escapeHtml(tag.name)} (#${tag.id})</option>`)
        .join('');
    activeTagSelect.disabled = tags.length === 0;
    addTagBtn.disabled = false;
    renameTagBtn.disabled = tags.length === 0;
    deleteTagBtn.disabled = tags.length === 0;

    const currentTag = getActiveTag();
    renameTagInput.value = currentTag ? currentTag.name : '';
}

function getTagOptionsHtml(selectedTagId) {
    if (tags.length === 0) {
        return '<option value="">No tags</option>';
    }

    return tags
        .map((tag) => `<option value="${tag.id}" ${tag.id === selectedTagId ? 'selected' : ''}>${escapeHtml(tag.name)} (#${tag.id})</option>`)
        .join('');
}

async function loadTags(preferredTagId = null) {
    const res = await fetch('/tags');
    if (!res.ok) {
        throw new Error('Failed to load tags');
    }
    tags = await res.json();
    renderActiveTagSelect(preferredTagId);
}

async function addTag() {
    const name = newTagInput.value.trim();
    if (!name) {
        alert('Tag name is required.');
        return;
    }

    const res = await fetch('/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    });

    if (!res.ok) {
        alert('Failed to create tag.');
        return;
    }

    const result = await res.json();
    await loadTags(result.id);
    newTagInput.value = '';
    refreshEditorState();
}

async function renameActiveTag() {
    const active = getActiveTag();
    if (!active) {
        alert('Select a tag first.');
        return;
    }

    const nextName = renameTagInput.value.trim();
    if (!nextName) {
        alert('New tag name is required.');
        return;
    }

    const res = await fetch(`/tags/${active.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nextName })
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Failed to rename tag.' }));
        alert(err.detail || 'Failed to rename tag.');
        return;
    }

    annotations.forEach((ann) => {
        if (ann.class_id === active.id) {
            ann.class_name = nextName;
        }
    });

    await loadTags(active.id);
    refreshEditorState();
    loadHistory();
}

async function deleteActiveTag() {
    const active = getActiveTag();
    if (!active) {
        return;
    }

    if (!confirm(`Delete tag "${active.name}" (#${active.id})?`)) {
        return;
    }

    const res = await fetch(`/tags/${active.id}`, { method: 'DELETE' });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Failed to delete tag.' }));
        alert(err.detail || 'Failed to delete tag.');
        return;
    }

    await loadTags();
    refreshEditorState();
}

function setMode(nextMode) {
    mode = nextMode;
    drawModeBtn.classList.toggle('active', mode === 'draw');
    selectModeBtn.classList.toggle('active', mode === 'select');
    canvas.style.cursor = mode === 'draw' ? 'crosshair' : selectedBoxIndex >= 0 ? 'move' : 'default';
    editorHint.textContent =
        mode === 'draw'
            ? 'Draw mode: drag on image to add object with active tag.'
            : 'Select mode: click object, drag to move, drag corners to resize, change tag in list.';
}

function updateBadges() {
    const count = annotations.length;
    boxCountBadge.textContent = `${count} object${count === 1 ? '' : 's'}`;
    selectedBadge.textContent = selectedBoxIndex >= 0 ? `Selected #${selectedBoxIndex + 1}` : 'No selection';
    deleteSelectedBtn.disabled = selectedBoxIndex < 0;
}

function renderBoxList() {
    if (annotations.length === 0) {
        boxList.innerHTML = '<p class="empty-box">No objects yet.</p>';
        return;
    }

    boxList.innerHTML = annotations
        .map((box, idx) => {
            const x = Math.round(box.x * 100);
            const y = Math.round(box.y * 100);
            const w = Math.round(box.w * 100);
            const h = Math.round(box.h * 100);
            return `
                <div class="box-item">
                    <div class="box-top-row">
                        <button class="box-select-btn ${idx === selectedBoxIndex ? 'active' : ''}" type="button" data-select-index="${idx}">
                            #${idx + 1} (${x}, ${y}) ${w}x${h}
                        </button>
                        <button class="box-delete-btn" type="button" data-delete-index="${idx}">Delete</button>
                    </div>
                    <div class="box-class-row">
                        <select class="box-class-input" data-tag-index="${idx}">
                            ${getTagOptionsHtml(box.class_id)}
                        </select>
                    </div>
                </div>
            `;
        })
        .join('');
}

function renderThumbOverlay(annotationsForImage) {
    if (!annotationsForImage || annotationsForImage.length === 0) {
        return '';
    }

    const boxes = annotationsForImage
        .map((a) => {
            const x = Math.max(0, Math.min(1, Number(a.bbox_x) || 0)) * 100;
            const y = Math.max(0, Math.min(1, Number(a.bbox_y) || 0)) * 100;
            const w = Math.max(0, Math.min(1, Number(a.bbox_w) || 0)) * 100;
            const h = Math.max(0, Math.min(1, Number(a.bbox_h) || 0)) * 100;
            return `<rect x="${x}%" y="${y}%" width="${w}%" height="${h}%"></rect>`;
        })
        .join('');

    return `<svg class="thumb-annotation-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${boxes}</svg>`;
}

function refreshEditorState() {
    updateBadges();
    renderBoxList();
    redraw();
}

function resetEditorState() {
    annotations = [];
    selectedBoxIndex = -1;
    interaction = null;
    setMode('draw');
    refreshEditorState();
}

function closeEditor() {
    editor.classList.add('hidden');
    currentImage = null;
    currentImageUuid = null;
    resetEditorState();
    cameraInput.value = '';
}

function clearAllBoxes() {
    if (!currentImage) {
        return;
    }
    annotations = [];
    selectedBoxIndex = -1;
    interaction = null;
    refreshEditorState();
}

function deleteBox(index) {
    if (index < 0 || index >= annotations.length) {
        return;
    }
    annotations.splice(index, 1);
    if (selectedBoxIndex === index) {
        selectedBoxIndex = -1;
    } else if (selectedBoxIndex > index) {
        selectedBoxIndex -= 1;
    }
    refreshEditorState();
}

function selectBox(index) {
    if (index < 0 || index >= annotations.length) {
        selectedBoxIndex = -1;
    } else {
        selectedBoxIndex = index;
    }
    refreshEditorState();
}

function getEventPoint(e) {
    const rect = canvas.getBoundingClientRect();
    const source = e.touches ? e.touches[0] || e.changedTouches[0] : e;
    return {
        x: source.clientX - rect.left,
        y: source.clientY - rect.top
    };
}

function toCanvasBox(box) {
    return {
        x: box.x * canvas.width,
        y: box.y * canvas.height,
        w: box.w * canvas.width,
        h: box.h * canvas.height
    };
}

function fromCanvasBox(boxPx, source) {
    return {
        ...source,
        x: boxPx.x / canvas.width,
        y: boxPx.y / canvas.height,
        w: boxPx.w / canvas.width,
        h: boxPx.h / canvas.height
    };
}

function pointInBox(point, box) {
    return (
        point.x >= box.x &&
        point.x <= box.x + box.w &&
        point.y >= box.y &&
        point.y <= box.y + box.h
    );
}

function getHandle(point, box) {
    const handles = {
        nw: { x: box.x, y: box.y },
        ne: { x: box.x + box.w, y: box.y },
        sw: { x: box.x, y: box.y + box.h },
        se: { x: box.x + box.w, y: box.y + box.h }
    };

    for (const [name, corner] of Object.entries(handles)) {
        const dx = point.x - corner.x;
        const dy = point.y - corner.y;
        if (Math.hypot(dx, dy) <= HANDLE_RADIUS + 2) {
            return name;
        }
    }
    return null;
}

function hitTestBox(point) {
    for (let i = annotations.length - 1; i >= 0; i -= 1) {
        const boxPx = toCanvasBox(annotations[i]);
        if (pointInBox(point, boxPx)) {
            return i;
        }
    }
    return -1;
}

function onPointerDown(e) {
    if (!currentImage) {
        return;
    }
    if (e.cancelable) {
        e.preventDefault();
    }

    const point = getEventPoint(e);

    if (mode === 'draw') {
        interaction = {
            type: 'draw',
            startX: point.x,
            startY: point.y,
            currentX: point.x,
            currentY: point.y
        };
        return;
    }

    const hitIndex = hitTestBox(point);

    if (hitIndex === -1) {
        selectBox(-1);
        interaction = null;
        return;
    }

    selectBox(hitIndex);

    const selectedPx = toCanvasBox(annotations[hitIndex]);
    const handle = getHandle(point, selectedPx);

    if (handle) {
        interaction = {
            type: 'resize',
            index: hitIndex,
            handle
        };
        return;
    }

    interaction = {
        type: 'move',
        index: hitIndex,
        offsetX: point.x - selectedPx.x,
        offsetY: point.y - selectedPx.y
    };
}

function onPointerMove(e) {
    if (!interaction || !currentImage) {
        return;
    }
    if (e.cancelable) {
        e.preventDefault();
    }

    const point = getEventPoint(e);

    if (interaction.type === 'draw') {
        interaction.currentX = point.x;
        interaction.currentY = point.y;
        redraw(interaction);
        return;
    }

    if (interaction.type === 'move') {
        const item = annotations[interaction.index];
        const box = toCanvasBox(item);
        const nextX = clamp(point.x - interaction.offsetX, 0, canvas.width - box.w);
        const nextY = clamp(point.y - interaction.offsetY, 0, canvas.height - box.h);
        annotations[interaction.index] = fromCanvasBox({
            x: nextX,
            y: nextY,
            w: box.w,
            h: box.h
        }, item);
        redraw();
        return;
    }

    if (interaction.type === 'resize') {
        const item = annotations[interaction.index];
        const box = toCanvasBox(item);
        const resized = resizeBoxByHandle(box, interaction.handle, point);
        annotations[interaction.index] = fromCanvasBox(resized, item);
        redraw();
    }
}

function onPointerUp(e) {
    if (!interaction || !currentImage) {
        return;
    }
    if (e.cancelable) {
        e.preventDefault();
    }

    if (interaction.type === 'draw') {
        const activeTag = getActiveTag();
        if (!activeTag) {
            alert('Create/select a tag before drawing annotations.');
            interaction = null;
            redraw();
            return;
        }

        const x1 = interaction.startX;
        const y1 = interaction.startY;
        const x2 = interaction.currentX;
        const y2 = interaction.currentY;
        const width = Math.abs(x2 - x1);
        const height = Math.abs(y2 - y1);

        if (width >= MIN_BOX_SIZE_PX && height >= MIN_BOX_SIZE_PX) {
            annotations.push({
                annotation_uuid: makeUuid(),
                class_name: activeTag.name,
                class_id: activeTag.id,
                x: Math.min(x1, x2) / canvas.width,
                y: Math.min(y1, y2) / canvas.height,
                w: width / canvas.width,
                h: height / canvas.height
            });
            selectedBoxIndex = annotations.length - 1;
            setMode('select');
        }
    }

    interaction = null;
    refreshEditorState();
}

function resizeBoxByHandle(box, handle, point) {
    let next = { ...box };

    if (handle === 'nw') {
        const x = clamp(point.x, 0, box.x + box.w - MIN_BOX_SIZE_PX);
        const y = clamp(point.y, 0, box.y + box.h - MIN_BOX_SIZE_PX);
        next = {
            x,
            y,
            w: box.x + box.w - x,
            h: box.y + box.h - y
        };
    } else if (handle === 'ne') {
        const right = clamp(point.x, box.x + MIN_BOX_SIZE_PX, canvas.width);
        const top = clamp(point.y, 0, box.y + box.h - MIN_BOX_SIZE_PX);
        next = {
            x: box.x,
            y: top,
            w: right - box.x,
            h: box.y + box.h - top
        };
    } else if (handle === 'sw') {
        const left = clamp(point.x, 0, box.x + box.w - MIN_BOX_SIZE_PX);
        const bottom = clamp(point.y, box.y + MIN_BOX_SIZE_PX, canvas.height);
        next = {
            x: left,
            y: box.y,
            w: box.x + box.w - left,
            h: bottom - box.y
        };
    } else if (handle === 'se') {
        const right = clamp(point.x, box.x + MIN_BOX_SIZE_PX, canvas.width);
        const bottom = clamp(point.y, box.y + MIN_BOX_SIZE_PX, canvas.height);
        next = {
            x: box.x,
            y: box.y,
            w: right - box.x,
            h: bottom - box.y
        };
    }

    return next;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function handleCaptureUpload(e) {
    const file = e.target.files[0];
    if (!file) {
        return;
    }

    const formData = new FormData();
    formData.append('file', file);

    fetch('/upload', { method: 'POST', body: formData })
        .then((res) => {
            if (!res.ok) {
                throw new Error('Capture upload failed');
            }
            return res.json();
        })
        .then(() => {
            cameraInput.value = '';
            loadHistory();
        })
        .catch(() => {
            alert('Failed to upload captured image.');
        });
}

function handleBatchUpload(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) {
        return;
    }

    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));

    fetch('/upload/batch', { method: 'POST', body: formData })
        .then((res) => {
            if (!res.ok) {
                throw new Error('Batch upload failed');
            }
            return res.json();
        })
        .then(() => {
            batchUploadInput.value = '';
            loadHistory();
        })
        .catch(() => {
            alert('Failed to upload images.');
        });
}

function setupCanvas() {
    const containerWidth = canvas.parentElement.clientWidth;
    if (containerWidth === 0) {
        canvas.width = 600;
        canvas.height = 400;
    } else {
        const scale = containerWidth / currentImage.width;
        canvas.width = containerWidth;
        canvas.height = currentImage.height * scale;
    }
    redraw();
}

function redraw(draft = null) {
    if (!currentImage || canvas.width === 0) {
        return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(currentImage, 0, 0, canvas.width, canvas.height);

    annotations.forEach((box, idx) => {
        const boxPx = toCanvasBox(box);
        const selected = idx === selectedBoxIndex;

        ctx.strokeStyle = selected ? '#0d5660' : '#d9481d';
        ctx.lineWidth = selected ? 3 : 2;
        ctx.strokeRect(boxPx.x, boxPx.y, boxPx.w, boxPx.h);

        ctx.fillStyle = selected ? 'rgba(13, 86, 96, 0.95)' : 'rgba(217, 72, 29, 0.9)';
        ctx.font = '12px Space Grotesk';
        ctx.fillText(`#${idx + 1} ${box.class_name || 'Unknown'}`, boxPx.x + 4, boxPx.y + 14);

        if (selected && mode === 'select') {
            drawHandles(boxPx);
        }
    });

    if (draft && draft.type === 'draw') {
        ctx.strokeStyle = '#4f46e5';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(
            draft.startX,
            draft.startY,
            draft.currentX - draft.startX,
            draft.currentY - draft.startY
        );
        ctx.setLineDash([]);
    }
}

function drawHandles(box) {
    const corners = [
        { x: box.x, y: box.y },
        { x: box.x + box.w, y: box.y },
        { x: box.x, y: box.y + box.h },
        { x: box.x + box.w, y: box.y + box.h }
    ];

    corners.forEach((corner) => {
        ctx.fillStyle = '#0d5660';
        ctx.fillRect(corner.x - HANDLE_RADIUS / 2, corner.y - HANDLE_RADIUS / 2, HANDLE_RADIUS, HANDLE_RADIUS);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(corner.x - HANDLE_RADIUS / 2, corner.y - HANDLE_RADIUS / 2, HANDLE_RADIUS, HANDLE_RADIUS);
    });
}

function saveAnnotations() {
    if (!currentImageUuid) {
        return;
    }

    const payload = {
        image_uuid: currentImageUuid,
        annotations: annotations.map((box) => {
            const tag = getTagById(box.class_id);
            return {
                annotation_uuid: box.annotation_uuid,
                class_name: tag ? tag.name : (box.class_name || 'Unknown').trim() || 'Unknown',
                class_id: tag ? tag.id : (Number.parseInt(box.class_id, 10) || null),
                bbox_x: box.x,
                bbox_y: box.y,
                bbox_w: box.w,
                bbox_h: box.h
            };
        })
    };

    fetch('/annotate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).then((res) => {
        if (!res.ok) {
            throw new Error('Failed to save annotations.');
        }
        closeEditor();
        return loadHistory();
    }).catch(() => {
        alert('Failed to save annotations. Please try again.');
    });
}

function editImage(uuid, filename, encodedAnnotations) {
    const source = JSON.parse(decodeURIComponent(encodedAnnotations));
    currentImageUuid = uuid;

    currentImage = new Image();
    currentImage.onload = () => {
        editor.classList.remove('hidden');

        annotations = source.map((a) => {
            const tagId = Number.parseInt(a.class_id, 10);
            ensureTagLocally(Number.isNaN(tagId) ? null : tagId, a.class_name || 'Unknown');
            return {
                annotation_uuid: a.annotation_uuid || makeUuid(),
                class_name: a.class_name || 'Unknown',
                class_id: Number.isNaN(tagId) ? null : tagId,
                x: a.bbox_x,
                y: a.bbox_y,
                w: a.bbox_w,
                h: a.bbox_h
            };
        });

        renderActiveTagSelect(annotations[0] ? annotations[0].class_id : null);

        if (annotations.length > 0) {
            selectedBoxIndex = 0;
            setMode('select');
        } else {
            selectedBoxIndex = -1;
            setMode('draw');
        }

        refreshEditorState();
        setupCanvas();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    currentImage.src = `/uploads/${filename}`;
}

function renderEmptyState() {
    selectedImageUuids.clear();
    updateHistorySelectionUI();
    imageList.innerHTML = '<div class="empty-state">No images yet. Capture or upload one to start annotating.</div>';
}

function updateHistorySelectionUI() {
    const selectedCount = selectedImageUuids.size;
    historySelected.textContent = `${selectedCount} selected`;
    deleteSelectedImagesBtn.disabled = selectedCount === 0;
    const hasImages = historyImages.length > 0;
    exportYoloBtn.disabled = !hasImages;
    selectAllImages.disabled = !hasImages;
    selectAllImages.checked = hasImages && selectedCount === historyImages.length;
}

function toggleImageSelection(imageUuid, isSelected) {
    if (isSelected) {
        selectedImageUuids.add(imageUuid);
    } else {
        selectedImageUuids.delete(imageUuid);
    }
    updateHistorySelectionUI();
}

function renderHistoryGrid() {
    if (historyImages.length === 0) {
        renderEmptyState();
        return;
    }

    imageList.innerHTML = historyImages
        .map((img) => {
            const annJson = encodeURIComponent(JSON.stringify(img.annotations));
            const checked = selectedImageUuids.has(img.uuid) ? 'checked' : '';
            return `
                <div class="image-card">
                    <div class="image-thumb-wrap">
                        <img src="/uploads/${img.filename}" alt="Annotated upload">
                        ${renderThumbOverlay(img.annotations)}
                        <div class="image-card-head">
                            <label class="image-select-label">
                                <input type="checkbox" ${checked} onchange="toggleImageSelection('${img.uuid}', this.checked)">
                            </label>
                            <button class="delete-image-btn" onclick="deleteOneImage('${img.uuid}')">Delete</button>
                        </div>
                    </div>
                    <div class="info">
                        <div class="tags">
                            ${img.annotations
                                .map((a) => `<span class="badge">${escapeHtml(a.class_name || 'Unknown')}</span>`)
                                .join('') || '<span class="badge">No tags</span>'}
                        </div>
                        <button class="edit-btn" onclick="editImage('${img.uuid}', '${img.filename}', '${annJson}')">Edit</button>
                    </div>
                </div>
            `;
        })
        .join('');
}

function deleteOneImage(imageUuid) {
    if (!confirm('Delete this image and all annotations?')) {
        return;
    }
    fetch(`/images/${imageUuid}`, { method: 'DELETE' }).then((res) => {
        if (!res.ok) {
            alert('Failed to delete image.');
            return;
        }
        selectedImageUuids.delete(imageUuid);
        loadHistory();
    });
}

function deleteSelectedImages() {
    if (selectedImageUuids.size === 0) {
        return;
    }
    if (!confirm(`Delete ${selectedImageUuids.size} selected images and all annotations?`)) {
        return;
    }
    fetch('/images/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_uuids: Array.from(selectedImageUuids) })
    }).then((res) => {
        if (!res.ok) {
            alert('Failed to delete selected images.');
            return;
        }
        selectedImageUuids.clear();
        loadHistory();
    });
}

function exportYoloDataset() {
    if (historyImages.length === 0) {
        alert('No images to export.');
        return;
    }
    window.location.href = '/export/yolo';
}

function loadHistory() {
    return fetch('/images')
        .then((res) => {
            if (!res.ok) {
                throw new Error('Failed to load images.');
            }
            return res.json();
        })
        .then((images) => {
            historyCount.textContent = `${images.length} image${images.length === 1 ? '' : 's'}`;
            historyImages = images;
            selectedImageUuids = new Set(
                images
                    .map((img) => img.uuid)
                    .filter((uuid) => selectedImageUuids.has(uuid))
            );
            updateHistorySelectionUI();
            renderHistoryGrid();
        })
        .catch(() => {
            imageList.innerHTML = '<div class="empty-state">Failed to load images. Refresh to try again.</div>';
            historyCount.textContent = '0 images';
            selectedImageUuids.clear();
            updateHistorySelectionUI();
        });
}

window.toggleImageSelection = toggleImageSelection;
window.deleteOneImage = deleteOneImage;
window.editImage = editImage;

setMode('draw');
refreshEditorState();
updateHistorySelectionUI();
Promise.all([loadTags(), loadHistory()]).catch(() => {
    alert('Failed to initialize tags or images.');
});
