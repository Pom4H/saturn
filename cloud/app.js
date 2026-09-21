const $ = selector => document.querySelector(selector);
const loginView = $('#login-view');
const runtimeView = $('#runtime-view');
const connection = $('#connection');
let csrf = '';

function short(value) {
  if (!value) return '—';
  const text = String(value);
  return text.length > 16 ? text.slice(0, 10) + '…' + text.slice(-4) : text;
}
function setConnection(online) {
  connection.className = 'connection ' + (online ? 'online' : 'offline');
  connection.querySelector('span').textContent = online ? 'online' : 'offline';
}
function render(state) {
  loginView.hidden = true;
  runtimeView.hidden = false;
  const project = state.project || {};
  const instance = state.instance || {};
  const frame = state.frame || {};
  const cloud = state.cloud || {};
  $('#project-title').textContent = project.title || project.id || 'Saturn project';
  $('#environment').textContent = cloud.site || instance.cloudSite || location.hostname;
  $('#head').textContent = short(state.head);
  $('#published').textContent = short(state.desired);
  $('#applied').textContent = short(instance.applied || frame.revision);
  $('#instance').textContent = short(instance.instanceId);
  $('#run').textContent = short(frame.runId || instance.runId);
  $('#last-seen').textContent = cloud.lastSeen ? new Date(cloud.lastSeen).toLocaleString() : '—';
  setConnection(cloud.online === true);

  const samples = Object.entries(frame.samples || {}).sort(([a],[b]) => a.localeCompare(b));
  $('#signal-count').textContent = samples.length;
  $('#signals').replaceChildren(...samples.map(([name, sample]) => {
    const row = document.createElement('div');
    row.className = 'signal-row';
    const value = sample?.value;
    row.innerHTML = '<code></code><span class="value"></span><span class="quality"></span>';
    row.children[0].textContent = name;
    row.children[1].textContent = value == null ? '—' : typeof value === 'number' ? value.toLocaleString(undefined,{maximumFractionDigits:3}) : String(value);
    row.children[2].textContent = sample?.quality || 'unknown';
    row.children[2].className = 'quality ' + (sample?.quality || '');
    return row;
  }));

  const alarms = (frame.alarms || []).filter(alarm => alarm?.active);
  $('#alarm-count').textContent = alarms.length;
  const host = $('#alarms');
  if (!alarms.length) host.innerHTML = '<p class="muted">Нет активных аварий</p>';
  else host.replaceChildren(...alarms.map(alarm => {
    const item = document.createElement('div');
    item.className = 'alarm';
    const title = document.createElement('strong');
    const detail = document.createElement('small');
    title.textContent = alarm.id || 'Alarm';
    detail.textContent = alarm.acknowledged ? 'ACKNOWLEDGED' : 'ACTIVE';
    item.append(title, detail);
    return item;
  }));
}
async function api(path, init) {
  const response = await fetch('/plant/api/' + path, {
    ...init,
    headers: {
      ...(init?.body ? {'Content-Type':'application/json'} : {}),
      ...(csrf && init?.method === 'POST' ? {'X-CSRF-Token':csrf} : {}),
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new Error(value?.error || 'Request failed');
  return value;
}
async function refresh() {
  try {
    const state = await api('session');
    csrf = state.csrf || csrf;
    render(state);
  } catch {
    loginView.hidden = false;
    runtimeView.hidden = true;
    connection.className = 'connection';
    connection.querySelector('span').textContent = 'sign in';
  }
}
$('#login').addEventListener('submit', async event => {
  event.preventDefault();
  $('#login-error').textContent = '';
  const data = new FormData(event.currentTarget);
  try {
    const result = await api('login', {
      method: 'POST',
      body: JSON.stringify({user:data.get('user'),password:data.get('password')}),
    });
    csrf = result.csrf || '';
    await refresh();
  } catch (error) {
    $('#login-error').textContent = error instanceof Error ? error.message : 'Не удалось войти';
  }
});
$('#logout').addEventListener('click', async () => {
  try { await api('logout',{method:'POST',body:'{}'}); } catch {}
  csrf = '';
  await refresh();
});
await refresh();
setInterval(() => void refresh(), 2000);
