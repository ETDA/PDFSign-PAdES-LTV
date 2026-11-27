const { PDFDocument, PDFName } = require('pdf-lib');
const { extractSignature } = require('node-signpdf');
const forge = require('node-forge');
const fs = require('fs');
const path = require('path');

const DIGEST_FACTORY = {
    '1.3.14.3.2.26': forge.md.sha1,
    '2.16.840.1.101.3.4.2.1': forge.md.sha256,
    '2.16.840.1.101.3.4.2.2': forge.md.sha384,
    '2.16.840.1.101.3.4.2.3': forge.md.sha512,
};

/**
 * Service Layer for Identity Verification
 * Focuses on PAdES Digital Signature and Cryptographic Integrity
 */
class VerificationService {
    constructor() {
        // Trust anchors. A deployment points ETDA_TRUST_DIR at the directory holding
        // the CA certificates it trusts. The bundled development certificate is the
        // default so the sample documents validate out of the box.
        this.trustDir = process.env.ETDA_TRUST_DIR || path.join(__dirname, '../../assets/keys');
    }

    loadTrustAnchors() {
        const anchors = [];
        try {
            for (const name of fs.readdirSync(this.trustDir)) {
                if (!/\.(crt|pem|cer)$/i.test(name)) continue;
                try {
                    anchors.push(forge.pki.certificateFromPem(fs.readFileSync(path.join(this.trustDir, name), 'utf8')));
                } catch (e) { /* skip anything that is not a PEM certificate */ }
            }
        } catch (e) { /* no trust directory */ }
        return anchors;
    }

    /**
     * Pick the certificate that actually produced the signature by matching the
     * serial number carried in the SignerInfo, falling back to the first cert.
     */
    findSignerCert(p7) {
        const certs = p7.certificates || [];
        const si = (p7.rawCapture && p7.rawCapture.serial) ? forge.util.createBuffer(p7.rawCapture.serial).toHex() : null;
        if (si) {
            const match = certs.find(c => c.serialNumber && c.serialNumber.replace(/^0+/, '') === si.replace(/^0+/, ''));
            if (match) return match;
        }
        return certs[0] || null;
    }

