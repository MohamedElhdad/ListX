"use strict";
// Project sites share an origin. Keep this folder separate from other apps.
const storagePrefix = location.pathname.toLowerCase().startsWith("/listx/") ? "listx:/ListX/:" : "";
const $ = (selector) => document.querySelector(selector);
const storage = {
  get(key, fallback = null, session = false) {
    try {
      return (session ? sessionStorage : localStorage).getItem(storagePrefix + key) ?? fallback;
    } catch {
      warnStorage();
      return fallback;
    }
  },
  set(key, value, session = false) {
    try {
      (session ? sessionStorage : localStorage).setItem(storagePrefix + key, value);
      return true;
    } catch {
      warnStorage();
      return false;
    }
  },
};
function warnStorage() {
  $("#storage-warning").hidden = false;
}
function id() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}
function readTasks() {
  const raw = storage.get("tasks");
  if (!raw) return [];
  try {
    const values = JSON.parse(raw);
    if (!Array.isArray(values)) throw new Error("Invalid task data");
    let legacyDone = [];
    try {
      const old = JSON.parse(storage.get("line", "[]"));
      if (Array.isArray(old)) legacyDone = old;
    } catch {}
    const seen = new Set();
    return values.map((value) => {
      const task =
        typeof value === "string"
          ? { text: value, done: legacyDone.includes(value) }
          : value;
      if (!task || typeof task.text !== "string")
        throw new Error("Invalid task record");
      const taskId =
        typeof task.id === "string" && !seen.has(task.id) ? task.id : id();
      seen.add(taskId);
      return { id: taskId, text: task.text, done: task.done === true };
    });
  } catch {
    // Preserve unrecognised data rather than silently overwriting it.
    recoveryNeeded = true;
    $("#storage-warning").textContent =
      "Saved task data could not be read. It has not been changed. Back up your browser data before adding tasks.";
    warnStorage();
    return [];
  }
}
let recoveryNeeded = false;
let tasks = readTasks();
let currentFilter = "all";
let search = "";
let undoSnapshot = null;
let toastTimer;
const UNDO_DURATION = 8000;
let editingId = null;
let lastFocus = null;

function persist() {
  if (recoveryNeeded) {
    showToast("Saved data needs recovery. No changes were saved.");
    return;
  }
  storage.set("tasks", JSON.stringify(tasks));
}
const PALETTES = {
  dark: "#111a17",
  "dark-blue": "#111725",
  graphite: "#19181e",
  obsidian: "#0a0b0d",
  petrol: "#0d1c20",
  espresso: "#1c1714",
  light: "#f8f5ef",
  "light-blue": "#f0f4fa",
  "light-sage": "#faf1f5",
};
const SIZE_MIN = 12;
const SIZE_MAX = 22;
const SIZE_DEFAULT = 14;
function clampSize(value) {
  const n = parseFloat(value);
  if (!isFinite(n)) return SIZE_DEFAULT;
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(n * 10) / 10));
}
function formatSize(n) {
  return String(Math.round(n * 10) / 10);
}
// V1 slots meant 13/15/17/20px, clamped to 14/15/17/17. V2 slots meant
// 14/15/16/17px. V3 stores the exact numeric size the user typed.
const SIZE_SLOTS_V2 = { small: 14, compact: 15, comfortable: 16, large: 17 };
const SIZE_SLOTS_V1 = { small: 14, compact: 15, comfortable: 17, large: 17 };
function migrateSize(saved) {
  if (saved.sizeVersion === 3 && isFinite(parseFloat(saved.sizePx)))
    return clampSize(saved.sizePx);
  if (Object.hasOwn(SIZE_SLOTS_V2, saved.size))
    return saved.sizeVersion === 2
      ? SIZE_SLOTS_V2[saved.size]
      : SIZE_SLOTS_V1[saved.size];
  return SIZE_DEFAULT;
}
let appearance = { font: "inter", sizePx: SIZE_DEFAULT, sizeVersion: 3 };
try {
  const saved = JSON.parse(storage.get("listx-appearance", "{}"));
  if (["inter", "system", "editorial", "mono"].includes(saved.font))
    appearance.font = saved.font;
  appearance.sizePx = migrateSize(saved);
} catch {}
function setTheme(theme, save = true) {
  if (!Object.hasOwn(PALETTES, theme)) theme = "obsidian";
  document.documentElement.dataset.theme = theme;
  if (save) storage.set("theme", theme);
  $('meta[name="theme-color"]').content = PALETTES[theme];
  document
    .querySelectorAll("[data-palette]")
    .forEach((button) =>
      button.setAttribute("aria-pressed", button.dataset.palette === theme),
    );
}
function applyAppearance(save = true) {
  document.documentElement.dataset.font = appearance.font;
  document.documentElement.style.setProperty(
    "--task-size",
    `${appearance.sizePx}px`,
  );
  if (save) storage.set("listx-appearance", JSON.stringify(appearance));
  document
    .querySelectorAll("[data-font-option]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        button.dataset.fontOption === appearance.font,
      ),
    );
  // Don't reformat the field while the user is typing in it.
  const sizeInput = $("#size-input");
  if (sizeInput && document.activeElement !== sizeInput)
    sizeInput.value = formatSize(appearance.sizePx);
}
setTheme(storage.get("theme") || "obsidian", false);
applyAppearance(false);
$("#settings-button").addEventListener("click", () => {
  $("#settings-dialog").showModal();
  $("#settings-close").focus();
});
$("#settings-close").addEventListener("click", () =>
  $("#settings-dialog").close(),
);
document
  .querySelectorAll("[data-palette]")
  .forEach((button) =>
    button.addEventListener("click", () => setTheme(button.dataset.palette)),
  );
