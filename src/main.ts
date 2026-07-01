import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './styles.css';

type Role = 'presenter' | 'audience' | 'mobile';

type PresentationState = {
  current_page: number;
  total_pages: number;
};

const params = new URLSearchParams(window.location.search);
const role = (params.get('role') as Role | null) ?? 'presenter';

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
      <div class="status" aria-label="connection status">Synced</div>
    </section>

    <section class="stage" aria-label="slide preview">
      <div class="slide-frame">
        <div>
          <p class="slide-label">PDF page preview</p>
          <p class="slide-number" data-slide-number>1</p>
        </div>
      </div>
    </section>

    <section class="controls" aria-label="presentation controls">
      <button type="button" data-command="previous">Previous</button>
      <div class="counter" data-counter>1 / 1</div>
      <button type="button" data-command="next">Next</button>
    </section>
  </main>
`;

const counter = app.querySelector<HTMLElement>('[data-counter]');
const slideNumber = app.querySelector<HTMLElement>('[data-slide-number]');

function renderState(state: PresentationState): void {
  const label = `${state.current_page} / ${state.total_pages}`;

  if (counter) {
    counter.textContent = label;
  }

  if (slideNumber) {
    slideNumber.textContent = String(state.current_page);
  }
}

async function sendCommand(command: 'next_page' | 'previous_page'): Promise<void> {
  const state = await invoke<PresentationState>(command);
  renderState(state);
}

app.querySelector('[data-command="next"]')?.addEventListener('click', () => {
  void sendCommand('next_page');
});

app.querySelector('[data-command="previous"]')?.addEventListener('click', () => {
  void sendCommand('previous_page');
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowRight' || event.key === ' ' || event.key === 'PageDown') {
    event.preventDefault();
    void sendCommand('next_page');
  }

  if (event.key === 'ArrowLeft' || event.key === 'Backspace' || event.key === 'PageUp') {
    event.preventDefault();
    void sendCommand('previous_page');
  }
});

void listen<PresentationState>('presentation-state', (event) => {
  renderState(event.payload);
});

void invoke<PresentationState>('get_presentation_state').then(renderState);
