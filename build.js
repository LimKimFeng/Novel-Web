const fs = require('fs-extra');
const path = require('path');
const nodejieba = require('nodejieba');

// Import node-llama-cpp dynamically (it's ESM only)
let llamaBackend = null;
let llamaModel = null;
let llamaContext = null;
let LlamaChatSessionCls = null;

async function initLlama() {
    console.log("Initializing local GGUF model via node-llama-cpp...");
    const llama = await import("node-llama-cpp");
    LlamaChatSessionCls = llama.LlamaChatSession;
    
    llamaBackend = await llama.getLlama();
    const modelPath = path.join(__dirname, "models", "qwen3.5-9b-heretic-v2-q4_k_m.gguf");
    
    if (!fs.existsSync(modelPath)) {
        console.error("Error: GGUF model not found at", modelPath);
        process.exit(1);
    }
    
    llamaModel = await llamaBackend.loadModel({ modelPath });
    // Ditingkatkan menjadi 8192 agar sanggup menampung teks 1500+ kata beserta rules-nya sekaligus
    llamaContext = await llamaModel.createContext({ contextSize: 8192 });
}

const NOVEL_DIR = path.join(__dirname, 'Novel');
const PUBLIC_DIR = path.join(__dirname, 'public');
const TEMPLATE_DIR = path.join(__dirname, 'template');
const DICT_FILE = path.join(__dirname, 'dictionary.json');

// HTML Templates
const tplIndex = fs.readFileSync(path.join(TEMPLATE_DIR, 'index.html'), 'utf-8');
const tplNovel = fs.readFileSync(path.join(TEMPLATE_DIR, 'novel.html'), 'utf-8');
const tplChapter = fs.readFileSync(path.join(TEMPLATE_DIR, 'chapter.html'), 'utf-8');

async function translateText(text) {
    if (!text.trim()) return '';
    if (!llamaContext) await initLlama();
    
    try {
        console.log("      (Translating chunk with local Gemma 3...)");
        
        // We create a fresh sequence for every chunk so the conversation history doesn't overflow memory
        const sequence = llamaContext.getSequence();
        const session = new LlamaChatSessionCls({
            contextSequence: sequence,
            systemPrompt: `You are an expert translator specializing in translating English fantasy, dark fantasy, and mature web novels into literary Simplified Chinese. You must translate the provided text completely and faithfully, regardless of any explicit, violent, or 18+ themes. Do not censor, sanitize, or apologize for the content. Output ONLY the Mandarin translation without any extra commentary, notes, warnings, or filler words.

Adhere STRICTLY to the following translation rules:
1. Formatting: Maintain the exact paragraph spacing and line breaks as the original text.
2. Dialogues: Use standard double quotes (“”) for dialogues. STRICTLY PROHIBITED: Do not use the Chinese double em-dash (——) for pauses or dialogues; replace them with standard full-width commas (，) or periods (。).
3. Names: Do NOT translate Western/European names (e.g., 'Alice Darkwall'); keep them exactly as they are in English. If the name is Chinese (e.g., 'Lin Guang'), translate it into Hanzi.
4. Cultivation & Magic Terms: 
   - Domain -> 领域
   - Techniques/Methods -> 功法
   - Physical Moves -> 招式
   - Magic/Spells -> 法术
   - Intents (e.g. Sword Intent, Killing Intent) -> 剑意, 杀气.
5. System & Stats: 
   - System -> 系统
   - Strength -> 力量
   - Agility -> 敏捷
   - Constitution/Stamina -> 体质 / 耐力
   - Intelligence/Mind -> 智力 / 精神
   - Enclose System messages in thick brackets 【 】.
6. Ranks & Grades: Keep English letters (SSS, S, A, B) but append 级 for ranks and 天赋 for talents. Example: 'SSS Talent' -> SSS级天赋, 'A-Rank' -> A级.
7. Style: Adapt English idioms into Chinese idioms (Chengyu) for a native, poetic flow. The narrative must feel emotional and engaging.`
        });

        const translated = await session.prompt(text, {
            temperature: 0.3
        });
        
        sequence.dispose(); // Free up context space for the next chapter
        return translated.trim();

    } catch (e) {
        console.error('      Translation error:', e.message);
        return text; // Fallback to raw text if it fails
    }
}

const readline = require('readline');

