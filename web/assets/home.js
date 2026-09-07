/* home-page 首页：状态轮询 + 时钟 + 卡片（左键打开 / 右键容器操作），视觉对齐 Sun-Panel */

const state = {
  settings: {},
  groups: [],
  features: { docker: false, admin: false },
  status: { items: {}, containers: {} },
  probingRequest: false, // 手动/自动探测请求在飞（用于等待态的呼吸点）
  probed: false,         // 本页面是否已触发过探测：未触发前不展示历史缓存，一律灰点
};

const el = (id) => document.getElementById(id);
const toastBox = el('toast');

function toast(msg) {
  toastBox.textContent = msg;
  toastBox.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastBox.classList.remove('show'), 2200);
}

async function api(path, options = {}) {
  // 统一超时：避免请求挂起时页面一直停留在旧状态（如断网时旧的全绿点久不更新）
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), options.timeout || 15000);
  try {
    const res = await fetch(path, { ...options, signal: ctrl.signal });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || res.statusText);
    }
    return res.json();
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('请求超时');
    throw e;
  } finally {
    clearTimeout(timer);
  }
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
let netMode = localStorage.getItem('hp:netMode') || 'auto';

function netLabel(key) { return (NET_MODES.find((m) => m.key === key) || NET_MODES[0]).label; }

function netModeTitle(key) {
  return `访问地址：${key === 'auto' ? '自动选择' : key === 'lan' ? '局域网地址（常用）' : '本机地址（localhost）'}，点击切换`;
}

// 取该卡片应打开的地址：无内网地址时固定用 url
function chooseAddress(item) {
  if (!item || !item.lan_url) return item ? item.url : '';
  if (netMode === 'lan') return item.url;
  if (netMode === 'local') return item.lan_url;
  const h = location.hostname;
  const isLocal = h === 'localhost' || h === '127.0.0.1' || h === '::1';
  return isLocal ? item.lan_url : item.url;
}

// 切换模式后同步卡片悬停提示里的地址（点击打开在 click 时实时取 chooseAddress，无需刷新）
function refreshCardTitles() {
  document.querySelectorAll('.card').forEach((card) => {
    const it = itemById[Number(card.dataset.id)];
    if (!it) return;
    card.title = it.hidden ? '已禁用' : (chooseAddress(it) || '');
  });
}

