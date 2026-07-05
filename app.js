// ---------- IndexedDB layer ----------

const DB_NAME = "photoOrganizerDB";
const DB_VERSION = 1;
const STORE = "photos";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("name", "name", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise = openDB();

async function dbAdd(record) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAll() {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbUpdate(record) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).put(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(id) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ---------- State ----------

let allPhotos = [];          // cached list, newest first
let objectUrls = new Map();  // id -> object URL (revoked on delete / rerender)
let pendingFiles = [];       // files staged in the naming modal

// ---------- DOM refs ----------

const addBtn = document.getElementById("addBtn");
const addMenu = document.getElementById("addMenu");
const fileInput = document.getElementById("fileInput");
const cameraInput = document.getElementById("cameraInput");
const searchInput = document.getElementById("searchInput");
const countBadge = document.getElementById("countBadge");
const photoList = document.getElementById("photoList");
const emptyState = document.getElementById("emptyState");

const nameModal = document.getElementById("nameModal");
const pendingList = document.getElementById("pendingList");
const cancelAddBtn = document.getElementById("cancelAddBtn");
const confirmAddBtn = document.getElementById("confirmAddBtn");

const viewer = document.getElementById("viewer");
const viewerImg = document.getElementById("viewerImg");
const viewerLabel = document.getElementById("viewerLabel");
const viewerClose = document.getElementById("viewerClose");

const toast = document.getElementById("toast");

// ---------- Helpers ----------

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add("hidden"), 2200);
}

function stripExtension(filename) {
  const idx = filename.lastIndexOf(".");
  return idx > 0 ? filename.slice(0, idx) : filename;
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString("hu-HU", { year: "numeric", month: "short", day: "numeric" });
}

function frameNumber(index) {
  return "No. " + String(index + 1).padStart(3, "0");
}

function urlFor(photo) {
  if (!objectUrls.has(photo.id)) {
    objectUrls.set(photo.id, URL.createObjectURL(photo.blob));
  }
  return objectUrls.get(photo.id);
}

// ---------- Rendering ----------

async function loadAndRender() {
  const raw = await dbGetAll();
  raw.sort((a, b) => b.createdAt - a.createdAt);
  allPhotos = raw;
  render();
}

