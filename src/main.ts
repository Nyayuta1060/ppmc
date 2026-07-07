import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import './styles.css';

type Role = 'presenter' | 'audience' | 'mobile';

type PresentationState = {
  current_page: number;
  total_pages: number;
  pdf_path: string | null;
  notes_path: string | null;
  current_notes: string | null;
  page_image: string | null;
  render_error: string | null;
  notes_error: string | null;
};

type PresentationCommand = 'first_page' | 'previous_page' | 'next_page' | 'last_page';

type MonitorInfo = {
  index: number;
  name: string | null;
  width: number;
  height: number;
  x: number;
  y: number;
  scale_factor: number;
};

const params = new URLSearchParams(window.location.search);
const role = (params.get('role') as Role | null) ?? 'presenter';
const windowLabel = role === 'audience' ? 'audience' : 'presenter';

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('missing #app root');
}

const roleTitle: Record<Role, string> = {
  presenter: 'Presenter Console',
  audience: 'Audience Screen',
  mobile: 'Mobile Console',
};

app.innerHTML = `
  <main class="shell shell--${role}">
    <section class="toolbar">
      <div>
        <p class="eyebrow">ppmc</p>
        <h1>${roleTitle[role]}</h1>
      </div>
      <div class="status" aria-label="connection status" data-status>Ready</div>
    </section>

    <form class="load-panel" data-load-form>
      <label for="pdf-path">PDF path</label>
      <div class="load-row">
        <input id="pdf-path" name="pdf-path" type="text" placeholder="/path/to/slides.pdf" data-pdf-path />
        <button type="button" data-choose-pdf>Choose PDF</button>
        <button type="submit">Load PDF</button>
      </div>
      <label for="notes-path">ppmc notes</label>
      <div class="load-row">
        <input id="notes-path" name="notes-path" type="text" placeholder="/path/to/slides.ppmc" data-notes-path />
        <button type="button" data-choose-notes>Choose Notes</button>
        <button type="button" data-load-notes>Load Notes</button>
      </div>
      <p class="error" data-error hidden></p>
    </form>

    <section class="stage" aria-label="slide preview">
      <div class="slide-frame">
        <img class="slide-image" alt="Rendered PDF page" data-slide-image hidden />
        <div class="slide-placeholder" data-slide-placeholder>
          <p class="slide-label">PDF page preview</p>
          <p class="slide-number" data-slide-number>1</p>
        </div>
      </div>
    </section>

    <section class="notes-panel" aria-label="presenter notes">
      <div class="panel-heading">
        <h2>Presenter Notes</h2>
        <span data-notes-source>No .ppmc loaded</span>
      </div>
      <pre data-current-notes>No notes for this page.</pre>
    </section>

    <section class="controls" aria-label="presentation controls">
      <button type="button" data-command="first">First</button>
      <button type="button" data-command="previous">Previous</button>
      <div class="counter" data-counter>1 / 1</div>
      <button type="button" data-command="next">Next</button>
      <button type="button" data-command="last">Last</button>
      <button type="button" data-command="fullscreen">Fullscreen</button>
    </section>

    <section class="monitor-panel" aria-label="monitor information">
      <h2>Monitors</h2>
      <div data-monitors>Loading...</div>
    </section>
  </main>
`;

const counter = app.querySelector<HTMLElement>('[data-counter]');
const slideNumber = app.querySelector<HTMLElement>('[data-slide-number]');
const slideImage = app.querySelector<HTMLImageElement>('[data-slide-image]');
const slidePlaceholder = app.querySelector<HTMLElement>('[data-slide-placeholder]');
const monitors = app.querySelector<HTMLElement>('[data-monitors]');
const status = app.querySelector<HTMLElement>('[data-status]');
const error = app.querySelector<HTMLElement>('[data-error]');
const loadForm = app.querySelector<HTMLFormElement>('[data-load-form]');
const pdfPathInput = app.querySelector<HTMLInputElement>('[data-pdf-path]');
const choosePdfButton = app.querySelector<HTMLButtonElement>('[data-choose-pdf]');
const notesPathInput = app.querySelector<HTMLInputElement>('[data-notes-path]');
const chooseNotesButton = app.querySelector<HTMLButtonElement>('[data-choose-notes]');
const loadNotesButton = app.querySelector<HTMLButtonElement>('[data-load-notes]');
const notesSource = app.querySelector<HTMLElement>('[data-notes-source]');
const currentNotes = app.querySelector<HTMLElement>('[data-current-notes]');
const slideFrame = app.querySelector<HTMLElement>('.slide-frame');

function setStatus(message: string): void {
  if (status) {
    status.textContent = message;
  }
}

function showError(message: string | null): void {
  if (!error) {
    return;
  }

  if (!message) {
    error.hidden = true;
    error.textContent = '';
    return;
  }

  error.hidden = false;
  error.textContent = message;
}

function renderState(state: PresentationState): void {
  const label = `${state.current_page} / ${state.total_pages}`;

  if (counter) {
    counter.textContent = label;
  }

  if (slideNumber) {
    slideNumber.textContent = String(state.current_page);
  }

  if (pdfPathInput && state.pdf_path) {
    pdfPathInput.value = state.pdf_path;
  }

  if (notesPathInput && state.notes_path) {
    notesPathInput.value = state.notes_path;
  }

  if (notesSource) {
    notesSource.textContent = state.notes_path ?? 'No .ppmc loaded';
  }

  if (currentNotes) {
    currentNotes.textContent = state.current_notes?.trim() || 'No notes for this page.';
  }

  if (slideImage && slidePlaceholder) {
    if (state.page_image) {
      slideImage.src = state.page_image;
      slideImage.hidden = false;
      slidePlaceholder.hidden = true;
    } else {
      slideImage.removeAttribute('src');
      slideImage.hidden = true;
      slidePlaceholder.hidden = false;
    }
  }

  showError(state.render_error ?? state.notes_error);
}

