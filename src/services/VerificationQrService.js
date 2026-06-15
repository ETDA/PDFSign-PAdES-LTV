const cbor = require('cbor');
const base45 = require('base45');
const qrcode = require('qrcode');
const pako = require('pako');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const forge = require('node-forge');

/**
 * Service to handle compact offline Verification QR Code generation
 * Following standards like CBOR, COSE, Base45 (similar to EU Digital COVID Certificate)
 */
class VerificationQrService {
    constructor() {
        this.p12Path = path.join(__dirname, '../../assets/keys/test-cert.p12');
        this.passphrase = 'password';
    }

    /**
     * Recursive Helper to find values in nested objects
     */
    findValue(obj, keys) {
        if (!obj || typeof obj !== 'object') return null;
        for (const key of keys) {
            if (obj[key]) {
                // If it's an object with a 'name', return name, else return value
                if (typeof obj[key] === 'object' && obj[key].name) return obj[key].name;
                return obj[key];
            }
        }
        for (const k in obj) {
            if (typeof obj[k] === 'object') {
                const res = this.findValue(obj[k], keys);
                if (res) return res;
            }
        }
        return null;
    }

    /**
     * Generate a compact verification QR code
     */
    async generateVerificationQr(data, documentId) {
        const workflow = [];

        // 1. Prepare Minimal Data Set
        workflow.push("1. Preparing Minimal Data Set (Essential Fields only)");

        // Find Issuer (Organization)
        const issuerName = this.findValue(data, ['company', 'seller', 'organizer', 'issuer', 'university', 'school', 'issuerName']) || "ETDA-DEV-001";

        // Find Subject ID for hashing
        const subjectId = this.findValue(data, ['idNumber', 'employeeId', 'idCard', 'taxId', 'id', 'traineeId']) || "0000";
        const subjectHash = crypto.createHash('sha256').update(subjectId + "ETDA-SALT").digest('hex').substring(0, 8);

        // Final Subject String: Type (..Hash)
        const docType = data.type || "Document";
        const finalSubject = `${docType} (..${subjectHash})`;

        const payload = {
            iss: issuerName, // Organization Name
            sub: finalSubject, // Document Type (..Hash)
            doc_id: documentId,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor((Date.now() + 365 * 24 * 60 * 60 * 1000) / 1000),
        };

        console.log(`[QR GEN] Issuer: "${issuerName}", Subject: "${finalSubject}"`);

        // 2. Convert to CBOR
        workflow.push("2. Encoding payload to binary structure (CBOR)");
        const cborPayload = cbor.encode(payload);

        // 3. Signing with COSE-like structure
        workflow.push("3. Signing payload with Private Key (COSE structure)");
        const signature = await this.signData(cborPayload);

        const coseSign1 = [
            cbor.encode({ 1: -7 }), // ES256
            {},
            cborPayload,
            signature
        ];
        const taggedCose = new cbor.Tagged(18, coseSign1);
        const signedCbor = cbor.encode(taggedCose);

        // 4. Compression
        workflow.push("4. Compressing binary data (Zlib/Deflate)");
        const compressed = pako.deflate(signedCbor);

        // 5. Encoding
        workflow.push("5. Encoding to QR-friendly text (Base45)");
        const b45Encoded = base45.encode(Buffer.from(compressed));
        const finalString = "EA1:" + b45Encoded;

        // 6. Generate QR Code Image
        workflow.push("6. Rendering as High-density QR Code (Offline-ready)");
        const qrDataUrl = await qrcode.toDataURL(finalString, {
            errorCorrectionLevel: 'M',
            margin: 2,
            scale: 8,
            color: { dark: "#012B54", light: "#FFFFFF" }
        });

        return { qrDataUrl, base45: finalString, workflow };
    }

    /**
     * Legacy hashSubject - now uses the internal findValue logic
     */
    hashSubject(data) {
        const id = this.findValue(data, ['idNumber', 'employeeId', 'idCard', 'taxId', 'id']) || "0000";
        const hash = crypto.createHash('sha256').update(id + "ETDA-SALT").digest('hex').substring(0, 8);
        return `(..${hash})`;
    }

    async signData(dataBuffer) {
        if (!fs.existsSync(this.p12Path)) {
            throw new Error("P12 certificate not found.");
        }
        const p12Buffer = fs.readFileSync(this.p12Path);
        const p12Der = forge.util.createBuffer(p12Buffer.toString('binary'));
        const p12Asn1 = forge.asn1.fromDer(p12Der);
        const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, this.passphrase);
        const keyData = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag][0];
        const privateKey = keyData.key;
        const md = forge.md.sha256.create();
        md.update(dataBuffer.toString('binary'));
        const signatureBytes = privateKey.sign(md);
        return Buffer.from(signatureBytes, 'binary');
    }

    async verifyQrOffline(qrString) {
        const verifySteps = [];
        try {
            if (!qrString.startsWith("EA1:")) throw new Error("Invalid Format Prefix");
            verifySteps.push("1. Decoding Base45 text content");
            const b45Data = qrString.substring(4);
            const compressed = base45.decode(b45Data);
            verifySteps.push("2. Decompressing binary payload (Zlib)");
            const signedCbor = pako.inflate(compressed);
            verifySteps.push("3. Parsing COSE/CBOR structure");
            const decodedCose = cbor.decode(signedCbor);
            if (decodedCose.tag !== 18) throw new Error("Not a COSE_Sign1 message");
            const [protectedHead, unprotectedHead, payload, signature] = decodedCose.value;
            const data = cbor.decode(payload);
            verifySteps.push("4. Verifying Digital Signature using Public Key (Offline)");
            const p12Buffer = fs.readFileSync(this.p12Path);
            const p12Der = forge.util.createBuffer(p12Buffer.toString('binary'));
            const p12Asn1 = forge.asn1.fromDer(p12Der);
            const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, this.passphrase);
            const certBag = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag][0];
            const publicKey = certBag.cert.publicKey;
            const md = forge.md.sha256.create();
            md.update(payload.toString('binary'));
            const verified = publicKey.verify(md.digest().bytes(), signature.toString('binary'));
            if (!verified) throw new Error("Signature Mismatch!");
            return { valid: true, data, steps: verifySteps };
        } catch (err) {
            verifySteps.push("❌ Error: " + err.message);
            return { valid: false, error: err.message, steps: verifySteps };
        }
    }
}

module.exports = new VerificationQrService();
