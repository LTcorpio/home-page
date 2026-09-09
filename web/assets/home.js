/* home-page 首页：状态轮询 + 时钟 + 卡片（左键打开 / 右键容器操作），视觉对齐 Sun-Panel */

const state = {
  settings: {},
  groups: [],
  features: { docker: false, admin: false },
  identity: {},     // 当前 SSO 登录身份：{user,name,email,groups}（匿名时为空对象）
  probes: {},     // 浏览器直连可达性结果：id -> {online, error?, ts}
  containers: {}, // 容器运行状态：name -> {state, ...}（来自 /api/containers）
  probing: false, // 是否有探测轮次在跑（刷新按钮旋转 + 未出结果的卡片呼吸等待）
};

const el = (id) => document.getElementById(id);
const toastBox = el('toast');

/* ------------------------------------------------ 前端偏好（localStorage，仅当前浏览器生效） */
// 自动探测偏好：原为后端全局配置，随后端探测一起移除；
// 现探测在浏览器内进行，自动重探节奏与时钟显示偏好改为按设备保存在本机，可随时在右上角「页面偏好」调整。
const PREFS = { autoSec: 0, onOpen: false, clockSec: false }; // 默认：关闭自动重探 + 打开页面不立即探测 + 时钟不显示秒（仅手动刷新 / 容器启停时探测）
const PREFS_KEYS = { autoSec: 'hp:autoSec', onOpen: 'hp:onOpen', clockSec: 'hp:clockSec' };

function readPrefs() {
  const sec = parseInt(localStorage.getItem(PREFS_KEYS.autoSec), 10);
  if (!Number.isNaN(sec)) PREFS.autoSec = Math.max(0, Math.min(86400, sec));
  const on = localStorage.getItem(PREFS_KEYS.onOpen);
  if (on !== null) PREFS.onOpen = on === '1';
  const cs = localStorage.getItem(PREFS_KEYS.clockSec);
  if (cs !== null) PREFS.clockSec = cs === '1';
}


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
  const addr = item.url || '';
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
      if (card.classList.contains('dead')) { toast(`「${it.name}」当前不可达${reachReason(it.id)}`); return; }
      const url = it.url;
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
  const ctMap = state.containers || {};
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
        toast(`「${it.name}」当前不可达${reachReason(it.id)}`);
        return;
      }
      const url = it.url;
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

/* ------------------------------------------------------------ 可达性（浏览器直连） */

// 取卡片绑定容器中「未运行」的名字列表。
// 容器缺失（不在容器表内）不计入：接口取失败时容器表为空，若计缺失会导致全页误判红。
function downContainers(it) {
  const down = [];
  if (!it || !it.container_name) return down;
  for (const n of splitList(it.container_name)) {
    const c = state.containers[n];
    if (c && c.state !== 'running') down.push(n);
  }
  return down;
}

// 取卡片离线原因，用于不可达提示与状态点悬停。
// 顺序：容器未运行（与卡片置灰同源，最可靠）→ 浏览器探测的网络错误。
function reachReason(id) {
  const down = downContainers(itemById[id]);
  if (down.length) return `：容器未运行（${down.join('、')}）`;
  const res = state.probes[id];
  return res && res.error ? `：${res.error}` : '';
}

// 单张卡片：用卡片地址（url）让浏览器直接发请求判定可达性。
// 判定原则：http/https 用 fetch(no-cors)——网络可达即在线（拿不到状态码也不关心 3xx/4xx/5xx），
// 网络层不通（断网/拒连/域名解析失败/证书不受信任/超时）即离线。
// 注意：浏览器与服务器容器不同，直接处在真实主机网络栈里，Wi-Fi 断了就必然判红。
const PROBE_TIMEOUT = 4000; // 单次判定超时

async function probeCard(it) {
  const addr = it.url;
  if (!addr) return null;
  if (!/^https?:\/\//i.test(addr)) return null; // 非 Web 地址无法在浏览器判定，跳过（状态点不渲染）
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT);
  try {
    await fetch(addr, {
      method: 'GET',
      mode: 'no-cors', // 跨域也能判定「能否拿到响应」，不被 CORS 头拦截
      redirect: 'follow',
      cache: 'no-store',
      signal: ctrl.signal,
    });
    return { online: true, ts: Date.now() };
  } catch (e) {
    const err = (e && e.name === 'AbortError')
      ? '请求超时'
      : '无法访问（网络不通 / 连接被拒 / 证书不受信任等）';
    return { online: false, error: err, ts: Date.now() };
  } finally {
    clearTimeout(timer);
  }
}

// 探测一轮：清空旧结果 → 逐项浏览器直连 → 先完成的先点亮。
// 支持“打断重来”：再次刷新会启动新代次，旧代次未完成的写入一律丢弃（结果不会过期串扰）。
let probeGen = 0; // 探测代次，启动新轮 +1；旧轮完成时若代次已过期则不再落地

