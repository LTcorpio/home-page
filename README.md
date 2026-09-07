# home-page

局域网自用的**导航页 + 服务可达性状态 + Docker 容器启停**，单容器、单二进制、占用 80 端口（访问不用带端口）。
视觉高仿 [Sun-Panel](https://github.com/hslr-s/sun-panel)（壁纸 + 白字阴影 + 半透明深色横向卡片），功能按自己需要裁剪：导航卡片、状态灯、内外网双地址、容器启停、卡片备忘录。

## 功能

| 模块 | 说明 |
| --- | --- |
| 导航卡片 | 分组展示，图标 + 名称 + 描述，左键新窗口打开 |
| 可达性状态 | 服务端探测（TCP + HTTP 状态码），卡片右上角状态点；触发方式：后台定时轮询（可设间隔，0 关闭）、打开页面自动探测一轮、右上角按钮手动刷新 |
| 状态点语义 | 后台轮询开启，或**本页面已触发过探测**（打开页面自动 / 右上角手动）后展示结果：在线绿 / 离线红；本页尚未探测时一律灰点（不渲染服务端历史缓存），探测在跑时短暂呼吸 |
| 手动探测 | 右上角刷新按钮随时触发一轮探测；设置 `probe_on_open` 可让每次打开首页自动探测一次（默认开） |
| 不可达禁点 | 已展示探测结果且离线（需本页已探测或轮询开启），或绑定容器未运行 → 卡片置灰且点击被拦截（提示「当前不可达」） |
| 内外网地址 | 每张卡片可配「地址」与「本机地址」，右上角一键切换 自动 / 局域网 / 本机（带图标，切换即时生效不刷新页面） |
| 管理员 / 游客模式 | 尚未引入登录：以访问来源区分——**本机（localhost/127.0.0.1）= 管理员**，局域网 IP = 游客；游客不显示右上角管理入口 |
| 容器启停 | 卡片绑定容器名后，**右键**（移动端**长按**）唤出菜单启停/重启（菜单项带图标）；**一张卡片可绑定多个容器**（英文逗号分隔），操作覆盖全部绑定容器——停服按声明序（先应用后依赖），启动按倒序（先依赖后应用）；白名单外容器不出现；仅管理员可用 |
| 卡片备注 | 每张卡片可写备注/凭证；管理员右键卡片可「查看备注」（有内容才显示入口），游客看不到 |
| 卡片禁用 | 可逐张禁用；由设置决定是否仍在首页置灰显示 |
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
├── probe.go       # 可达性探测与结果缓存（间隔可配，0=关闭）
├── docker.go      # Docker Engine API（unix socket）
├── icons.go       # favicon 抓取与图标文件
├── web/           # 前端（index.html / admin.html / assets）
├── Dockerfile     # 多阶段构建
└── build.sh       # 构建镜像
```

运行时数据（由 compose 挂载）：

```
Docker/DockerData/home-page/
├── home-page.db   # 数据库
└── icons/         # 上传与抓取的图标（含壁纸）
```

## 部署

服务已并入 lifestyle 栈管理（与 film-memo / personal-crm 等同一 compose 文件）：

```bash
# 1) 构建镜像
cd "/Volumes/ZHITAI TiPlus5000 1TB/Programs/home-page" && ./build.sh

# 2) 启动 / 重启（占用宿主 80 端口；80 需先让出来）
cd "/Volumes/ZHITAI TiPlus5000 1TB/Docker/compose/lifestyle" && docker compose up -d home-page
```

浏览器打开 `http://192.168.1.100`（或 `http://localhost`），管理后台在 `/admin`。

### 访问模式

| 来源 | 模式 | 权限 |
| --- | --- | --- |
| `localhost` / `127.0.0.1` | 管理员 | 管理后台、卡片右键（容器启停/查看备注）、备忘录可见 |
| 局域网 IP（如 192.168.1.100） | 游客 | 纯导航；右键/长按无操作菜单，管理接口一律 403 |

鉴权正式引入后，此来源判定会替换为真实登录与用户组（`acl` 字段已预留）。

## 环境变量（均有镜像默认值，compose 无需重复设置）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `80` | 监听端口 |
| `DATA_DIR` | `/data` | 数据库与图标目录 |
| `SEED_HOST` | `192.168.1.100` | 首次初始化示例卡片用的宿主地址 |
| `DOCKER_SOCK` | `/var/run/docker.sock` | Docker Engine API 套接字 |

## 站点设置项

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `site_title` | Home | 浏览器标签页标题 |
| `probe_interval` | 20 | 可达性轮询间隔（秒）；**0 = 关闭轮询**，1~4 按 5 秒处理，改动即时生效 |
| `probe_on_open` | 1 | 打开首页时立即触发一轮探测；0 = 关闭（仍可点右上角刷新按钮手动触发） |
| `show_disabled` | 0 | 禁用的卡片是否仍在首页置灰显示 |
| `docker_enabled` | 1 | 是否允许容器启停 |
| `background_image` | 空 | 壁纸地址，如 `/icons/bg.jpg` |
| `background_mask` | 0 | 壁纸黑色遮罩 0~1 |
| `background_blur` | 2 | 壁纸模糊 px |
| `max_width` | 1200 | 内容最大宽度 px |

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/board` | 设置 + 分组 + 卡片（不含备忘录） |
| GET | `/api/status` | 探测结果 + 白名单容器状态 |
| POST | `/api/probe` | 立即探测一次 |
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

## 预留（后续鉴权接入点）

正式鉴权引入前的过渡方案：后端统一走 `isAdminRequest()`（本机 = 管理员）。接入真实登录时：

- 用登录会话替代 `isAdminRequest()` 判断
- 卡片 `acl` 字段（允许的用户组，逗号分隔，留空=公开）+ `Item.allows()` / `userGroups()` 已实现，可按反代注入的 `Remote-Groups` / `Remote-User` 头过滤
- 管理接口（后台 CRUD、容器启停、设置）已集中由 `requireAdmin` 中间件保护，替换判断逻辑即可

## 已知限制

- 探测结果仅保存在内存，容器重启后重新探测
- 容器状态缓存约 5 秒刷新，点完启停后约 1 秒更新
- 多容器启停为顺序执行：停止每容器优雅期 5 秒（最多 N×5 秒后强杀），遇到不响应 SIGTERM 的容器会偏慢；批量操作期间页面等待接口返回
- iconify 图标（如 `solar:printer-broken`）无本地图标库，迁移时降级为文字图标
