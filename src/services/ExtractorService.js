const VerificationService = require('./VerificationService');
const DataExtractionService = require('./DataExtractionService');

/**
 * Service to extract and verify data from Hybrid PDF/A-3
 * Composition of VerificationService and DataExtractionService for legacy support.
 */
class ExtractorService {
    async extractData(pdfBuffer) {
        return DataExtractionService.extractData(pdfBuffer);
    }

    async verifySignature(pdfBuffer) {
        return VerificationService.verifySignature(pdfBuffer);
    }

    async extractAndVerify(pdfBuffer) {
        const data = await this.extractData(pdfBuffer);
        const sig = await this.verifySignature(pdfBuffer);
        return {
            success: data.success && sig.success,
            extractedData: data.extractedData,
            signatureInfo: {
                isValid: sig.isValid,
                signer: sig.signer,
                signingTime: sig.signingTime,
                integrity: sig.integrity
            },
            workflowLog: [...data.workflowLog, ...sig.workflowLog]
        };
    }
}

module.exports = new ExtractorService();
