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
  light: "#f7f5ef",
  "light-blue": "#f0f4fa",
  "light-sage": "#faf1f5",
};
let appearance = { font: "inter", size: "comfortable" };
try {
  const saved = JSON.parse(storage.get("listx-appearance", "{}"));
  if (["inter", "system", "editorial", "mono"].includes(saved.font))
    appearance.font = saved.font;
  if (["small", "compact", "comfortable", "large"].includes(saved.size))
    appearance.size = saved.size;
} catch {}
function setTheme(theme, save = true) {
  if (!Object.hasOwn(PALETTES, theme)) theme = "dark";
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
  document.documentElement.dataset.size = appearance.size;
  if (save) storage.set("listx-appearance", JSON.stringify(appearance));
  document
    .querySelectorAll("[data-font-option]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        button.dataset.fontOption === appearance.font,
      ),
    );
  document
    .querySelectorAll("[data-size-option]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        button.dataset.sizeOption === appearance.size,
      ),
    );
}
setTheme(storage.get("theme") || "dark", false);
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
document.querySelectorAll("[data-size-option]").forEach((button) =>
  button.addEventListener("click", () => {
    appearance.size = button.dataset.sizeOption;
    applyAppearance();
  }),
);
$("#reset-appearance").addEventListener("click", () => {
  appearance = { font: "inter", size: "comfortable" };
  applyAppearance();
  setTheme("dark");
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
function showToast(message, undo = false) {
  clearTimeout(toastTimer);
  $("#toast-message").textContent = message;
  $("#undo-button").hidden = !undo;
  $("#toast").hidden = false;
  // Undo remains available until dismissed or replaced, not a short timed target.
  if (!undo)
    toastTimer = setTimeout(() => {
      $("#toast").hidden = true;
    }, 5000);
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
  undoSnapshot = null;
  commit("Tasks restored");
  $("#toast").hidden = true;
  ($(".drag-handle") || $("#settings-button")).focus({ preventScroll: true });
});
$("#dismiss-toast").addEventListener("click", () => {
  $("#toast").hidden = true;
  undoSnapshot = null;
});
window.addEventListener("storage", (event) => {
  if (storagePrefix && !event.key?.startsWith(storagePrefix)) return;
  const key = storagePrefix ? event.key.slice(storagePrefix.length) : event.key;
  if (key === "tasks") {
    tasks = readTasks();
    undoSnapshot = null;
    $("#toast").hidden = true;
    render();
  }
  if (key === "theme") setTheme(event.newValue || "dark", false);
  if (key === "listx-appearance") {
    try {
      const a = JSON.parse(event.newValue || "{}");
      if (["inter", "system", "editorial", "mono"].includes(a.font))
        appearance.font = a.font;
      if (["small", "compact", "comfortable", "large"].includes(a.size))
        appearance.size = a.size;
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
let dragging = null;
function installReorder(row, taskId) {
  let timer = null,
    originX = 0,
    originY = 0,
    pressed = false;
  const ignore = (target) => target.closest("input, .task-actions");
  function clearTimer() {
    clearTimeout(timer);
    timer = null;
  }
  function begin(x, y) {
    if (!pressed || $("#task-list").children.length < 2) return;
    const rect = row.getBoundingClientRect();
    const preview = row.cloneNode(true);
    preview.className = row.className + " drag-preview";
    preview.removeAttribute("data-id");
    preview.querySelectorAll("[id]").forEach(element => element.removeAttribute("id"));
    preview.setAttribute("aria-hidden", "true");
    preview.inert = true;
    Object.assign(preview.style, { left: `${rect.left}px`, top: "0", width: `${rect.width}px`, height: `${rect.height}px`, transform: `translate3d(0, ${rect.top}px, 0) scale(1.015)` });
    document.body.append(preview);
    dragging = { id: taskId, row, y, preview, grab: y - rect.top, scrollFrame: null, cancel: () => finish(true) };
    row.classList.add("is-dragging");
    document.body.classList.add("is-reordering");
    $(".task-panel").classList.add("reorder-mode");
    $("#live-status").textContent =
      "Reordering task. Drag up or down, then release.";
    navigator.vibrate?.(20);
    function autoScroll() {
      if (!dragging) return;
      dragging.preview.style.transform = `translate3d(0, ${dragging.y - dragging.grab}px, 0) scale(1.015)`;
      const margin = 90,
        y = dragging.y;
      const delta =
        y < margin
          ? -Math.ceil((margin - y) / 8)
          : y > innerHeight - margin
            ? Math.ceil((y - (innerHeight - margin)) / 8)
            : 0;
      if (delta) {
        window.scrollBy(0, delta);
        place(y);
      }
      dragging.scrollFrame = requestAnimationFrame(autoScroll);
    }
    dragging.scrollFrame = requestAnimationFrame(autoScroll);
  }
  function place(y) {
    const list = $("#task-list");
    const others = Array.from(list.children).filter(item => item !== row);
    const next = others.find(item => {
      return y < list.getBoundingClientRect().top + item.offsetTop + item.offsetHeight / 2;
    });
    if (row.nextElementSibling === (next || null)) return;
    const before = new Map(others.map(item => [item, item.getBoundingClientRect().top]));
    for (const item of others) item.getAnimations().forEach(animation => animation.cancel());
    if (next) list.insertBefore(row, next); else list.append(row);
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (const item of others) {
        const delta = before.get(item) - item.getBoundingClientRect().top;
        if (Math.abs(delta) > 1) item.animate([{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }], { duration: 230, easing: "cubic-bezier(.2,.75,.25,1)" });
      }
    }
  }
  function move(x, y, event) {
    if (!pressed) return;
    if (!dragging && Math.hypot(x - originX, y - originY) > 9) {
      pressed = false;
      clearTimer();
      return;
    }
    if (dragging?.row !== row) return;
    if (event.cancelable) event.preventDefault();
    dragging.y = y;
    place(y);
  }
  function finish(cancelled = false) {
    clearTimer();
    pressed = false;
    if (dragging?.row !== row) return;
    const state = dragging;
    cancelAnimationFrame(state.scrollFrame);
    dragging = null;
    document.body.classList.remove("is-reordering");
    $(".task-panel").classList.remove("reorder-mode");
    const order = Array.from($("#task-list").children).map(item => item.dataset.id);
    if (cancelled) { state.preview.remove(); render(); return; }
    const start = state.preview.getBoundingClientRect();
    applyVisibleOrder(order);
    const target = Array.from($("#task-list").children).find(item => item.dataset.id === taskId);
    if (!target || matchMedia("(prefers-reduced-motion: reduce)").matches) { state.preview.remove(); return; }
    const end = target.getBoundingClientRect();
    target.classList.add("drop-settling");
    const animation = state.preview.animate([
      { transform: `translate3d(0, ${start.top}px, 0) scale(1.015)` },
      { transform: `translate3d(0, ${end.top}px, 0) scale(1)` }
    ], { duration: 190, easing: "cubic-bezier(.2,.75,.25,1)", fill: "forwards" });
    const cleanup = () => { state.preview.remove(); target.classList.remove("drop-settling"); };
    animation.finished.then(cleanup, cleanup);
  }

  row.addEventListener(
    "touchstart",
    (event) => {
      if (ignore(event.target) || event.touches.length !== 1) return;
      const t = event.touches[0];
      originX = t.clientX;
      originY = t.clientY;
      pressed = true;
      clearTimer();
      timer = setTimeout(() => begin(originX, originY), 420);
    },
    { passive: true },
  );
  row.addEventListener(
    "touchmove",
    (event) => {
      if (event.touches.length !== 1) {
        finish(true);
        return;
      }
      const t = event.touches[0];
      move(t.clientX, t.clientY, event);
    },
    { passive: false },
  );
  row.addEventListener("touchend", () => finish());
  row.addEventListener("touchcancel", () => finish(true));
  row.addEventListener("contextmenu", (event) => {
    if (!ignore(event.target)) event.preventDefault();
  });
  row.addEventListener("pointerdown", (event) => {
    if (
      event.pointerType === "touch" ||
      event.button !== 0 ||
      ignore(event.target)
    )
      return;
    originX = event.clientX;
    originY = event.clientY;
    pressed = true;
    clearTimer();
    timer = setTimeout(
      () => {
        begin(originX, originY);
        if (dragging?.row === row) row.setPointerCapture(event.pointerId);
      },
      event.target.closest(".drag-handle") ? 120 : 420,
    );
  });
  row.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "touch")
      move(event.clientX, event.clientY, event);
  });
  row.addEventListener("pointerup", (event) => {
    if (event.pointerType !== "touch") finish();
  });
  row.addEventListener("pointercancel", (event) => {
    if (event.pointerType !== "touch") finish(true);
  });
  row.addEventListener("pointerleave", (event) => {
    if (event.pointerType !== "touch" && !dragging) {
      pressed = false;
      clearTimer();
    }
  });
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && dragging) dragging.cancel();
});
updateAdd();
render();
// Never register a service worker from file://; opening index.html still works.
if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("./sw.js").catch(() => {
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
