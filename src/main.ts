import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import './styles.css';

type Role = 'presenter' | 'audience' | 'mobile';

type PresentationState = {
  current_page: number;
  total_pages: number;
  pdf_path: string | null;
  page_image: string | null;
  render_error: string | null;
};

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

    <section class="controls" aria-label="presentation controls">
      <button type="button" data-command="previous">Previous</button>
      <div class="counter" data-counter>1 / 1</div>
      <button type="button" data-command="next">Next</button>
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

  showError(state.render_error);
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

async function invokeState(command: 'next_page' | 'previous_page'): Promise<void> {
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

app.querySelector('[data-command="next"]')?.addEventListener('click', () => {
  void invokeState('next_page');
});

app.querySelector('[data-command="previous"]')?.addEventListener('click', () => {
  void invokeState('previous_page');
});

app.querySelector('[data-command="fullscreen"]')?.addEventListener('click', () => {
  void invoke<boolean>('toggle_fullscreen', { label: windowLabel });
});

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement) {
    return;
  }

  if (event.key === 'ArrowRight' || event.key === ' ' || event.key === 'PageDown') {
    event.preventDefault();
    void invokeState('next_page');
  }

  if (event.key === 'ArrowLeft' || event.key === 'Backspace' || event.key === 'PageUp') {
    event.preventDefault();
    void invokeState('previous_page');
  }

  if (event.key.toLowerCase() === 'f') {
    event.preventDefault();
    void invoke<boolean>('toggle_fullscreen', { label: windowLabel });
  }
});

void listen<PresentationState>('presentation-state', (event) => {
  renderState(event.payload);
});

void invoke<PresentationState>('get_presentation_state')
  .then(renderState)
  .catch((caught) => showError(String(caught)));
void invoke<MonitorInfo[]>('list_monitors').then(renderMonitors);
