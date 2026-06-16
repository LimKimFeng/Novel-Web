const fs = require('fs-extra');
const path = require('path');
const readline = require('readline');

const NOVEL_DIR = path.join(__dirname, 'Novel');
const PUBLIC_DIR = path.join(__dirname, 'public');
const TEMPLATE_DIR = path.join(__dirname, 'template');

const tplIndex = fs.readFileSync(path.join(TEMPLATE_DIR, 'index.html'), 'utf-8');
const tplNovel = fs.readFileSync(path.join(TEMPLATE_DIR, 'novel.html'), 'utf-8');
const tplChapter = fs.readFileSync(path.join(TEMPLATE_DIR, 'chapter.html'), 'utf-8');

async function buildSite(selectedNovels) {
    console.log('Starting static site build process for Japanese Novels...');

    fs.ensureDirSync(PUBLIC_DIR);
    fs.copySync(path.join(TEMPLATE_DIR, 'style.css'), path.join(PUBLIC_DIR, 'style.css'));
    fs.copySync(path.join(TEMPLATE_DIR, 'script.js'), path.join(PUBLIC_DIR, 'script.js'));
    if (fs.existsSync(path.join(TEMPLATE_DIR, 'login.html'))) {
        fs.copySync(path.join(TEMPLATE_DIR, 'login.html'), path.join(PUBLIC_DIR, 'login.html'));
    }

    if (!fs.existsSync(NOVEL_DIR)) {
        console.log('Novel directory not found. Creating empty one.');
        fs.ensureDirSync(NOVEL_DIR);
    }

    for (const novel of selectedNovels) {
        console.log(`\nProcessing Novel: ${novel}`);
        const novelPath = path.join(NOVEL_DIR, novel);
        const novelPublicPath = path.join(PUBLIC_DIR, novel);
        fs.ensureDirSync(novelPublicPath);

        if (fs.existsSync(path.join(novelPath, 'cover.jpg'))) {
            fs.copySync(path.join(novelPath, 'cover.jpg'), path.join(novelPublicPath, 'cover.jpg'));
        } else if (fs.existsSync(path.join(novelPath, 'cover.webp'))) {
            fs.copySync(path.join(novelPath, 'cover.webp'), path.join(novelPublicPath, 'cover.webp'));
        }

        const rawPath = path.join(novelPath, 'raw');
        fs.ensureDirSync(rawPath);

        const rawFiles = fs.readdirSync(rawPath)
            .filter(f => f.endsWith('.txt') && f !== 'last_url.txt')
            .sort((a, b) => {
                const aMatch = a.match(/\d+/);
                const bMatch = b.match(/\d+/);
                const aNum = aMatch ? parseInt(aMatch[0]) : 0;
                const bNum = bMatch ? parseInt(bMatch[0]) : 0;
                return aNum - bNum;
            });

        let chapterListHtml = '';
        let chapterOptionsHtml = '';

        for (let j = 0; j < rawFiles.length; j++) {
            const chapName = rawFiles[j].replace('.txt', '');
            chapterOptionsHtml += `<option value="${chapName}">${chapName}</option>\n`;
        }

        for (let i = 0; i < rawFiles.length; i++) {
            const file = rawFiles[i];
            const chapterName = file.replace('.txt', '');
            console.log(`  - Generating HTML for: ${chapterName}`);

            const chapterPublicDir = path.join(novelPublicPath, chapterName);
            fs.ensureDirSync(chapterPublicDir);

            const contentRaw = fs.readFileSync(path.join(rawPath, file), 'utf-8');
            const paragraphs = contentRaw.split('\n').filter(p => p.trim() !== '');
            
            let chapterHtml = '';
            for (const p of paragraphs) {
                chapterHtml += `<p>${p}</p>`;
            }

            const prevFile = i > 0 ? `../${rawFiles[i-1].replace('.txt', '')}/index.html` : null;
            const nextFile = i < rawFiles.length - 1 ? `../${rawFiles[i+1].replace('.txt', '')}/index.html` : null;

            const prevLinkHtml = prevFile ? `<a href="${prevFile}" class="btn">&larr; Previous</a>` : `<span class="btn" style="visibility: hidden;">&larr; Previous</span>`;
            const nextLinkHtml = nextFile ? `<a href="${nextFile}" class="btn">Next &rarr;</a>` : `<span class="btn" style="visibility: hidden;">Next &rarr;</span>`;

            let currentChapterOptionsHtml = chapterOptionsHtml.replace(`value="${chapterName}"`, `value="${chapterName}" selected`);

            let chapterFinalHtml = tplChapter
                .replace(/{{NOVEL_NAME}}/g, novel)
                .replace(/{{CHAPTER_NAME}}/g, chapterName)
                .replace(/{{CHAPTER_CONTENT}}/g, chapterHtml)
                .replace(/{{PREV_LINK_HTML}}/g, prevLinkHtml)
                .replace(/{{NEXT_LINK_HTML}}/g, nextLinkHtml)
                .replace(/{{CHAPTER_OPTIONS}}/g, currentChapterOptionsHtml);

            fs.writeFileSync(path.join(chapterPublicDir, 'index.html'), chapterFinalHtml);
            chapterListHtml += `<a href="${chapterName}/index.html">${chapterName}</a>\n`;
        }

        let novelFinalHtml = tplNovel
            .replace(/{{NOVEL_NAME}}/g, novel)
            .replace(/{{CHAPTER_LIST}}/g, chapterListHtml || '<p style="grid-column: 1/-1;">No chapters yet.</p>');

        fs.writeFileSync(path.join(novelPublicPath, 'index.html'), novelFinalHtml);
    }

    // Update index.html using ALL novels in the Novel/ folder (baik JP maupun Chinese)
    const allNovels = fs.readdirSync(NOVEL_DIR).filter(file => {
        return fs.statSync(path.join(NOVEL_DIR, file)).isDirectory();
    });

    let publicNovelListHtml = '';
    let adminNovelListHtml = '';

    for (const novel of allNovels) {
        let chaptersCount = 0;
        
        // Cek chapter dari folder 'content' (jika novel terjemahan)
        const contentPath = path.join(NOVEL_DIR, novel, 'content');
        if (fs.existsSync(contentPath)) {
            chaptersCount = fs.readdirSync(contentPath).filter(f => f.endsWith('.txt')).length;
        } else {
            // Jika tidak ada folder content, kemungkinan novel jepang, cek folder 'raw'
            const rawPath = path.join(NOVEL_DIR, novel, 'raw');
            if (fs.existsSync(rawPath)) {
                chaptersCount = fs.readdirSync(rawPath).filter(f => f.endsWith('.txt') && f !== 'last_url.txt').length;
            }
        }
        
        let isAdmin = false;
        const configPath = path.join(NOVEL_DIR, novel, 'config.json');
        if (fs.existsSync(configPath)) {
            isAdmin = fs.readJsonSync(configPath).admin || false;
        }

        const cardHtml = `
            <a href="${novel}/index.html" class="novel-card">
                <img src="${novel}/cover.jpg" alt="${novel} Cover" onerror="this.onerror=null; this.src='${novel}/cover.webp';">
                <div class="novel-info">
                    <h3>${novel}</h3>
                    <span>${chaptersCount} chapters</span>
                </div>
            </a>
        `;

        if (isAdmin) {
            adminNovelListHtml += cardHtml;
        } else {
            publicNovelListHtml += cardHtml;
        }
    }

    if (!publicNovelListHtml) publicNovelListHtml = '<p>No public novels available yet.</p>';
    if (!adminNovelListHtml) adminNovelListHtml = '<p>No hidden novels available yet.</p>';

    let indexFinalHtml = tplIndex.replace(/{{NOVEL_LIST}}/g, publicNovelListHtml);
    fs.writeFileSync(path.join(PUBLIC_DIR, 'index.html'), indexFinalHtml);
    
    if (fs.existsSync(path.join(TEMPLATE_DIR, 'admin-index.html'))) {
        const tplAdminIndex = fs.readFileSync(path.join(TEMPLATE_DIR, 'admin-index.html'), 'utf-8');
        let adminIndexFinalHtml = tplAdminIndex.replace(/{{NOVEL_LIST}}/g, adminNovelListHtml);
        fs.writeFileSync(path.join(PUBLIC_DIR, 'admin-index.html'), adminIndexFinalHtml);
    }

    console.log('\nBuild completed successfully!');
    process.exit(0);
}

