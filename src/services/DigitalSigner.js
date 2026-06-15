const signer = require('node-signpdf').default;
const forge = require('node-forge');
const fs = require('fs');
const path = require('path');

/**
 * Service to handle Digital Signatures (PAdES)
 */
class DigitalSigner {
    constructor() {
        this.p12Path = path.join(__dirname, '../../assets/keys/test-cert.p12');
        this.passphrase = 'password';
    }

    /**
     * Sign a PDF document using a P12 certificate
     * @param {Buffer} pdfBuffer Buffer containing PDF with signature placeholder
     * @returns {Promise<Buffer>}
     */
    async signPDF(pdfBuffer) {
        if (!fs.existsSync(this.p12Path)) {
            console.log('Generating temporary self-signed certificate for testing...');
            this.generateMockP12();
        }

        const p12Buffer = fs.readFileSync(this.p12Path);

        try {
            // node-signpdf expects a Buffer
            const signedPdf = signer.sign(pdfBuffer, p12Buffer, {
                passphrase: this.passphrase,
            });

            // --- LTV ENHANCEMENT: Integrate Revocation Data and Timestamps ---
            // In a real implementation, applyLTV would be called here after sign()
            // for the B-LT (Long-Term) level.
            const revocationInfo = await this.simulateFetchRevocationData();
            const timestampToken = await this.simulateFetchTimestamp('MOCK_HASH');
            
            console.log('Document signed and LTV materials prepared.');
            return Buffer.from(signedPdf);
        } catch (error) {
            console.error('Signing Error:', error);
            throw error;
        }
    }

    /**
     * Helper to generate a mock P12 certificate for development purposes
     */
    generateMockP12() {
        const pki = forge.pki;
        const keys = pki.rsa.generateKeyPair(3072);
        const cert = pki.createCertificate();
        cert.publicKey = keys.publicKey;
        // Use a more random-looking serial number to force fresh validation
        cert.serialNumber = Math.floor(Math.random() * 1000000).toString();
        cert.validity.notBefore = new Date();
        cert.validity.notBefore.setDate(cert.validity.notBefore.getDate() - 1); // 1 day before
        cert.validity.notAfter = new Date();
        cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

        const attrs = [
            { name: 'commonName', value: 'ETDA Dev Signature' },
            { name: 'organizationName', value: 'ETDA' },
            { shortName: 'OU', value: 'Research & Development' },
            { name: 'countryName', value: 'TH' }
        ];
        cert.setSubject(attrs);
        cert.setIssuer(attrs); // Self-signed (Root)

        cert.setExtensions([
            {
                name: 'basicConstraints',
                cA: false // End-entity cert
            },
            {
                name: 'keyUsage',
                digitalSignature: true,
                nonRepudiation: true,
                keyEncipherment: true,
                dataEncipherment: true
            },
            {
                name: 'extKeyUsage',
                emailProtection: true,
                clientAuth: true,
                timeStamping: true,
                '1.2.840.113583.1.1.10': true // Adobe Document Signing
            },
            {
                name: 'subjectAltName',
                altNames: [{
                    type: 1, // email
                    value: 'etda-dev@example.com'
                }]
            },
            { name: 'subjectKeyIdentifier' },
            { name: 'authorityKeyIdentifier' }
        ]);

        cert.sign(keys.privateKey, forge.md.sha256.create());

        const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], this.passphrase);
        const p12Bytes = forge.asn1.toDer(p12Asn1).getBytes();

        const dir = path.dirname(this.p12Path);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        fs.writeFileSync(this.p12Path, Buffer.from(p12Bytes, 'binary'));
        console.log('Mock P12 (Standard Compatible) created at:', this.p12Path);

        const certPem = pki.certificateToPem(cert);
        fs.writeFileSync(this.p12Path.replace('.p12', '.crt'), certPem);
    }

    /**
     * Simulation: Get OCSP/CRL data for the certificate (Part of LTV process)
     * In a real system, you would call the CA's OCSP/CRL endpoint
     */
    async simulateFetchRevocationData() {
        console.log('LTV Workflow: Fetching Revocation Data (OCSP/CRL)...');
        // Return mock binary data for simulation
        return {
            ocsp: Buffer.from('MOCK_OCSP_RESPONSE_DATA'),
            crl: Buffer.from('MOCK_CRL_DATA'),
            certs: [fs.readFileSync(this.p12Path)] // Include cert chain
        };
    }

    /**
     * Simulation: Get Document Timestamp from TSA (Part of LTV-Document Timestamp)
     * In a real system, you would call a Time Stamping Authority (TSA)
     */
    async simulateFetchTimestamp(documentHash) {
        console.log('LTV Workflow: Requesting Document Timestamp from TSA...');
        // Return a mock RFC3161 timestamp token
        return Buffer.from('MOCK_TSA_TIMESTAMP_TOKEN_' + documentHash.substring(0, 8));
    }
}

module.exports = new DigitalSigner();
