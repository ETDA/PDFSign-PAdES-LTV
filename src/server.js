const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const PdfGenerator = require('./services/PdfGenerator');
const XmlJsonBuilder = require('./services/XmlJsonBuilder');
const DigitalSigner = require('./services/DigitalSigner');
const VerificationService = require('./services/VerificationService');
const DataExtractionService = require('./services/DataExtractionService');
const ExtractorService = require('./services/ExtractorService');
const VerificationQrService = require('./services/VerificationQrService');
const MaskingService = require('./services/MaskingService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// Ensure certificate exists on startup
if (!fs.existsSync(path.join(__dirname, '../assets/keys/test-cert.p12'))) {
    console.log('No test certificate found. Generating one...');
    DigitalSigner.generateMockP12();
}

/**
 * API: Get Samples List
 */
app.get('/api/samples', (req, res) => {
    const samplesPath = path.join(__dirname, '../data/samples');
    const files = fs.readdirSync(samplesPath).filter(f => f.endsWith('.json'));
    res.json(files.map(f => f.replace('.json', '')));
});

/**
 * API: Get Sample Data
 */
app.get('/api/sample-data/:type', (req, res) => {
    const type = req.params.type;
    const dataPath = path.join(__dirname, `../data/samples/${type}.json`);
    if (fs.existsSync(dataPath)) {
        const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
        res.json(data);
    } else {
        res.status(404).json({ error: 'Sample not found' });
    }
});

/**
 * API: Get README.md content
 */
app.get('/api/readme', (req, res) => {
    const readmePath = path.join(__dirname, '../README.md');
    if (fs.existsSync(readmePath)) {
        const content = fs.readFileSync(readmePath, 'utf-8');
        res.send(content);
    } else {
        res.status(404).send('README.md not found');
    }
});

/**
 * API: Get LICENSE content
 */
app.get('/api/license', (req, res) => {
    const licensePath = path.join(__dirname, '../LICENSE');
    if (fs.existsSync(licensePath)) {
        const content = fs.readFileSync(licensePath, 'utf-8');
        res.send(content);
    } else {
        res.status(404).send('LICENSE not found');
    }
});

/**
 * API: Get DISCLAIMER content
 */
app.get('/api/disclaimer', (req, res) => {
    const disclaimerPath = path.join(__dirname, '../DISCLAIMER.md');
    if (fs.existsSync(disclaimerPath)) {
        const content = fs.readFileSync(disclaimerPath, 'utf-8');
        res.send(content);
    } else {
        res.status(404).send('DISCLAIMER.md not found');
    }
});

/**
 * API: Download Mock Certificate (for User to Trust in Adobe)
 */
app.get('/api/download-cert', (req, res) => {
    const certPath = path.join(__dirname, '../assets/keys/test-cert.crt');
    if (fs.existsSync(certPath)) {
        res.download(certPath, 'ETDA-Dev-Test.crt');
    } else {
        res.status(404).send('Certificate not generated yet. Please generate a PDF first.');
    }
});

/**
 * API: Generate Hybrid PDF
 */
app.post('/api/generate-pdf', async (req, res) => {
    try {
        const { data: inputData, type } = req.body;

        if (!inputData) {
            return res.status(400).json({ success: false, message: 'Input data is required' });
        }

        // 1. Build machine-readable data
        const jsonData = XmlJsonBuilder.buildJSON(inputData);
        const xml = XmlJsonBuilder.buildXML(inputData);

        const docTypeSlug = (inputData.type || 'document').toLowerCase().replace(/\s+/g, '_');
        const xmlName = `${docTypeSlug}.xml`;
        const jsonName = `${docTypeSlug}.json`;

        let finalPdf;
        let fileName;
        let qrResult = { qrDataUrl: null, base45: null, workflow: [] };
        const doc_id = `credential-${type}-${Date.now()}`;
        const workflow = [];

        // 2. Prepare LTV Data if needed
        let revocationData = null;
        if (type === 'ltv' || type === 'full') {
            console.log('Preparing LTV Data (DSS)...');
            revocationData = await DigitalSigner.simulateFetchRevocationData();
        }

        if (type === 'full') {
            // --- TYPE 3: PDF + Attachment + Signing + LTV + QR Code ---
            console.log('Generating Type: Full (QR + LTV + Attachments)...');
            qrResult = await VerificationQrService.generateVerificationQr(inputData, doc_id);
            const basePdfWithQrBytes = await PdfGenerator.createBasePDF(inputData, qrResult.qrDataUrl);
            const hybridPdf = await PdfGenerator.createHybridPDF(basePdfWithQrBytes, xml, jsonData, xmlName, jsonName);
            const ltvPdf = await PdfGenerator.applyLTV(hybridPdf, revocationData);
            const placeholder = await PdfGenerator.addSignaturePlaceholder(ltvPdf);
            finalPdf = await DigitalSigner.signPDF(placeholder);
            fileName = `${doc_id}_full.pdf`;
            workflow.push("1. Created Base PDF with QR Code");
            workflow.push("2. Embedded XML and JSON attachments (Hybrid PDF/A-3)");
            workflow.push("3. Applied PAdES-LTV (ETDA 5.4) with revocation data (OCSP/CRL)");
            workflow.push("4. Signed with Digital Signature (RSA)");
        } else if (type === 'ltv') {
            // --- TYPE 2: PDF + Attachment + Signing + LTV ---
            console.log('Generating Type: LTV (LTV + Attachments)...');
            const basePdfNoQrBytes = await PdfGenerator.createBasePDF(inputData, null);
            const hybridPdf = await PdfGenerator.createHybridPDF(basePdfNoQrBytes, xml, jsonData, xmlName, jsonName);
            const ltvPdf = await PdfGenerator.applyLTV(hybridPdf, revocationData);
            const placeholder = await PdfGenerator.addSignaturePlaceholder(ltvPdf);
            finalPdf = await DigitalSigner.signPDF(placeholder);
            fileName = `${doc_id}_ltv.pdf`;
            workflow.push("1. Created Base PDF");
            workflow.push("2. Embedded XML and JSON attachments (Hybrid PDF/A-3)");
            workflow.push("3. Applied PAdES-LTV (ETDA 5.4) with revocation data (OCSP/CRL)");
            workflow.push("4. Signed with Digital Signature (RSA)");
        } else {
            // --- TYPE 1: PDF + Attachment + Signing (Default) ---
            console.log('Generating Type: Signing only (Attachments + Signing)...');
            const basePdfNoQrBytes = await PdfGenerator.createBasePDF(inputData, null);
            const hybridPdf = await PdfGenerator.createHybridPDF(basePdfNoQrBytes, xml, jsonData, xmlName, jsonName);
            const placeholder = await PdfGenerator.addSignaturePlaceholder(hybridPdf);
            finalPdf = await DigitalSigner.signPDF(placeholder);
            fileName = `${doc_id}_signed.pdf`;
            workflow.push("1. Created Base PDF");
            workflow.push("2. Embedded XML and JSON attachments (Hybrid PDF/A-3)");
            workflow.push("3. Signed with Digital Signature (RSA)");
        }

        // 4. Ensure output directory exists
        const outputDir = path.join(__dirname, '../output');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir);
        }

        // 5. Store file in output folder
        fs.writeFileSync(path.join(outputDir, fileName), finalPdf);

        const finalPdfBuffer = Buffer.from(finalPdf);

        const responseData = {
            success: true,
            pdfBase64: finalPdfBuffer.toString('base64'),
            jsonData: jsonData,
            xml: xml,
            xmlName: xmlName,
            jsonName: jsonName,
            fileName: fileName,
            qrCode: qrResult.qrDataUrl,
            qrBase45: qrResult.base45,
            qrWorkflow: qrResult.workflow,
            workflow: workflow
        };

        console.log(`[SERVER] Generated type ${type}. File: ${fileName}`);
        res.json(responseData);

    } catch (error) {
        console.error('Generation Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * API: Verify Digital Signature (Receiver Layer 1: Trust)
 */
app.post('/api/verify-signature', async (req, res) => {
    try {
        const { pdfBase64 } = req.body;
        const pdfBuffer = Buffer.from(pdfBase64, 'base64');
        const results = await VerificationService.verifySignature(pdfBuffer);
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * API: Extract Machine-Readable Data (Receiver Layer 2: Data)
 */
app.post('/api/extract-data-only', async (req, res) => {
    try {
        const { pdfBase64 } = req.body;
        const pdfBuffer = Buffer.from(pdfBase64, 'base64');
        const results = await DataExtractionService.extractData(pdfBuffer);
        res.json(results);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * API: Verify QR Code Offline Simulator
 */
app.post('/api/verify-qr', async (req, res) => {
    try {
        const { qrString } = req.body;
        const result = await VerificationQrService.verifyQrOffline(qrString);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * API: Data Masking Service
 */
app.post('/api/mask-data', (req, res) => {
    try {
        const { input, start, mid, end } = req.body;
        const maskedResult = MaskingService.applyMasking(input, start, mid, end);
        res.json({ success: true, maskedResult });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * API: Combined Extract & Verify (Legacy Support)
 */
app.post('/api/extract-data', async (req, res) => {
    try {
        const { pdfBase64 } = req.body;
        const pdfBuffer = Buffer.from(pdfBase64, 'base64');
        const results = await ExtractorService.extractAndVerify(pdfBuffer);
        res.json(results);
    } catch (error) {
        console.error('Extraction Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`ETDA Hybrid PDF Starter running at http://localhost:${PORT}`);
});
