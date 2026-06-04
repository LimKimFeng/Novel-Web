document.addEventListener('DOMContentLoaded', () => {
    const tooltip = document.getElementById('dict-tooltip');
    if (!tooltip) return;

    const hanziEl = document.getElementById('tooltip-hanzi');
    const pinyinEl = document.getElementById('tooltip-pinyin');
    const englishEl = document.getElementById('tooltip-english');
    const speakerEl = document.getElementById('tooltip-speaker');

    let currentActiveWord = null;

    function getNumberedPinyin(pinyinWithMarks) {
        const toneMap = {
            'ā': ['a', '1'], 'á': ['a', '2'], 'ǎ': ['a', '3'], 'à': ['a', '4'],
            'ō': ['o', '1'], 'ó': ['o', '2'], 'ǒ': ['o', '3'], 'ò': ['o', '4'],
            'ē': ['e', '1'], 'é': ['e', '2'], 'ě': ['e', '3'], 'è': ['e', '4'],
            'ī': ['i', '1'], 'í': ['i', '2'], 'ǐ': ['i', '3'], 'ì': ['i', '4'],
            'ū': ['u', '1'], 'ú': ['u', '2'], 'ǔ': ['u', '3'], 'ù': ['u', '4'],
            'ǖ': ['uu', '1'], 'ǘ': ['uu', '2'], 'ǚ': ['uu', '3'], 'ǜ': ['uu', '4']
        };

        return pinyinWithMarks.toLowerCase().split(/\s+/).map(syl => {
            let tone = '5';
            let base = syl;
            
            for (let char in toneMap) {
                if (base.includes(char)) {
                    base = base.replace(char, toneMap[char][0]);
                    tone = toneMap[char][1];
                    break;
                }
            }
            
            base = base.replace(/ü/g, 'uu');
            
            if (!/^[a-z]+$/.test(base)) {
                 return null;
            }
            
            return base + tone;
        }).filter(s => s !== null);
    }

    function playPinyinAudio(pinyinStr) {
        if (!pinyinStr) return;
        const syllables = getNumberedPinyin(pinyinStr);
        let i = 0;
        
        function playNext() {
            if (i < syllables.length) {
                let audio = new Audio(`../../audio/mp3/${syllables[i]}.mp3`);
                audio.onended = playNext;
                audio.play().catch(e => {
                    console.log('Audio not found or blocked:', e);
                    playNext();
                });
                i++;
            }
        }
        playNext();
    }

    if (speakerEl) {
        speakerEl.addEventListener('click', (e) => {
            e.stopPropagation();
            if (currentActiveWord) {
                playPinyinAudio(currentActiveWord.getAttribute('data-pinyin'));
            }
        });
    }

    document.querySelectorAll('.dict-word').forEach(word => {
        word.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent document click from closing immediately
            
            // Populate data
            hanziEl.textContent = word.textContent;
            pinyinEl.textContent = word.getAttribute('data-pinyin') || '';
            englishEl.textContent = word.getAttribute('data-en') || 'Definition not found in dictionary';

            // Show tooltip to calculate dimensions
            tooltip.classList.add('visible');

            // Position tooltip smartly
            const rect = word.getBoundingClientRect();
            const tooltipRect = tooltip.getBoundingClientRect();

            let top = rect.bottom + window.scrollY + 10;
            let left = rect.left + window.scrollX;

            // Adjust if overflows right edge
            if (left + tooltipRect.width > window.innerWidth) {
                left = window.innerWidth - tooltipRect.width - 20;
            }

            // Adjust if overflows bottom edge
            if (top + tooltipRect.height > window.scrollY + window.innerHeight) {
                // place it above the word
                top = rect.top + window.scrollY - tooltipRect.height - 10;
            }

            // Ensure left isn't negative (mobile edge case)
            if (left < 10) left = 10;

            tooltip.style.top = `${top}px`;
            tooltip.style.left = `${left}px`;
            
            currentActiveWord = word;
        });
    });

    // Close tooltip when clicking anywhere else
    document.addEventListener('click', () => {
        if (tooltip.classList.contains('visible')) {
            tooltip.classList.remove('visible');
            currentActiveWord = null;
        }
    });

    // Prevent closing when interacting with the tooltip itself
    tooltip.addEventListener('click', (e) => {
        e.stopPropagation();
    });
});