async function probeAll(manual = false) {
  const gen = ++probeGen;
  state.probing = true;
  state.probes = {}; // 撤掉上一轮的旧结果，全部回到灰点，杜绝旧红绿残留
  const svg = el('refreshBtn').querySelector('svg');
  if (manual) svg.classList.add('spin');
  applyStatus();
  const targets = [];
  (state.groups || []).forEach((g) => (g.items || []).forEach((it) => {
    if (it.hidden || !it.probe) return;
    const addr = it.url;
    if (addr && /^https?:\/\//i.test(addr)) targets.push(it); // 仅收集可浏览器判定的 http/https 卡片
  }));
  await Promise.allSettled(targets.map(async (it) => {
    const r = await probeCard(it);
    if (!r || gen !== probeGen) return; // 已被更新的轮次取代：丢弃本次结果
    state.probes[it.id] = r;
    applyStatus(); // 单项完成即点亮
  }));
  if (gen !== probeGen) return; // 期间启动了新轮次：由新轮负责收尾
  state.probing = false;
  if (manual) svg.classList.remove('spin');
  applyStatus();
}

// 自动重探调度：按 PREFS.autoSec 起可重启的定时器；间隔为 0 即停用（仅手动/切模式时探测）
let autoTimer = null;
function armAutoProbe() {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  if (PREFS.autoSec <= 0) return;
  autoTimer = setInterval(() => { if (!document.hidden) probeAll(); }, PREFS.autoSec * 1000);
}

// 拉取容器运行状态（卡片 dead 判定 / 右键菜单摘要用），10 秒一次，与可达性探测无关
async function refreshContainers() {
  if (!state.features.docker) return;
  try {
    const data = await api('/api/containers', { timeout: 8000 });
    state.containers = (data && data.containers) || {};
    applyStatus();
  } catch (e) {
    // 获取失败保留上次状态，不打断页面
  }
}

// 渲染整页状态点与卡片可点性：数据源 = state.probes（浏览器直连结果）+ state.containers
function applyStatus() {
  const byId = itemById;
  document.querySelectorAll('.card').forEach((card) => {
    const id = Number(card.dataset.id);
    const it = byId[id];
    if (!it) return;
    const res = state.probes[id];
    const dot = card.querySelector('[data-dot]');
    const addr = it.url;
    const isWeb = !!(addr && /^https?:\/\//i.test(addr));

    // 绑定多容器：任一容器非 running 即视为服务不可用（容器缺失不计，见 downContainers）
    const downNames = downContainers(it);
    const cDown = downNames.length > 0;

    dot.className = 'dot';
    dot.title = '';
    if (it.hidden) {
      dot.classList.add('idle');
    } else if (cDown) {
      // 容器运行状态优先于浏览器探测：服务停了但 nginx 仍会应答（维护页 / 502），
      // 而 no-cors 探测读不到状态码、一律判绿，就会出现「绿点却点不开」的矛盾。
      // 故容器未运行时直接判红，与卡片置灰、「当前不可达」提示保持同源。
      dot.classList.add('offline');
      dot.title = `离线：容器未运行（${downNames.join('、')}）`;
    } else if (res) {
      if (res.online) {
        dot.classList.add('online');
        dot.title = '在线';
      } else {
        dot.classList.add('offline');
        // 悬停状态点可看到离线原因（如断网/证书不受信任等）
        dot.title = res.error ? `离线：${res.error}` : '离线';
      }
    } else if (it.probe && state.probing && isWeb) {
      dot.classList.add('pending'); // 呼吸等待：正在浏览器探测
    } else if (it.probe && !isWeb && addr) {
      dot.classList.add('idle');
      dot.title = '非网页地址，浏览器无法判定可达性';
    } else {
      dot.classList.add('idle');
    }

    // 不可点击态：浏览器判定离线 → 禁点；绑定容器未运行 → 始终禁点
    const probeDown = res && !res.online;
    card.classList.toggle('dead', (it && !it.hidden && probeDown) || cDown);
    if (it.hidden) card.classList.add('disabled');
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
    setTimeout(probeAll, 900); // 操作后立即按当前模式重探一轮并逐项展示最新状态
  } catch (e) {
    toast(`${label}失败: ${e.message}`);
  }
}

/* ------------------------------------------------------------ 时钟（日期完整 + 可配置显示秒） */

const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function tickClock() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const col = '<span class="col">:</span>';
  const hm = `${p(d.getHours())}${col}${p(d.getMinutes())}`;
  el('clockTime').innerHTML = PREFS.clockSec ? `${hm}${col}${p(d.getSeconds())}` : hm;
  el('clockDate').textContent = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  el('clockWeek').textContent = weekdays[d.getDay()];
}

/* ------------------------------------------------------------ 当前登录身份 */

// 右上角只读展示「我是谁」：显示名优先，悬停显示账号与所属 SSO 组；
// 未携带身份头（匿名）时显示「未登录」，此时只能看到未设访问组的公开卡片。
// 配置了认证中心（settings.auth_portal）时 chip 变为可点击链接，跳转登录/切换账号
function renderIdentity() {
  const id = state.identity || {};
  const chip = el('userChip');
  const label = id.name || id.user || '';
  const groups = Array.isArray(id.groups) ? id.groups : [];
  const portal = (state.settings && state.settings.auth_portal || '').trim();
  if (portal) {
    chip.href = portal;
    chip.setAttribute('aria-label', '前往认证中心');
  } else {
    chip.removeAttribute('href');
    chip.removeAttribute('aria-label');
  }
  if (label) {
    chip.classList.remove('guest');
    el('userChipText').textContent = label;
    const who = `已登录：${id.user || label}（组：${groups.length ? groups.join('、') : '无'}）`;
    chip.title = portal ? `${who}；点击前往认证中心登录 / 切换账号` : who;
  } else {
    chip.classList.add('guest');
    el('userChipText').textContent = '未登录';
    chip.title = portal
      ? '未登录（匿名访客）：点击前往认证中心登录，当前仅显示公开卡片'
      : '未携带 SSO 身份（匿名访客），仅显示公开卡片';
  }
}

/* ------------------------------------------------------------ 启动 */

const setPop = el('setPop');

// 回填弹层输入为指定值（打开时用当前偏好，恢复默认时用默认值）
function fillSetPop(sec, on, cs) {
  el('setSec').value = sec;
  el('setOpen').checked = on;
  el('setClockSec').checked = cs;
}

function applyPrefs(sec, on, cs, msg) {
  localStorage.setItem(PREFS_KEYS.autoSec, String(sec));
  localStorage.setItem(PREFS_KEYS.onOpen, on ? '1' : '0');
  localStorage.setItem(PREFS_KEYS.clockSec, cs ? '1' : '0');
  PREFS.autoSec = sec;
  PREFS.onOpen = on;
  PREFS.clockSec = cs;
  armAutoProbe(); // 间隔变化立即生效，无需重开页面
  tickClock();    // 时钟显示偏好立即生效
  toast(msg);
}

function bindSetPop() {
  const btn = el('setBtn');
  const toggle = () => {
    const show = setPop.style.display === 'none';
    if (show) fillSetPop(PREFS.autoSec, PREFS.onOpen, PREFS.clockSec);
    setPop.style.display = show ? 'block' : 'none';
  };
  btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  el('setSave').addEventListener('click', () => {
    const sec = Math.max(0, Math.min(86400, Math.round(Number(el('setSec').value) || 0)));
    const on = el('setOpen').checked;
    const cs = el('setClockSec').checked;
    setPop.style.display = 'none';
    const parts = [sec > 0 ? `自动重探每 ${sec} 秒` : '已关闭自动重探', on ? '开页即探' : '开页不探', cs ? '时间显示秒' : '时间隐藏秒'];
    applyPrefs(sec, on, cs, `已保存：${parts.join('，')}`);
  });
  el('setReset').addEventListener('click', () => {
    setPop.style.display = 'none';
    applyPrefs(0, false, false, '已恢复默认：关闭自动重探、打开页面不立即探测、时间不显示秒');
  });
  document.addEventListener('click', (e) => {
    if (!setPop.contains(e.target)) setPop.style.display = 'none';
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setPop.style.display = 'none'; });
}

async function boot() {
  readPrefs(); // 先读回本机浏览器里保存的偏好（自动重探间隔 / 打开页面立即探测）
  tickClock();
  setInterval(tickClock, 1000);
  try {
    const data = await api('/api/board');
    state.settings = data.settings || {};
    state.groups = data.groups || [];
    state.features = data.features || state.features;
    state.identity = data.identity || {};
    renderIdentity(); // 右上角展示当前登录身份（SSO 用户名与所属组）
    // 管理员入口：仅管理员（SSO 管理员组）显示，游客不渲染入口
    el('adminLink').style.display = state.features.admin ? '' : 'none';
    const byId = {};
    (state.groups || []).forEach((g) => (g.items || []).forEach((it) => { byId[it.id] = it; }));
    itemById = byId;
    renderBoard();
  } catch (e) {
    el('board').innerHTML = `<div class="empty">加载失败：${escapeHTML(e.message)}</div>`;
    return;
  }
  bindSetPop();
  el('refreshBtn').addEventListener('click', () => probeAll(true));
  // 容器状态：首次拉取后每 10 秒刷新（仅做 dead 判定与右键菜单摘要）
  refreshContainers();
  setInterval(refreshContainers, 10000);
  // 可达性（间隔与开关可在右上角「页面偏好」调整，存本机）：
  // 默认两项均关闭（autoSec=0 且 onOpen=false）：页面打开不做任何自动探测，
  // 仅手动刷新 / 容器启停时触发；开启任一偏好即按各自节奏自动探测
  if (PREFS.onOpen) probeAll(true);
  armAutoProbe();
}

boot();
