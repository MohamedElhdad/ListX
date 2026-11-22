const storagePrefix = location.pathname.toLowerCase().startsWith("/listx/") ? "listx:/ListX/:" : "";
'use strict';
// No framework or build step. Keep the original `tasks` and `theme` storage keys.
const $ = (selector) => document.querySelector(selector);
const storage = {
  get(key, fallback = null, session = false) {
    try { return (session ? sessionStorage : localStorage).getItem(storagePrefix + key) ?? fallback; }
    catch { warnStorage(); return fallback; }
  },
  set(key, value, session = false) {
    try { (session ? sessionStorage : localStorage).setItem(storagePrefix + key, value); return true; }
    catch { warnStorage(); return false; }
  }
};
function warnStorage() { $('#storage-warning').hidden = false; }
function id() { return globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
function readTasks() {
  const raw = storage.get('tasks');
  if (!raw) return [];
  try {
    const values = JSON.parse(raw);
    if (!Array.isArray(values)) throw new Error('Invalid task data');
    let legacyDone = [];
    try { const old = JSON.parse(storage.get('line', '[]')); if (Array.isArray(old)) legacyDone = old; } catch {}
    const seen = new Set();
    return values.map(value => {
      const task = typeof value === 'string' ? { text: value, done: legacyDone.includes(value) } : value;
      if (!task || typeof task.text !== 'string') throw new Error('Invalid task record');
      const taskId = typeof task.id === 'string' && !seen.has(task.id) ? task.id : id();
      seen.add(taskId);
      return { id: taskId, text: task.text, done: task.done === true };
    });
  } catch {
    // Preserve unrecognised data rather than silently overwriting it.
    recoveryNeeded = true;
    $('#storage-warning').textContent = 'Saved task data could not be read. It has not been changed. Back up your browser data before adding tasks.';
    warnStorage();
    return [];
  }
}
let recoveryNeeded = false;
let tasks = readTasks();
let currentFilter = 'all';
let search = '';
let undoSnapshot = null;
let toastTimer;
let editingId = null;
let lastFocus = null;

function persist() {
  if (recoveryNeeded) {
    showToast('Saved data needs recovery. No changes were saved.');
    return;
  }
  storage.set('tasks', JSON.stringify(tasks));
}
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  storage.set('theme', theme);
  $('meta[name="theme-color"]').content = theme === 'light' ? '#f6f8f3' : '#101816';
  $('#theme-toggle').setAttribute('aria-label', `Switch to ${theme === 'light' ? 'dark' : 'light'} theme`);
}
setTheme(storage.get('theme') === 'light' ? 'light' : 'dark');
$('#theme-toggle').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
$('#date-label').textContent = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`); svg.append(use); return svg;
}
function actionButton(name, label, handler) {
  const button = document.createElement('button');
  button.type = 'button'; button.title = label; button.setAttribute('aria-label', label);
  button.append(icon(name)); button.addEventListener('click', handler); return button;
}
function commit(announcement) { persist(); render(); if (announcement) $('#live-status').textContent = announcement; }
function taskRow(task) {
  const li = document.createElement('li'); li.className = `task${task.done ? ' done' : ''}`; li.dataset.id = task.id;
  const check = document.createElement('input'); check.type = 'checkbox'; check.className = 'task-checkbox'; check.checked = task.done;
  check.setAttribute('aria-label', `Mark ${task.text} ${task.done ? 'active' : 'complete'}`);
  check.addEventListener('change', () => {
    task.done = check.checked; commit(task.done ? 'Task completed' : 'Task marked active');
    const replacement = Array.from($('#task-list').children).find(row => row.dataset.id === task.id);
    (replacement?.querySelector('input') || $(`[data-filter="${currentFilter}"]`)).focus();
  });
  const text = document.createElement('p'); text.className = 'task-content'; text.dir = 'auto'; text.textContent = task.text;
  text.addEventListener('dblclick', () => openEdit(task.id));
  // Keep long-press copy without blocking normal text selection elsewhere.
  let timer, copied = false, lastTap = 0;
  text.addEventListener('touchstart', () => { copied = false; timer = setTimeout(async () => {
    copied = true;
    try { await navigator.clipboard.writeText(task.text); showToast('Task copied'); }
    catch { showToast('Copy is unavailable. Select the task text to copy it.'); }
  }, 550); }, { passive: true });
  ['touchmove', 'touchcancel'].forEach(event => text.addEventListener(event, () => clearTimeout(timer), { passive: true }));
  text.addEventListener('touchend', event => {
    clearTimeout(timer); if (copied) { lastTap = 0; return; }
    const now = Date.now(); if (now - lastTap < 300) { event.preventDefault(); openEdit(task.id); lastTap = 0; } else lastTap = now;
  });
  const actions = document.createElement('div'); actions.className = 'task-actions';
  actions.append(actionButton('edit', `Edit ${task.text}`, () => openEdit(task.id)), actionButton('trash', `Delete ${task.text}`, () => {
    undoSnapshot = tasks.map(t => ({ ...t })); tasks = tasks.filter(t => t.id !== task.id); commit('Task deleted');
    showToast('Task deleted', true); $('#task-input').focus();
  }));
  li.append(check, text, actions); return li;
}
function render() {
  const total = tasks.length, done = tasks.filter(t => t.done).length, active = total - done;
  const percent = total ? Math.round(done / total * 100) : 0;
  for (const [selector, value] of Object.entries({ '#stat-total': total, '#stat-active': active, '#stat-completed': done, '#heading-count': total, '#nav-count': active, '#filter-all': total, '#filter-active': active, '#filter-completed': done })) $(selector).textContent = value;
  $('#remaining-label').textContent = `${active} ${active === 1 ? 'task' : 'tasks'} left`;
  $('#progress-value').textContent = `${percent}%`;
  $('#progress-ring').style.setProperty('--progress', `${percent}%`);
  $('#progress-ring').setAttribute('aria-valuenow', percent);
  $('#progress-caption').textContent = total ? `${percent}% of your list, done` : 'A fresh start';
  $('#clear-all').disabled = !total || recoveryNeeded;
  $('#clear-completed').hidden = !done;
  const query = search.trim().toLocaleLowerCase();
  const visible = tasks.filter(t => (currentFilter === 'all' || (currentFilter === 'completed' ? t.done : !t.done)) && t.text.toLocaleLowerCase().includes(query));
  $('#task-list').replaceChildren(...visible.map(taskRow));
  $('#empty-state').hidden = visible.length > 0;
  if (!visible.length) {
    $('#empty-state h3').textContent = query ? 'No matching tasks' : !total ? 'Your next chapter starts here' : currentFilter === 'completed' ? 'Good things take a first step' : 'A little breathing room';
    $('#empty-state p').textContent = query ? 'Try a different search or switch filters.' : !total ? 'Add your first task. Keep it small, make it count.' : currentFilter === 'completed' ? 'Your completed tasks will appear here.' : 'All caught up. Take a moment for yourself.';
  }
}
function updateAdd() { $('#add-button').disabled = !$('#task-input').value.trim() || recoveryNeeded; }
$('#task-input').value = storage.get('task-input', '', true);
$('#task-input').addEventListener('input', () => { storage.set('task-input', $('#task-input').value, true); updateAdd(); });
$('#add-form').addEventListener('submit', event => {
  event.preventDefault(); const text = $('#task-input').value.trim(); if (!text || recoveryNeeded) return;
  tasks.push({ id: id(), text, done: false });
  // Show a newly added task even when the user was in a filtered view.
  setFilter('all'); search = ''; $('#search-input').value = '';
  $('#task-input').value = ''; storage.set('task-input', '', true); updateAdd(); commit('Task added'); $('#task-input').focus();
});
function setFilter(filter) {
  currentFilter = filter;
  document.querySelectorAll('[data-filter]').forEach(button => {
    const selected = button.dataset.filter === filter; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', selected);
  }); render();
}
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => setFilter(button.dataset.filter)));
$('#all-nav').addEventListener('click', () => { search = ''; $('#search-input').value = ''; setFilter('all'); });
$('#search-input').addEventListener('input', event => { search = event.target.value; render(); });

function openEdit(taskId) {
  const task = tasks.find(t => t.id === taskId); if (!task) return;
  editingId = taskId; lastFocus = document.activeElement; $('#edit-input').value = task.text; $('#edit-save').disabled = false;
  $('#edit-dialog').showModal(); $('#edit-input').focus(); $('#edit-input').select();
}
$('#edit-input').addEventListener('input', () => { $('#edit-save').disabled = !$('#edit-input').value.trim(); });
$('#edit-form').addEventListener('submit', event => {
  event.preventDefault(); const text = $('#edit-input').value.trim(); if (!text) return;
  const task = tasks.find(t => t.id === editingId); if (task) task.text = text;
  commit('Task updated'); $('#edit-dialog').close();
});
$('#edit-cancel').addEventListener('click', () => $('#edit-dialog').close());
$('#edit-dialog').addEventListener('close', () => {
  const row = Array.from($('#task-list').children).find(element => element.dataset.id === editingId);
  if (lastFocus?.isConnected) lastFocus.focus(); else (row?.querySelector('.task-actions button') || $('#task-input')).focus();
  editingId = null;
});
$('#clear-all').addEventListener('click', () => { $('#clear-dialog').showModal(); $('#clear-cancel').focus(); });
$('#clear-cancel').addEventListener('click', () => $('#clear-dialog').close());
$('#clear-confirm').addEventListener('click', () => {
  undoSnapshot = tasks.map(t => ({ ...t })); tasks = []; commit('All tasks cleared'); $('#clear-dialog').close(); showToast('All tasks cleared', true); $('#task-input').focus();
});
$('#clear-completed').addEventListener('click', () => {
  undoSnapshot = tasks.map(t => ({ ...t })); tasks = tasks.filter(t => !t.done); commit('Completed tasks cleared'); showToast('Completed tasks cleared', true); $('#task-input').focus();
});
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', event => {
  if (event.target !== dialog) return; const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});
function showToast(message, undo = false) {
  clearTimeout(toastTimer); $('#toast-message').textContent = message; $('#undo-button').hidden = !undo; $('#toast').hidden = false;
  // Undo remains available until dismissed or replaced, not a short timed target.
  if (!undo) toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5000);
}
$('#undo-button').addEventListener('click', () => {
  if (!undoSnapshot) return;
  // Preserve tasks added since the delete, and restore the old order/state.
  const restoredIds = new Set(undoSnapshot.map(t => t.id));
  const currentById = new Map(tasks.map(t => [t.id, t]));
  tasks = [...undoSnapshot.map(t => currentById.get(t.id) || t), ...tasks.filter(t => !restoredIds.has(t.id))]; undoSnapshot = null;
  commit('Tasks restored'); $('#toast').hidden = true; $('#task-input').focus();
});
$('#dismiss-toast').addEventListener('click', () => { $('#toast').hidden = true; undoSnapshot = null; });
window.addEventListener('storage', event => {
  if(storagePrefix && !event.key?.startsWith(storagePrefix)) return;
  const changedKey = storagePrefix ? event.key.slice(storagePrefix.length) : event.key;
  if (changedKey === 'tasks') { tasks = readTasks(); undoSnapshot = null; $('#toast').hidden = true; render(); }
  if (changedKey === 'theme') setTheme(event.newValue === 'light' ? 'light' : 'dark');
});
updateAdd(); render();
// Never register a service worker from file://; opening index.html still works.
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {
    $('#connection-status').textContent = 'Offline setup unavailable';
  }));
}