document.querySelectorAll("[data-font-option]").forEach((button) =>
  button.addEventListener("click", () => {
    appearance.font = button.dataset.fontOption;
    applyAppearance();
  }),
);
const sizeInput = $("#size-input");
function commitSizeInput() {
  appearance.sizePx = clampSize(sizeInput.value);
  applyAppearance();
  sizeInput.value = formatSize(appearance.sizePx);
}
sizeInput.addEventListener("input", () => {
  // Numbers and a single decimal point only; px is implied, never typed.
  const cleaned = sizeInput.value
    .replace(/[^\d.]/g, "")
    .replace(/(\..*)\./g, "$1");
  if (cleaned !== sizeInput.value) sizeInput.value = cleaned;
  if (cleaned && isFinite(parseFloat(cleaned))) {
    appearance.sizePx = clampSize(cleaned);
    applyAppearance();
  }
});
sizeInput.addEventListener("change", commitSizeInput);
sizeInput.addEventListener("blur", commitSizeInput);
$("#size-decrease").addEventListener("click", () => {
  appearance.sizePx = clampSize(Math.round((appearance.sizePx - 0.5) * 10) / 10);
  applyAppearance();
});
$("#size-increase").addEventListener("click", () => {
  appearance.sizePx = clampSize(Math.round((appearance.sizePx + 0.5) * 10) / 10);
  applyAppearance();
});
$("#reset-appearance").addEventListener("click", () => {
  appearance = { font: "inter", sizePx: SIZE_DEFAULT, sizeVersion: 3 };
  applyAppearance();
  setTheme("obsidian");
});
$("#date-label").textContent = new Intl.DateTimeFormat("en", {
  weekday: "long",
  month: "long",
  day: "numeric",
}).format(new Date());

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}
function actionButton(name, label, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(icon(name));
  button.addEventListener("click", handler);
  return button;
}
function commit(announcement) {
  persist();
  render();
  if (announcement) $("#live-status").textContent = announcement;
}
function taskRow(task) {
  const li = document.createElement("li");
  li.className = `task${task.done ? " done" : ""}`;
  li.dataset.id = task.id;
  const check = document.createElement("input");
  check.type = "checkbox";
  check.className = "task-checkbox";
  check.checked = task.done;
  check.setAttribute(
    "aria-label",
    `Mark ${task.text} ${task.done ? "active" : "complete"}`,
  );
  check.addEventListener("change", () => {
    task.done = check.checked;
    commit(task.done ? "Task completed" : "Task marked active");
    const replacement = Array.from($("#task-list").children).find(
      (row) => row.dataset.id === task.id,
    );
    (
      replacement?.querySelector("input") ||
      $(`[data-filter="${currentFilter}"]`)
    ).focus();
  });
  const text = document.createElement("p");
  text.className = "task-content";
  text.dir = "auto";
  text.textContent = task.text;
  text.classList.toggle("ar", /[\u0600-\u06ff]/.test(task.text));
  text.addEventListener("dblclick", () => openEdit(task.id));
  // Long press now belongs to ordering, not copying. A visible handle adds keyboard access.
  const grip = actionButton(
    "grip",
    `Reorder ${task.text}. Hold to drag or use arrow keys.`,
    () => {},
  );
  grip.className = "drag-handle";
  grip.addEventListener("keydown", (event) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const visible = Array.from($("#task-list").children).map(
      (row) => row.dataset.id,
    );
    const from = visible.indexOf(task.id);
    const to =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? visible.length - 1
          : Math.max(
              0,
              Math.min(
                visible.length - 1,
                from + (event.key === "ArrowUp" ? -1 : 1),
              ),
            );
    visible.splice(from, 1);
    visible.splice(to, 0, task.id);
    applyVisibleOrder(visible);
    const row = Array.from($("#task-list").children).find(
      (row) => row.dataset.id === task.id,
    );
    row?.querySelector(".drag-handle")?.focus();
  });
  installReorder(li, task.id);
  const actions = document.createElement("div");
  actions.className = "task-actions";
  actions.append(
    actionButton("edit", `Edit ${task.text}`, () => openEdit(task.id)),
    actionButton("trash", `Delete ${task.text}`, () => {
      undoSnapshot = tasks.map((t) => ({ ...t }));
      tasks = tasks.filter((t) => t.id !== task.id);
      commit("Task deleted");
      showToast("Task deleted", true);
      $("#undo-button").focus({ preventScroll: true });
    }),
  );
  li.append(grip, check, text, actions);
  return li;
}
function render() {
  cancelReorder(false);
  const total = tasks.length,
    done = tasks.filter((t) => t.done).length,
    active = total - done;
  const percent = total ? Math.round((done / total) * 100) : 0;
  for (const [selector, value] of Object.entries({
    "#stat-total": total,
    "#stat-active": active,
    "#stat-completed": done,
    "#heading-count": total,
    "#nav-count": active,
    "#filter-all": total,
    "#filter-active": active,
    "#filter-completed": done,
  }))
    $(selector).textContent = value;
  $("#remaining-label").textContent =
    `${active} ${active === 1 ? "task" : "tasks"} left`;
  $("#progress-value").textContent = `${percent}%`;
  $("#progress-ring").style.setProperty("--progress", `${percent}%`);
  $("#progress-ring").setAttribute("aria-valuenow", percent);
  $("#progress-caption").textContent = total
    ? `${percent}% of your list, done`
    : "A fresh start";
  $("#clear-all").disabled = !total || recoveryNeeded;
  $("#clear-completed").hidden = !done;
  const query = search.trim().toLocaleLowerCase();
  const visible = tasks.filter(
    (t) =>
      (currentFilter === "all" ||
        (currentFilter === "completed" ? t.done : !t.done)) &&
      t.text.toLocaleLowerCase().includes(query),
  );
  $("#task-list").replaceChildren(...visible.map(taskRow));
  $("#list-summary").textContent =
    `${visible.length} ${visible.length === 1 ? "TASK" : "TASKS"}${search.trim() ? " FOUND" : currentFilter === "all" ? " IN YOUR LIST" : currentFilter === "active" ? " IN PROGRESS" : " COMPLETED"}`;
  $("#empty-state").hidden = visible.length > 0;
  if (!visible.length) {
    $("#empty-state h3").textContent = query
      ? "No matching tasks"
      : !total
        ? "Your next chapter starts here"
        : currentFilter === "completed"
          ? "Good things take a first step"
          : "A little breathing room";
    $("#empty-state p").textContent = query
      ? "Try a different search or switch filters."
      : !total
        ? "Add your first task. Keep it small, make it count."
        : currentFilter === "completed"
          ? "Your completed tasks will appear here."
          : "All caught up. Take a moment for yourself.";
  }
}
function updateAdd() {
  $("#add-button").disabled = !$("#task-input").value.trim() || recoveryNeeded;
}
$("#task-input").value = storage.get("task-input", "", true);
$("#task-input").addEventListener("input", () => {
  storage.set("task-input", $("#task-input").value, true);
  updateAdd();
});
$("#add-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = $("#task-input").value.trim();
  if (!text || recoveryNeeded) return;
  tasks.push({ id: id(), text, done: false });
  // Show a newly added task even when the user was in a filtered view.
  setFilter("all");
  search = "";
  $("#search-input").value = "";
  $("#task-input").value = "";
  storage.set("task-input", "", true);
  updateAdd();
  commit("Task added");
  $("#task-input").focus();
});
function setFilter(filter) {
  currentFilter = filter;
  document.querySelectorAll("[data-filter]").forEach((button) => {
    const selected = button.dataset.filter === filter;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", selected);
  });
  render();
}
document
  .querySelectorAll("[data-filter]")
  .forEach((button) =>
    button.addEventListener("click", () => setFilter(button.dataset.filter)),
  );
