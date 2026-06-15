const crypto = require('crypto');

/**
 * Service to handle Data Masking logic (GDPR/PDPA Compliance)
 */
class MaskingService {
    /**
     * Apply masking to a string
     * @param {string} input String to mask
     * @param {number} start Count from start
     * @param {number} mid Count in middle
     * @param {number} end Count from end
     * @returns {string} Masked string
     */
    applyMasking(input, start = 0, mid = 0, end = 0) {
        if (!input) return '-';

        let chars = input.split('');
        const len = chars.length;

        // 1. Mask Start (Head)
        for (let i = 0; i < Math.min(start, len); i++) {
            chars[i] = '*';
        }

        // 2. Mask End (Tail)
        const endStartIdx = Math.max(0, len - end);
        for (let i = endStartIdx; i < len; i++) {
            chars[i] = '*';
        }

        // 3. Mask Middle (Center)
        if (mid > 0 && len > 0) {
            const center = Math.floor(len / 2);
            const halfMid = Math.floor(mid / 2);
            let midStart = center - halfMid;
            
            for (let i = 0; i < mid; i++) {
                const targetIdx = midStart + i;
                if (targetIdx >= 0 && targetIdx < len) {
                    chars[targetIdx] = '*';
                }
            }
        }

        return chars.join('');
    }

    /**
     * Apply Hashing (Zero-Knowledge Verification)
     * As per ETDA-STD-11-2569 Section จ.4
     * @param {string} input 
     * @returns {string} SHA-256 Hex Digest
     */
    hashData(input) {
        if (!input) return '';
        return crypto.createHash('sha256').update(input).digest('hex');
    }
}

module.exports = new MaskingService();
