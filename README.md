# home-page

局域网自用的**导航页 + 服务可达性状态 + Docker 容器启停**，单容器、单二进制、占用 80 端口（访问不用带端口）。
视觉高仿 [Sun-Panel](https://github.com/hslr-s/sun-panel)（壁纸 + 白字阴影 + 半透明深色横向卡片），功能按自己需要裁剪：导航卡片、状态灯、内外网双地址、容器启停、卡片备忘录。

## 功能

| 模块 | 说明 |
| --- | --- |
| 导航卡片 | 分组展示，图标 + 名称 + 描述，左键新窗口打开 |
| 可达性状态 | 服务端定时探测（TCP + HTTP 状态码），卡片右上角状态灯；可设间隔，设为 0 关闭轮询 |
| 状态点语义 | 在线绿 / 离线红 / 轮询关闭或禁用时常亮灰（不闪烁）/ 等待首次探测时短暂呼吸 |
| 不可达禁点 | 探测离线或绑定容器未运行 → 卡片置灰且点击被拦截（提示「当前不可达」） |
| 内外网地址 | 每张卡片可配「地址」与「本机地址」，右上角一键切换 自动 / 局域网 / 本机 |
| 容器启停 | 卡片绑定容器名后，**右键**（移动端**长按**）唤出菜单启停/重启，白名单外容器不出现 |
| 卡片禁用 | 可逐张禁用；由设置决定是否仍在首页置灰显示 |
| 管理员备忘 | 每张卡片的备注/凭证仅 `/admin` 可见，公开看板接口不返回 |
| 管理后台 | `/admin`：侧栏分 分组 / 卡片 / 站点设置；卡片支持图标按钮排序、启用禁用、编辑、删除 |

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

```bash
# 1) 构建镜像
cd "/Volumes/ZHITAI TiPlus5000 1TB/Programs/home-page" && ./build.sh

# 2) 启动（占用宿主 80 端口；80 需先让出来，例如停掉 nginx 栈）
cd "/Volumes/ZHITAI TiPlus5000 1TB/Docker/compose/home-page" && docker compose up -d
```

浏览器打开 `http://192.168.1.100`（或 `http://localhost`），管理后台在 `/admin`。

## 环境变量

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
| GET/POST | `/api/groups`、`/api/items` | 分组 / 卡片列表与新建 |
| PUT/DELETE | `/api/groups/{id}`、`/api/items/{id}` | 修改与删除 |
| POST | `/api/groups/sort`、`/api/items/sort` | 排序 |
| GET/PUT | `/api/settings` | 站点设置（只接受已知键） |
| POST | `/api/icons/upload` | 上传图标（multipart，字段名 `file`） |
| POST | `/api/icons/fetch` | 抓取站点 favicon 并固化 |
| GET | `/api/icons/proxy?url=` | 代抓 favicon 并缓存 |

## 预留（未启用）

鉴权按约定放到后续统一处理，这里只把接口留出来：

- 卡片有 `acl` 字段（允许访问的用户组，逗号分隔，留空=公开）
- 后端 `Item.allows()` 与 `userGroups()` 已按反代注入的 `Remote-Groups` / `Remote-User` 头实现过滤逻辑
- 接入时只需在 `/api/board`、`/api/status` 前启用身份校验，并为写操作（容器启停、后台 CRUD）加一层口令

## 已知限制

- 探测结果仅保存在内存，容器重启后重新探测
- 容器状态缓存约 5 秒刷新，点完启停后约 1 秒更新
- iconify 图标（如 `solar:printer-broken`）无本地图标库，迁移时降级为文字图标
