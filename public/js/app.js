let currentPdfBase64 = null;
let currentQrBase45 = null;

window.onload = initSamples;

async function initSamples() {
    try {
        const response = await fetch('/api/samples');
        const samples = await response.json();
        const select = document.getElementById('docType');
        if (select) {
            select.innerHTML = '';
            samples.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s;
                opt.innerText = s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');
                select.appendChild(opt);
            });
            loadSampleData(); // Load first sample by default
        }
    } catch (error) {
        console.error('Error initializing samples:', error);
    }
}

/**
 * Switch between PDF Generator and Data Masking views
 */
function switchView(view) {
    const pdfView = document.getElementById('pdf-view');
    const maskingView = document.getElementById('masking-view');
    const navPdf = document.getElementById('nav-pdf');
    const navMasking = document.getElementById('nav-masking');

    if (view === 'pdf') {
        pdfView.style.display = 'block';
        maskingView.style.display = 'none';
        navPdf.classList.add('active');
        navMasking.classList.remove('active');
    } else {
        pdfView.style.display = 'none';
        maskingView.style.display = 'block';
        navPdf.classList.remove('active');
        navMasking.classList.add('active');
        applyDataMasking(); // Refresh masking result
    }
}

async function loadSampleData() {
    const type = document.getElementById('docType').value;
    try {
        const response = await fetch(`/api/sample-data/${type}`);
        const data = await response.json();
        document.getElementById('inputData').value = JSON.stringify(data, null, 2);
    } catch (error) {
        alert('Error loading sample data: ' + error.message);
    }
}

async function generatePDF(type = 'signed') {
    const inputDataValue = document.getElementById('inputData').value;
    const actionButtons = document.querySelectorAll('.action-area button');
    const loader = document.getElementById('loader');
    const resultArea = document.getElementById('resultArea');

    if (!inputDataValue) {
        alert('กรุณาโหลดข้อมูลตัวอย่างหรือกรอกข้อมูลก่อน');
        return;
    }

    try {
        let inputData;
        try {
            inputData = JSON.parse(inputDataValue);
        } catch (e) {
            alert('JSON Input ไม่ถูกต้อง');
            return;
        }

        // UI Feedback
        actionButtons.forEach(btn => btn.disabled = true);
        loader.style.display = 'block';
        resultArea.style.display = 'none';
        document.getElementById('verificationSection').style.display = 'none';
        document.getElementById('extractionSection').style.display = 'none';

        const response = await fetch('/api/generate-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: inputData, type: type })
        });

        const result = await response.json();

        if (result.success) {
            currentPdfBase64 = result.pdfBase64;

            // Update Previews
            document.getElementById('schemaPreviewJson').textContent = result.jsonData;
            document.getElementById('schemaPreviewXml').textContent = result.xml;

            // Trigger Prism highlighting for previews
            Prism.highlightElement(document.getElementById('schemaPreviewJson'));
            Prism.highlightElement(document.getElementById('schemaPreviewXml'));

            // Update Attachment names in UI
            if (result.jsonName) document.getElementById('attachmentJson').innerText = result.jsonName;
            if (result.xmlName) document.getElementById('attachmentXml').innerText = result.xmlName;

            // Show PDF in iframe
            const pdfBlob = base64ToBlob(result.pdfBase64, 'application/pdf');
            const pdfUrl = URL.createObjectURL(pdfBlob);
            document.getElementById('pdfPreview').src = pdfUrl;

            // Setup Download Link
            const downloadBtn = document.getElementById('downloadBtn');
            downloadBtn.href = pdfUrl;
            downloadBtn.download = result.fileName;

            // Render Workflow
            const workflowList = document.getElementById('workflowList');
            workflowList.innerHTML = '';
            result.workflow.forEach(step => {
                const li = document.createElement('li');
                li.innerText = step;
                workflowList.appendChild(li);
            });

            // Update QR Code for verification logic
            if (result.qrCode) {
                currentQrBase45 = result.qrBase45;
            }

            resultArea.style.display = 'block';
            document.getElementById('verificationSection').style.display = 'block';
            document.getElementById('extractionSection').style.display = 'block';
            resultArea.scrollIntoView({ behavior: 'smooth' });
        } else {
            alert('Error generating PDF: ' + result.message);
        }
    } catch (error) {
        alert('Server Error: ' + error.message);
    } finally {
        actionButtons.forEach(btn => btn.disabled = false);
        loader.style.display = 'none';
    }
}

/**
 * RECEIVER ACTION 1: Verify Electronic Signature
 */