$("#all-nav").addEventListener("click", () => {
  search = "";
  $("#search-input").value = "";
  setFilter("all");
});
$("#search-input").addEventListener("input", (event) => {
  search = event.target.value;
  render();
});

function openEdit(taskId) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  editingId = taskId;
  lastFocus = document.activeElement;
  $("#edit-input").value = task.text;
  $("#edit-save").disabled = false;
  $("#edit-dialog").showModal();
  $("#edit-input").focus();
  $("#edit-input").select();
}
$("#edit-input").addEventListener("input", () => {
  $("#edit-save").disabled = !$("#edit-input").value.trim();
});
$("#edit-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = $("#edit-input").value.trim();
  if (!text) return;
  const task = tasks.find((t) => t.id === editingId);
  if (task) task.text = text;
  commit("Task updated");
  $("#edit-dialog").close();
});
$("#edit-cancel").addEventListener("click", () => $("#edit-dialog").close());
$("#edit-dialog").addEventListener("close", () => {
  const row = Array.from($("#task-list").children).find(
    (element) => element.dataset.id === editingId,
  );
  if (lastFocus?.isConnected) lastFocus.focus();
  else (row?.querySelector(".task-actions button") || $("#task-input")).focus();
  editingId = null;
});
$("#clear-all").addEventListener("click", () => {
  $("#clear-dialog").showModal();
  $("#clear-cancel").focus();
});
$("#clear-cancel").addEventListener("click", () => $("#clear-dialog").close());
$("#clear-confirm").addEventListener("click", () => {
  undoSnapshot = tasks.map((t) => ({ ...t }));
  tasks = [];
  commit("All tasks cleared");
  $("#clear-dialog").close();
  showToast("All tasks cleared", true);
  $("#undo-button").focus({ preventScroll: true });
});
$("#clear-completed").addEventListener("click", () => {
  undoSnapshot = tasks.map((t) => ({ ...t }));
  tasks = tasks.filter((t) => !t.done);
  commit("Completed tasks cleared");
  showToast("Completed tasks cleared", true);
  $("#undo-button").focus({ preventScroll: true });
});
for (const dialog of document.querySelectorAll("dialog"))
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      dialog.close();
  });
