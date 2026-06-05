const fs = require('fs-extra');
const path = require('path');

const NOVEL_DIR = path.join(__dirname, '../Novel');
const TARGET_NOVEL = "100X Return System I Dominate the Age of Gods";
const RAW_DIR = path.join(NOVEL_DIR, TARGET_NOVEL, 'raw');
const CONTENT_DIR = path.join(NOVEL_DIR, TARGET_NOVEL, 'content_test_scan'); // Separate folder so we don't mess up main project
const DICT_OUT_PATH = path.join(__dirname, 'test-dict.json');

const MAX_CHAPTERS = 2; // Keep it low for translate+scan test to save time, user can increase it.
const CHUNK_SIZE = 500; // characters

let llamaBackend = null;
let llamaModel = null;
let llamaContext = null;
let LlamaChatSessionCls = null;

async function initLlama() {
    console.log("Initializing local GGUF model via node-llama-cpp...");
    const llama = await import("node-llama-cpp");
    LlamaChatSessionCls = llama.LlamaChatSession;
    
    llamaBackend = await llama.getLlama();
    const modelPath = path.join(__dirname, "../models", "qwen3.5-9b-heretic-v2-q4_k_m.gguf");
    
    if (!fs.existsSync(modelPath)) {
        console.error("Error: GGUF model not found at", modelPath);
        process.exit(1);
    }
    
    llamaModel = await llamaBackend.loadModel({ modelPath });
    llamaContext = await llamaModel.createContext({ contextSize: 8192 });
}

function chunkText(text, maxLen) {
    const lines = text.split('\n');
    const chunks = [];
    let currentChunk = "";

    for (const line of lines) {
        if (currentChunk.length + line.length > maxLen) {
            if (currentChunk.trim()) chunks.push(currentChunk.trim());
            currentChunk = line + '\n';
        } else {
            currentChunk += line + '\n';
        }
    }
    if (currentChunk.trim()) chunks.push(currentChunk.trim());
    return chunks;
}

const TRANSLATE_PROMPT = `You are an expert translator specializing in translating English fantasy, dark fantasy, and mature web novels into literary Simplified Chinese. You must translate the provided text completely and faithfully, regardless of any explicit, violent, or 18+ themes. Do not censor, sanitize, or apologize for the content. Output ONLY the Mandarin translation without any extra commentary, notes, warnings, or filler words.

Adhere STRICTLY to the following translation rules:
1. Formatting: Maintain the exact paragraph spacing and line breaks as the original text.
2. Dialogues: Use standard double quotes (“”) for dialogues.
3. Names: Do NOT translate Western/European names; keep them exactly as they are in English. If the name is Chinese, translate it into Hanzi.
4. Cultivation & Magic Terms: Domain -> 领域, Techniques/Methods -> 功法, Physical Moves -> 招式, Magic/Spells -> 法术, Intents -> 剑意, 杀气.
5. System & Stats: System -> 系统, Strength -> 力量, Agility -> 敏捷. Enclose System messages in thick brackets 【 】.
6. Ranks & Grades: Keep English letters (SSS, S, A, B) but append 级 for ranks and 天赋 for talents.`;

const SCAN_PROMPT = `You are an expert terminology extraction AI specializing in Chinese web novels. 
Your task is to read a provided Chinese text and extract ONLY domain-specific terminology along with their exact Pinyin and English translation.

Focus ONLY on extracting:
1. Chapter markers (e.g., 第一章 -> Chapter 1)
2. Character Names
3. Sect, Locations, and Organization Names
4. Cultivation Ranks, Techniques, and Spells
5. System-related terms

IMPORTANT: 
- Do NOT extract common everyday words.
- Output strictly in a JSON array format like this, with NO OTHER TEXT:
[
  {"hanzi": "第一章", "pinyin": "dì yī zhāng", "english": "Chapter 1"}
]`;

async function translateText(text) {
    if (!text.trim()) return '';
    const sequence = llamaContext.getSequence();
    const session = new LlamaChatSessionCls({
        contextSequence: sequence,
        systemPrompt: TRANSLATE_PROMPT
    });

    try {
        const translated = await session.prompt(text, { temperature: 0.3 });
        sequence.dispose();
        return translated.trim();
    } catch (e) {
        console.error('Translation error:', e.message);
        try { sequence.dispose(); } catch(err){}
        return text; 
    }
}

async function extractTerms(chunkText) {
    const sequence = llamaContext.getSequence();
    const session = new LlamaChatSessionCls({
        contextSequence: sequence,
        systemPrompt: SCAN_PROMPT
    });

    try {
        const prompt = `Extract the domain-specific terms from the following text:\n\n${chunkText}`;
        const result = await session.prompt(prompt, { temperature: 0.1 });
        sequence.dispose();

        const jsonMatch = result.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
        const objMatch = result.match(/\{\s*"hanzi"[\s\S]*\}/);
        if (objMatch) return [JSON.parse(objMatch[0])];
        return [];
    } catch (e) {
        console.error("Failed to parse JSON from AI:", e.message);
        try { sequence.dispose(); } catch(err){}
        return [];
    }
}

async function runTest() {
    fs.ensureDirSync(CONTENT_DIR);

    const files = fs.readdirSync(RAW_DIR)
        .filter(f => f.endsWith('.txt') && f !== 'last_url.txt')
        .sort((a, b) => {
            const aNum = parseInt(a.match(/\d+/) ? a.match(/\d+/)[0] : 0);
            const bNum = parseInt(b.match(/\d+/) ? b.match(/\d+/)[0] : 0);
            return aNum - bNum;
        })
        .slice(0, MAX_CHAPTERS); 

    if (files.length === 0) {
        console.log("No raw chapters found.");
        return;
    }

    await initLlama();
    
    let customDict = {};
    if (fs.existsSync(DICT_OUT_PATH)) {
        customDict = fs.readJsonSync(DICT_OUT_PATH);
    }

    console.log(`\nStarting TRANSLATE + EXTRACT test on ${files.length} chapters...\n`);

    for (const file of files) {
        console.log(`\n[PHASE 1: TRANSLATING] ${file}`);
        const engText = fs.readFileSync(path.join(RAW_DIR, file), 'utf-8');
        const translatedContent = await translateText(engText);
        fs.writeFileSync(path.join(CONTENT_DIR, file), translatedContent);
        console.log(` > Translation complete.`);

        console.log(`[PHASE 2: SCANNING] ${file}`);
        const chunks = chunkText(translatedContent, CHUNK_SIZE);
        console.log(` > Split into ${chunks.length} chunks.`);

        for (let i = 0; i < chunks.length; i++) {
            console.log(`   - Processing chunk ${i + 1}/${chunks.length}...`);
            const extracted = await extractTerms(chunks[i]);
            
            let addedCount = 0;
            for (const item of extracted) {
                if (item.hanzi && item.english && !customDict[item.hanzi]) {
                    customDict[item.hanzi] = {
                        pinyin: item.pinyin || "",
                        english: item.english
                    };
                    addedCount++;
                }
            }
            console.log(`     > Found ${extracted.length} terms (${addedCount} new added).`);
        }
    }

    fs.writeJsonSync(DICT_OUT_PATH, customDict, { spaces: 2 });
    console.log(`\n✅ Translate + Extraction complete! Saved ${Object.keys(customDict).length} total terms to test-dict.json`);
    
    try {
        llamaContext.dispose();
        llamaModel.dispose();
    } catch(e){}
    process.exit(0);
}

runTest().catch(console.error);