function render() {
  const query = searchInput.value.trim().toLocaleLowerCase("hu");
  const filtered = query
    ? allPhotos.filter(p => p.name.toLocaleLowerCase("hu").includes(query))
    : allPhotos;

  countBadge.textContent = allPhotos.length === 1 ? "1 kép" : `${allPhotos.length} kép`;

  photoList.innerHTML = "";

  if (allPhotos.length === 0) {
    emptyState.hidden = false;
    photoList.hidden = true;
    return;
  }
  emptyState.hidden = true;
  photoList.hidden = false;

  if (filtered.length === 0) {
    const li = document.createElement("li");
    li.className = "empty-state";
    li.style.padding = "1.2rem 0";
    li.innerHTML = `<p>Nincs találat erre: „${escapeHtml(searchInput.value)}”.</p>`;
    photoList.appendChild(li);
    return;
  }

  filtered.forEach((photo) => {
    const globalIndex = allPhotos.indexOf(photo);
    const li = document.createElement("li");
    li.className = "photo-item";
    li.dataset.id = photo.id;

    li.innerHTML = `
      <span class="photo-item__frameno">${frameNumber(globalIndex)}</span>
      <button type="button" class="photo-item__thumb-btn" aria-label="Megnyitás teljes képernyőn">
        <img src="${urlFor(photo)}" alt="${escapeHtml(photo.name)}">
      </button>
      <div class="photo-item__body">
        <span class="photo-item__name">${escapeHtml(photo.name)}</span>
        <span class="photo-item__date">${formatDate(photo.createdAt)}</span>
      </div>
      <div class="photo-item__actions">
        <button type="button" class="icon-btn icon-btn--rename" aria-label="Átnevezés">✎</button>
        <button type="button" class="icon-btn icon-btn--danger" aria-label="Törlés">🗑</button>
      </div>
    `;

    li.querySelector(".photo-item__thumb-btn").addEventListener("click", () => openViewer(photo));
    li.querySelector(".icon-btn--rename").addEventListener("click", () => startRename(li, photo));
    li.querySelector(".icon-btn--danger").addEventListener("click", () => confirmDelete(photo));

    photoList.appendChild(li);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Rename ----------

function startRename(li, photo) {
  const nameEl = li.querySelector(".photo-item__name");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "photo-item__name-input";
  input.value = photo.name;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = async () => {
    const newName = input.value.trim();
    if (newName && newName !== photo.name) {
      photo.name = newName;
      await dbUpdate(photo);
      showToast("Átnevezve");
    }
    render();
  };

  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") { input.value = photo.name; input.blur(); }
  });
}

// ---------- Delete ----------

function confirmDelete(photo) {
  if (!confirm(`Törlöd a(z) „${photo.name}” képet? A művelet nem visszavonható.`)) return;
  dbDelete(photo.id).then(() => {
    if (objectUrls.has(photo.id)) {
      URL.revokeObjectURL(objectUrls.get(photo.id));
      objectUrls.delete(photo.id);
    }
    showToast("Kép törölve");
    loadAndRender();
  });
}

// ---------- Add flow ----------

addBtn.addEventListener("click", () => addMenu.classList.toggle("hidden"));
document.addEventListener("click", (e) => {
  if (!addMenu.contains(e.target) && e.target !== addBtn) addMenu.classList.add("hidden");
});

addMenu.addEventListener("click", (e) => {
  const mode = e.target.dataset.mode;
  if (mode === "file") fileInput.click();
  if (mode === "camera") cameraInput.click();
  addMenu.classList.add("hidden");
});

fileInput.addEventListener("change", () => stageFiles(fileInput.files));
cameraInput.addEventListener("change", () => stageFiles(cameraInput.files));

function stageFiles(fileList) {
  const files = Array.from(fileList).filter(f => f.type.startsWith("image/"));
  if (files.length === 0) return;
  pendingFiles = files.map(f => ({ file: f, name: stripExtension(f.name), url: URL.createObjectURL(f) }));
  renderPendingList();
  nameModal.classList.remove("hidden");
}

function renderPendingList() {
  pendingList.innerHTML = "";
  pendingFiles.forEach((item, i) => {
    const li = document.createElement("li");
    li.className = "pending-item";
    li.innerHTML = `
      <img src="${item.url}" alt="">
      <input type="text" value="${escapeHtml(item.name)}" data-index="${i}">
    `;
    li.querySelector("input").addEventListener("input", (e) => {
      pendingFiles[i].name = e.target.value;
    });
    pendingList.appendChild(li);
  });
}

function closeNameModal() {
  nameModal.classList.add("hidden");
  pendingFiles.forEach(item => URL.revokeObjectURL(item.url));
  pendingFiles = [];
  fileInput.value = "";
  cameraInput.value = "";
}

cancelAddBtn.addEventListener("click", closeNameModal);

confirmAddBtn.addEventListener("click", async () => {
  const items = pendingFiles;
  if (items.length === 0) { closeNameModal(); return; }
  confirmAddBtn.disabled = true;
  try {
    for (const item of items) {
      const name = item.name.trim() || "Névtelen kép";
      await dbAdd({ name, blob: item.file, type: item.file.type, createdAt: Date.now() });
    }
    showToast(items.length === 1 ? "Kép mentve" : `${items.length} kép mentve`);
    closeNameModal();
    await loadAndRender();
  } catch (err) {
    console.error(err);
    showToast("Hiba történt a mentés közben");
  } finally {
    confirmAddBtn.disabled = false;
  }
});

// ---------- Viewer ----------

function openViewer(photo) {
  viewerImg.src = urlFor(photo);
  viewerImg.alt = photo.name;
  viewerLabel.textContent = photo.name;
  viewer.classList.remove("hidden");
}

function closeViewer() {
  viewer.classList.add("hidden");
}

viewerClose.addEventListener("click", closeViewer);
viewer.addEventListener("click", (e) => { if (e.target === viewer) closeViewer(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeViewer(); });

// ---------- Search ----------

searchInput.addEventListener("input", render);

// ---------- Service worker (offline app shell) ----------

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(err => console.warn("SW regisztráció sikertelen:", err));
  });
}

// ---------- Init ----------

loadAndRender();
