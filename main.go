package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

//go:embed all:web
var webFS embed.FS

// ---------------------------------------------------------------- 工具

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("写响应失败: %v", err)
	}
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func readJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	return json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(v)
}

func pathID(r *http.Request, name string) (int64, error) {
	return strconv.ParseInt(r.PathValue(name), 10, 64)
}

// splitContainers 解析卡片绑定的容器列表：支持英文逗号/中文逗号/空格分隔，去重、去空白
func splitContainers(raw string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, seg := range strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == '，' || r == ' ' || r == '\t'
	}) {
		seg = strings.TrimSpace(seg)
		if seg != "" && !seen[seg] {
			seen[seg] = true
			out = append(out, seg)
		}
	}
	return out
}

// ---------------------------------------------------------------- 身份（SSO / Authelia）

// identity 经 SSO 认证后的用户身份，取自 nginx 反代注入的可信头
// （authelia-auth.inc：Remote-User / Remote-Groups / Remote-Name / Remote-Email）
type identity struct {
	User   string   `json:"user"`
	Name   string   `json:"name"`
	Email  string   `json:"email"`
	Groups []string `json:"groups"`
}

// clientIP 取请求来源 IP（去掉端口与 IPv6 方括号）
func clientIP(r *http.Request) net.IP {
	host := r.RemoteAddr
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	return net.ParseIP(strings.Trim(strings.TrimSpace(host), "[]"))
}

// trustedProxyCIDRs 允许注入身份头的来源网段：默认回环 + 私网。
// home-page 只监听 127.0.0.1（见 compose 端口绑定），外部设备直连不进来；能连进来的
// 只有宿主反代（nginx）与同网段容器。注意：经宿主端口转发后，容器看到的源 IP 是
// VM 侧网关地址（不是 127.0.0.1），故不能只判回环。若部署环境源地址不在默认范围，
// 用环境变量 TRUSTED_PROXY_CIDRS 覆盖（逗号分隔 CIDR，如 "192.168.215.0/24,127.0.0.0/8"）。
var trustedProxyCIDRs = func() []*net.IPNet {
	out := []*net.IPNet{}
	for _, s := range strings.Split(envOr("TRUSTED_PROXY_CIDRS",
		// 回环、RFC1918 私网、CGNAT(100.64/10)、链路本地、保留测试段(198.18/15，OrbStack/Clash 用)、IPv6 本机与私网
		"127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,100.64.0.0/10,169.254.0.0/16,198.18.0.0/15,::1/128,fc00::/7"), ",") {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		if !strings.Contains(s, "/") { // 允许直接写单个 IP
			s += "/32"
		}
		if _, n, err := net.ParseCIDR(s); err == nil {
			out = append(out, n)
		}
	}
	return out
}()

// trustedProxy 身份头只信任指定来源：不在信任网段内的一律按匿名处理，
// 杜绝客户端自带 Remote-Groups 头伪造身份
func trustedProxy(r *http.Request) bool {
	ip := clientIP(r)
	if ip == nil {
		return false
	}
	for _, n := range trustedProxyCIDRs {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

// identify 解析当前请求身份；未携带身份头 = 匿名访客（组为空，只看公开卡）
func identify(r *http.Request) identity {
	if !trustedProxy(r) {
		return identity{}
	}
	raw := r.Header.Get("Remote-Groups")
	if raw == "" {
		raw = r.Header.Get("X-Remote-Groups")
	}
	groups := []string{}
	for _, g := range strings.Split(raw, ",") {
		if g = strings.TrimSpace(g); g != "" {
			groups = append(groups, g)
		}
	}
	return identity{
		User:   r.Header.Get("Remote-User"),
		Name:   r.Header.Get("Remote-Name"),
		Email:  r.Header.Get("Remote-Email"),
		Groups: groups,
	}
}

// isAdmin 是否管理员：所属组命中 admin_groups 设置（默认 admins，可在后台「权限」改）
func (id identity) isAdmin() bool {
	for _, a := range parseACL(getSetting("admin_groups")) {
		for _, g := range id.Groups {
			if a == g {
				return true
			}
		}
	}
	return false
}

// isAdminRequest 管理员判定：以 SSO 用户组为依据（不再以 localhost 为依据，
// 因为经 https://home.lan 访问时 Host 不再是 localhost）
func isAdminRequest(r *http.Request) bool { return identify(r).isAdmin() }

// requireAdmin 管理接口保护：非管理员返回 403
func requireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !isAdminRequest(r) {
			writeErr(w, 403, "需要管理员权限：请以管理员组账号登录（当前账号不属于 "+getSetting("admin_groups")+"）")
			return
		}
		next(w, r)
	}
}

