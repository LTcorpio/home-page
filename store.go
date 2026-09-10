package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

// 数据目录：容器内默认 /data，由 compose 挂载到 DockerData/home-page
// 结构：
//
//	/data/home-page.db  SQLite 主库
//	/data/icons/        上传或抓取的图标文件
var (
	dataDir = envOr("DATA_DIR", "/data")
	dbPath  = filepath.Join(dataDir, "home-page.db")
	iconDir = filepath.Join(dataDir, "icons")
)

// seedHost 首次初始化时写入示例卡片使用的宿主机地址
var seedHost = envOr("SEED_HOST", "127.0.0.1")

var db *sql.DB

// Group 导航分组
type Group struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	Sort int    `json:"sort"`
}

// Item 一张导航卡片
type Item struct {
	ID            int64  `json:"id"`
	GroupID       int64  `json:"group_id"`
	Name          string `json:"name"`
	URL           string `json:"url"` // 访问地址（SSO 统一入口或内网直连地址）
	Description   string `json:"description"`
	IconType      string `json:"icon_type"`      // auto | upload | text
	IconValue     string `json:"icon_value"`     // upload=文件名, text=文字, auto=留空
	ContainerName string `json:"container_name"` // 绑定的 Docker 容器名（白名单）
	LanURL        string `json:"lan_url"`        // 局域网直连地址（IP:端口）；仅绑定容器时可用，经 IP 访问首页时优先使用
	Probe         bool   `json:"probe"`          // 是否参与在线状态探测
	Sort          int    `json:"sort"`
	Hidden        bool   `json:"hidden"`         // 禁用：不出现在首页且不参与探测
	ACL           string `json:"acl"`            // 预留：允许访问的用户组，逗号分隔，留空=公开
	Memo          string `json:"memo,omitempty"` // 管理员备忘录（凭证等，仅在 /admin 返回）
	CreatedAt     string `json:"created_at"`
	UpdatedAt     string `json:"updated_at"`

	IconURL string `json:"icon_url,omitempty"` // 派生字段：图标可访问地址
}

// IconURL 计算卡片图标地址：upload 指向 /icons/，其余为空（前端回退 favicon 抓取 / 首字母）
func (it Item) iconURL() string {
	if it.IconType == "upload" && it.IconValue != "" {
		return "/icons/" + it.IconValue
	}
	return ""
}

// --- 启动初始化 ---------------------------------------------------------

func initStore() {
	if err := os.MkdirAll(iconDir, 0o755); err != nil {
		log.Fatalf("创建图标目录失败: %v", err)
	}
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)", dbPath)
	var err error
	db, err = sql.Open("sqlite", dsn)
	if err != nil {
		log.Fatalf("打开数据库失败: %v", err)
	}
	db.SetMaxOpenConns(1) // SQLite 单写者，串行访问最稳
	if err := db.Ping(); err != nil {
		log.Fatalf("连接数据库失败: %v", err)
	}
	migrate()
	seed()
}

