document.addEventListener('DOMContentLoaded', () => {
    const tooltip = document.getElementById('dict-tooltip');
    if (!tooltip) return;

    const hanziEl = document.getElementById('tooltip-hanzi');
    const pinyinEl = document.getElementById('tooltip-pinyin');
    const englishEl = document.getElementById('tooltip-english');

    let currentActiveWord = null;

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