// ---------------------------------------------------------------- 页面

func serveIndex(w http.ResponseWriter, r *http.Request) {
	b, err := webFS.ReadFile("web/index.html")
	if err != nil {
		http.Error(w, "首页缺失", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(b)
}

func serveAdmin(w http.ResponseWriter, r *http.Request) {
	b, err := webFS.ReadFile("web/admin.html")
	if err != nil {
		http.Error(w, "管理页缺失", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(b)
}

// ---------------------------------------------------------------- 看板

type boardGroup struct {
	Group
	Items []Item `json:"items"`
}

func handleBoard(w http.ResponseWriter, r *http.Request) {
	groups, err := listGroups()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	items, err := listItems()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	id := identify(r)                                             // SSO 身份（匿名时组为空）
	isAdmin := id.isAdmin()                                       // 管理员：组命中 admin_groups
	showDisabled := getSetting("show_disabled") == "1"            // 管理员视角
	showDisabledGuest := getSetting("show_disabled_guest") == "1" // 访客视角
	byGroup := map[int64][]Item{}
	for _, it := range items {
		if it.Hidden {
			// 禁用卡显示与否按视角取各自的开关：管理员/访客互不影响
			show := showDisabledGuest
			if isAdmin {
				show = showDisabled
			}
			if !show {
				continue
			}
		}
		// 可访问性：管理员看全部；访客只看公开卡 + 授权给自己组的卡
		if !it.allows(id.Groups, isAdmin) {
			continue
		}
		if !isAdmin {
			it.Memo = "" // 备忘录仅管理员可见，访客看板不返回
		}
		byGroup[it.GroupID] = append(byGroup[it.GroupID], it)
	}
	out := make([]boardGroup, 0, len(groups)+1)
	for _, g := range groups {
		its := byGroup[g.ID]
		if its == nil {
			its = []Item{}
		}
		out = append(out, boardGroup{Group: g, Items: its})
	}
	// 未分组卡片兜底展示
	if loose := byGroup[0]; len(loose) > 0 {
		out = append(out, boardGroup{Group: Group{ID: 0, Name: "未分组", Sort: 9999}, Items: loose})
	}
	settings, err := listSettings()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, map[string]any{
		"settings": settings,
		"groups":   out,
		"features": map[string]any{
			"docker": getSetting("docker_enabled") == "1" && dockerAvailable(),
			"admin":  isAdmin,
		},
		"identity": id, // 当前登录身份（匿名时 user 为空）
		"now":      time.Now().Format("2006-01-02 15:04:05"),
	})
}

// ---------------------------------------------------------------- 容器

// containerWhitelist 卡片里绑定过的容器名列表（白名单；一张卡片可绑定多个，逗号分隔）
func containerWhitelist() []string {
	items, err := listItems()
	if err != nil {
		return nil
	}
	seen := map[string]bool{}
	out := []string{}
	for _, it := range items {
		for _, n := range splitContainers(it.ContainerName) {
			if !seen[n] {
				seen[n] = true
				out = append(out, n)
			}
		}
	}
	sort.Strings(out)
	return out
}

func handleContainerAction(w http.ResponseWriter, r *http.Request) {
	if getSetting("docker_enabled") != "1" {
		writeErr(w, 403, "Docker 控制未启用")
		return
	}
	name := r.PathValue("name")
	action := r.PathValue("action")
	allowed := false
	for _, n := range containerWhitelist() {
		if n == name {
			allowed = true
			break
		}
	}
	if !allowed {
		writeErr(w, 403, "该容器不在白名单内，请先在卡片里绑定容器名")
		return
	}
	// 禁止对 home-page 自身执行操作，避免把自己停掉后打不开页面
	ctMu.RLock()
	target := ctCache[name]
	ctMu.RUnlock()
	if isSelfContainer(name, target.ID) {
		writeErr(w, 403, "不能对 home-page 自身容器执行该操作")
		return
	}
	if err := dockerAction(name, action); err != nil {
		log.Printf("容器操作失败 %s/%s: %v", name, action, err)
		writeErr(w, 500, err.Error())
		return
	}
	refreshContainers()
	ctMu.Lock()
	ctLastPick = time.Time{} // 强制下次立即刷新
	ctMu.Unlock()
	refreshContainers()
	writeJSON(w, map[string]bool{"ok": true})
}

func handleContainerList(w http.ResponseWriter, _ *http.Request) {
	if !dockerAvailable() {
		writeJSON(w, map[string]any{"available": false, "containers": map[string]Container{}})
		return
	}
	refreshContainers()
	ctMu.RLock()
	err := ctErr
	ctMu.RUnlock()
	writeJSON(w, map[string]any{
		"available":  true,
		"containers": whitelistContainers(containerWhitelist()),
		"error":      err,
	})
}

// containerOpResult 批量操作中单个容器的结果
type containerOpResult struct {
	Name   string `json:"name"`
	Action string `json:"action"`
	OK     bool   `json:"ok"`
	Error  string `json:"error,omitempty"`
}

// handleItemContainerAction 对卡片绑定的「一个或多个容器」执行启停/重启。
// 一张卡片（一个服务）可绑定多个容器，操作会覆盖其全部绑定容器：
//   - stop / restart 的停止阶段：按卡片上声明的顺序（先停主服务，再停依赖，如 immich_server→ml→redis→postgres）
//   - start / restart 的启动阶段：按声明顺序倒序（先拉起依赖，再拉起主服务）
func handleItemContainerAction(w http.ResponseWriter, r *http.Request) {
	if getSetting("docker_enabled") != "1" {
		writeErr(w, 403, "Docker 控制未启用")
		return
	}
	id, err := pathID(r, "id")
	if err != nil {
		writeErr(w, 400, "ID 非法")
		return
	}
	it, err := getItem(id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if it == nil {
		writeErr(w, 404, "卡片不存在")
		return
	}
	names := splitContainers(it.ContainerName)
	if len(names) == 0 {
		writeErr(w, 400, "该卡片未绑定容器")
		return
	}
	action := r.PathValue("action")
	switch action {
	case "start", "stop", "restart":
	default:
		writeErr(w, 400, "不支持的操作: "+action)
		return
	}

	// 安全校验：白名单（绑定即白名单）内禁止对 home-page 自身容器操作，避免把自己停掉
	ctMu.RLock()
	for _, n := range names {
		if isSelfContainer(n, ctCache[n].ID) {
			ctMu.RUnlock()
			writeErr(w, 403, "不能对 home-page 自身容器执行该操作")
			return
		}
	}
	ctMu.RUnlock()

	// 编排操作顺序：stop 按声明序；start 倒序（先依赖后应用）；restart = 先按序停、再倒序启
	type step struct{ name, act string }
	plan := []step{}
	switch action {
	case "start":
		for i := len(names) - 1; i >= 0; i-- {
			plan = append(plan, step{names[i], "start"})
		}
	case "stop":
		for _, n := range names {
			plan = append(plan, step{n, "stop"})
		}
	case "restart":
		for _, n := range names {
			plan = append(plan, step{n, "stop"})
		}
		for i := len(names) - 1; i >= 0; i-- {
			plan = append(plan, step{names[i], "start"})
		}
	}

	results := make([]containerOpResult, 0, len(names))
	firstErr := ""
	for _, st := range plan {
		res := containerOpResult{Name: st.name, Action: st.act}
		if err := dockerAction(st.name, st.act); err != nil {
			res.Error = err.Error()
			if firstErr == "" {
				firstErr = fmt.Sprintf("容器 %s %s 失败: %s", st.name, st.act, err.Error())
			}
			log.Printf("容器操作失败 %s/%s: %v", st.name, st.act, err)
		} else {
			res.OK = true
		}
		results = append(results, res)
	}

	refreshContainers()
	ctMu.Lock()
	ctLastPick = time.Time{} // 强制下次立即刷新
	ctMu.Unlock()
	refreshContainers()
	writeJSON(w, map[string]any{"ok": firstErr == "", "error": firstErr, "results": results})
}

// ---------------------------------------------------------------- 分组 API

func handleGroups(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		groups, err := listGroups()
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, groups)
	case http.MethodPost:
		var g Group
		if err := readJSON(r, &g); err != nil {
			writeErr(w, 400, "请求格式错误")
			return
		}
		if strings.TrimSpace(g.Name) == "" {
			writeErr(w, 400, "分组名不能为空")
			return
		}
		groups, _ := listGroups()
		g.Sort = len(groups)
		id, err := createGroup(g)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		g.ID = id
		writeJSON(w, g)
	}
}

func handleGroupByID(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeErr(w, 400, "ID 非法")
		return
	}
	switch r.Method {
	case http.MethodPut:
		var g Group
		if err := readJSON(r, &g); err != nil {
			writeErr(w, 400, "请求格式错误")
			return
		}
		g.ID = id
		if strings.TrimSpace(g.Name) == "" {
			writeErr(w, 400, "分组名不能为空")
			return
		}
		if err := updateGroup(g); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, g)
	case http.MethodDelete:
		if err := deleteGroup(id); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	}
}

