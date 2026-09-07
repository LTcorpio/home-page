/* home-page 首页：状态轮询 + 时钟 + 卡片（左键打开 / 右键容器操作），视觉对齐 Sun-Panel */

  const state = {
  settings: {},
  groups: [],
  features: { docker: false, admin: false },
  status: { items: {}, containers: {} },
};

const el = (id) => document.getElementById(id);
const toastBox = el('toast');

function toast(msg) {
  toastBox.textContent = msg;
  toastBox.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastBox.classList.remove('show'), 2200);
}

async function api(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
}

function escapeHTML(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ------------------------------------------------------------ 网络模式（内外网地址切换） */

// 模式说明：auto=自动（本机访问选 lan_url，其余用 url）；lan=局域网(常用地址)；local=本机(localhost)
const NET_MODES = [
  { key: 'auto', label: '自动' },
  { key: 'lan', label: '局域网' },
  { key: 'local', label: '本机' },
];
const netMode = localStorage.getItem('hp:netMode') || 'auto';

function netLabel(key) { return (NET_MODES.find((m) => m.key === key) || NET_MODES[0]).label; }

// 取该卡片应打开的地址：无内网地址时固定用 url
function chooseAddress(item) {
  if (!item || !item.lan_url) return item ? item.url : '';
  if (netMode === 'lan') return item.url;
  if (netMode === 'local') return item.lan_url;
  const h = location.hostname;
  const isLocal = h === 'localhost' || h === '127.0.0.1' || h === '::1';
  return isLocal ? item.lan_url : item.url;
}

function bindNetChip() {
  const chip = el('netMode');
  chip.textContent = netLabel(netMode);
  chip.title = `访问地址：${netMode === 'auto' ? '自动选择' : netMode === 'lan' ? '局域网地址（常用）' : '本机地址（localhost）'}，点击切换`;
  chip.addEventListener('click', () => {
    const idx = NET_MODES.findIndex((m) => m.key === netMode);
    const next = NET_MODES[(idx + 1) % NET_MODES.length].key;
    localStorage.setItem('hp:netMode', next);
    location.reload();
  });
}

/* ------------------------------------------------------------ 渲染 */

function renderBoard() {
  document.title = state.settings.site_title || 'Home';
  const wp = el('wallpaper');
  const bg = state.settings.background_image || '';
  if (bg) {
    wp.classList.add('has-image');
    wp.style.background = `url(${bg}) no-repeat`;
    wp.style.backgroundSize = 'cover';
    wp.style.backgroundPosition = 'center';
    wp.style.filter = `blur(${state.settings.background_blur || 2}px)`;
  }
  el('mask').style.background = `rgba(0,0,0,${state.settings.background_mask || 0})`;
  document.querySelector('.page').style.maxWidth = (state.settings.max_width || 1200) + 'px';

  const board = el('board');
  const visible = (state.groups || []).filter((g) => g.items && g.items.length);
  if (!visible.length) {
    board.innerHTML = `<div class="empty">还没有任何卡片，去 <a href="/admin">管理后台</a> 添加吧</div>`;
    return;
  }
  board.innerHTML = visible.map((g) => `
    <section class="group">
      <h2 class="group-title text-shadow">${escapeHTML(g.name)}</h2>
      <div class="grid">
        ${g.items.map(cardHTML).join('')}
      </div>
    </section>`).join('');
  bindCards();
}

function cardHTML(item) {
  const addr = chooseAddress(item) || '';
  const cls = ['card', item.hidden ? 'disabled' : ''].join(' ');
  return `
    <div class="${cls}" data-id="${item.id}" data-container="${escapeHTML(item.container_name || '')}" data-name="${escapeHTML(item.name || '')}" title="${item.hidden ? '已禁用' : escapeHTML(addr)}">
      <span class="dot" data-dot></span>
      <div class="icon-box"><div class="icon">${iconHTML(item)}</div></div>
      <div class="info">
        <div class="info-text">
          <div class="name">${escapeHTML(item.name)}</div>
          <div class="desc">${escapeHTML(item.description || '')}</div>
        </div>
      </div>
    </div>`;
}

function bindCards() {
  const byId = {};
  (state.groups || []).forEach((g) => (g.items || []).forEach((it) => { byId[it.id] = it; }));
  document.querySelectorAll('.card').forEach((card) => {
    card.addEventListener('click', () => {
      const it = byId[Number(card.dataset.id)];
      if (!it) return;
      // 长按刚弹出菜单时，忽略紧随其后的 click（部分浏览器仍会补发）
      if (longPressState.card === card && Date.now() - longPressState.at < 600) {
        longPressState.card = null;
        return;
      }
      if (it.hidden) { toast(`「${it.name}」已禁用`); return; }
      if (card.classList.contains('dead')) { toast(`「${it.name}」当前不可达`); return; }
      const url = chooseAddress(it);
      if (url) window.open(url, '_blank');
    });
    card.addEventListener('contextmenu', (e) => {
      const it = byId[Number(card.dataset.id)];
      if (!canShowMenu(it)) return; // 游客或无内容：放行系统默认菜单
      e.preventDefault();
      showCtxMenu(e.clientX, e.clientY, card);
    });
    if (canShowMenu(byId[Number(card.dataset.id)])) bindLongPress(card);
  });
}

// 菜单是否可用：管理员模式，且卡片未禁用，且有「容器操作」或「备忘录」内容
function canShowMenu(it) {
  return !!(state.features.admin && it && !it.hidden && (!!it.memo || (!!it.container_name && state.features.docker)));
}

// 移动端：长按 500ms 唤出同一个菜单（仅绑定容器的卡片），滑动即取消
const longPressState = { card: null, at: 0 };

function bindLongPress(card) {
  let timer = null;
  let start = null;
  let fired = false;

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    start = null;
  };

  card.addEventListener('touchstart', (e) => {
    const it = itemById[Number(card.dataset.id)];
    if (!canShowMenu(it)) return; // 无菜单（游客/无内容）不拦截
    const t = e.touches[0];
    if (!t) return;
    start = { x: t.clientX, y: t.clientY };
    fired = false;
    timer = setTimeout(() => {
      timer = null;
      fired = true;
      longPressState.card = card;
      longPressState.at = Date.now();
      if (navigator.vibrate) {
        try { navigator.vibrate(15); } catch (err) { /* 部分浏览器不支持 */ }
      }
      showCtxMenu(start.x, start.y, card);
    }, 500);
  }, { passive: true });

  card.addEventListener('touchmove', (e) => {
    if (!start) return;
    const t = e.touches[0];
    if (!t) return;
    if (Math.abs(t.clientX - start.x) > 10 || Math.abs(t.clientY - start.y) > 10) cancel(); // 视为滚动
  }, { passive: true });

  card.addEventListener('touchend', (e) => {
    if (fired) e.preventDefault(); // 长按后不再触发 click 打开链接
    cancel();
  });

  card.addEventListener('touchcancel', cancel);
}

