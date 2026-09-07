package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// Docker Engine API 通过 unix socket 直连，不引入 SDK
// 容器启停属于白名单操作：只有卡片里绑定了 container_name 的容器才会被列出和操作

var dockerSock = envOr("DOCKER_SOCK", "/var/run/docker.sock")

var dockerHTTP = &http.Client{
	Timeout: 10 * time.Second,
	Transport: &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return net.Dial("unix", dockerSock)
		},
	},
}

// Container 精简后的容器信息
type Container struct {
	Name   string `json:"name"`
	Image  string `json:"image"`
	State  string `json:"state"`  // running | exited | created | paused | restarting | dead
	Status string `json:"status"` // Docker 原始描述，如 Up 3 hours
	ID     string `json:"id"`
}

type rawContainer struct {
	ID     string   `json:"Id"`
	Names  []string `json:"Names"`
	Image  string   `json:"Image"`
	State  string   `json:"State"`
	Status string   `json:"Status"`
}

// dockerAvailable 是否挂载了 docker.sock
func dockerAvailable() bool {
	_, err := os.Stat(dockerSock)
	return err == nil
}

// selfContainerID 读取 home-page 自身所在容器的 ID，用于禁止自杀式操作
func selfContainerID() string {
	b, err := os.ReadFile("/proc/self/cgroup")
	if err == nil {
		for _, line := range strings.Split(string(b), "\n") {
			idx := strings.LastIndex(line, "/")
			if idx < 0 {
				continue
			}
			id := strings.TrimSpace(line[idx+1:])
			id = strings.TrimSuffix(strings.TrimPrefix(id, "docker-"), ".scope")
			if len(id) == 64 || len(id) == 12 {
				return id
			}
		}
	}
	if h, err := os.Hostname(); err == nil {
		return h
	}
	return ""
}

// isSelfContainer 目标是否为 home-page 自身（按 ID 前缀或容器名/主机名匹配）
func isSelfContainer(name, id string) bool {
	self := selfContainerID()
	if self == "" {
		return false
	}
	if id != "" && strings.HasPrefix(id, self) {
		return true
	}
	return name != "" && (name == self || strings.HasPrefix(self, name))
}

// dockerList 列出全部容器（含已停止），返回以容器名为键的映射
func dockerList() (map[string]Container, error) {
	if !dockerAvailable() {
		return map[string]Container{}, nil
	}
	resp, err := dockerHTTP.Get("http://docker/containers/json?all=1")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("Docker API 返回 %d", resp.StatusCode)
	}
	var raw []rawContainer
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, err
	}
	out := make(map[string]Container, len(raw))
	for _, c := range raw {
		name := ""
		if len(c.Names) > 0 {
			name = strings.TrimPrefix(c.Names[0], "/")
		}
		if name == "" {
			continue
		}
		out[name] = Container{Name: name, Image: c.Image, State: c.State, Status: c.Status, ID: c.ID}
	}
	return out, nil
}

// dockerAction 对白名单容器执行 start / stop / restart
func dockerAction(name, action string) error {
	if !dockerAvailable() {
		return fmt.Errorf("未挂载 docker.sock，无法操作容器")
	}
	switch action {
	case "start", "stop", "restart":
	default:
		return fmt.Errorf("不支持的操作: %s", action)
	}
	url := fmt.Sprintf("http://docker/containers/%s/%s", name, action)
	if action == "stop" || action == "restart" {
		url += "?t=5" // 优雅期缩短到 5 秒（超时强杀），点完按钮能较快返回
	}
	req, err := http.NewRequest(http.MethodPost, url, nil)
	if err != nil {
		return err
	}
	resp, err := dockerHTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	// 204 = 成功；304 = 容器已处于目标状态；404 = 容器不存在
	if resp.StatusCode >= 400 {
		return fmt.Errorf("Docker API 返回 %d", resp.StatusCode)
	}
	return nil
}

// --- 容器状态缓存 -------------------------------------------------------

var (
	ctMu       sync.RWMutex
	ctCache    = map[string]Container{}
	ctErr      string
	ctLastPick time.Time
)

// refreshContainers 刷新缓存；高频调用时会做 2 秒节流
func refreshContainers() {
	ctMu.Lock()
	defer ctMu.Unlock()
	if time.Since(ctLastPick) < 2*time.Second {
		return
	}
	ctLastPick = time.Now()
	list, err := dockerList()
	if err != nil {
		ctErr = err.Error()
		return
	}
	ctErr = ""
	ctCache = list
}

// whitelistContainers 只返回卡片绑定过的容器
func whitelistContainers(names []string) map[string]Container {
	ctMu.RLock()
	defer ctMu.RUnlock()
	out := make(map[string]Container, len(names))
	for _, n := range names {
		if n == "" {
			continue
		}
		if c, ok := ctCache[n]; ok {
			out[n] = c
		} else {
			// 缓存里没有：可能容器不存在或被过滤掉，标记为 missing 便于前端提示
			out[n] = Container{Name: n, State: "missing", Status: "未找到该容器"}
		}
	}
	return out
}

// startContainerLoop 后台定时刷新容器状态
func startContainerLoop() {
	refreshContainers()
	go func() {
		t := time.NewTicker(5 * time.Second)
		defer t.Stop()
		for range t.C {
			refreshContainers()
		}
	}()
	log.Printf("Docker 控制: %s（%s）", enabledStr(dockerAvailable()), dockerSock)
}

func enabledStr(b bool) string {
	if b {
		return "已启用"
	}
	return "未启用"
}
