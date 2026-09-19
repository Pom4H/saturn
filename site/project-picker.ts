import './project-picker.css';

/** The hidden select is a compatibility adapter to the workspace's project model. */
export function mountProjectPicker() {
  const source = document.querySelector<HTMLSelectElement>('#project-switch')!;
  const trigger = document.querySelector<HTMLButtonElement>('#project-trigger')!;
  const name = trigger.querySelector<HTMLElement>('.project-trigger-name')!;
  const panel = document.querySelector<HTMLElement>('#project-picker')!;
  const search = panel.querySelector<HTMLInputElement>('input')!;
  const list = panel.querySelector<HTMLElement>('[role=listbox]')!;
  let active = 0;
  let matches: HTMLOptionElement[] = [];
  let returnFocus = true;
  const isOpen = () => panel.matches(':popover-open');
  function sync() {
    name.textContent = source.selectedOptions[0]?.textContent ?? 'Проект';
    trigger.title = name.textContent;
    trigger.disabled = !source.options.length;
    if (isOpen()) render();
  }
  function position() {
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(336, innerWidth - 24);
    panel.style.width = `${width}px`;
    panel.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`;
    panel.style.top = `${Math.min(rect.bottom + 8, innerHeight - 200)}px`;
    panel.style.maxHeight = `${Math.max(160, innerHeight - rect.bottom - 24)}px`;
  }
  function highlight() {
    const rows = [...list.querySelectorAll<HTMLElement>('[role=option]')];
    for (const [index, row] of rows.entries()) row.dataset.highlighted = String(index === active);
    if (rows[active]) {
      search.setAttribute('aria-activedescendant', rows[active].id);
      rows[active].scrollIntoView({ block: 'nearest' });
    } else search.removeAttribute('aria-activedescendant');
  }
  function choose(option: HTMLOptionElement) {
    panel.hidePopover();
    if (option.value !== source.value) {
      source.value = option.value;
      source.dispatchEvent(new Event('change', { bubbles: true }));
      sync();
    }
  }
  function render() {
    list.replaceChildren();
    const query = search.value.trim().toLocaleLowerCase();
    matches = [...source.options].filter(option => !option.disabled && (option.textContent ?? '').toLocaleLowerCase().includes(query));
    active = Math.max(0, Math.min(active, matches.length - 1));
    let lastGroup = '';
    matches.forEach((option, index) => {
      const group = option.parentElement instanceof HTMLOptGroupElement ? option.parentElement.label : 'Сервер';
      if (group !== lastGroup) {
        const heading = document.createElement('div'); heading.className = 'project-picker-group'; heading.textContent = group; heading.setAttribute('role', 'presentation'); list.append(heading); lastGroup = group;
      }
      const row = document.createElement('button'); row.type = 'button'; row.className = 'project-picker-row'; row.id = `project-choice-${index}`; row.dataset.project = option.value;
      row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(option.selected)); row.tabIndex = -1;
      const icon = document.createElement('span'); icon.className = 'project-picker-icon'; icon.innerHTML = `<svg aria-hidden="true"><use href="#${option.value.startsWith('example:') ? 'i-grid' : 'i-folder'}"/></svg>`;
      const title = document.createElement('span'); title.className = 'project-picker-title'; title.textContent = option.textContent;
      row.title = option.textContent ?? '';
      const check = document.createElement('span'); check.className = 'project-picker-check'; check.innerHTML = '<svg aria-hidden="true"><use href="#i-check"/></svg>'; check.hidden = !option.selected;
      row.append(icon, title, check); row.onclick = () => choose(option); row.onpointermove = () => { active = index; highlight(); }; list.append(row);
    });
    if (!matches.length) { const empty = document.createElement('p'); empty.className = 'project-picker-empty'; empty.textContent = 'Проект не найден'; list.append(empty); }
    highlight();
  }
  trigger.onclick = () => {
    if (isOpen()) { panel.hidePopover(); return; }
    search.value = ''; active = [...source.options].findIndex(option => option.selected); returnFocus = true;
    position(); panel.showPopover(); render(); search.focus();
  };
  panel.addEventListener('toggle', () => {
    const open = isOpen(); trigger.setAttribute('aria-expanded', String(open));
    if (!open && returnFocus && (document.activeElement === document.body || panel.contains(document.activeElement))) trigger.focus();
  });
  panel.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); panel.hidePopover(); trigger.focus(); }
    else if (event.target === search && !event.isComposing) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (matches.length) active = (active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length; highlight(); }
      else if (event.key === 'Enter') { event.preventDefault(); if (matches[active]) choose(matches[active]); }
    }
  });
  search.oninput = () => { active = 0; render(); };
  for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-project-action]')) button.onclick = () => {
    returnFocus = false; panel.hidePopover(); trigger.focus();
    document.querySelector<HTMLButtonElement>(button.dataset.projectAction!)?.click();
  };
  window.addEventListener('resize', () => { if (isOpen()) position(); });
  document.addEventListener('scroll', () => { if (isOpen()) position(); }, { passive: true });
  new MutationObserver(sync).observe(source, { childList: true, subtree: true, attributes: true });
  source.addEventListener('change', sync);
  sync();
}
