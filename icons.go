package main

import (
	"crypto/md5"
	"crypto/tls"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// iconTransport 内网自签证书也能抓
var iconTransport = &http.Transport{
	TLSClientConfig:       &tls.Config{InsecureSkipVerify: true},
	TLSHandshakeTimeout:   5 * time.Second,
	ResponseHeaderTimeout: 8 * time.Second,
	DialContext:           (&net.Dialer{Timeout: 5 * time.Second}).DialContext,
}

// 图标方案：
//  1. icon_type=upload  —— 本地文件（后台上传或"抓取图标"固化），地址 /icons/<file>
//  2. icon_type=letter   —— 首字母色块，前端渲染，不需要文件
//  3. icon_type=auto     —— 服务端代抓目标站点 favicon 并缓存，前端走 /api/icons/proxy

var iconClient = &http.Client{
	Timeout: 8 * time.Second,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 {
			return fmt.Errorf("跳转过多")
		}
		return nil
	},
	Transport: iconTransport,
}

var allowedExt = map[string]string{
	"image/png":                ".png",
	"image/jpeg":               ".jpg",
	"image/gif":                ".gif",
	"image/webp":               ".webp",
	"image/svg+xml":            ".svg",
	"image/x-icon":             ".ico",
	"image/vnd.microsoft.icon": ".ico",
}

var iconLinkRe = regexp.MustCompile(`(?is)<link[^>]+rel\s*=\s*["']?[^"']*icon[^"']*["']?[^>]*>`)
var hrefRe = regexp.MustCompile(`(?is)href\s*=\s*["']([^"']+)["']`)

// safeIconName 只允许文件名，杜绝路径穿越
func safeIconName(name string) string {
	name = filepath.Base(name)
	if name == "." || name == "/" || strings.Contains(name, "..") {
		return ""
	}
	return name
}

func saveIcon(data []byte, ext string) (string, error) {
	if len(data) == 0 {
		return "", fmt.Errorf("图标内容为空")
	}
	if len(data) > 2<<20 { // 2MB 上限
		return "", fmt.Errorf("图标过大")
	}
	sum := md5.Sum(data)
	name := hex.EncodeToString(sum[:]) + ext
	if err := os.WriteFile(filepath.Join(iconDir, name), data, 0o644); err != nil {
		return "", err
	}
	return name, nil
}

// fetchFavicon 抓取站点图标：先解析页面里的 <link rel=icon>，失败再试 /favicon.ico
func fetchFavicon(pageURL string) ([]byte, string, error) {
	pageURL = strings.TrimSpace(pageURL)
	if pageURL == "" {
		return nil, "", fmt.Errorf("地址为空")
	}
	if !strings.Contains(pageURL, "://") {
		pageURL = "http://" + pageURL
	}
	u, err := url.Parse(pageURL)
	if err != nil {
		return nil, "", fmt.Errorf("地址无法解析")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, "", fmt.Errorf("仅支持 http/https")
	}
	base := u.Scheme + "://" + u.Host

	// 1) 页面里的 link rel=icon
	if body, ct, err := get(u.String()); err == nil {
		if strings.Contains(ct, "text/html") || strings.Contains(string(body[:min(len(body), 512)]), "<html") {
			for _, tag := range iconLinkRe.FindAllString(string(body), 5) {
				m := hrefRe.FindStringSubmatch(tag)
				if len(m) < 2 {
					continue
				}
				href := strings.TrimSpace(m[1])
				iconURL := href
				if strings.HasPrefix(href, "//") {
					iconURL = u.Scheme + ":" + href
				} else if strings.HasPrefix(href, "/") {
					iconURL = base + href
				} else if !strings.HasPrefix(href, "http") {
					iconURL = base + "/" + href
				}
				if data, ext, err := fetchImage(iconURL); err == nil {
					return data, ext, nil
				}
			}
		}
	}

	// 2) 兜底 /favicon.ico
	return fetchImage(base + "/favicon.ico")
}

func get(rawURL string) ([]byte, string, error) {
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", "home-page-icon/1.0")
	resp, err := iconClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, "", err
	}
	return body, resp.Header.Get("Content-Type"), nil
}

func fetchImage(rawURL string) ([]byte, string, error) {
	body, ct, err := get(rawURL)
	if err != nil {
		return nil, "", err
	}
	ct = strings.ToLower(strings.TrimSpace(strings.Split(ct, ";")[0]))
	ext, ok := allowedExt[ct]
	if !ok {
		// 部分站点不返回 content-type，按内容嗅探
		sniffed := http.DetectContentType(body)
		if e, ok2 := allowedExt[strings.Split(sniffed, ";")[0]]; ok2 {
			ext = e
		} else if strings.Contains(strings.ToLower(string(body[:min(len(body), 256)])), "<svg") {
			ext = ".svg"
		} else {
			return nil, "", fmt.Errorf("不是图片类型: %s", ct)
		}
	}
	if len(body) == 0 {
		return nil, "", fmt.Errorf("空响应")
	}
	return body, ext, nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// cacheKeyFor 按 URL 生成缓存文件名
func cacheKeyFor(rawURL string) string {
	sum := md5.Sum([]byte(rawURL))
	return hex.EncodeToString(sum[:])
}

// findCachedIcon 在图标目录里查找缓存文件（扩展名未知，逐个试）
func findCachedIcon(key string) string {
	for _, ext := range []string{".png", ".ico", ".svg", ".jpg", ".webp", ".gif"} {
		p := filepath.Join(iconDir, key+ext)
		if fi, err := os.Stat(p); err == nil && fi.Size() > 0 {
			return key + ext
		}
	}
	return ""
}
