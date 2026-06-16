const fs = require('fs-extra');
const path = require('path');
const readline = require('readline');
const cheerio = require('cheerio');
const { execSync } = require('child_process');

const NOVEL_DIR = path.join(__dirname, 'Novel');

async function main() {
    if (!fs.existsSync(NOVEL_DIR)) fs.ensureDirSync(NOVEL_DIR);
    
    const novels = fs.readdirSync(NOVEL_DIR).filter(file => {
        return fs.statSync(path.join(NOVEL_DIR, file)).isDirectory();
    });

    if (novels.length === 0) {
        console.log("Belum ada project novel.");
        process.exit(0);
    }

    console.log("=== Extractor HTML Manual (Jepang) ===");
    for (let i = 0; i < novels.length; i++) {
        console.log(`${i + 1}. ${novels[i]}`);
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (query) => new Promise(resolve => rl.question(query, resolve));
    
    let novelName = '';
    while (true) {
        const answer = await ask("Masukkan nomor pilihan: ");
        const choice = parseInt(answer.trim());
        if (choice >= 1 && choice <= novels.length) {
            novelName = novels[choice - 1];
            break;
        }
    }

    const baseNovelDir = path.join(NOVEL_DIR, novelName);
    const htmlsDir = path.join(baseNovelDir, 'htmls');
    const rawDir = path.join(baseNovelDir, 'raw');

    // Pastikan config.json menggunakan bahasa Jepang
    const configPath = path.join(baseNovelDir, 'config.json');
    let config = { admin: true, lang: 'jp' };
    if (fs.existsSync(configPath)) {
        config = fs.readJsonSync(configPath);
        config.lang = 'jp';
    }
    fs.writeJsonSync(configPath, config, { spaces: 2 });

    fs.ensureDirSync(rawDir);

    if (!fs.existsSync(htmlsDir)) {
        fs.ensureDirSync(htmlsDir);
        console.log(`\n=> Folder "htmls" telah dibuat di: ${htmlsDir}`);
        console.log("=> CARA PENGGUNAAN:");
        console.log("1. Buka browser aslimu dan masuk ke chapter novel.");
        console.log("2. Tekan Ctrl+S (Save As) atau cukup Copy seluruh tulisan HTML (Inspect Element).");
        console.log("3. Simpan sebagai file 1.html, 2.html, 3.html, dst. ke dalam folder 'htmls' tersebut.");
        console.log("4. Jalankan script ini lagi untuk mengubahnya menjadi teks raw yang bersih!");
        rl.close();
        return;
    }

    const htmlFiles = fs.readdirSync(htmlsDir).filter(f => f.endsWith('.html') || f.endsWith('.htm'));
    
    if (htmlFiles.length === 0) {
        console.log(`\n=> Folder "htmls" masih kosong!`);
        console.log(`Silakan masukkan file-file HTML chapter ke folder: ${htmlsDir}`);
        rl.close();
        return;
    }

    // Sort files based on numeric name if possible (e.g. 1.html, 2.html)
    htmlFiles.sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)) || 0;
        const numB = parseInt(b.match(/\d+/)) || 0;
        return numA - numB;
    });

    console.log(`\n=> Menemukan ${htmlFiles.length} file HTML. Memulai ekstraksi...`);

    let existingRawCount = fs.readdirSync(rawDir).filter(f => f.endsWith('.txt') && f !== 'last_url.txt').length;
    let successCount = 0;

    for (const file of htmlFiles) {
        const filePath = path.join(htmlsDir, file);
        const htmlContent = fs.readFileSync(filePath, 'utf-8');
        
        const $ = cheerio.load(htmlContent);
        
        // Coba ambil judul
        let title = $('title').text().replace(" - ハーメルン", "").trim();
        if (!title) {
            title = `Chapter ${existingRawCount + 1}`;
        }

        // Hapus furigana (rt, rp)
        $('rt, rp').remove();

        // Ambil teks dari #honbun p
        let chapterText = [];
        $('#honbun p').each((i, el) => {
            const pText = $(el).text().trim();
            if (pText) {
                chapterText.push(pText);
            }
        });

        if (chapterText.length === 0) {
            // Coba ambil dari tag <p> sembarang jika tidak ada #honbun (buat jaga-jaga kalau strukturnya beda)
            $('p').each((i, el) => {
                const pText = $(el).text().trim();
                if (pText && pText.length > 5) {
                    chapterText.push(pText);
                }
            });
        }

        if (chapterText.length === 0) {
            console.log(`  ❌ Gagal mengekstrak teks dari: ${file} (Teks kosong)`);
            continue;
        }

        const safeTitle = title.replace(/[/:?"<>|]/g, '-').trim();
        const finalContent = `${title}\n\n${chapterText.join('\n\n')}`;
        
        const rawFileName = `Chapter ${existingRawCount + 1}. ${safeTitle}.txt`;
        const rawFilePath = path.join(rawDir, rawFileName);

        fs.writeFileSync(rawFilePath, finalContent);
        console.log(`  ✔️ Berhasil diekstrak: ${file} -> ${rawFileName}`);

        // Pindahkan file HTML yang sudah diproses ke folder 'done' agar tidak diekstrak 2x
        const doneDir = path.join(htmlsDir, 'done');
        fs.ensureDirSync(doneDir);
        fs.renameSync(filePath, path.join(doneDir, file));

        // Hapus folder _files (misal 1_files) bawaan Chrome jika ada, karena tidak dibutuhkan lagi
        const filesDir = filePath.replace(/\.html?$/, '_files');
        if (fs.existsSync(filesDir)) {
            fs.removeSync(filesDir);
        }

        existingRawCount++;
        successCount++;
    }

    console.log(`\n🎉 Proses ekstraksi selesai! Total diekstrak: ${successCount} chapter.`);

    const answerBuild = await ask("\nApakah kamu mau langsung mempublikasikannya (Build HTML Public)? (y/n): ");
    if (answerBuild.toLowerCase() === 'y') {
        config.admin = false;
        fs.writeJsonSync(configPath, config, { spaces: 2 });
        
        console.log("=> Memulai proses build HTML public...");
        execSync("node build-jp.js --all", { stdio: 'inherit' });
        console.log("✅ Build selesai! Novel sudah bisa dibaca di browser.");
    }

    rl.close();
}

main().catch(console.error);