func migrate() {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS groups (
			id   INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			sort INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE IF NOT EXISTS items (
			id             INTEGER PRIMARY KEY AUTOINCREMENT,
			group_id       INTEGER NOT NULL DEFAULT 0,
			name           TEXT NOT NULL,
			url            TEXT NOT NULL DEFAULT '',
			description    TEXT NOT NULL DEFAULT '',
			icon_type      TEXT NOT NULL DEFAULT 'auto',
			icon_value     TEXT NOT NULL DEFAULT '',
			container_name TEXT NOT NULL DEFAULT '',
			lan_url        TEXT NOT NULL DEFAULT '',
			probe          INTEGER NOT NULL DEFAULT 1,
			sort           INTEGER NOT NULL DEFAULT 0,
			hidden         INTEGER NOT NULL DEFAULT 0,
			acl            TEXT NOT NULL DEFAULT '',
			memo           TEXT NOT NULL DEFAULT '',
			created_at     TEXT NOT NULL DEFAULT '',
			updated_at     TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE INDEX IF NOT EXISTS idx_items_group ON items(group_id)`,
		`CREATE TABLE IF NOT EXISTS settings (
			key   TEXT PRIMARY KEY,
			value TEXT NOT NULL DEFAULT ''
		)`,
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			log.Fatalf("建表失败: %v\n%s", err, s)
		}
	}
	// 兼容旧库：补充后加的列
	for _, col := range []struct{ name, ddl string }{
		{"memo", "ALTER TABLE items ADD COLUMN memo TEXT NOT NULL DEFAULT ''"},
		{"lan_url", "ALTER TABLE items ADD COLUMN lan_url TEXT NOT NULL DEFAULT ''"},
	} {
		if !tableHasColumn("items", col.name) {
			if _, err := db.Exec(col.ddl); err != nil {
				log.Printf("给 items 补列 %s 失败: %v", col.name, err)
			} else {
				log.Printf("已给 items 补充列 %s", col.name)
			}
		}
	}
	// 注意：lan_url 曾在「内外网地址切换」下线时被 DROP，现以新语义回归——
	// 不再做本机/局域网/自动三态切换，而是「域名访问用 url，IP 直连访问用 lan_url」，
	// 且仅对绑定了容器的卡片开放。切勿再恢复该列的 DROP 迁移。
	// 上次异常退出（SIGKILL/断电）会留下未折回主库的 -wal/-shm：
	// SQLite 打开时已自动回放，这里再主动做一次 TRUNCATE 检查点收尾，
	// 把残留数据真正落进主库并清空 WAL
	if err := checkpointWAL(); err != nil {
		log.Printf("启动期 WAL 检查点失败（稍后由周期任务重试）: %v", err)
	}
	go walCheckpointLoop()
}

// walStop 通知周期 WAL 检查点协程退出（closeStore 时 close）
var walStop = make(chan struct{})

// checkpointWAL TRUNCATE 级检查点：把 -wal 中已提交内容折回主库并截断 WAL。
// 返回错误表示本次未完成（如被并发连接占用），可稍后重试。
func checkpointWAL() error {
	var busy, logFrames, ckptFrames int
	err := db.QueryRow(`PRAGMA wal_checkpoint(TRUNCATE)`).Scan(&busy, &logFrames, &ckptFrames)
	if err != nil {
		return err
	}
	if busy != 0 {
		return fmt.Errorf("有 %d 个连接占用，检查点未完成", busy)
	}
	return nil
}

// walCheckpointLoop 每 5 分钟压缩一次 WAL：
//   - 运行期数据定期落回主库，-wal 不无限增长（SQLite 默认 4MB 才自动检查点）
//   - 万一再遇 SIGKILL/断电这类无法优雅退出的场景，残留 WAL 也极小、重启恢复更快
func walCheckpointLoop() {
	t := time.NewTicker(5 * time.Minute)
	defer t.Stop()
	for {
		select {
		case <-t.C:
			if err := checkpointWAL(); err != nil {
				log.Printf("周期 WAL 检查点失败: %v", err)
			}
		case <-walStop:
			return
		}
	}
}

// closeStore 优雅停库（配合 main 的 SIGTERM 处理）：
// 先做最终 TRUNCATE 检查点，再关闭全部连接——最后一个连接干净关闭时，
// SQLite 会顺手删除 -wal / -shm 临时文件，数据目录只剩主库 home-page.db
func closeStore() {
	close(walStop)
	if err := checkpointWAL(); err != nil {
		log.Printf("停机前 WAL 检查点失败: %v", err)
	}
	if err := db.Close(); err != nil {
		log.Printf("关闭数据库失败: %v", err)
		return
	}
	log.Printf("数据库已优雅关闭，-wal/-shm 临时文件已清理")
}

func tableHasColumn(table, col string) bool {
	rows, err := db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return false
	}
	defer rows.Close()
	for rows.Next() {
		var cid, notnull, pk int
		var name, ctype string
		var dflt any
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return false
		}
		if name == col {
			return true
		}
	}
	return false
}

// defaultSettings 站点级配置默认值（视觉对齐 Sun-Panel）
var defaultSettings = map[string]string{
	"site_title":          "Home",
	"docker_enabled":      "1",
	"show_disabled":       "1",                          // 管理员首页是否置灰显示禁用卡；1=显示（便于管理核对）
	"show_disabled_guest": "0",                          // 访客首页是否置灰显示禁用卡；0=不显示（访客看不到，仅管理员可选开）
	"admin_groups":        "admins",                     // 拥有管理后台权限的 SSO 用户组（逗号分隔，取自 SSO 网关 Remote-Groups）
	"known_groups":        "admins,family,guest",        // 卡片「访问组」的候选组（仅作下拉提示，不限制自由填写；guest 为免登录访客身份）
	"auth_portal":         "", // SSO 认证中心地址：右上角身份 chip 点击跳转（切换/登录账号）；留空则 chip 不可点
	"background_image":    "",                           // 壁纸地址，如 /icons/bg.jpg；留空用深色渐变兜底
	"background_mask":     "0",                          // 壁纸上的黑色遮罩透明度 0~1
	"background_blur":     "2",                          // 壁纸模糊 px
	"max_width":           "1200",
}

// seed 首次运行写入默认设置与示例数据（库中已有分组时不重复写入）
func seed() {
	for k, v := range defaultSettings {
		if _, err := db.Exec(`INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)`, k, v); err != nil {
			log.Printf("写入默认设置 %s 失败: %v", k, err)
		}
	}
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM groups`).Scan(&n); err != nil || n > 0 {
		return
	}
	g := Group{Name: "常用服务"}
	gid, err := createGroup(g)
	if err != nil {
		log.Printf("创建默认分组失败: %v", err)
		return
	}
	items := []Item{
		{Name: "家庭相册", URL: "http://" + seedHost + ":2283", Description: "照片与视频", ContainerName: "immich_server"},
		{Name: "个人 CRM", URL: "http://" + seedHost + ":5197", Description: "联系人与往来记录", ContainerName: "personal-crm"},
		{Name: "观影记录", URL: "http://" + seedHost + ":8686", Description: "看过的电影与剧集", ContainerName: "film-memo"},
		{Name: "出行记录", URL: "http://" + seedHost + ":7997", Description: "通勤与差旅台账", ContainerName: "transit-memo"},
		{Name: "房租管理", URL: "http://" + seedHost + ":9097", Description: "租金与合同台账", ContainerName: "rent-management"},
		{Name: "抖音导出", URL: "http://" + seedHost + ":8000", Description: "聊天记录导出工具", ContainerName: "douyin-chat-export"},
		{Name: "备份管理", URL: "http://" + seedHost + ":8390", Description: "容器与数据备份", ContainerName: "docker-backup-manager"},
		{Name: "影视仓搜索", URL: "http://127.0.0.1:9978", Description: "电视端影视仓搜索引擎"},
	}
	for i := range items {
		items[i].GroupID = gid
		items[i].Sort = i
		items[i].IconType = "auto"
		items[i].Probe = true
		if _, err := createItem(items[i]); err != nil {
			log.Printf("写入示例卡片失败: %v", err)
		}
	}
	log.Printf("已初始化示例数据（宿主地址 %s），可在 /admin 修改", seedHost)
}