function bindNetChip() {
  const chip = el('netMode');
  el('netModeText').textContent = netLabel(netMode);
  chip.title = netModeTitle(netMode);
  chip.addEventListener('click', () => {
    const idx = NET_MODES.findIndex((m) => m.key === netMode);
    const next = NET_MODES[(idx + 1) % NET_MODES.length];
    netMode = next.key;
    localStorage.setItem('hp:netMode', next.key);
    // 只更新界面与卡片地址提示，不做整页刷新，避免闪屏
    el('netModeText').textContent = next.label;
    chip.title = netModeTitle(next.key);
    refreshCardTitles();
    toast(`访问地址已切换为「${next.label}」`);
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
    board.innerHTML = state.features.admin
      ? `<div class="empty">还没有任何卡片，去 <a href="/admin">管理后台</a> 添加吧</div>`
      : `<div class="empty">暂无可用的服务卡片</div>`;
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

// 拆分卡片绑定的容器列表（与后端一致：英文/中文逗号或空格分隔）
function splitList(raw) {
  return String(raw || '').split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
}

// 菜单项 SVG 图标（stroke 风格，与后台操作栏一致）
const MENU_ICON = {
  start: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 5.5 11 6.5-11 6.5Z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  restart: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/></svg>',
  memo: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>',
  open: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>',
};

function ctxBtn(act, label, danger) {
  return `<button data-act="${act}"${danger ? ' class="danger"' : ''}><span class="ci">${MENU_ICON[act] || ''}</span><span class="ct">${label}</span></button>`;
}

// 服务（多容器）整体运行状态摘要
function containerSummary(containers, names) {
  if (!names.length) return '';
  const present = names.map((n) => containers[n]).filter(Boolean);
  const running = present.filter((c) => c.state === 'running').length;
  const missing = names.length - present.length;
  let st;
  if (running === names.length) st = '运行中';
  else if (running > 0) st = `${running}/${names.length} 运行`;
  else st = missing > 0 ? '已停止（含未找到容器）' : '已停止';
  return `${names.length} 个容器 · ${st}`;
}

function showCtxMenu(x, y, card) {
  const it = itemById[Number(card.dataset.id)];
  if (!it) return;
  ctxOpenedAt = Date.now();
  const cnames = splitList(it.container_name);
  const ctMap = state.status.containers || {};
  const present = cnames.map((n) => ctMap[n]).filter(Boolean);
  const runningN = present.filter((c) => c.state === 'running').length;
  const withDocker = !!(cnames.length && state.features.docker);
  let title = escapeHTML(it.name);
  if (withDocker) title += ` · ${containerSummary(ctMap, cnames)}`;

  const actions = [];
  if (withDocker && runningN < cnames.length) actions.push(ctxBtn('start', '启动容器'));
  if (withDocker && runningN > 0) actions.push(ctxBtn('stop', '停止容器', true));
  if (withDocker && runningN > 0) actions.push(ctxBtn('restart', '重启容器'));
  if (it.memo) actions.push(ctxBtn('memo', '查看备注'));
  actions.push(ctxBtn('open', '打开链接'));

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
    containerAction(it, act);
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

    // 绑定多容器：任一容器非 running 即视为服务不可用（容器缺失也算不可用）
    let cDown = false;
    if (it && it.container_name) {
      for (const n of splitList(it.container_name)) {
        const c = containers[n];
        if (c && c.state !== 'running') { cDown = true; break; }
      }
    }

    // 探测结果展示开关：后台轮询开启，或本页面已触发过探测（打开自动探测/手动刷新），
    // 才把结果画成红绿点。轮询关闭且本页尚未探测时，不渲染服务端历史缓存，一律灰点。
    const background = String(state.settings.probe_interval ?? 20) !== '0';
    const showProbe = background || !!state.probed;
    const waiting = background || !!state.probingRequest; // 呼吸等待：探测在跑（自动或后台）即将出结果
    dot.className = 'dot';
    if (it && it.hidden) {
      dot.classList.add('idle');
    } else if (showProbe && res && res.checked) {
      dot.classList.add(res.online ? 'online' : 'offline');
    } else if (it && it.probe && waiting) {
      dot.classList.add('pending');
    } else {
      dot.classList.add('idle');
    }

    // 不可点击态：展示探测结果且离线 → 禁点；绑定容器未运行 → 始终禁点
    const probeDown = showProbe && res && res.checked && !res.online;
    card.classList.toggle('dead', (it && !it.hidden && probeDown) || cDown);
    if (it && it.hidden) card.classList.add('disabled');
  });
}

async function refreshStatus() {
  try {
    state.status = await api('/api/status');
    applyStatus();
    return true;
  } catch (e) {
    console.warn('状态刷新失败', e);
    return false;
  }
}

/* ------------------------------------------------------------ 手动探测 */

// 触发一轮探测并逐项即时展示状态（右上角刷新按钮 / 打开页面按设置自动触发）
async function probeNow() {
  const svg = el('refreshBtn').querySelector('svg');
  state.probingRequest = true; // 探测进行中：尚无结果的卡片显示呼吸等待点
  state.probed = true;         // 本轮已发起探测：此后可展示本轮红绿结果
  // 立即撤掉上一轮展示的旧结果（服务端缓存也已在接管时清空），全部回到灰/呼吸等待。
  // 关键：杜绝「断网/刷新瞬间仍残留上一轮旧红绿（如旧全绿）」被误认为当前状态。
  state.status = { ...state.status, items: {} };
  svg.classList.add('spin');
  applyStatus();
  try {
    await api('/api/probe', { method: 'POST' }); // 异步触发，后端随即开始逐项探测，这里很快返回
    // 高频轮询 /api/status：后端每完成一项写一条缓存，这里逐项渲染——
    // 哪个服务先探测完就先亮起（绿/红），不需要等其它服务全部探测完再一起显示。
    await pollProbeResults();
  } catch (e) {
    toast(`探测失败: ${e.message}`);
  } finally {
    state.probingRequest = false;
    svg.classList.remove('spin');
    // 失败/收尾后重画一次：轮询关闭时把等待态收成常亮灰点（不渲染任何过期结果）；
    // 成功时本轮结果已在轮询中画好，此步幂等无副作用。
    if (String(state.settings.probe_interval ?? 20) === '0') applyStatus();
  }
}

// 探测进行中轮询：拉 /api/status 逐项展示，直到服务端 probing=false（本轮全部完成）。
// 单次拉取失败或超时最多等待到 timeoutMs 兜底退出（已收到的部分结果照常展示）。
function pollProbeResults(timeoutMs = 30000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = async () => {
      try {
        const st = await api('/api/status', { timeout: 8000 });
        state.status = st;
        applyStatus();
        if (!st.probing) { resolve(true); return; } // 本轮探测全部完成
      } catch (e) {
        console.warn('轮询探测结果失败', e);
      }
      if (Date.now() - t0 >= timeoutMs) { resolve(false); return; }
      setTimeout(tick, 350); // 短间隔轮询：先完成的服务能尽快点亮
    };
    tick();
  });
}

/* ------------------------------------------------------------ 容器操作 */

// 对卡片绑定的全部容器执行启停/重启（走服务级批量接口，stop 先停应用、start 先拉依赖）
async function containerAction(item, action) {
  const names = splitList(item.container_name);
  const label = { start: '启动', stop: '停止', restart: '重启' }[action] || action;
  const target = names.length > 1 ? `${item.name}（${names.length} 个容器）` : names[0];
  if (action !== 'start' && !confirm(`确认${label}「${target}」？`)) return;
  toast(`正在${label} ${names.length > 1 ? item.name : names[0]}…`);
  try {
    const data = await api(`/api/items/${item.id}/containers/${action}`, { method: 'POST' });
    const failed = (data.results || []).filter((r) => !r.ok);
    if (failed.length) {
      toast(`${label}部分失败：${failed[0].name} ${failed[0].error || ''}`);
    } else {
      toast(`已${label} ${names.length > 1 ? `${names.length} 个容器` : names[0]}`);
    }
    setTimeout(probeNow, 900); // 操作后自动探测一轮并逐项展示最新状态
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
  el('refreshBtn').addEventListener('click', () => probeNow());
  try {
    const data = await api('/api/board');
    state.settings = data.settings || {};
    state.groups = data.groups || [];
    state.features = data.features || state.features;
    // 管理员入口：仅管理员（本机访问）显示，游客不渲染入口
    el('adminLink').style.display = state.features.admin ? '' : 'none';
    const byId = {};
    (state.groups || []).forEach((g) => (g.items || []).forEach((it) => { byId[it.id] = it; }));
    itemById = byId;
    renderBoard();
  } catch (e) {
    el('board').innerHTML = `<div class="empty">加载失败：${escapeHTML(e.message)}</div>`;
    return;
  }
  // 打开页面时是否立即触发一轮探测（设置 probe_on_open=1 默认开启；后台轮询 probe_interval=0 时尤其有用）
  if (String(state.settings.probe_on_open ?? '1') === '1') {
    await probeNow();
  } else {
    await refreshStatus();
  }
  setInterval(refreshStatus, 10000);
}

boot();
