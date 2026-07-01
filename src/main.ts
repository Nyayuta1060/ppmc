import './styles.css';

type Role = 'presenter' | 'audience' | 'mobile';

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
      <div class="status" aria-label="connection status">PoC</div>
    </section>

    <section class="stage" aria-label="slide preview">
      <div class="slide-frame">
        <span>PDF page preview</span>
      </div>
    </section>

    <section class="controls" aria-label="presentation controls">
      <button type="button" data-command="previous">Previous</button>
      <div class="counter">1 / 1</div>
      <button type="button" data-command="next">Next</button>
    </section>
  </main>
`;