/* ------------------------------------------------------------ 图标 */

let itemById = {};

function iconHTML(item) {
  const text = (item.icon_type === 'text' && item.icon_value)
    ? item.icon_value
    : (item.name || '?').trim().charAt(0) || '?';
  let src = '';
  if (item.icon_type === 'upload' && item.icon_value) {
    src = '/icons/' + encodeURIComponent(item.icon_value);
  } else if (item.icon_type === 'auto' && item.url) {
    src = '/api/icons/proxy?url=' + encodeURIComponent(item.url);
  }
  if (!src) return `<span class="letter text-shadow">${escapeHTML(text)}</span>`;
  return `<img src="${src}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
    + `<span class="letter text-shadow" style="display:none">${escapeHTML(text)}</span>`;
}

/* ------------------------------------------------------------ 右键菜单（容器启停） */

const ctx = el('ctxMenu');

function showCtxMenu(x, y, card) {
  const it = itemById[Number(card.dataset.id)];
  if (!it) return;
  ctxOpenedAt = Date.now();
  const cname = it.container_name || '';
  const c = cname ? (state.status.containers || {})[cname] : null;
  const running = !!(c && c.state === 'running');
  const withDocker = !!(cname && state.features.docker);
  let title = escapeHTML(it.name);
  if (withDocker) title += ` · ${c ? (running ? '运行中' : c.state === 'missing' ? '容器缺失' : '已停止') : '—'}`;

  const actions = [];
  if (withDocker && !running) actions.push('<button data-act="start">启动容器</button>');
  if (withDocker && running) actions.push('<button data-act="stop" class="danger">停止容器</button>');
  if (withDocker && running) actions.push('<button data-act="restart">重启容器</button>');
  if (it.memo) actions.push('<button data-act="memo">查看备注</button>');
  actions.push('<button data-act="open">打开链接</button>');

  ctx.innerHTML = `<div class="ctx-title">${title}</div>${actions.join('')}`;
  ctx.style.display = 'block';
  ctx.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    hideCtxMenu();
    const act = b.dataset.act;
    if (act === 'memo') { openMemoPop(it); return; }
    if (act === 'open') {
      if (card.classList.contains('dead')) {
        toast(`「${it.name}」当前不可达`);
        return;
      }
      const url = chooseAddress(it);
      if (url) window.open(url, '_blank');
      return;
    }
    containerAction(cname, act);
  }));
  // 视口边界自适应
  const r = ctx.getBoundingClientRect();
  const px = Math.min(x, window.innerWidth - r.width - 8);
  const py = Math.min(y, window.innerHeight - r.height - 8);
  ctx.style.left = Math.max(8, px) + 'px';
  ctx.style.top = Math.max(8, py) + 'px';
}

/* ------------------------------------------------------------ 备忘录浮层 */

const memoMask = el('memoMask');

function openMemoPop(it) {
  el('memoTitle').textContent = `${it.name} · 备注`;
  el('memoBody').textContent = it.memo || '';
  memoMask.style.display = 'flex';
}

function closeMemoPop() { memoMask.style.display = 'none'; }

el('memoClose').addEventListener('click', closeMemoPop);
memoMask.addEventListener('click', (e) => { if (e.target === memoMask) closeMemoPop(); });

let ctxOpenedAt = 0; // 菜单打开时间，用于跳过“打开瞬间浏览器补发的滚动事件”

function hideCtxMenu() { ctx.style.display = 'none'; }

document.addEventListener('click', (e) => { if (!ctx.contains(e.target)) hideCtxMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideCtxMenu(); });
window.addEventListener('blur', hideCtxMenu);
// 滚动关闭菜单：跳过打开后 250ms 内的合成滚动（无实际位移也会触发 scroll）
window.addEventListener('scroll', () => {
  if (Date.now() - ctxOpenedAt > 250) hideCtxMenu();
}, true);

/* ------------------------------------------------------------ 状态 */

function applyStatus() {
  const items = state.status.items || {};
  const containers = state.status.containers || {};
  const byId = itemById;
  document.querySelectorAll('.card').forEach((card) => {
    const id = Number(card.dataset.id);
    const it = byId[id];
    const res = items[id];
    const dot = card.querySelector('[data-dot]');
    const dead = it && !it.hidden && (res && res.checked && !res.online);
    const cname = it ? it.container_name : '';
    const c = cname ? containers[cname] : null;
    const cDown = !!(c && c.state !== 'running');

    // 状态点：轮询关闭/禁用/未开启探测 → 常亮灰点不闪烁；探测进行中 → 淡入淡出；在线/离线 → 对应颜色
    const probing = String(state.settings.probe_interval ?? 20) !== '0';
    dot.className = 'dot';
    if (!probing || (it && it.hidden)) {
      dot.classList.add('idle');
    } else if (res && res.online) {
      dot.classList.add('online');
    } else if (res && res.checked && !res.online) {
      dot.classList.add('offline');
    } else if (it && it.probe) {
      dot.classList.add('pending');
    } else {
      dot.classList.add('idle');
    }

    // 不可点击态：探测离线（轮询关闭时不判断）或绑定容器未运行（始终判断）
    card.classList.toggle('dead', (probing && dead) || cDown);
    if (it && it.hidden) card.classList.add('disabled');
  });
}

async function refreshStatus() {
  try {
    state.status = await api('/api/status');
    applyStatus();
  } catch (e) {
    console.warn('状态刷新失败', e);
  }
}

/* ------------------------------------------------------------ 容器操作 */

async function containerAction(name, action) {
  const label = { start: '启动', stop: '停止', restart: '重启' }[action] || action;
  if (action !== 'start' && !confirm(`确认${label}容器「${name}」？`)) return;
  toast(`正在${label} ${name}…`);
  try {
    await api(`/api/containers/${encodeURIComponent(name)}/${action}`, { method: 'POST' });
    toast(`已${label} ${name}`);
    setTimeout(refreshStatus, 900);
  } catch (e) {
    toast(`${label}失败: ${e.message}`);
  }
}

/* ------------------------------------------------------------ 时钟（仅日期与时间） */

const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function tickClock() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  el('clockTime').textContent = `${p(d.getHours())}:${p(d.getMinutes())}`;
  el('clockDate').textContent = `${d.getMonth() + 1}-${d.getDate()}`;
  el('clockWeek').textContent = weekdays[d.getDay()];
}

/* ------------------------------------------------------------ 启动 */

async function boot() {
  tickClock();
  setInterval(tickClock, 1000);
  bindNetChip();
  try {
    const data = await api('/api/board');
    state.settings = data.settings || {};
    state.groups = data.groups || [];
    state.features = data.features || state.features;
    const byId = {};
    (state.groups || []).forEach((g) => (g.items || []).forEach((it) => { byId[it.id] = it; }));
    itemById = byId;
    renderBoard();
  } catch (e) {
    el('board').innerHTML = `<div class="empty">加载失败：${escapeHTML(e.message)}</div>`;
    return;
  }
  await refreshStatus();
  setInterval(refreshStatus, 10000);
}

boot();