func handleGroupSort(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IDs []int64 `json:"ids"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, 400, "请求格式错误")
		return
	}
	if err := reorderGroups(req.IDs); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

// ---------------------------------------------------------------- 卡片 API

func handleItems(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		items, err := listItems()
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, items)
	case http.MethodPost:
		var it Item
		if err := readJSON(r, &it); err != nil {
			writeErr(w, 400, "请求格式错误")
			return
		}
		if strings.TrimSpace(it.Name) == "" {
			writeErr(w, 400, "名称不能为空")
			return
		}
		if it.IconType == "" {
			it.IconType = "auto"
		}
		if it.IconType == "upload" && it.IconValue == "" {
			it.IconType = "auto"
		}
		items, _ := listItems()
		for _, x := range items {
			if x.GroupID == it.GroupID && x.Sort >= it.Sort {
				it.Sort = x.Sort + 1
			}
		}
		id, err := createItem(it)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		// 回读一次，返回带时间戳与图标地址的完整记录
		if full, err := getItem(id); err == nil && full != nil {
			writeJSON(w, full)
			return
		}
		it.ID = id
		it.IconURL = it.iconURL()
		writeJSON(w, it)
	}
}

func handleItemByID(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeErr(w, 400, "ID 非法")
		return
	}
	switch r.Method {
	case http.MethodGet:
		it, err := getItem(id)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		if it == nil {
			writeErr(w, 404, "卡片不存在")
			return
		}
		writeJSON(w, it)
	case http.MethodPut:
		var it Item
		if err := readJSON(r, &it); err != nil {
			writeErr(w, 400, "请求格式错误")
			return
		}
		it.ID = id
		if strings.TrimSpace(it.Name) == "" {
			writeErr(w, 400, "名称不能为空")
			return
		}
		if it.IconType == "" {
			it.IconType = "auto"
		}
		if err := updateItem(it); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		it.IconURL = it.iconURL()
		writeJSON(w, it)
	case http.MethodDelete:
		if err := deleteItem(id); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	}
}

func handleItemSort(w http.ResponseWriter, r *http.Request) {
	var req struct {
		GroupID int64   `json:"group_id"`
		IDs     []int64 `json:"ids"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, 400, "请求格式错误")
		return
	}
	if err := reorderItems(req.GroupID, req.IDs); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

