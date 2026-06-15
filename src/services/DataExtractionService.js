const { PDFDocument, PDFName } = require('pdf-lib');
const zlib = require('zlib');

/**
 * Service Layer for Data Extraction
 * Focuses on extracting embedded attachments (JSON/XML) from PDF/A-3
 */
class DataExtractionService {
    /**
     * Extracts machine-readable JSON-LD/XML (Associated Files)
     * @param {Buffer} pdfBuffer 
     * @returns {Promise<Object>}
     */
    async extractData(pdfBuffer) {
        const results = {
            success: false,
            extractedData: null,
            fileName: null,
            workflowLog: []
        };

        try {
            results.workflowLog.push('Loading PDF for attachment extraction...');
            const pdfDoc = await PDFDocument.load(pdfBuffer);

            const indirectObjects = pdfDoc.context.enumerateIndirectObjects();
            results.files = [];

            for (const [ref, obj] of indirectObjects) {
                if (obj.has && obj.has(PDFName.of('EF')) && obj.has(PDFName.of('F'))) {
                    const f = obj.get(PDFName.of('F'));
                    let fileName = (f.asString ? f.asString() : f.toString())
                        .replace(/^\(|\)$/g, '')
                        .toLowerCase();

                    if (fileName.endsWith('.json') || fileName.endsWith('.xml')) {
                        const efRef = obj.get(PDFName.of('EF'));
                        const efDict = pdfDoc.context.lookup(efRef);
                        const fStreamRef = efDict.get(PDFName.of('F'));
                        const fStream = pdfDoc.context.lookup(fStreamRef);

                        let rawData = fStream.contents;
                        let decoded = null;

                        if (typeof fStream.decodeContents === 'function') {
                            try { decoded = fStream.decodeContents(); } catch (e) { }
                        }

                        if ((!decoded || decoded[0] === 0x78) && rawData[0] === 0x78) {
                            try { decoded = zlib.inflateSync(rawData); } catch (e) { }
                        }

                        const resultData = decoded || rawData;
                        const contentString = Buffer.from(resultData).toString('utf-8');

                        let content = contentString;
                        if (fileName.endsWith('.json')) {
                            try { content = JSON.parse(contentString); } catch (e) { }
                        }

                        results.files.push({
                            name: fileName,
                            content: content,
                            type: fileName.endsWith('.json') ? 'json' : 'xml'
                        });

                        results.workflowLog.push(`Found & Extracted: ${fileName}`);
                    }
                }
            }

            if (results.files.length > 0) {
                results.success = true;
                // For compatibility: set extractedData to the first JSON found, or the first file
                const jsonFile = results.files.find(f => f.type === 'json');
                results.extractedData = jsonFile ? jsonFile.content : results.files[0].content;
                results.fileName = jsonFile ? jsonFile.name : results.files[0].name;
            } else {
                throw new Error('No machine-readable attachment (.json or .xml) found');
            }

        } catch (error) {
            results.success = false;
            results.workflowLog.push(`Extraction Error: ${error.message}`);
        }

        return results;
    }
}

module.exports = new DataExtractionService();
