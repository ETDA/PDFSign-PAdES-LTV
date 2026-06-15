const PdfGenerator = require('../src/services/PdfGenerator');
const XmlJsonBuilder = require('../src/services/XmlJsonBuilder');
const DigitalSigner = require('../src/services/DigitalSigner');
const VerificationService = require('../src/services/VerificationService');
const fs = require('fs');
const path = require('path');

async function runVerification() {
    console.log('--- ETDA COMPLIANCE VERIFICATION ---');

    // 1. Prepare Data
    const sampleData = {
        type: 'Medical Certificate',
        title: 'ใบรับรองแพทย์ (มาตรฐานใหม่)',
        author: 'โรงพยาบาลทดสอบ',
        patient: { name: 'สมชาย รักชาติ', idCard: '1-2345-67890-12-3' },
        diagnosis: 'ตรวจพบอาการปกติ'
    };

    // 2. Build Hybrid PDF
    console.log('Building Hybrid PDF/A-3 (Level U)...');
    const jsonData = XmlJsonBuilder.buildJSON(sampleData);
    const xml = XmlJsonBuilder.buildXML(sampleData);
    const basePdf = await PdfGenerator.createBasePDF(sampleData);
    const hybridPdf = await PdfGenerator.createHybridPDF(basePdf, xml, jsonData);

    // 3. Apply LTV & Sign
    console.log('Applying LTV (DSS)...');
    const revocationData = await DigitalSigner.simulateFetchRevocationData();
    const ltvPdf = await PdfGenerator.applyLTV(hybridPdf, revocationData);
    
    console.log('Signing Document (RSA 3072 + PAdES)...');
    const placeholder = await PdfGenerator.addSignaturePlaceholder(ltvPdf);
    const signedPdf = await DigitalSigner.signPDF(placeholder);

    // 4. Verify
    console.log('\n--- VERIFICATION RESULTS ---');
    const results = await VerificationService.verifySignature(signedPdf);
    console.log(JSON.stringify(results, null, 2));

    const outPath = path.join(__dirname, 'output', 'compliance_test.pdf');
    if (!fs.existsSync(path.dirname(outPath))) fs.mkdirSync(path.dirname(outPath));
    fs.writeFileSync(outPath, signedPdf);
    console.log(`\nCompliant PDF saved to: ${outPath}`);
}

runVerification().catch(console.error);