// ---------------------------------------------------------------- 设置

func handleSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s, err := listSettings()
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, s)
	case http.MethodPut:
		var kv map[string]string
		if err := readJSON(r, &kv); err != nil {
			writeErr(w, 400, "请求格式错误")
			return
		}
		// 只允许更新已知配置项
		clean := map[string]string{}
		for k, v := range kv {
			if _, ok := defaultSettings[k]; ok {
				clean[k] = v
			}
		}
		if err := saveSettings(clean); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		s, _ := listSettings()
		writeJSON(w, s)
	}
}

// ---------------------------------------------------------------- 图标

func handleIconUpload(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(4 << 20); err != nil {
		writeErr(w, 400, "上传解析失败")
		return
	}
	f, header, err := r.FormFile("file")
	if err != nil {
		writeErr(w, 400, "缺少文件字段 file")
		return
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, 2<<20))
	if err != nil {
		writeErr(w, 500, "读取文件失败")
		return
	}
	ext := strings.ToLower(filepath.Ext(header.Filename))
	switch ext {
	case ".png", ".jpg", ".jpeg", ".svg", ".ico", ".webp", ".gif":
	case "":
		ext = extByContent(data)
	default:
		writeErr(w, 400, "不支持的图片类型: "+ext)
		return
	}
	name, err := saveIcon(data, ext)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, map[string]string{"icon_type": "upload", "icon_value": name, "icon_url": "/icons/" + name})
}