function renderMonitors(items: MonitorInfo[]): void {
  if (!monitors) {
    return;
  }

  if (items.length === 0) {
    monitors.textContent = 'No monitors reported';
    return;
  }

  monitors.innerHTML = items
    .map((monitor) => {
      const name = monitor.name ?? `Display ${monitor.index + 1}`;
      return `
        <div class="monitor-item">
          <span>${name}</span>
          <span>${monitor.width}x${monitor.height} @ ${monitor.x},${monitor.y}</span>
        </div>
      `;
    })
    .join('');
}

async function invokeState(command: PresentationCommand): Promise<void> {
  try {
    setStatus('Rendering');
    const state = await invoke<PresentationState>(command);
    renderState(state);
    setStatus('Ready');
  } catch (caught) {
    setStatus('Error');
    showError(String(caught));
  }
}

async function loadNotes(path: string): Promise<void> {
  try {
    showError(null);
    setStatus('Loading notes');
    const state = await invoke<PresentationState>('load_notes', { path });
    renderState(state);
    setStatus('Ready');
  } catch (caught) {
    setStatus('Error');
    showError(String(caught));
  }
}

async function loadPdf(path: string): Promise<void> {
  try {
    showError(null);
    setStatus('Loading');
    const state = await invoke<PresentationState>('load_pdf', { path });
    renderState(state);
    setStatus('Ready');
  } catch (caught) {
    setStatus('Error');
    showError(String(caught));
  }
}

loadForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const path = pdfPathInput?.value.trim();

  if (!path) {
    showError('Enter a PDF path.');
    return;
  }

  void loadPdf(path);
});

loadNotesButton?.addEventListener('click', () => {
  const path = notesPathInput?.value.trim();

  if (!path) {
    showError('Enter a .ppmc notes path.');
    return;
  }

  void loadNotes(path);
});

choosePdfButton?.addEventListener('click', () => {
  void (async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });

    if (typeof selected !== 'string') {
      return;
    }

    if (pdfPathInput) {
      pdfPathInput.value = selected;
    }

    await loadPdf(selected);
  })().catch((caught) => {
    setStatus('Error');
    showError(String(caught));
  });
});

chooseNotesButton?.addEventListener('click', () => {
  void (async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'ppmc notes', extensions: ['ppmc'] }],
    });

    if (typeof selected !== 'string') {
      return;
    }

    if (notesPathInput) {
      notesPathInput.value = selected;
    }

    await loadNotes(selected);
  })().catch((caught) => {
    setStatus('Error');
    showError(String(caught));
  });
});

app.querySelector('[data-command="first"]')?.addEventListener('click', () => {
  void invokeState('first_page');
});

app.querySelector('[data-command="next"]')?.addEventListener('click', () => {
  void invokeState('next_page');
});

app.querySelector('[data-command="previous"]')?.addEventListener('click', () => {
  void invokeState('previous_page');
});

app.querySelector('[data-command="last"]')?.addEventListener('click', () => {
  void invokeState('last_page');
});

app.querySelector('[data-command="fullscreen"]')?.addEventListener('click', () => {
  void invoke<boolean>('toggle_fullscreen', { label: windowLabel });
});

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLButtonElement ||
    target instanceof HTMLSelectElement
  );
}

function toggleFullscreen(): void {
  void invoke<boolean>('toggle_fullscreen', { label: windowLabel });
}

function quitApp(): void {
  void invoke<void>('quit_app');
}

window.addEventListener('keydown', (event) => {
  if (isInteractiveTarget(event.target)) {
    return;
  }

  const key = event.key.toLowerCase();

  const nextKeys = ['ArrowRight', 'ArrowDown', ' ', 'PageDown'];
  const previousKeys = ['ArrowLeft', 'ArrowUp', 'Backspace', 'PageUp'];

  if (nextKeys.includes(event.key) || key === 'n') {
    event.preventDefault();
    void invokeState('next_page');
    return;
  }

  if (previousKeys.includes(event.key) || key === 'p') {
    event.preventDefault();
    void invokeState('previous_page');
    return;
  }

  if (event.key === 'Home') {
    event.preventDefault();
    void invokeState('first_page');
    return;
  }

  if (event.key === 'End') {
    event.preventDefault();
    void invokeState('last_page');
    return;
  }

  if (key === 'f') {
    event.preventDefault();
    toggleFullscreen();
    return;
  }

  if (key === 'q' || event.key === 'Escape') {
    event.preventDefault();
    quitApp();
  }
});

slideFrame?.addEventListener('click', () => {
  void invokeState('next_page');
});

slideFrame?.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  void invokeState('previous_page');
});

slideFrame?.addEventListener('wheel', (event) => {
  if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) {
    return;
  }

  event.preventDefault();
  void invokeState(event.deltaY > 0 ? 'next_page' : 'previous_page');
});

void listen<PresentationState>('presentation-state', (event) => {
  renderState(event.payload);
});

async function initialize(): Promise<void> {
  const state = await invoke<PresentationState>('get_presentation_state');
  renderState(state);

  if (role !== 'presenter' || state.pdf_path) {
    return;
  }

  const startupPdfPath = await invoke<string | null>('get_startup_pdf_path');

  if (startupPdfPath) {
    await loadPdf(startupPdfPath);
  }
}

void initialize().catch((caught) => showError(String(caught)));
void invoke<MonitorInfo[]>('list_monitors').then(renderMonitors);