    /**
     * Verifies PAdES Digital Signature and identity
     * @param {Buffer} pdfBuffer
     * @returns {Promise<Object>}
     */
    async verifySignature(pdfBuffer) {
        const results = {
            success: false,
            isValid: false,
            signer: 'Unknown',
            signingTime: 'N/A',
            integrity: false,
            authentic: false,
            trusted: false,
            revocationChecked: false,
            ltvEnabled: false,
            timestamped: false,
            workflowLog: []
        };

        try {
            results.workflowLog.push('Extracting PKCS7 Signature Block...');
            const { ByteRange, signature, signedData } = extractSignature(pdfBuffer);
            if (!signature) throw new Error('No digital signature found in PDF');

            // The ByteRange must cover the whole document except the single gap that
            // holds the signature. Otherwise an attacker can leave edited bytes outside
            // the signed range and still present a signature.
            if (!ByteRange || ByteRange.length !== 4 || ByteRange[0] !== 0 ||
                ByteRange[2] + ByteRange[3] !== pdfBuffer.length) {
                throw new Error('ByteRange does not cover the whole document');
            }

            const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(signature, false));
            const cert = this.findSignerCert(p7);
            if (!cert) throw new Error('No signer certificate present in the signature');
            results.signer = cert.subject.getField('CN')?.value || 'Digital ID';

            const rc = p7.rawCapture;
            const attrs = rc.authenticatedAttributes;
            if (!attrs || attrs.length === 0) throw new Error('Signature carries no signed attributes');

            const digestOid = forge.asn1.derToOid(rc.digestAlgorithm);
            const mdFactory = DIGEST_FACTORY[digestOid];
            if (!mdFactory) throw new Error('Unsupported digest algorithm ' + digestOid);

            // 1) Integrity. The messageDigest signed attribute must equal the hash of the
            // signed byte range. This is what a changed document fails on.
            let messageDigest = null;
            for (const attr of attrs) {
                if (forge.asn1.derToOid(attr.value[0].value) === forge.pki.oids.messageDigest) {
                    messageDigest = attr.value[1].value[0].value;
                }
            }
            if (messageDigest == null) throw new Error('Signature has no messageDigest attribute');
            const contentHash = mdFactory.create();
            contentHash.update(signedData.toString('binary'));
            if (contentHash.digest().getBytes() !== messageDigest) {
                throw new Error('Document has been altered after signing');
            }
            results.integrity = true;
            results.workflowLog.push('Integrity Verified: document matches the signed digest.');

            // 2) Authenticity. The signature must verify over the DER of the signed
            // attributes using the signer public key.
            const signedAttrSet = forge.asn1.create(
                forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, attrs);
            const attrHash = mdFactory.create();
            attrHash.update(forge.asn1.toDer(signedAttrSet).getBytes());
            results.authentic = cert.publicKey.verify(attrHash.digest().getBytes(), rc.signature);
            if (!results.authentic) throw new Error('Signature does not verify against the signer key');
            results.workflowLog.push('Authenticity Verified: signature matches the signer key.');

            // Certificate validity window.
            const now = new Date();
            if (now < cert.validity.notBefore || now > cert.validity.notAfter) {
                throw new Error('Signer certificate is outside its validity period');
            }

            // 3) Trust. The signer certificate must chain to a configured trust anchor.
            const anchors = this.loadTrustAnchors();
            if (anchors.length) {
                const caStore = forge.pki.createCaStore(anchors);
                const chain = [cert].concat((p7.certificates || []).filter(c => c !== cert));
                try {
                    results.trusted = forge.pki.verifyCertificateChain(caStore, chain);
                } catch (e) {
                    results.trusted = false;
                }
            }
            if (!results.trusted) throw new Error('Signer is not anchored to a trusted certificate');
            results.workflowLog.push('Trust Verified: signer chains to a trusted certificate.');

            // Signing time, from the signed attribute when present, else the signature dict.
            const timeAttr = attrs.find(a => forge.asn1.derToOid(a.value[0].value) === forge.pki.oids.signingTime);
            if (timeAttr && timeAttr.value[1] && timeAttr.value[1].value[0]) {
                results.signingTime = timeAttr.value[1].value[0].value;
            }
            if (results.signingTime === 'N/A') {
                try {
                    const pdfDoc = await PDFDocument.load(pdfBuffer);
                    for (const [, obj] of pdfDoc.context.enumerateIndirectObjects()) {
                        if (obj.has && obj.get(PDFName.of('Type'))?.toString() === '/Sig') {
                            const m = obj.get(PDFName.of('M'));
                            if (m) {
                                const t = m.toString().replace(/[()D:]/g, '');
                                results.signingTime = new Date(
                                    `${t.substring(0, 4)}-${t.substring(4, 6)}-${t.substring(6, 8)}T` +
                                    `${t.substring(8, 10)}:${t.substring(10, 12)}:${t.substring(12, 14)}Z`).toISOString();
                            }
                            break;
                        }
                    }
                } catch (e) { }
            }

            results.isValid = results.integrity && results.authentic && results.trusted;
            results.success = true;

            // LTV material is reported for information. Full revocation and timestamp
            // validation against the DSS is a separate step and is not asserted here.
            const pdfDoc = await PDFDocument.load(pdfBuffer);
            const dss = pdfDoc.catalog.get(PDFName.of('DSS'));
            if (dss) {
                results.ltvEnabled = true;
                results.workflowLog.push('LTV Material Found: DSS (Document Security Store) is present.');
            }

            results.workflowLog.push(`Signature Verified: ${results.signer}`);

        } catch (error) {
            results.success = results.integrity || results.authentic;
            results.isValid = false;
            results.workflowLog.push(`Verification Error: ${error.message}`);
        }

        return results;
    }
}

module.exports = new VerificationService();