async function startInteractive() {
    if (!fs.existsSync(NOVEL_DIR)) fs.ensureDirSync(NOVEL_DIR);
    
    const novels = fs.readdirSync(NOVEL_DIR).filter(file => {
        return fs.statSync(path.join(NOVEL_DIR, file)).isDirectory();
    });

    if (novels.length === 0) {
        console.log("Belum ada project novel.");
        process.exit(0);
    }

    if (process.argv.includes('--all')) {
        console.log("\n=> Mode Auto-Update: Memproses SEMUA novel Jepang...");
        const jpNovels = [];
        for (const novel of novels) {
            const configPath = path.join(NOVEL_DIR, novel, 'config.json');
            if (fs.existsSync(configPath)) {
                const cfg = fs.readJsonSync(configPath);
                if (cfg.lang === 'jp') {
                    jpNovels.push(novel);
                }
            }
        }
        if (jpNovels.length > 0) {
            await buildSite(jpNovels);
        } else {
            console.log("Tidak ada project Jepang yang ditemukan (lang: 'jp'). Hanya mengupdate index utama.");
            await buildSite([]); 
        }
        return;
    }

    console.log("\n=== Pilih Project Novel Jepang untuk di-Build ===");
    for (let i = 0; i < novels.length; i++) {
        console.log(`${i + 1}. ${novels[i]}`);
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (query) => new Promise(resolve => rl.question(query, resolve));
    
    let selectedNovels = [];
    while (true) {
        const answer = await ask("Masukkan nomor pilihan: ");
        const choice = parseInt(answer.trim());
        if (choice >= 1 && choice <= novels.length) {
            selectedNovels = [novels[choice - 1]];
            break;
        }
    }
    rl.close();
    
    await buildSite(selectedNovels);
}

startInteractive().catch(console.error);