func extByContent(data []byte) string {
	ct := http.DetectContentType(data)
	if e, ok := allowedExt[strings.Split(ct, ";")[0]]; ok {
		return e
	}
	return ".png"
}

// handleIconFetch 抓取站点 favicon 并固化为本地图标（可选绑定 item_id）
func handleIconFetch(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL    string `json:"url"`
		ItemID int64  `json:"item_id"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, 400, "请求格式错误")
		return
	}
	target := req.URL
	if req.ItemID > 0 {
		if it, err := getItem(req.ItemID); err == nil && it != nil && target == "" {
			target = it.URL
		}
	}
	data, ext, err := fetchFavicon(target)
	if err != nil {
		writeErr(w, 502, "抓取失败: "+err.Error())
		return
	}
	name, err := saveIcon(data, ext)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if req.ItemID > 0 {
		if it, err := getItem(req.ItemID); err == nil && it != nil {
			it.IconType = "upload"
			it.IconValue = name
			_ = updateItem(*it)
		}
	}
	writeJSON(w, map[string]string{"icon_type": "upload", "icon_value": name, "icon_url": "/icons/" + name})
}

// handleIconProxy 按 URL 代抓 favicon 并缓存，供 icon_type=auto 的卡片使用
func handleIconProxy(w http.ResponseWriter, r *http.Request) {
	rawURL := r.URL.Query().Get("url")
	if rawURL == "" {
		http.Error(w, "缺少 url", http.StatusBadRequest)
		return
	}
	key := cacheKeyFor(rawURL)
	if cached := findCachedIcon(key); cached != "" {
		http.ServeFile(w, r, filepath.Join(iconDir, cached))
		return
	}
	data, ext, err := fetchFavicon(rawURL)
	if err != nil {
		// 抓取失败返回非图片 404，让前端 img 触发 onerror 回退到首字母色块
		http.Error(w, "icon not found", http.StatusNotFound)
		return
	}
	name, err := saveIcon(data, ext)
	if err != nil {
		http.Error(w, "图标保存失败", http.StatusInternalServerError)
		return
	}
	http.ServeFile(w, r, filepath.Join(iconDir, name))
}

// ---------------------------------------------------------------- 导入

// ---------------------------------------------------------------- 启动

// noStore 静态资源不做缓存：go:embed 无真实修改时间，避免浏览器命中陈旧 JS/CSS
func noStore(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

func main() {
	initStore()
	startContainerLoop()

	webRoot, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatalf("加载前端资源失败: %v", err)
	}

	mux := http.NewServeMux()
	mux.Handle("GET /assets/", noStore(http.FileServer(http.FS(webRoot))))
	mux.Handle("GET /icons/", http.StripPrefix("/icons/", http.FileServer(http.Dir(iconDir))))
	mux.HandleFunc("GET /{$}", serveIndex) // 仅精确匹配根路径，其余路径 404
	mux.HandleFunc("GET /admin", requireAdmin(serveAdmin))

	mux.HandleFunc("GET /api/board", handleBoard)
	mux.HandleFunc("GET /api/containers", handleContainerList)
	// 以下均为管理操作：仅本机（管理员模式）可访问
	mux.HandleFunc("POST /api/containers/{name}/{action}", requireAdmin(handleContainerAction))
	mux.HandleFunc("POST /api/items/{id}/containers/{action}", requireAdmin(handleItemContainerAction))
	mux.HandleFunc("/api/groups", requireAdmin(handleGroups))
	mux.HandleFunc("/api/groups/sort", requireAdmin(handleGroupSort))
	mux.HandleFunc("/api/groups/{id}", requireAdmin(handleGroupByID))
	mux.HandleFunc("/api/items", requireAdmin(handleItems))
	mux.HandleFunc("/api/items/sort", requireAdmin(handleItemSort))
	mux.HandleFunc("/api/items/{id}", requireAdmin(handleItemByID))
	mux.HandleFunc("/api/settings", requireAdmin(handleSettings))
	mux.HandleFunc("POST /api/icons/upload", requireAdmin(handleIconUpload))
	mux.HandleFunc("POST /api/icons/fetch", requireAdmin(handleIconFetch))
	mux.HandleFunc("GET /api/icons/proxy", handleIconProxy)

	addr := ":" + envOr("PORT", "80")
	log.Printf("home-page 启动于 %s（数据目录 %s）", addr, dataDir)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("服务退出: %v", err)
	}
}