func nowStr() string {
	return time.Now().Format("2006-01-02 15:04:05")
}

// --- 分组 ---------------------------------------------------------------

func listGroups() ([]Group, error) {
	rows, err := db.Query(`SELECT id, name, sort FROM groups ORDER BY sort, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Group{}
	for rows.Next() {
		var g Group
		if err := rows.Scan(&g.ID, &g.Name, &g.Sort); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, nil
}

func createGroup(g Group) (int64, error) {
	res, err := db.Exec(`INSERT INTO groups(name, sort) VALUES (?, ?)`, g.Name, g.Sort)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func updateGroup(g Group) error {
	_, err := db.Exec(`UPDATE groups SET name = ?, sort = ? WHERE id = ?`, g.Name, g.Sort, g.ID)
	return err
}

// deleteGroup 删除分组，其下卡片一并删除
func deleteGroup(id int64) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM items WHERE group_id = ?`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM groups WHERE id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

// reorderGroups 按传入顺序重排分组
func reorderGroups(ids []int64) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for i, id := range ids {
		if _, err := tx.Exec(`UPDATE groups SET sort = ? WHERE id = ?`, i, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// --- 卡片 ---------------------------------------------------------------

const itemCols = `id, group_id, name, url, description, icon_type, icon_value,
	container_name, lan_url, probe, sort, hidden, acl, memo, created_at, updated_at`

func scanItem(rows *sql.Rows) (Item, error) {
	var it Item
	var probe, hidden int
	err := rows.Scan(&it.ID, &it.GroupID, &it.Name, &it.URL, &it.Description,
		&it.IconType, &it.IconValue, &it.ContainerName, &it.LanURL, &probe, &it.Sort, &hidden,
		&it.ACL, &it.Memo, &it.CreatedAt, &it.UpdatedAt)
	it.Probe = probe == 1
	it.Hidden = hidden == 1
	it.IconURL = it.iconURL()
	return it, err
}

func listItems() ([]Item, error) {
	rows, err := db.Query(`SELECT ` + itemCols + ` FROM items ORDER BY sort, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Item{}
	for rows.Next() {
		it, err := scanItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, nil
}

func getItem(id int64) (*Item, error) {
	rows, err := db.Query(`SELECT `+itemCols+` FROM items WHERE id = ?`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if rows.Next() {
		it, err := scanItem(rows)
		if err != nil {
			return nil, err
		}
		return &it, nil
	}
	return nil, nil
}

func createItem(it Item) (int64, error) {
	res, err := db.Exec(`INSERT INTO items
		(group_id, name, url, description, icon_type, icon_value, container_name, lan_url, probe, sort, hidden, acl, memo, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		it.GroupID, it.Name, it.URL, it.Description, it.IconType, it.IconValue,
		it.ContainerName, it.LanURL, boolInt(it.Probe), it.Sort, boolInt(it.Hidden), it.ACL, it.Memo, nowStr(), nowStr())
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func updateItem(it Item) error {
	_, err := db.Exec(`UPDATE items SET group_id = ?, name = ?, url = ?, description = ?,
		icon_type = ?, icon_value = ?, container_name = ?, lan_url = ?, probe = ?, sort = ?, hidden = ?, acl = ?, memo = ?, updated_at = ?
		WHERE id = ?`,
		it.GroupID, it.Name, it.URL, it.Description, it.IconType, it.IconValue,
		it.ContainerName, it.LanURL, boolInt(it.Probe), it.Sort, boolInt(it.Hidden), it.ACL, it.Memo, nowStr(), it.ID)
	return err
}

func deleteItem(id int64) error {
	_, err := db.Exec(`DELETE FROM items WHERE id = ?`, id)
	return err
}

func reorderItems(groupID int64, ids []int64) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for i, id := range ids {
		if _, err := tx.Exec(`UPDATE items SET sort = ?, group_id = ? WHERE id = ?`, i, groupID, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// --- 设置 ---------------------------------------------------------------

func listSettings() (map[string]string, error) {
	out := map[string]string{}
	for k, v := range defaultSettings {
		out[k] = v
	}
	rows, err := db.Query(`SELECT key, value FROM settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, nil
}

func saveSettings(kv map[string]string) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for k, v := range kv {
		if _, err := tx.Exec(`INSERT INTO settings(key, value) VALUES (?, ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value`, k, v); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func getSetting(key string) string {
	var v string
	if err := db.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&v); err != nil {
		return defaultSettings[key]
	}
	return v
}

func getSettingInt(key string, def int) int {
	v := getSetting(key)
	var n int
	if _, err := fmt.Sscanf(v, "%d", &n); err != nil {
		return def
	}
	return n
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// parseACL 解析卡片允许访问的用户组：支持英文逗号 / 中文逗号 / 空格分隔（与容器名解析同规则）
func parseACL(raw string) []string { return splitContainers(raw) }

// allows 判断该卡片对当前身份是否可见：
//   - 管理员（所属组命中 admin_groups）看全部卡片，便于核对与管理
//   - 卡片未声明访问组（acl 留空）= 公开，所有人可见
//   - 否则要求用户所属组与卡片访问组有交集
//
// 注意：不再有「未携带身份头即放行」的兜底——匿名请求组为空，只会看到公开卡
func (it Item) allows(groups []string, isAdmin bool) bool {
	if isAdmin {
		return true
	}
	acl := parseACL(it.ACL)
	if len(acl) == 0 {
		return true
	}
	for _, a := range acl {
		for _, g := range groups {
			if a == g {
				return true
			}
		}
	}
	return false
}
