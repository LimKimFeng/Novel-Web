package main

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/launcher"
	"github.com/go-rod/rod/lib/proto"
	"github.com/go-rod/stealth"
)

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

	if len(projects) == 0 {
		fmt.Println("Belum ada folder project di dalam folder Novel/!")
		return
	}

	fmt.Println("=== Pilih Project Novel ===")
	for i, proj := range projects {
		fmt.Printf("%d. %s\n", i+1, proj)
	}
	fmt.Println("===========================")

	reader := bufio.NewReader(os.Stdin)
	var novelName string

	for {
		fmt.Print("Masukkan nomor pilihan: ")
		pilihanStr, _ := reader.ReadString('\n')
		pilihanStr = strings.TrimSpace(pilihanStr)
		
		pilihan, err := strconv.Atoi(pilihanStr)
		if err == nil && pilihan >= 1 && pilihan <= len(projects) {
			novelName = projects[pilihan-1]
			break
		}
		fmt.Println("Pilihan tidak valid, masukkan angka yang sesuai.")
	}

	fmt.Printf("=> Project terpilih: %s\n\n", novelName)

	baseDir := filepath.Join("/home/LinJinFeng/Desktop/Cornel-SSD/Cornel-SSD/Novel-Web", "Novel", novelName, "raw")
	os.MkdirAll(baseDir, os.ModePerm)
	lastUrlPath := filepath.Join(baseDir, "last_url.txt")
	
	var startURL string
	if lastUrlBytes, err := os.ReadFile(lastUrlPath); err == nil && len(strings.TrimSpace(string(lastUrlBytes))) > 0 {
		startURL = strings.TrimSpace(string(lastUrlBytes))
		fmt.Printf("=> Melanjutkan dari jejak link terakhir: %s\n\n", startURL)
	} else {
		fmt.Print("Masukkan URL Awal Chapter (contoh: https://novelarrow.com/...): ")
		startURL, _ = reader.ReadString('\n')
		startURL = strings.TrimSpace(startURL)

		if startURL == "" {
			fmt.Println("URL tidak boleh kosong. Program dihentikan.")
			return
		}
	}

	fmt.Printf("Starting scraper for: %s\n", novelName)
	fmt.Printf("Initial URL: %s\n", startURL)

	u := launcher.New().Bin("/usr/bin/google-chrome-stable").Headless(false).MustLaunch()
	browser := rod.New().ControlURL(u).MustConnect()
	defer browser.MustClose()

	page := stealth.MustPage(browser)

	currentURL := startURL

	for currentURL != "" {
		fmt.Printf("Navigating to: %s\n", currentURL)
		page.MustNavigate(currentURL)
		page.MustWaitLoad()

		time.Sleep(3 * time.Second)
		
		html, _ := page.HTML()
		if strings.Contains(html, "Just a moment...") {
			fmt.Println("Cloudflare challenge detected! Waiting longer...")
			time.Sleep(10 * time.Second)
		}

		var title string
		var content string
		var nextURL string

		if strings.Contains(currentURL, "novelbin.com") {
			titleEl, err := page.Timeout(3 * time.Second).Element(".chr-title")
			if err == nil {
				title = titleEl.MustText()
			} else {
				fmt.Println("Could not find title in NovelBin")
			}

			contentEls, err := page.Timeout(3 * time.Second).Elements("#chr-content p")
			if err == nil {
				var paragraphs []string
				for _, p := range contentEls {
					text := p.MustText()
					if strings.TrimSpace(text) != "" {
						paragraphs = append(paragraphs, text)
					}
				}
				content = strings.Join(paragraphs, "\n\n")
			}

			nextEl, err := page.Timeout(3 * time.Second).Element("a.js-chapter-nav[data-chapter-nav='next']")
			if err == nil {
				disabled, _ := nextEl.Attribute("disabled")
				if disabled == nil {
					href, errHref := nextEl.Attribute("href")
					if errHref == nil && href != nil && *href != "javascript:void(0)" && *href != "" {
						nextURL = *href
					}
				}
			}

		} else if strings.Contains(currentURL, "novelarrow.com") {
			fmt.Println("Attempting to parse NovelArrow...")
			
			// Extract title from <title> tag
			titleEl, err := page.Timeout(3 * time.Second).Element("title")
			if err == nil {
				rawTitle := titleEl.MustText()
				// "The Golden Lord... / Chapter 208: Moonclaw... | Read on NovelArrow"
				parts := strings.Split(rawTitle, " / ")
				if len(parts) > 1 {
					subparts := strings.Split(parts[1], " | ")
					title = subparts[0]
				} else {
					title = rawTitle
				}
			}
			
			// Extract content from p tags
			contentEls, err := page.Timeout(3 * time.Second).Elements("p")
			if err == nil {
				var paragraphs []string
				for _, p := range contentEls {
					text := p.MustText()
					// Filter out short UI texts
					if len(text) > 30 {
						paragraphs = append(paragraphs, text)
					}
				}
				content = strings.Join(paragraphs, "\n\n")
			}

			// Find Next chapter button
			nextEl, err := page.Timeout(5 * time.Second).Element("[aria-label='Next chapter']")
			if err == nil {
				nextEl = nextEl.CancelTimeout() // Remove the 5s timeout for subsequent actions
				disabled, _ := nextEl.Attribute("disabled")
				if disabled == nil {
					// We can either extract href if it's an 'a' tag, or click it if it's a button.
					tagName, _ := nextEl.Eval(`() => this.tagName.toLowerCase()`)
					if tagName.Value.Str() == "a" {
						href, _ := nextEl.Attribute("href")
						if href != nil && *href != "" {
							if strings.HasPrefix(*href, "/") {
								nextURL = "https://novelarrow.com" + *href
							} else {
								nextURL = *href
							}
						}
					} else {
						// It's a button, click it
						fmt.Println("Clicking Next Chapter button...")
						nextEl.ScrollIntoView()
						time.Sleep(1 * time.Second) // wait a bit after scrolling
						errClick := nextEl.Click(proto.InputMouseButtonLeft, 1)
						if errClick != nil {
							fmt.Printf("Error clicking: %v\n", errClick)
							break
						}
						page.MustWaitLoad()
						time.Sleep(3 * time.Second)
						nextURL = page.MustInfo().URL
						// Avoid infinite loop if URL didn't change
						if nextURL == currentURL {
							nextURL = ""
						}
					}
				} else {
					fmt.Println("Next chapter button is disabled.")
				}
			}
		}

		if title == "" || content == "" {
			fmt.Println("Failed to extract title or content. Stopping.")
			break
		}

		// Sanitizing Title for filename
		safeTitle := strings.ReplaceAll(title, "/", "-")
		safeTitle = strings.ReplaceAll(safeTitle, ":", " -")
		safeTitle = strings.ReplaceAll(safeTitle, "?", "")
		safeTitle = strings.ReplaceAll(safeTitle, "\"", "")

		// baseDir already created above

		filename := fmt.Sprintf("%s.txt", safeTitle)
		filePath := filepath.Join(baseDir, filename)

		err := os.WriteFile(filePath, []byte(title+"\n\n"+content), 0644)
		if err != nil {
			fmt.Printf("Failed to write file %s: %v\n", filePath, err)
			break
		}
		fmt.Printf("Saved: %s\n", filePath)

		if nextURL == "" {
			fmt.Println("No Next Chapter found. Finished.")
			os.WriteFile(lastUrlPath, []byte(currentURL), 0644)
			break
		}

		os.WriteFile(lastUrlPath, []byte(nextURL), 0644)
		currentURL = nextURL
		
		// Wait a bit before next fetch to avoid getting rate limited
		time.Sleep(2 * time.Second)
	}
}