function dismissToast() {
  clearTimeout(toastTimer);
  // Avoid leaving keyboard focus inside a notification that is now hidden.
  if ($("#toast").contains(document.activeElement))
    ($(".drag-handle") || $("#settings-button")).focus({ preventScroll: true });
  $("#toast").hidden = true;
  $("#undo-button").hidden = true;
  undoSnapshot = null;
}
function showToast(message, undo = false) {
  clearTimeout(toastTimer);
  $("#toast-message").textContent = message;
  $("#undo-button").hidden = !undo;
  $("#toast").hidden = false;
  // Give Undo a generous but bounded lifetime; a new deletion restarts it.
  toastTimer = setTimeout(dismissToast, undo ? UNDO_DURATION : 5000);
}
$("#undo-button").addEventListener("click", () => {
  if (!undoSnapshot) return;
  // Preserve tasks added since the delete, and restore the old order/state.
  const restoredIds = new Set(undoSnapshot.map((t) => t.id));
  const currentById = new Map(tasks.map((t) => [t.id, t]));
  tasks = [
    ...undoSnapshot.map((t) => currentById.get(t.id) || t),
    ...tasks.filter((t) => !restoredIds.has(t.id)),
  ];
  dismissToast();
  commit("Tasks restored");
  ($(".drag-handle") || $("#settings-button")).focus({ preventScroll: true });
});
$("#dismiss-toast").addEventListener("click", dismissToast);
window.addEventListener("storage", (event) => {
  if (storagePrefix && !event.key?.startsWith(storagePrefix)) return;
  const key = storagePrefix ? event.key.slice(storagePrefix.length) : event.key;
  if (key === "tasks") {
    tasks = readTasks();
    undoSnapshot = null;
    $("#toast").hidden = true;
    render();
  }
  if (key === "theme") setTheme(event.newValue || "obsidian", false);
  if (key === "listx-appearance") {
    try {
      const a = JSON.parse(event.newValue || "{}");
      if (["inter", "system", "editorial", "mono"].includes(a.font))
        appearance.font = a.font;
      appearance.sizePx = migrateSize(a);
      applyAppearance(false);
    } catch {}
  }
});
// Reorder the visible subset in its existing model slots, keeping hidden tasks intact.
function applyVisibleOrder(order) {
  const visibleIds = new Set(order);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  let i = 0;
  tasks = tasks.map((task) =>
    visibleIds.has(task.id) ? byId.get(order[i++]) : task,
  );
  commit("Task order updated");
}
// A single gesture owns the timer, floating card and event cleanup, even if
// a search, filter or another tab replaces the original task row.
let reorderGesture = null;
let settlingCleanup = null;
function cancelReorder(redraw = true) {
  settlingCleanup?.();
  const state = reorderGesture;
  if (state) state.finish(true, redraw);
  // Also repair any stale visual left by a cancelled browser animation.
  document.querySelectorAll('.drag-preview').forEach(element => element.remove());
  document.querySelectorAll('.is-dragging,.drop-settling').forEach(element => element.classList.remove('is-dragging', 'drop-settling'));
  document.body.classList.remove('is-reordering');
  $('.task-panel').classList.remove('reorder-mode');
}
function installReorder(row, taskId) {
  const ignore = target => target.closest('input, .task-actions');
  function press(x, y, input, identifier, delay) {
    cancelReorder();
    if (!row.isConnected || row.parentElement !== $('#task-list')) return;
    const state = {
      row, id: taskId, input, identifier, originX: x, originY: y, y,
      captureTarget: $("#task-list"),
      active: false, preview: null, frame: null, timer: null,
      idleTimer: null, hardTimer: null, autoScrollUntil: 0,
      finish, move,
    };
    reorderGesture = state;
    function armIdleTimer() {
      clearTimeout(state.idleTimer);
      state.idleTimer = setTimeout(() => finish(true), 8000);
    }
    function place(y) {
      const list = $('#task-list');
      if (row.parentElement !== list) { finish(true); return; }
      const others = Array.from(list.children).filter(item => item !== row);
      const top = list.getBoundingClientRect().top;
      const next = others.find(item => y < top + item.offsetTop + item.offsetHeight / 2);
      if (row.nextElementSibling === (next || null)) return;
      const before = new Map(others.map(item => [item, item.getBoundingClientRect().top]));
      for (const item of others) item.getAnimations().forEach(animation => animation.cancel());
      if (next) list.insertBefore(row, next); else list.append(row);
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        for (const item of others) {
          const delta = before.get(item) - item.getBoundingClientRect().top;
          if (Math.abs(delta) > 1 && item.animate) item.animate([
            { transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' },
          ], { duration: 230, easing: 'cubic-bezier(.2,.75,.25,1)' });
        }
      }
    }
    function frame() {
      if (reorderGesture !== state || !state.active) return;
      if (row.parentElement !== $('#task-list') || !state.preview.isConnected) { finish(true); return; }
      state.preview.style.transform = `translate3d(0, ${state.y - state.grab}px, 0) scale(1.015)`;
      const margin = 90, y = state.y;
      const delta = y < margin ? -Math.ceil((margin - y) / 8) : y > innerHeight - margin ? Math.ceil((y - (innerHeight - margin)) / 8) : 0;
      if (delta) {
        // Only our own edge scrolling may keep the drag alive. A normal page
        // scroll, native takeover or viewport change cancels it.
        state.autoScrollUntil = performance.now() + 80;
        window.scrollBy(0, delta);
        place(y);
      }
      if (reorderGesture === state) state.frame = requestAnimationFrame(frame);
    }
    function begin() {
      if (reorderGesture !== state || !row.isConnected || row.parentElement !== $('#task-list') || $('#task-list').children.length < 2) { finish(true); return; }
      const rect = row.getBoundingClientRect();
      const preview = row.cloneNode(true);
      preview.className = row.className + ' drag-preview';
      preview.removeAttribute('data-id');
      preview.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
      preview.setAttribute('aria-hidden', 'true');
      preview.inert = true;
      Object.assign(preview.style, { left: `${rect.left}px`, top: '0', width: `${rect.width}px`, height: `${rect.height}px`, transform: `translate3d(0, ${rect.top}px, 0) scale(1.015)` });
      state.preview = preview;
      state.grab = state.originY - rect.top;
      state.active = true;
      document.body.append(preview);
      row.classList.add('is-dragging');
      document.body.classList.add('is-reordering');
      $('.task-panel').classList.add('reorder-mode');
      $('#live-status').textContent = 'Reordering task. Drag up or down, then release.';
      armIdleTimer();
      state.hardTimer = setTimeout(() => finish(true), 30000);
      try { navigator.vibrate?.(20); } catch {}
      if (input === 'pointer') {
        // Capture on the stable list, not the row that moves between DOM slots.
        try { state.captureTarget.setPointerCapture(identifier); } catch {}
      }
      state.frame = requestAnimationFrame(frame);
    }
    function move(x, y, event) {
      if (reorderGesture !== state) return;
      if (!state.active) {
        if (Math.hypot(x - state.originX, y - state.originY) > 9) finish(true);
        return;
      }
      if (input === 'touch' && !event.cancelable) { finish(true); return; }
      if (event.cancelable) event.preventDefault();
      state.y = y;
      armIdleTimer();
      place(y);
    }
    function finish(cancelled = false, redraw = true) {
      if (reorderGesture !== state) return;
      // Clear ownership before rendering or releasing capture: both can
      // synchronously send events back through the lifecycle guards.
      reorderGesture = null;
      clearTimeout(state.timer);
      clearTimeout(state.idleTimer);
      clearTimeout(state.hardTimer);
      cancelAnimationFrame(state.frame);
      if (input === 'pointer') {
        try { if (state.captureTarget.hasPointerCapture(identifier)) state.captureTarget.releasePointerCapture(identifier); } catch {}
      }
      document.body.classList.remove('is-reordering');
      $('.task-panel').classList.remove('reorder-mode');
      row.classList.remove('is-dragging');
      const preview = state.preview;
      const start = preview?.getBoundingClientRect();
      preview?.remove();
      if (!state.active) return;
      if (cancelled || row.parentElement !== $('#task-list')) {
        if (redraw) render();
        return;
      }
      const order = Array.from($('#task-list').children).map(item => item.dataset.id);
      applyVisibleOrder(order);
      const target = Array.from($('#task-list').children).find(item => item.dataset.id === taskId);
      if (!target || !preview || matchMedia('(prefers-reduced-motion: reduce)').matches || !preview.animate) return;
      const end = target.getBoundingClientRect();
      target.classList.add('drop-settling');
      document.body.append(preview);
      let animation = null, fallback = null;
      const cleanup = () => {
        clearTimeout(fallback);
        animation?.cancel();
        preview.remove();
        target.classList.remove('drop-settling');
        if (settlingCleanup === cleanup) settlingCleanup = null;
      };
      settlingCleanup = cleanup;
      // Animation promises may pause with a hidden tab. Removal must not
      // depend on a finish callback arriving.
      fallback = setTimeout(cleanup, 400);
      try {
        animation = preview.animate([
          { transform: `translate3d(0, ${start.top}px, 0) scale(1.015)` },
          { transform: `translate3d(0, ${end.top}px, 0) scale(1)` },
        ], { duration: 190, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'forwards' });
        animation.finished.then(cleanup, cleanup);
      } catch { cleanup(); }
    }
    state.timer = setTimeout(begin, delay);
  }
  row.addEventListener('touchstart', event => {
    if (ignore(event.target) || event.touches.length !== 1) return;
    const t = event.touches[0];
    press(t.clientX, t.clientY, 'touch', t.identifier, 420);
  }, { passive: true });
  row.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch' || event.button !== 0 || ignore(event.target)) return;
    press(event.clientX, event.clientY, 'pointer', event.pointerId, event.target.closest('.drag-handle') ? 120 : 420);
  });
  row.addEventListener('dragstart', event => { if (!ignore(event.target)) event.preventDefault(); });
  row.addEventListener('contextmenu', event => { if (!ignore(event.target)) event.preventDefault(); });
}
// Listen above the row: rendering, release outside the row, lost capture and
// Android's native scroll cancellation must all reach the same owner.
document.addEventListener('pointerdown', () => cancelReorder(), true);
document.addEventListener('touchstart', event => {
  if (event.touches.length !== 1) cancelReorder();
}, { passive: true, capture: true });
document.addEventListener('touchmove', event => {
  const state = reorderGesture;
  if (!state || state.input !== 'touch') return;
  const touch = Array.from(event.touches).find(t => t.identifier === state.identifier);
  if (!touch || event.touches.length !== 1) { cancelReorder(); return; }
  state.move(touch.clientX, touch.clientY, event);
}, { passive: false, capture: true });
document.addEventListener('touchend', event => {
  const state = reorderGesture;
  if (state?.input === 'touch' && (!event.touches.length || Array.from(event.changedTouches).some(t => t.identifier === state.identifier))) state.finish();
}, true);
document.addEventListener('touchcancel', () => cancelReorder(), true);
document.addEventListener('pointermove', event => {
  const state = reorderGesture;
  if (state?.input !== 'pointer' || event.pointerId !== state.identifier) return;
  if (!event.buttons) { cancelReorder(); return; }
  state.move(event.clientX, event.clientY, event);
}, true);
document.addEventListener('pointerup', event => {
  const state = reorderGesture;
  if (state?.input === 'pointer' && event.pointerId === state.identifier) state.finish();
}, true);
document.addEventListener('pointercancel', () => cancelReorder(), true);
document.addEventListener('lostpointercapture', event => {
  if (reorderGesture?.input === 'pointer' && reorderGesture.identifier === event.pointerId) cancelReorder();
}, true);
document.addEventListener('focusin', event => {
  const state = reorderGesture;
  if (settlingCleanup || (state && (!state.row.contains(event.target) || event.target.closest('input,.task-actions')))) cancelReorder();
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') cancelReorder(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelReorder(); });
window.addEventListener('blur', () => cancelReorder());
window.addEventListener('pagehide', () => cancelReorder());
window.addEventListener('resize', () => cancelReorder());
window.visualViewport?.addEventListener('resize', () => cancelReorder());
window.addEventListener('scroll', () => {
  if (settlingCleanup || (reorderGesture && performance.now() > reorderGesture.autoScrollUntil)) cancelReorder();
}, { passive: true, capture: true });
updateAdd();
render();
// Update flow: a new worker waits, the app pauses behind a modal until the
// user taps Update. The update is already downloaded, so the tap does not
// need a connection. If activation fails twice, the modal offers a way back
// to the current version so nobody gets stuck; tasks are never touched.
let updateRequested = false;
if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    try {
      sessionStorage.removeItem("listx-update-attempts");
      sessionStorage.removeItem("listx-update-skip");
    } catch {}
    if (updateRequested) location.reload();
  });
  window.addEventListener("load", () =>
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => {
        const overlay = $("#update-overlay");
        const updateBtn = $("#update-button");
        const laterBtn = $("#update-later");
        const errorText = $("#update-error");
        let attempts = 0;
        try {
          attempts =
            parseInt(
              sessionStorage.getItem("listx-update-attempts") || "0",
              10,
            ) || 0;
        } catch {}
        let lastFocus = null;
        const setInert = (on) => {
          document.body
            .querySelectorAll(":scope > *")
            .forEach((el) => {
              if (el !== overlay)
                on
                  ? el.setAttribute("inert", "")
                  : el.removeAttribute("inert");
            });
        };
        // Keep Tab cycling among the modal's own buttons while it is open.
        const trap = (e) => {
          if (e.key !== "Tab") return;
          const btns = [...overlay.querySelectorAll("button")].filter(
            (b) => !b.hidden && !b.disabled,
          );
          e.preventDefault();
          if (!btns.length) return;
          const i = btns.indexOf(document.activeElement);
          const next =
            i === -1
              ? 0
              : (i + (e.shiftKey ? btns.length - 1 : 1)) % btns.length;
          btns[next].focus();
        };
        const show = () => {
          lastFocus = document.activeElement;
          overlay.hidden = false;
          setInert(true);
          document.addEventListener("keydown", trap, true);
          // Two failed tries: offer a way back to the current version.
          const failed = attempts >= 2;
          errorText.hidden = !failed;
          laterBtn.hidden = !failed;
          if (failed) updateBtn.textContent = "Try again";
          updateBtn.focus({ preventScroll: true });
        };
        const hide = () => {
          overlay.hidden = true;
          setInert(false);
          document.removeEventListener("keydown", trap, true);
          if (lastFocus?.isConnected)
            lastFocus.focus({ preventScroll: true });
        };
        const offer = () => {
          // Only an update counts: a first install has no controller yet.
          if (!navigator.serviceWorker.controller) return;
          try {
            if (sessionStorage.getItem("listx-update-skip")) return;
          } catch {}
          show();
        };
        if (reg.waiting) offer();
        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed") offer();
          });
        });
        updateBtn.addEventListener("click", () => {
          updateRequested = true;
          attempts++;
          try {
            sessionStorage.setItem("listx-update-attempts", String(attempts));
          } catch {}
          errorText.hidden = true;
          laterBtn.hidden = true;
          updateBtn.disabled = true;
          updateBtn.textContent = "Updating\u2026";
          if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
          // Fallback: if no controllerchange arrives, reload anyway; a
          // repeated failure then surfaces the error state instead of a loop.
          setTimeout(() => location.reload(), 4000);
        });
        laterBtn.addEventListener("click", () => {
          try {
            sessionStorage.setItem("listx-update-skip", "1");
          } catch {}
          hide();
        });
      })
      .catch(() => {
        $("#connection-status").textContent = "Offline setup unavailable";
      }),
  );
}

// Keep feedback above an open mobile keyboard, including standalone display.
function positionFeedback() {
 const v = window.visualViewport;
 const inset = v ? Math.max(0, window.innerHeight - v.height - v.offsetTop) : 0;
 document.documentElement.style.setProperty('--keyboard-inset', `${inset}px`);
}
window.visualViewport?.addEventListener('resize', positionFeedback);
window.visualViewport?.addEventListener('scroll', positionFeedback);
positionFeedback();
