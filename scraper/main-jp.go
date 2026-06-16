package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/launcher"
	"github.com/go-rod/rod/lib/proto"
	"github.com/go-rod/stealth"
)

type Config struct {
	Admin bool   `json:"admin"`
	Lang  string `json:"lang,omitempty"`
}

func main() {
	novelBaseDir := "/home/LinJinFeng/Desktop/Cornel-SSD/Cornel-SSD/Novel-Web/Novel"
	entries, err := os.ReadDir(novelBaseDir)
	if err != nil {
		fmt.Printf("Gagal membaca folder %s: %v\n", novelBaseDir, err)
		return
	}

	var projects []string
	for _, entry := range entries {
		if entry.IsDir() {
			projects = append(projects, entry.Name())
		}
	}

	fmt.Println("=== Pilih Project Novel Jepang ===")
	for i, proj := range projects {
		fmt.Printf("%d. %s\n", i+1, proj)
	}
	fmt.Println("==================================")

	reader := bufio.NewReader(os.Stdin)
	var novelName string

	for {
		fmt.Print("Masukkan nomor pilihan (atau ketik nama project baru): ")
		pilihanStr, _ := reader.ReadString('\n')
		pilihanStr = strings.TrimSpace(pilihanStr)
		
		pilihan, err := strconv.Atoi(pilihanStr)
		if err == nil && pilihan >= 1 && pilihan <= len(projects) {
			novelName = projects[pilihan-1]
			break
		} else if pilihanStr != "" && err != nil {
			novelName = pilihanStr
			break
		}
		fmt.Println("Input tidak valid.")
	}

	fmt.Printf("=> Project terpilih: %s\n\n", novelName)

	baseNovelDir := filepath.Join("/home/LinJinFeng/Desktop/Cornel-SSD/Cornel-SSD/Novel-Web", "Novel", novelName)
	rawDir := filepath.Join(baseNovelDir, "raw")
	os.MkdirAll(rawDir, os.ModePerm)

	// Set config to private (admin: true) and lang: jp while scraping
	configPath := filepath.Join(baseNovelDir, "config.json")
	setConfig(configPath, true, "jp")

	lastUrlPath := filepath.Join(rawDir, "last_url.txt")
	var startURL string
	if lastUrlBytes, err := os.ReadFile(lastUrlPath); err == nil && len(strings.TrimSpace(string(lastUrlBytes))) > 0 {
		startURL = strings.TrimSpace(string(lastUrlBytes))
		fmt.Printf("=> Melanjutkan dari jejak link terakhir: %s\n\n", startURL)
	} else {
		fmt.Print("Masukkan URL Awal Chapter (contoh: https://syosetu.org/novel/...): ")
		startURL, _ = reader.ReadString('\n')
		startURL = strings.TrimSpace(startURL)

		if startURL == "" {
			fmt.Println("URL tidak boleh kosong. Program dihentikan.")
			return
		}
	}

	fmt.Printf("Starting JP scraper for: %s\n", novelName)
	fmt.Printf("Initial URL: %s\n", startURL)

	// Menggunakan Profil Chrome ASLI milikmu (User Mode)
	// Pastikan Google Chrome milikmu ditutup semua sebelum menjalankan script ini,
	// karena Chrome mengunci folder profilnya saat sedang berjalan.
	// Menggunakan profil terpisah ("chrome_data") agar kamu TIDAK PERLU menutup Chrome utamamu.
	// Ditambah dengan stealth dan host-resolver-rules untuk mem-bypass IM3 dan Cloudflare.
	u := launcher.New().
		Bin("/usr/bin/google-chrome-stable").
		UserDataDir("chrome_data").
		Headless(false).
		Set("ignore-certificate-errors", "true").
		Set("host-resolver-rules", "MAP syosetu.org 104.20.25.106, MAP *.syosetu.org 104.20.25.106").
		Set("disable-blink-features", "AutomationControlled").
		Delete("enable-automation").
		MustLaunch()
	browser := rod.New().ControlURL(u).MustConnect()
	defer browser.MustClose()

	// Set Cookies secara langsung di dalam kode
	fmt.Println("=> Menyuntikkan cookies ke dalam browser...")
	_ = browser.SetCookies([]*proto.NetworkCookieParam{
		{
			Name:     "_im_vid",
			Value:    "01KV8NC5E863BQVGRJC5T8MHKH",
			Domain:   "syosetu.org",
			Path:     "/",
			Secure:   true,
			SameSite: proto.NetworkCookieSameSiteNone, // "no_restriction" di map ke None
		},
		{
			Name:     "ETURAN",
			Value:    "404785_1",
			Domain:   ".syosetu.org",
			Path:     "/",
			Secure:   true,
			HTTPOnly: true,
			SameSite: proto.NetworkCookieSameSiteLax,
		},
		{
			Name:     "over18",
			Value:    "yes",
			Domain:   ".syosetu.org",
			Path:     "/",
		},
	})
	fmt.Println("  ✔️ Cookies berhasil disuntikkan!")

	// Membuka halaman dengan Stealth Mode agar tidak dideteksi sebagai bot oleh Cloudflare Turnstile
	page := stealth.MustPage(browser)

	currentURL := startURL
	chapterCount := 1

	// Detect starting chapter count if files exist
	files, _ := os.ReadDir(rawDir)
	for _, f := range files {
		if strings.HasPrefix(f.Name(), "Chapter ") && strings.HasSuffix(f.Name(), ".txt") {
			chapterCount++
		}
	}

	for currentURL != "" {
		fmt.Printf("Navigating to: %s\n", currentURL)
		page.MustNavigate(currentURL)
		page.MustWaitLoad()

		time.Sleep(2 * time.Second)
		
		html, _ := page.HTML()
		if strings.Contains(html, "Just a moment...") || strings.Contains(html, "cf-turnstile") {
			fmt.Println("Cloudflare challenge detected! Silakan selesaikan captcha di browser.")
		}

		fmt.Println("Menunggu konten chapter termuat...")
		// Tunggu sampai elemen #honbun benar-benar muncul di halaman (tanpa batas waktu)
		for {
			hasHonbun, _, _ := page.Has("#honbun")
			if hasHonbun {
				break
			}
			time.Sleep(2 * time.Second)
		}

		// Ambil Judul
		var title string
		titleEl, err := page.Element("title")
		if err == nil {
			title = titleEl.MustText()
			title = strings.ReplaceAll(title, " - ハーメルン", "")
		} else {
			title = fmt.Sprintf("Chapter %d", chapterCount)
		}

		// Ambil Isi Teks Jepang (Honbun)
		contentJs := `() => {
			let ps = document.querySelectorAll('#honbun p');
			let texts = [];
			for (let p of ps) {
				let clone = p.cloneNode(true);
				let rubies = clone.querySelectorAll('rt, rp');
				rubies.forEach(r => r.remove());
				let text = clone.innerText.trim();
				if (text !== '') {
					texts.push(text);
				}
			}
			return texts.join('\n\n');
		}`
		
		res, err := page.Eval(contentJs)
		var content string
		if err == nil && res != nil {
			content = res.Value.Str()
		}

		if content == "" {
			fmt.Println("Gagal mengambil isi chapter (honbun tidak ditemukan atau kosong). Berhenti.")
			break
		}

		// Bersihkan judul untuk nama file
		safeTitle := strings.ReplaceAll(title, "/", "-")
		safeTitle = strings.ReplaceAll(safeTitle, ":", " -")
		safeTitle = strings.ReplaceAll(safeTitle, "?", "")
		safeTitle = strings.ReplaceAll(safeTitle, "\"", "")

		filename := fmt.Sprintf("Chapter %d.txt", chapterCount)
		filePath := filepath.Join(rawDir, filename)

		err = os.WriteFile(filePath, []byte(title+"\n\n"+content), 0644)
		if err != nil {
			fmt.Printf("Gagal menyimpan file %s: %v\n", filePath, err)
			break
		}
		fmt.Printf("  ✔️ Tersimpan: %s\n", filename)

		// Cek link selanjutnya
		var nextURL string
		nextEl, err := page.Timeout(3 * time.Second).Element("a.next_page_link")
		if err == nil {
			href, _ := nextEl.Property("href")
			if href.Str() != "" && !strings.Contains(href.Str(), "#") {
				nextURL = href.Str()
			}
		}

		if nextURL == "" {
			fmt.Println("🎉 Tidak ada tombol Next! Scraping selesai!")
			os.WriteFile(lastUrlPath, []byte(currentURL), 0644)
			
			// Scraping selesai, set ke public (admin: false)
			fmt.Println("=> Mengubah status novel menjadi Public...")
			setConfig(configPath, false, "jp")
			
			// Launch build-jp.js secara otomatis!
			fmt.Println("=> Memulai proses build HTML...")
			cmd := exec.Command("node", "build-jp.js", "--all")
			cmd.Dir = "/home/LinJinFeng/Desktop/Cornel-SSD/Cornel-SSD/Novel-Web"
			cmd.Stdout = os.Stdout
			cmd.Stderr = os.Stderr
			cmd.Run()
			
			fmt.Println("✅ Semua proses selesai! Novel siap dibaca di browser.")
			break
		}

		os.WriteFile(lastUrlPath, []byte(nextURL), 0644)
		currentURL = nextURL
		chapterCount++
		
		time.Sleep(2 * time.Second)
	}
}

func setConfig(path string, isAdmin bool, lang string) {
	config := Config{
		Admin: isAdmin,
		Lang:  lang,
	}
	bytes, _ := json.MarshalIndent(config, "", "  ")
	os.WriteFile(path, bytes, 0644)
}
