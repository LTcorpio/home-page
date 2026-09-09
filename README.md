# home-page

局域网自用的**导航页 + 服务可达性状态 + Docker 容器启停**，单容器、单二进制、占用 80 端口（访问不用带端口）。
视觉高仿 [Sun-Panel](https://github.com/hslr-s/sun-panel)（壁纸 + 白字阴影 + 半透明深色横向卡片），功能按自己需要裁剪：导航卡片、状态灯、服务地址、容器启停、卡片备忘录。

## 功能

| 模块 | 说明 |
| --- | --- |
| 导航卡片 | 分组展示，图标 + 名称 + 描述，左键新窗口打开 |
| 登录身份 | 右上角显示当前 SSO 身份 chip（显示名，悬停看账号与所属组；未登录显示「未登录」）；**点击 chip 跳转认证中心**（设置 `auth_portal` 指定，默认 Authelia 门户），方便登录 / 切换账号；留空则 chip 不可点 |
| 可达性状态 | **浏览器直连探测**（不再由服务端探测）：卡片右上角状态点由**当前浏览器**直接向卡片地址（`url`）发请求判定，代表「这台设备此刻能否打开该链接」。判定原则：http/https 用 `fetch(no-cors)`，**网络可达即在线**（含任意状态码）；断网/拒连/域名解析失败/证书不受信任/超时即离线。浏览器处在真实主机网络栈里，**Wi-Fi 断开就必然判红**，不存在服务端经容器 NAT「假通」的误报路径 |
| 逐项即时展示 | 一轮探测**异步逐项产出**：自动复探间隔与开页探测由「页面偏好」控制（见下），或点右上角刷新立即测；容器启停后也会自动重探一轮。每个服务探测完成即点亮（绿/红），**不用等全部完成**；再次刷新会打断旧轮重新探测（旧轮未完成的结果直接丢弃，不串扰） |
| 状态点语义 | 在线绿 / 离线红（悬停可看离线原因，如「请求超时」「无法访问（网络不通 / 连接被拒 / 证书不受信任等）」）；正在探测时呼吸等待；非网页地址（无法用浏览器判定）与未开启探测的卡片为灰点 |
| 手动探测 | 右上角刷新按钮随时触发一轮；触发瞬间旧结果立即撤下回灰，**不残留上一轮旧红绿**（断网后旧的绿点不会继续显示） |
| 页面偏好 | 右上角「页面偏好」（滑块图标）弹层，分两组，**按设备**存浏览器 localStorage：**自动探测**——① 自动重探间隔（**默认 0 = 关闭**；设 N>0 后页面可见时每 N 秒自动复探）；② 打开页面是否立即探测一轮（**默认关闭**）。两项均默认关闭时，探测仅由手动刷新 / 容器启停触发。**时钟显示**——时间是否显示到秒（默认关闭）。不影响其他设备 |
| 页面时钟 | 头部时钟日期固定为完整格式（如 `2026-09-08 星期二`，含年份与前导零）；时间默认 `HH:MM`，可在「页面偏好 → 时钟显示」开启显示秒（`HH:MM:SS`），冒号相对数字垂直居中 |
| 不可达禁点 | 浏览器判定离线，或绑定容器未运行 → 卡片置灰且点击被拦截（提示「当前不可达」及原因） |
| 服务地址 | 每张卡片一个访问地址（`url`）：已接入 SSO 的服务填统一域名（如 `https://immich.home.lan/`），未接入的填内网直连地址；卡片打开与可达性探测都用该地址 |
| 管理员 / 访客模式 | 以 **SSO 用户组**区分：Authelia 注入的组命中后台「管理员组」（默认 `admins`）即为管理员——可进后台、启停容器、查看备注，首页也能看到全部卡片；其余为访客，不显示管理入口、看不到备注 |
| 容器启停 | 卡片绑定容器名后，**右键**（移动端**长按**）唤出菜单启停/重启（菜单项带图标）；**一张卡片可绑定多个容器**（英文逗号分隔），操作覆盖全部绑定容器——停服按声明序（先应用后依赖），启动按倒序（先依赖后应用）；白名单外容器不出现；仅管理员可用 |
| 卡片备注 | 每张卡片可写备注/凭证；管理员右键卡片可「查看备注」（有内容才显示入口），游客看不到 |
| 卡片禁用 | 可逐张禁用；首页是否置灰显示按视角分开设置（后台站点设置）：管理员默认显示、访客默认隐藏 |
| 按用户 / 组授权 | 每张卡片可填「访问组」（如 `family`、`admins`，逗号分隔，留空 = 公开）。管理员看全部；访客只看公开卡 + 授权给己组的卡；未携带 SSO 身份的匿名请求只看公开卡。组名来自 Authelia，候选组在后台「站点设置 → 权限」维护 |
| 管理后台 | `/admin`：侧栏分 分组 / 卡片 / 站点设置；卡片支持图标按钮排序、启用禁用、编辑、删除；仅管理员可访问 |

图标三种来源：
1. `auto` —— 服务端代抓目标站点 favicon 并缓存（浏览器不直连目标站）
2. `upload` —— 后台上传图片，或点「抓取 favicon」固化成本地图标
3. `text` —— 文字图标（如「状态」「RIDE」），也是 favicon 抓取失败时的兜底

## 技术栈

- 后端：Go 单二进制 + `net/http`（Go 1.22+ 路由），SQLite（纯 Go 驱动 `modernc.org/sqlite`，无需 CGO）
- 前端：原生 HTML/CSS/JS 两个页面，`go:embed` 打进二进制，无 node_modules、无构建步骤
- Docker 控制：直连 `/var/run/docker.sock` 调 Engine API，不引入 SDK

## 目录结构

```
Programs/home-page/
├── main.go        # 路由与 HTTP 处理
├── store.go       # SQLite：groups / items / settings
├── docker.go      # Docker Engine API（unix socket）
├── icons.go       # favicon 抓取与图标文件
├── web/           # 前端（index.html / admin.html / assets）
├── Dockerfile     # 多阶段构建
└── build.sh       # 构建镜像
```

运行时数据（由 compose 挂载，`./home-page` 相对 compose 目录）：

```
Docker/compose/lifestyle/home-page/
├── home-page.db   # 数据库
├── icons/         # 上传与抓取的图标（含壁纸）
└── (home-page.db-wal / -shm)   # SQLite WAL 临时文件：运行期存在，
                                # docker stop 优雅退出时自动折回主库并删除
```

程序对 SIGTERM（docker stop / compose down）做优雅停机：先停 HTTP 接收新请求，
再执行 WAL 检查点并关闭数据库，`-wal/-shm` 临时文件随之清理，数据目录只剩主库。
服务被强杀（SIGKILL/断电）时残留的 WAL 会在下次启动时自动回放并收尾，数据不丢。

## 部署

服务已并入 lifestyle 栈管理（与 film-memo / personal-crm 等同一 compose 文件）：

```bash
# 1) 构建镜像
cd "/Volumes/ZHITAI TiPlus5000 1TB/Programs/home-page" && ./build.sh

# 2) 启动 / 重启
cd "/Volumes/ZHITAI TiPlus5000 1TB/Docker/compose/lifestyle" && docker compose up -d home-page
```

- 容器端口映射为 `127.0.0.1:8080:80`（**只绑本机**）：宿主 nginx 在 `https://home.lan` 反代 `http://127.0.0.1:8080` 并做 Authelia 鉴权
- 访问地址 `https://home.lan`（需 SSO 登录）；管理后台 `https://home.lan/admin`，仅管理员组能进

### 访问模式

| 身份 | 判定 | 权限 |
| --- | --- | --- |
| 所属组命中 `admin_groups`（默认 `admins`） | 管理员 | 管理后台、卡片右键（容器启停 / 查看备注）、备忘录可见、首页看到全部卡片 |
| 其它已登录用户（如 `family`） | 访客 | 纯导航 + 公开卡 + 授权给己组的卡；无右键菜单，管理接口一律 403 |
| 未携带身份头的匿名请求 | 访客 | 仅公开卡（正常应不出现：所有访问都经 nginx 登录） |

## 环境变量（均有镜像默认值，compose 无需重复设置）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `80` | 监听端口 |
| `DATA_DIR` | `/data` | 数据库与图标目录 |
| `SEED_HOST` | `192.168.1.100` | 首次初始化示例卡片用的宿主地址 |
| `DOCKER_SOCK` | `/var/run/docker.sock` | Docker Engine API 套接字 |
| `TRUSTED_PROXY_CIDRS` | `127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,100.64.0.0/10,169.254.0.0/16,198.18.0.0/15,::1/128,fc00::/7` | 允许注入身份头（`Remote-User` / `Remote-Groups`）的来源网段，CIDR 逗号分隔；不在范围内按匿名处理 |

## 站点设置项

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `site_title` | Home | 浏览器标签页标题 |
| `show_disabled` | 1 | 管理员首页是否置灰显示禁用卡片 |
| `show_disabled_guest` | 0 | 访客首页是否置灰显示禁用卡片 |
| `docker_enabled` | 1 | 是否允许容器启停 |
| `background_image` | 空 | 壁纸地址，如 `/icons/bg.jpg` |
| `background_mask` | 0 | 壁纸黑色遮罩 0~1 |
| `background_blur` | 2 | 壁纸模糊 px |
| `admin_groups` | admins | 拥有管理后台权限的 SSO 用户组（逗号分隔；命中即为管理员） |
| `known_groups` | admins,family | 卡片「访问组」输入框的下拉候选（仅提示，不参与判定） |
| `auth_portal` | https://authelia.home.lan/ | SSO 认证中心地址：右上角身份 chip 点击跳转（登录 / 切换账号）；留空则 chip 不可点 |
| `max_width` | 1200 | 内容最大宽度 px |

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/board` | 设置 + 分组 + 卡片（不含备忘录） |
| GET | `/api/containers` | 白名单容器状态 |
| POST | `/api/containers/{name}/{start\|stop\|restart}` | 容器操作（白名单校验，禁止操作自身容器） |
| POST | `/api/items/{id}/containers/{start\|stop\|restart}` | 按卡片绑定的**全部容器**批量启停/重启（停按声明序、启按倒序，逐容器返回结果；禁止操作自身容器） |
| GET/POST | `/api/groups`、`/api/items` | 分组 / 卡片列表与新建 |
| PUT/DELETE | `/api/groups/{id}`、`/api/items/{id}` | 修改与删除 |
| POST | `/api/groups/sort`、`/api/items/sort` | 排序 |
| GET/PUT | `/api/settings` | 站点设置（只接受已知键） |
| POST | `/api/icons/upload` | 上传图标（multipart，字段名 `file`） |
| POST | `/api/icons/fetch` | 抓取站点 favicon 并固化 |
| GET | `/api/icons/proxy?url=` | 代抓 favicon 并缓存 |

## 权限与 SSO 接入

已接入 Authelia（宿主 nginx `auth_request` 前置鉴权），不再是「本机 = 管理员」的过渡方案：

- nginx 在受保护 location 内注入 `Remote-User` / `Remote-Groups` / `Remote-Name` / `Remote-Email`（见 `snippets/authelia-auth.inc`）
- 后端只信任来自**内网 / 回环**来源的这些头（`trustedProxyCIDRs`，可用环境变量 `TRUSTED_PROXY_CIDRS` 覆盖，逗号分隔 CIDR），其余来源一律按匿名处理，防止自带同名头伪造身份
- `isAdminRequest()` = 身份所属组命中设置 `admin_groups`（默认 `admins`）
- 卡片 `acl`（访问组，逗号分隔，留空 = 公开）+ `Item.allows()` 生效：管理员看全部，访客看公开卡 + 授权给己组的卡，匿名只看公开卡
- 管理接口（后台 CRUD、容器启停、设置）统一由 `requireAdmin` 保护，非管理员 403

部署要求：

- 容器端口**只绑本机**：compose 写 `127.0.0.1:8080:80`（nginx 反代 `http://127.0.0.1:8080` 不受影响）。若绑 `0.0.0.0`，局域网可直连绕过 SSO 并伪造 `Remote-Groups` 冒充管理员
- 用户与组在 Authelia 侧维护（`compose/authelia/config/users_database.yml`）：调整某个用户的 `groups` 即改变其可见服务范围
- 排查：登录后打开 `/api/board`，看 `identity` 字段是否有 `user` / `groups`；为空说明反代未注入头（检查 Authelia `server.endpoints.authz.auth-request.implementation: 'AuthRequest'` 与 nginx 片段）

## 已知限制

- 可达性由**浏览器直连**判定：每台设备的浏览器代表它自己的网络位置（本机 / 局域网访客各自探测各自能打开的目标），不存在服务端共享的全局状态，因此「自动重探间隔 / 打开即探测 / 时间显示秒」等偏好同样**按浏览器存 localStorage**（键 `hp:autoSec`、`hp:onOpen`、`hp:clockSec`），一台设备改了不影响其他设备；探测失败（网络不通）会在浏览器控制台留下 `Failed to load resource` 日志，属预期噪音
- **自签 https** 目标（如云服务器管理页）会被浏览器证书校验拦截 → 判红、点击打开同样被拦；如已在该浏览器手动信任过证书则可判绿
- 容器状态缓存约 5 秒刷新，点完启停后约 1 秒更新；卡片「绑定容器未运行」的置灰不受浏览器探测影响
- 多容器启停为顺序执行：停止每容器优雅期 5 秒（最多 N×5 秒后强杀），遇到不响应 SIGTERM 的容器会偏慢；批量操作期间页面等待接口返回
- iconify 图标（如 `solar:printer-broken`）无本地图标库，迁移时降级为文字图标