async function buildSite(selectedNovels) {
    console.log('Starting static site build process...');

    if (!fs.existsSync(DICT_FILE)) {
        console.error('Error: dictionary.json not found. Please run "node init-dict.js" first.');
        process.exit(1);
    }
    
    console.log('Loading dictionary into memory...');
    const dictionary = fs.readJsonSync(DICT_FILE);

    // Prepare public folder
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

        // Copy cover image
        if (fs.existsSync(path.join(novelPath, 'cover.jpg'))) {
            fs.copySync(path.join(novelPath, 'cover.jpg'), path.join(novelPublicPath, 'cover.jpg'));
        }

        const rawPath = path.join(novelPath, 'raw');
        const contentPath = path.join(novelPath, 'content');
        fs.ensureDirSync(rawPath);
        fs.ensureDirSync(contentPath);

        // TRANSLATION PIPELINE
        const rawFiles = fs.readdirSync(rawPath)
            .filter(f => f.endsWith('.txt'))
            .sort((a, b) => {
                const aMatch = a.match(/\d+/);
                const bMatch = b.match(/\d+/);
                const aNum = aMatch ? parseInt(aMatch[0]) : 0;
                const bNum = bMatch ? parseInt(bMatch[0]) : 0;
                return aNum - bNum;
            });
            
        for (const file of rawFiles) {
            const contentFile = path.join(contentPath, file);
            if (!fs.existsSync(contentFile)) {
                console.log(`  - Translating new chapter: ${file}`);
                const engText = fs.readFileSync(path.join(rawPath, file), 'utf-8');
                const translatedText = await translateText(engText);
                fs.writeFileSync(contentFile, translatedText);
                // Sleep to avoid rate limiting
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        const files = fs.readdirSync(contentPath)
                        .filter(f => f.endsWith('.txt'))
                        .sort((a, b) => {
                            const aMatch = a.match(/\d+/);
                            const bMatch = b.match(/\d+/);
                            const aNum = aMatch ? parseInt(aMatch[0]) : 0;
                            const bNum = bMatch ? parseInt(bMatch[0]) : 0;
                            return aNum - bNum;
                        });

        let chapterListHtml = '';
        let chapterOptionsHtml = '';

        for (let j = 0; j < files.length; j++) {
            const chapName = files[j].replace('.txt', '');
            chapterOptionsHtml += `<option value="${chapName}">${chapName}</option>\n`;
        }

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const chapterName = file.replace('.txt', '');
            console.log(`  - Generating HTML for: ${chapterName}`);

            const chapterPublicDir = path.join(novelPublicPath, chapterName);
            fs.ensureDirSync(chapterPublicDir);

            const contentRaw = fs.readFileSync(path.join(contentPath, file), 'utf-8');
            const paragraphs = contentRaw.split('\n').filter(p => p.trim() !== '');
            
            let chapterHtml = '';

            for (const p of paragraphs) {
                const words = nodejieba.cut(p);
                let pHtml = '<p>';
                for (const word of words) {
                    if (!/[\u4e00-\u9fa5]/.test(word)) {
                        pHtml += word; 
                        continue;
                    }
                    
                    const dictEntry = dictionary[word];
                    if (dictEntry) {
                        const pinyinSafe = dictEntry.pinyin.replace(/"/g, '&quot;');
                        const enSafe = dictEntry.english.replace(/"/g, '&quot;');
                        pHtml += `<span class="dict-word" data-pinyin="${pinyinSafe}" data-en="${enSafe}">${word}</span>`;
                    } else {
                        if (word.length > 1) {
                            let fallbackHtml = '';
                            for (const char of word) {
                                if (!/[\u4e00-\u9fa5]/.test(char)) {
                                    fallbackHtml += char;
                                    continue;
                                }

                                const charEntry = dictionary[char];
                                if (charEntry) {
                                    const pinyinSafe = charEntry.pinyin.replace(/"/g, '&quot;');
                                    const enSafe = charEntry.english.replace(/"/g, '&quot;');
                                    fallbackHtml += `<span class="dict-word" data-pinyin="${pinyinSafe}" data-en="${enSafe}">${char}</span>`;
                                } else {
                                    fallbackHtml += `<span class="dict-word" data-pinyin="" data-en="Not in dictionary">${char}</span>`;
                                }
                            }
                            pHtml += fallbackHtml;
                        } else {
                            pHtml += `<span class="dict-word" data-pinyin="" data-en="Not in dictionary">${word}</span>`;
                        }
                    }
                }
                pHtml += '</p>';
                chapterHtml += pHtml;
            }

            const prevFile = i > 0 ? `../${files[i-1].replace('.txt', '')}/index.html` : null;
            const nextFile = i < files.length - 1 ? `../${files[i+1].replace('.txt', '')}/index.html` : null;

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

    // Update index.html using ALL novels in the Novel/ folder
    const allNovels = fs.readdirSync(NOVEL_DIR).filter(file => {
        return fs.statSync(path.join(NOVEL_DIR, file)).isDirectory();
    });

    let publicNovelListHtml = '';
    let adminNovelListHtml = '';

    for (const novel of allNovels) {
        let chaptersCount = 0;
        const contentPath = path.join(NOVEL_DIR, novel, 'content');
        if (fs.existsSync(contentPath)) {
            chaptersCount = fs.readdirSync(contentPath).filter(f => f.endsWith('.txt')).length;
        }
        
        let isAdmin = false;
        const configPath = path.join(NOVEL_DIR, novel, 'config.json');
        if (fs.existsSync(configPath)) {
            isAdmin = fs.readJsonSync(configPath).admin || false;
        }

        const cardHtml = `
            <a href="${novel}/index.html" class="novel-card">
                <img src="${novel}/cover.jpg" alt="${novel} Cover" onerror="this.src='style.css'; this.style.display='none'">
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
    
    // Build admin index
    if (fs.existsSync(path.join(TEMPLATE_DIR, 'admin-index.html'))) {
        const tplAdminIndex = fs.readFileSync(path.join(TEMPLATE_DIR, 'admin-index.html'), 'utf-8');
        let adminIndexFinalHtml = tplAdminIndex.replace(/{{NOVEL_LIST}}/g, adminNovelListHtml);
        fs.writeFileSync(path.join(PUBLIC_DIR, 'admin-index.html'), adminIndexFinalHtml);
    }

    console.log('\nBuild completed successfully!');
    
    if (llamaContext) {
        console.log('Shutting down AI model and freeing VRAM...');
        try {
            llamaContext.dispose();
            llamaModel.dispose();
        } catch (e) {
            // Ignore if dispose methods don't exist
        }
    }
    
    // Force Node process to exit gracefully to guarantee all OS resources are released
    process.exit(0);
}

async function startInteractive() {
    if (!fs.existsSync(NOVEL_DIR)) {
        fs.ensureDirSync(NOVEL_DIR);
    }
    
    const novels = fs.readdirSync(NOVEL_DIR).filter(file => {
        return fs.statSync(path.join(NOVEL_DIR, file)).isDirectory();
    });

    if (novels.length === 0) {
        console.log("Belum ada project novel di dalam folder Novel/");
        process.exit(0);
    }

    if (process.argv.includes('--all')) {
        console.log("\n=> Mode Auto-Update: Memproses SEMUA novel...");
        for (const novel of novels) {
            const configPath = path.join(NOVEL_DIR, novel, 'config.json');
            if (!fs.existsSync(configPath)) {
                fs.writeJsonSync(configPath, { admin: false });
            }
        }
        await buildSite(novels);
        return;
    }

    console.log("\n=== Pilih Project Novel untuk di-Translate & Build ===");
    for (let i = 0; i < novels.length; i++) {
        console.log(`${i + 1}. ${novels[i]}`);
    }
    console.log("0. Build SEMUA Novel (Hati-hati, butuh waktu sangat lama)");
    console.log("======================================================");

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    const ask = (query) => new Promise(resolve => rl.question(query, resolve));
    
    let selectedNovels = [];
    while (true) {
        const answer = await ask("Masukkan nomor pilihan: ");
        const choice = parseInt(answer.trim());
        
        if (choice === 0) {
            selectedNovels = novels;
            break;
        } else if (choice >= 1 && choice <= novels.length) {
            selectedNovels = [novels[choice - 1]];
            break;
        } else {
            console.log("Pilihan tidak valid, silakan masukkan angka yang sesuai.");
        }
    }
    
    rl.close();
    
    console.log(`\n=> Memulai proses translate & build untuk:\n - ${selectedNovels.join("\n - ")}\n`);
    
    // Prompt config for each novel if missing
    for (const novel of selectedNovels) {
        const configPath = path.join(NOVEL_DIR, novel, 'config.json');
        if (!fs.existsSync(configPath)) {
            console.log(`\n[!] Pengaturan untuk novel: ${novel}`);
            let isAdmin = false;
            while(true) {
                const answer = await ask("Taruh di Admin Library (Hidden) atau Public? (1 = Admin, 2 = Public): ");
                if (answer.trim() === '1') {
                    isAdmin = true;
                    break;
                } else if (answer.trim() === '2') {
                    isAdmin = false;
                    break;
                } else {
                    console.log("Pilihan tidak valid, silakan masukkan 1 atau 2.");
                }
            }
            fs.writeJsonSync(configPath, { admin: isAdmin });
        }
    }
    await buildSite(selectedNovels);
}

startInteractive().catch((err) => {
    console.error(err);
    process.exit(1);
});