async function verifySignature() {
    if (!currentPdfBase64) return;

    const verifyBtn = document.getElementById('verifyBtn');
    const verificationResult = document.getElementById('verificationResult');

    verifyBtn.disabled = true;
    verifyBtn.innerText = 'กำลังตรวจสอบ...';

    try {
        const response = await fetch('/api/verify-signature', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pdfBase64: currentPdfBase64 })
        });

        const result = await response.json();

        if (result.success) {
            // UI Status
            const statusBox = document.getElementById('sigStatusBox');
            const statusTitle = document.getElementById('sigStatusTitle');

            if (result.isValid) {
                statusBox.style.background = '#ecfdf5';
                statusBox.style.border = '1px solid #10b981';
                statusTitle.innerText = '✅ Signature Valid';
                statusTitle.style.color = '#065f46';
            } else {
                statusBox.style.background = '#fef2f2';
                statusBox.style.border = '1px solid #ef4444';
                statusTitle.innerText = '❌ Invalid Signature';
                statusTitle.style.color = '#991b1b';
            }

            document.getElementById('resSigner').innerText = result.signer || 'Unknown';
            document.getElementById('resTime').innerText = result.signingTime || 'N/A';
            document.getElementById('resIntegrity').innerText = result.integrity ? 'Pass' : 'Failed';

            // Logs
            const logList = document.getElementById('verifyLogList');
            logList.innerHTML = '';
            result.workflowLog.forEach(log => {
                const li = document.createElement('li');
                li.innerText = log;
                logList.appendChild(li);
            });

            verificationResult.style.display = 'block';
            verificationResult.scrollIntoView({ behavior: 'smooth' });
        } else {
            alert('Error: ' + result.message);
        }
    } catch (error) {
        alert('Request Failed: ' + error.message);
    } finally {
        verifyBtn.disabled = false;
        verifyBtn.innerText = 'ตรวจสอบ PDF';
    }
}

/**
 * RECEIVER ACTION 1.5: Verify Compact QR Code (Offline Simulation)
 */
async function verifyQrCode() {
    if (!currentQrBase45) {
        alert('ไม่พบข้อมูล QR Code กรุณาสร้างเอกสารใหม่ก่อน');
        return;
    }

    console.log('Verifying QR Code:', currentQrBase45);

    const verifyBtn = document.getElementById('verifyQrBtn');
    const resultDiv = document.getElementById('qrVerificationResult');
    const logList = document.getElementById('qrVerifyLogList');

    verifyBtn.disabled = true;
    verifyBtn.innerText = 'กำลังสแกน...';

    try {
        const response = await fetch('/api/verify-qr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ qrString: currentQrBase45 })
        });

        const result = await response.json();
        console.log('QR Verification Result:', result);

        // UI Status
        const statusBox = document.getElementById('qrStatusBox');
        const statusTitle = document.getElementById('qrStatusTitle');

        if (result.valid) {
            statusBox.style.background = '#e0f2fe';
            statusBox.style.border = '1px solid #0ea5e9';
            statusTitle.innerText = '✅ QR Verified (Offline)';
            statusTitle.style.color = '#0369a1';

            document.getElementById('qrResIssuer').innerText = result.data.iss || '-';
            document.getElementById('qrResSubject').innerText = result.data.sub || '-';
            document.getElementById('qrResExp').innerText = result.data.exp ? new Date(result.data.exp * 1000).toLocaleDateString('th-TH') : '-';
        } else {
            statusBox.style.background = '#fef2f2';
            statusBox.style.border = '1px solid #ef4444';
            statusTitle.innerText = '❌ Verification Failed';
            statusTitle.style.color = '#991b1b';

            document.getElementById('qrResIssuer').innerText = '-';
            document.getElementById('qrResSubject').innerText = '-';
            document.getElementById('qrResExp').innerText = '-';
        }

        // Logs
        logList.innerHTML = '';
        if (result.steps) {
            result.steps.forEach(step => {
                const li = document.createElement('li');
                li.innerText = step;
                logList.appendChild(li);
            });
        }

        resultDiv.style.display = 'block';
        resultDiv.scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
        console.error('QR Verify Error Trace:', error);
        alert('QR Verification Failed: ' + error.message);
    } finally {
        verifyBtn.disabled = false;
        verifyBtn.innerText = 'ตรวจสอบ QR Code';
    }
}

/**
 * RECEIVER ACTION 2: Extract Machine-Readable Data
 */
