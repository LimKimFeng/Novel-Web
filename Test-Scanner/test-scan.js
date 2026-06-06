const fs = require('fs-extra');
const path = require('path');

const NOVEL_DIR = path.join(__dirname, '../Novel');
const TARGET_NOVEL = "100X Return System I Dominate the Age of Gods";
const CONTENT_DIR = path.join(NOVEL_DIR, TARGET_NOVEL, 'content');
const DICT_OUT_PATH = path.join(__dirname, 'test-dict.json');

const MAX_CHAPTERS = 10;
const CHUNK_SIZE = 500; // characters

let llamaBackend = null;
let llamaModel = null;
let llamaContext = null;
let LlamaChatSessionCls = null;

let globalSequence = null;
let scanSession = null;

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

const SYSTEM_PROMPT = `You are an expert terminology extraction AI specializing in Chinese web novels (Cultivation, LitRPG, Dark Fantasy). 
Your task is to read a provided Chinese text and extract ONLY domain-specific terminology along with their exact Pinyin and English translation.

Focus ONLY on extracting:
1. Chapter markers (e.g., 第一章 -> Chapter 1)
2. Character Names (e.g., 林枫 -> Lin Feng)
3. Sect, Locations, and Organization Names
4. Cultivation Ranks, Techniques, and Spells
5. System-related terms

IMPORTANT: 
- Do NOT extract common everyday words like "bisa", "kamu", "makan", "pedang".
- Output strictly in a JSON array format like this, with NO OTHER TEXT:
[
  {"hanzi": "第一章", "pinyin": "dì yī zhāng", "english": "Chapter 1"},
  {"hanzi": "万剑宗", "pinyin": "wàn jiàn zōng", "english": "Ten Thousand Swords Sect"}
]`;

async function extractTerms(chunkText) {
    if (!scanSession) {
        globalSequence = llamaContext.getSequence();
        scanSession = new LlamaChatSessionCls({
            contextSequence: globalSequence,
            systemPrompt: SYSTEM_PROMPT
        });
    }

    try {
        globalSequence.clearHistory();
        scanSession.resetChatHistory();
        const prompt = `Extract the domain-specific terms from the following text:\n\n${chunkText}`;
        const result = await scanSession.prompt(prompt, { temperature: 0.1 });
        
        // Extract JSON using Regex in case model hallucinates greetings
        const jsonMatch = result.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        } else {
            // If it returns a single object instead of array
            const objMatch = result.match(/\{\s*"hanzi"[\s\S]*\}/);
            if (objMatch) return [JSON.parse(objMatch[0])];
        }
        return [];
    } catch (e) {
        console.error("Failed to parse JSON from AI:", e.message);
        return [];
    }
}

async function runTest() {
    if (!fs.existsSync(CONTENT_DIR)) {
        console.error("Content directory not found:", CONTENT_DIR);
        return;
    }

    const files = fs.readdirSync(CONTENT_DIR)
        .filter(f => f.endsWith('.txt'))
        .sort((a, b) => {
            const aNum = parseInt(a.match(/\d+/) ? a.match(/\d+/)[0] : 0);
            const bNum = parseInt(b.match(/\d+/) ? b.match(/\d+/)[0] : 0);
            return aNum - bNum;
        })
        .slice(0, MAX_CHAPTERS); // 10 samples

    if (files.length === 0) {
        console.log("No translated chapters found to scan.");
        return;
    }

    await initLlama();
    
    // Load existing dictionary for deduplication
    let customDict = {};
    if (fs.existsSync(DICT_OUT_PATH)) {
        customDict = fs.readJsonSync(DICT_OUT_PATH);
    }

    console.log(`\nStarting extraction test on ${files.length} chapters...\n`);

    for (const file of files) {
        console.log(`Scanning Chapter: ${file}`);
        const content = fs.readFileSync(path.join(CONTENT_DIR, file), 'utf-8');
        const chunks = chunkText(content, CHUNK_SIZE);
        
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

    // Save Deduplicated Dictionary
    fs.writeJsonSync(DICT_OUT_PATH, customDict, { spaces: 2 });
    console.log(`\n✅ Extraction complete! Saved ${Object.keys(customDict).length} total terms to test-dict.json`);
    
    try {
        if (globalSequence) globalSequence.dispose();
        llamaContext.dispose();
        llamaModel.dispose();
    } catch(e){}
    process.exit(0);
}

runTest().catch(console.error);
