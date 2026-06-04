const fs = require('fs-extra');
const axios = require('axios');
const AdmZip = require('adm-zip');
const path = require('path');

const DICT_URL = 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.zip';
const ZIP_FILE = path.join(__dirname, 'cedict.zip');
const TXT_FILE = path.join(__dirname, 'cedict_ts.u8');
const OUTPUT_FILE = path.join(__dirname, 'dictionary.json');

async function downloadAndParseDict() {
    console.log('Downloading CC-CEDICT (this may take a minute)...');
    try {
        const response = await axios({
            url: DICT_URL,
            method: 'GET',
            responseType: 'arraybuffer'
        });

        fs.writeFileSync(ZIP_FILE, response.data);
        
        console.log('Extracting ZIP...');
        const zip = new AdmZip(ZIP_FILE);
        zip.extractAllTo(__dirname, true);
        
        console.log('Parsing dictionary...');
        const lines = fs.readFileSync(TXT_FILE, 'utf-8').split(/\r?\n/);
        const dictionary = {};

        const PinyinTones = {
            a: ['a', 'ā', 'á', 'ǎ', 'à', 'a'],
            e: ['e', 'ē', 'é', 'ě', 'è', 'e'],
            i: ['i', 'ī', 'í', 'ǐ', 'ì', 'i'],
            o: ['o', 'ō', 'ó', 'ǒ', 'ò', 'o'],
            u: ['u', 'ū', 'ú', 'ǔ', 'ù', 'u'],
            v: ['ü', 'ǖ', 'ǘ', 'ǚ', 'ǜ', 'ü'],
            'ü': ['ü', 'ǖ', 'ǘ', 'ǚ', 'ǜ', 'ü']
        };

        function convertPinyin(numbered) {
            return numbered.split(' ').map(syl => {
                return syl.replace(/[a-zA-Züv:]+\d/g, match => {
                    let tone = parseInt(match.slice(-1));
                    let word = match.slice(0, -1).toLowerCase().replace(/v/g, 'ü').replace(/u:/g, 'ü');
                    if (tone < 1 || tone > 5) return word;
                    
                    let target = '';
                    if (word.includes('a')) target = 'a';
                    else if (word.includes('e')) target = 'e';
                    else if (word.includes('ou')) target = 'o';
                    else {
                        const vowels = word.match(/[aeiouü]/g);
                        if (vowels && vowels.length > 0) {
                            target = vowels[vowels.length - 1];
                        }
                    }

                    if (target) {
                        word = word.replace(target, PinyinTones[target][tone]);
                    }
                    return word;
                });
            }).join(' ');
        }

        for (let line of lines) {
            if (line.startsWith('#') || line.trim() === '') continue;
            
            // Format: Traditional Simplified [pin1 yin1] /meaning 1/meaning 2/
            const match = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\/$/);
            if (match) {
                const simp = match[2];
                const pinyin = convertPinyin(match[3]);
                const english = match[4].replace(/\//g, '; ');
                
                // Store first occurrence (which is usually the most common definition)
                if (!dictionary[simp]) {
                    dictionary[simp] = { pinyin, english };
                }
            }
        }

        console.log(`Parsed ${Object.keys(dictionary).length} dictionary entries.`);
        
        fs.writeJsonSync(OUTPUT_FILE, dictionary);
        console.log(`Saved dictionary as lightweight JSON to ${OUTPUT_FILE}`);
        
        // Cleanup
        fs.removeSync(ZIP_FILE);
        fs.removeSync(TXT_FILE);
        console.log('Cleanup complete. Ready to build.');
    } catch (error) {
        console.error('Error downloading or parsing the dictionary:', error);
    }
}

downloadAndParseDict();