async function extractPayload() {
    if (!currentPdfBase64) return;

    const extractBtn = document.getElementById('extractBtn');
    const extractionResult = document.getElementById('extractionResult');
    const jsonDisplay = document.getElementById('extractedJsonDisplay');
    const xmlDisplay = document.getElementById('extractedXmlDisplay');

    extractBtn.disabled = true;
    extractBtn.innerText = 'กำลังสกัดข้อมูล...';
    jsonDisplay.textContent = '';
    xmlDisplay.textContent = '';

    try {
        const response = await fetch('/api/extract-data-only', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pdfBase64: currentPdfBase64 })
        });

        const result = await response.json();

        if (result.success) {
            // Populate multiple files if available
            if (result.files && result.files.length > 0) {
                result.files.forEach(file => {
                    const content = typeof file.content === 'object' ?
                        JSON.stringify(file.content, null, 2) : file.content;

                    if (file.type === 'json') jsonDisplay.textContent = content;
                    if (file.type === 'xml') xmlDisplay.textContent = content;
                });
            } else {
                // Fallback for single data
                jsonDisplay.textContent = typeof result.extractedData === 'object' ?
                    JSON.stringify(result.extractedData, null, 2) : result.extractedData;
            }

            // Trigger Prism highlighting
            Prism.highlightElement(jsonDisplay);
            Prism.highlightElement(xmlDisplay);

            // Logs
            const logList = document.getElementById('extractLogList');
            logList.innerHTML = '';
            result.workflowLog.forEach(log => {
                const li = document.createElement('li');
                li.innerText = log;
                logList.appendChild(li);
            });

            extractionResult.style.display = 'block';
            extractionResult.scrollIntoView({ behavior: 'smooth' });
        } else {
            alert('Error: ' + result.message);
        }
    } catch (error) {
        alert('Extraction Request Failed: ' + error.message);
    } finally {
        extractBtn.disabled = false;
        extractBtn.innerText = 'สกัดข้อมูลจากไฟล์ PDF';
    }
}


function base64ToBlob(base64, type) {
    const binStr = atob(base64);
    const len = binStr.length;
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        arr[i] = binStr.charCodeAt(i);
    }
    return new Blob([arr], { type: type });
}

/**
 * Documentation Modal Logic
 */
document.addEventListener('DOMContentLoaded', () => {
    const docModal = document.getElementById('docModal');
    const modalTitle = document.getElementById('modalTitle');
    const readmeContent = document.getElementById('readmeContent');
    
    const links = [
        { id: 'docLink', url: '/api/readme', title: 'Documentation & Guidelines' },
        { id: 'licenseLink', url: '/api/license', title: 'Licence Agreement (MIT License)' },
        { id: 'disclaimerLink', url: '/api/disclaimer', title: 'ข้อสงวนสิทธิ์ (Disclaimer)' }
    ];

    links.forEach(link => {
        const element = document.getElementById(link.id);
        if (element && docModal) {
            element.addEventListener('click', async (e) => {
                e.preventDefault();
                modalTitle.innerText = link.title;
                readmeContent.innerHTML = '<p>กำลังโหลดข้อมูล...</p>';
                docModal.setAttribute('open', true);

                try {
                    const response = await fetch(link.url);
                    if (response.ok) {
                        const content = await response.text();
                        // For License, it might be plain text, but Apache is readable as MD or text.
                        // We use marked.parse for all to support MD rendering in Disclaimer and Readme.
                        readmeContent.innerHTML = marked.parse(content);
                        
                        // Trigger Prism highlighting for code blocks
                        if (window.Prism) {
                            Prism.highlightAllUnder(readmeContent);
                        }
                    } else {
                        readmeContent.innerHTML = `<p style="color:red;">ไม่สามารถโหลดข้อมูลได้ (${response.status})</p>`;
                    }
                } catch (error) {
                    readmeContent.innerHTML = `<p style="color:red;">เกิดข้อผิดพลาด: ${error.message}</p>`;
                }
            });
        }
    });

    const closeButtons = [
        document.getElementById('closeDocModal'),
        document.getElementById('closeDocModalBtn')
    ];

    closeButtons.forEach(btn => {
        if (btn) {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                docModal.removeAttribute('open');
            });
        }
    });

    // Close on backdrop click (native <dialog> behavior)
    docModal.addEventListener('click', (e) => {
        if (e.target === docModal) {
            docModal.removeAttribute('open');
        }
    });
});

/**
 * Part 6: Data Masking Utility
 * Applies '*' masking to Head, Middle, and Tail of the input string.
 */
async function applyDataMasking() {
    const input = document.getElementById('maskInput').value;
    const start = parseInt(document.getElementById('maskStart').value) || 0;
    const mid = parseInt(document.getElementById('maskMid').value) || 0;
    const end = parseInt(document.getElementById('maskEnd').value) || 0;
    const resultDisplay = document.getElementById('maskResult');

    if (!input) {
        resultDisplay.innerText = '-';
        return;
    }

    try {
        const response = await fetch('/api/mask-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input, start, mid, end })
        });
        const result = await response.json();
        if (result.success) {
            resultDisplay.innerText = result.maskedResult;
        }
    } catch (error) {
        console.error('Masking Error:', error);
    }
}

