package main

import (
	"crypto/tls"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// 服务端探测：容器内直接拨测目标地址，避免浏览器跨域限制
// 结果缓存在内存，前端定时拉取 /api/status

type ProbeResult struct {
	Online  bool   `json:"online"`
	Code    int    `json:"code"`              // HTTP 状态码，0 表示未取到
	Latency int    `json:"latency"`           // 毫秒
	Error   string `json:"error,omitempty"`   // 失败原因
	Checked string `json:"checked,omitempty"` // 探测时间
}

var (
	probeMu    sync.RWMutex
	probeCache = map[int64]ProbeResult{}
)

var probeClient = &http.Client{
	Timeout: 5 * time.Second,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse // 不跟随跳转，302 也算在线
	},
	Transport: &http.Transport{
		TLSClientConfig:     &tls.Config{InsecureSkipVerify: true}, // 内网自签证书
		DisableKeepAlives:   true,
		TLSHandshakeTimeout: 3 * time.Second,
	},
}

// probeOne 探测单个地址：先 TCP 拨号，再尝试一次 HTTP 请求取状态码
func probeOne(rawURL string) ProbeResult {
	res := ProbeResult{Checked: time.Now().Format("15:04:05")}
	u := strings.TrimSpace(rawURL)
	if u == "" {
		res.Error = "未配置地址"
		return res
	}
	if !strings.Contains(u, "://") {
		u = "http://" + u
	}
	parsed, err := url.Parse(u)
	if err != nil {
		res.Error = "地址无法解析"
		return res
	}
	host := parsed.Hostname()
	if host == "" {
		res.Error = "地址缺少主机"
		return res
	}
	port := parsed.Port()
	if port == "" {
		if strings.EqualFold(parsed.Scheme, "https") {
			port = "443"
		} else {
			port = "80"
		}
	}
	addr := net.JoinHostPort(host, port)

	start := time.Now()
	conn, err := net.DialTimeout("tcp", addr, 1500*time.Millisecond)
	if err != nil {
		res.Error = "端口不通"
		res.Latency = int(time.Since(start).Milliseconds())
		return res
	}
	conn.Close()
	res.Online = true
	res.Latency = int(time.Since(start).Milliseconds())

	// TCP 通了再补一次 HTTP 状态码，失败也不影响在线判定
	if strings.EqualFold(parsed.Scheme, "http") || strings.EqualFold(parsed.Scheme, "https") {
		req, err := http.NewRequest(http.MethodGet, u, nil)
		if err == nil {
			req.Header.Set("User-Agent", "home-page-probe/1.0")
			if r, err := probeClient.Do(req); err == nil {
				res.Code = r.StatusCode
				io.Copy(io.Discard, io.LimitReader(r.Body, 4096))
				r.Body.Close()
			}
		}
	}
	return res
}

// runProbe 并发探测所有开启探测的卡片（禁用的卡片不参与）
func runProbe() {
	items, err := listItems()
	if err != nil {
		log.Printf("读取卡片失败，跳过本轮探测: %v", err)
		return
	}
	var wg sync.WaitGroup
	mu := sync.Mutex{}
	fresh := map[int64]ProbeResult{}
	for _, it := range items {
		if it.Hidden || !it.Probe || it.URL == "" {
			continue
		}
		wg.Add(1)
		go func(it Item) {
			defer wg.Done()
			r := probeOne(it.URL)
			mu.Lock()
			fresh[it.ID] = r
			mu.Unlock()
		}(it)
	}
	wg.Wait()

	probeMu.Lock()
	probeCache = fresh
	probeMu.Unlock()
}

func probeResult(id int64) (ProbeResult, bool) {
	probeMu.RLock()
	defer probeMu.RUnlock()
	r, ok := probeCache[id]
	return r, ok
}

// probeWake 设置变更（探测间隔）后唤醒重排
var probeWake = make(chan struct{}, 1)

func wakeProbe() {
	select {
	case probeWake <- struct{}{}:
	default:
	}
}

// probeInterval 当前探测间隔：0 = 关闭轮询；小于 5 秒统一按 5 秒处理
func probeInterval() time.Duration {
	n := getSettingInt("probe_interval", 20)
	if n <= 0 {
		return 0
	}
	if n < 5 {
		n = 5
	}
	return time.Duration(n) * time.Second
}

// clearProbeCache 关闭轮询时清空结果，前端不再显示历史在线状态
func clearProbeCache() {
	probeMu.Lock()
	probeCache = map[int64]ProbeResult{}
	probeMu.Unlock()
}

// startProbeLoop 后台定时探测：每轮按最新设置取间隔，改动即时生效；间隔为 0 时停止轮询
func startProbeLoop() {
	if iv := probeInterval(); iv > 0 {
		runProbe()
	} else {
		clearProbeCache()
	}
	go func() {
		lastZero := probeInterval() <= 0
		for {
			iv := probeInterval()
			if iv <= 0 {
				// 轮询已关闭：清空结果并等待设置变更
				clearProbeCache()
				lastZero = true
				<-probeWake
				continue
			}
			if lastZero {
				// 从关闭恢复：立即探测一次，不用等满一个间隔
				lastZero = false
				runProbe()
				continue
			}
			select {
			case <-probeWake: // 设置变更后不等满一轮立即重排
			case <-time.After(iv):
			}
			runProbe()
		}
	}()
	log.Printf("服务探测已启动（间隔可在管理后台调整，设为 0 关闭轮询）")
}
