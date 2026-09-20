import { entities, operators } from '../dsl-reference';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

const tabs = document.querySelector<HTMLElement>('.tabs');
const main = document.querySelector<HTMLElement>('main');

if (tabs && main && !document.querySelector('[data-tab="dsl"]')) {
  const tab = document.createElement('button');
  tab.dataset.tab = 'dsl';
  tab.textContent = 'DSL';
  tab.title = 'Интерактивная документация @saturn/core';
  tabs.insertBefore(tab, tabs.querySelector('[data-tab="extensions"]'));

  const panel = document.createElement('section');
  panel.dataset.panel = 'dsl';
  panel.hidden = true;
  panel.innerHTML = `
    <style>
      .dsl-docs{display:grid;gap:20px}
      .dsl-hero{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(260px,.75fr);gap:18px;align-items:stretch}
      .dsl-hero>div,.dsl-map,.dsl-operators{border:1px solid #cbdbe2;background:#f8fbfc;padding:18px}
      .dsl-kicker{margin:0 0 7px;font:700 10px ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.12em;color:#527383}
      .dsl-hero h2{margin:0 0 9px;font-size:25px;color:#183c4d}
      .dsl-hero p{margin:7px 0;line-height:1.55}
      .dsl-package{display:grid;gap:7px;font:12px ui-monospace,SFMono-Regular,Consolas,monospace}
      .dsl-package span{display:grid;grid-template-columns:116px minmax(0,1fr);gap:8px;padding:7px 0;border-bottom:1px solid #dbe5e9}
      .dsl-package b{color:#173746}.dsl-package code{overflow-wrap:anywhere}
      .dsl-map{overflow:auto}
      .dsl-map-grid{min-width:650px;display:grid;grid-template-columns:repeat(6,minmax(88px,1fr));gap:8px;align-items:center}
      .dsl-map button{min-height:58px;padding:9px;border:1px solid #c7d6dc;background:white;text-align:left;font:600 11px ui-monospace,SFMono-Regular,Consolas,monospace}
      .dsl-map button small{display:block;margin-top:4px;font:10px system-ui;color:#6a818c}
      .dsl-map .arrow{border:0;background:transparent;text-align:center;color:#78909b;font-size:18px;min-height:0}
      .dsl-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .dsl-toolbar input{flex:1;min-width:220px}
      .dsl-categories{display:flex;gap:6px;flex-wrap:wrap}
      .dsl-categories button[aria-pressed=true]{background:#173746;color:white;border-color:#173746}
      .dsl-results{font-size:11px;color:#637d88;margin-left:auto}
      .dsl-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      .dsl-card{border:1px solid #cbdbe2;background:white;min-width:0}
      .dsl-card[data-featured=true]{border-color:#83a9b7;background:#fbfdfe}
      .dsl-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:15px}
      .dsl-card h3{margin:0 0 5px;font:700 17px ui-monospace,SFMono-Regular,Consolas,monospace;color:#173746}
      .dsl-signature{font:11px ui-monospace,SFMono-Regular,Consolas,monospace;color:#527383;overflow-wrap:anywhere}
      .dsl-category{font:700 9px ui-monospace,SFMono-Regular,Consolas,monospace;text-transform:uppercase;letter-spacing:.08em;color:#6a818c}
      .dsl-card p{margin:0;padding:0 15px 14px;line-height:1.5;color:#395b68}
      .dsl-card button[data-dsl-expand]{margin:0 15px 15px;white-space:nowrap}
      .dsl-detail{border-top:1px solid #dbe5e9;padding:14px 15px 16px;background:#f8fbfc}
      .dsl-detail pre{margin:0 0 12px;padding:13px;overflow:auto;background:#102c38;color:#e7f1f4;font:11px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace}
      .dsl-relations{display:flex;gap:5px;flex-wrap:wrap}
      .dsl-relations button{font:10px ui-monospace,SFMono-Regular,Consolas,monospace;padding:5px 7px}
      .dsl-note{margin-top:12px!important;padding:10px!important;background:#eef5f7;border-left:3px solid #5c8797;color:#315563!important}
      .dsl-operators code{display:inline-block;margin:4px 5px 0 0;padding:6px 8px;border:1px solid #d3e0e5;background:white;font-size:11px}
      .dsl-empty{grid-column:1/-1;padding:32px;text-align:center;border:1px dashed #cbdbe2;color:#6a818c}
      @media(max-width:900px){.dsl-hero{grid-template-columns:1fr}.dsl-grid{grid-template-columns:1fr}}
      @media(max-width:680px){.dsl-hero>div,.dsl-map,.dsl-operators{padding:13px}.dsl-package span{grid-template-columns:1fr}.dsl-toolbar{align-items:stretch}.dsl-toolbar input{min-width:100%;width:100%}.dsl-results{width:100%;margin-left:0}.dsl-card-head{flex-direction:column}}
    </style>
    <div class="dsl-docs">
      <div class="dsl-hero">
        <div>
          <p class="dsl-kicker">SATURN · AUTHORING API</p>
          <h2>DSL проекта</h2>
          <p>Один декларативный TypeScript-проект описывает состав установки, сигналы, топологию, управление, PLC, интерфейсы и отчёты. Runtime-состояние и подключение к операторскому Saturn остаются вне исходников.</p>
          <pre><code>import { project, system, simulation, port, pipe } from '@saturn/core'</code></pre>
        </div>
        <div class="dsl-package">
          <span><b>Приложение</b><code>@saturn/scada</code></span>
          <span><b>DSL / contracts</b><code>@saturn/core</code></span>
          <span><b>Расширение</b><code>@saturn/my-extension</code></span>
          <span><b>Project IR</b><code>один на все renderer/runtime targets</code></span>
        </div>
      </div>

      <div class="dsl-map">
        <p class="dsl-kicker">КАК СУЩНОСТИ СВЯЗАНЫ</p>
        <div class="dsl-map-grid" aria-label="Связи сущностей DSL">
          <button type="button" data-dsl-jump="system">system()<small>структура</small></button>
          <span class="arrow">→</span>
          <button type="button" data-dsl-jump="simulation">simulation()<small>поведение</small></button>
          <span class="arrow">→</span>
          <button type="button" data-dsl-jump="port">port()<small>терминал</small></button>
          <span></span>
          <button type="button" data-dsl-jump="signal">signal()<small>данные</small></button>
          <span class="arrow">→</span>
          <button type="button" data-dsl-jump="derived">derived()<small>выражение</small></button>
          <span class="arrow">→</span>
          <button type="button" data-dsl-jump="alarm">alarm()<small>событие</small></button>
          <span></span>
          <button type="button" data-dsl-jump="control">control()<small>уставка</small></button>
          <span class="arrow">→</span>
          <button type="button" data-dsl-jump="plc">plc()<small>логика</small></button>
          <span class="arrow">↔</span>
          <button type="button" data-dsl-jump="cable">cable()<small>электрика / bus</small></button>
          <span></span>
          <button type="button" data-dsl-jump="equipment">equipment()<small>представление</small></button>
          <span class="arrow">←</span>
          <button type="button" data-dsl-jump="pipe">pipe()<small>технология</small></button>
          <span class="arrow">→</span>
          <button type="button" data-dsl-jump="project">project()<small>единый IR</small></button>
        </div>
      </div>

      <div class="dsl-toolbar">
        <input id="dsl-search" type="search" placeholder="Найти pipe, PLC, сигнал, отчёт…" aria-label="Поиск по DSL">
        <div class="dsl-categories" id="dsl-categories"></div>
        <span class="dsl-results" id="dsl-results" aria-live="polite"></span>
      </div>

      <div class="dsl-grid" id="dsl-grid"></div>

      <div class="dsl-operators">
        <p class="dsl-kicker">ВЫРАЖЕНИЯ</p>
        <p>Операторы работают с тем же <code>Expr</code>, что и выходы моделей, derived signals, условия и PLC bindings.</p>
        <div id="dsl-operators"></div>
      </div>
    </div>
  `;
  main.append(panel);

  const search = panel.querySelector<HTMLInputElement>('#dsl-search')!;
  const categories = panel.querySelector<HTMLElement>('#dsl-categories')!;
  const grid = panel.querySelector<HTMLElement>('#dsl-grid')!;
  const results = panel.querySelector<HTMLElement>('#dsl-results')!;
  const operatorHost = panel.querySelector<HTMLElement>('#dsl-operators')!;
  const allCategories = ['All', ...new Set(entities.map(entity => entity.category))] as const;
  let category = 'All';

  categories.innerHTML = allCategories.map(name => `<button type="button" data-dsl-category="${escapeHtml(name)}" aria-pressed="${name === 'All'}">${escapeHtml(name)}</button>`).join('');
  operatorHost.innerHTML = operators.map(([, signature]) => `<code>${escapeHtml(signature)}</code>`).join('');

  const render = () => {
    const query = search.value.trim().toLocaleLowerCase('ru');
    const visible = entities.filter(entity => {
      const inCategory = category === 'All' || entity.category === category;
      const haystack = [entity.name, entity.signature, entity.category, entity.summary, entity.relations.join(' '), entity.note ?? ''].join(' ').toLocaleLowerCase('ru');
      return inCategory && (!query || haystack.includes(query));
    });
    results.textContent = `${visible.length} / ${entities.length}`;
    grid.innerHTML = visible.length ? visible.map(entity => `
      <article class="dsl-card" data-dsl-entity="${escapeHtml(entity.name)}" data-featured="${String(!!entity.featured)}">
        <div class="dsl-card-head">
          <div>
            <div class="dsl-category">${escapeHtml(entity.category)}</div>
            <h3>${escapeHtml(entity.name)}()</h3>
            <div class="dsl-signature">${escapeHtml(entity.signature)}</div>
          </div>
          ${entity.featured ? '<span class="badge active">core abstraction</span>' : ''}
        </div>
        <p>${escapeHtml(entity.summary)}</p>
        <button type="button" data-dsl-expand="${escapeHtml(entity.name)}" aria-expanded="false">Пример и связи</button>
        <div class="dsl-detail" hidden>
          <pre><code>${escapeHtml(entity.example)}</code></pre>
          <div class="dsl-relations">${entity.relations.map(name => `<button type="button" data-dsl-jump="${escapeHtml(name)}">${escapeHtml(name)}()</button>`).join('')}</div>
          ${entity.note ? `<p class="dsl-note">${escapeHtml(entity.note)}</p>` : ''}
        </div>
      </article>
    `).join('') : '<div class="dsl-empty">Ничего не найдено. Сбросьте категорию или поиск.</div>';
  };

  search.addEventListener('input', render);
  categories.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-dsl-category]');
    if (!button) return;
    category = button.dataset.dslCategory ?? 'All';
    categories.querySelectorAll<HTMLButtonElement>('[data-dsl-category]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    render();
  });

  panel.addEventListener('click', event => {
    const target = event.target as Element;
    const expand = target.closest<HTMLButtonElement>('[data-dsl-expand]');
    if (expand) {
      const card = expand.closest<HTMLElement>('.dsl-card')!;
      const detail = card.querySelector<HTMLElement>('.dsl-detail')!;
      const open = detail.hidden;
      detail.hidden = !open;
      expand.setAttribute('aria-expanded', String(open));
      expand.textContent = open ? 'Свернуть' : 'Пример и связи';
      return;
    }
    const jump = target.closest<HTMLButtonElement>('[data-dsl-jump]');
    if (jump) {
      const name = jump.dataset.dslJump!;
      category = 'All';
      search.value = name;
      categories.querySelectorAll<HTMLButtonElement>('[data-dsl-category]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.dslCategory === 'All')));
      render();
      const card = grid.querySelector<HTMLElement>(`[data-dsl-entity="${CSS.escape(name)}"]`);
      card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card?.querySelector<HTMLButtonElement>('[data-dsl-expand]')?.focus();
    }
  });

  render();
}
