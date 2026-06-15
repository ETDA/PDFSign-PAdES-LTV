const { create } = require('xmlbuilder2');

/**
 * Service to build XML and JSON structured data according to standards
 */
class XmlJsonBuilder {
    /**
     * Build machine-readable data for Hybrid PDF/A-3.
     * Ensures strict 1:1 field parity between JSON and XML for ETDA-STD-11-2569 compliance.
     */
    _prepareData(rawData) {
        const type = rawData.type || 'Document';
        const docId = rawData.document?.number || `DOC-${Date.now()}`;
        const issueDate = rawData.document?.issueDate || rawData.issueDate || new Date().toISOString();

        const cleanObj = (obj) => {
            const newObj = {};
            for (const key in obj) {
                if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "" && obj[key] !== "N/A") {
                    newObj[key] = obj[key];
                }
            }
            return newObj;
        };

        // 1. Shared Identity Extraction (Dynamic)
        const getIdent = (entity) => {
            if (!entity) return null;
            const ident = {};
            const name = entity.name || entity.nameTh || "N/A";

            ident.name = name;
            if (entity.id) ident.id = entity.id;
            else if (entity.taxId) ident.id = `https://id.example.com/issuers/${entity.taxId}`;

            if (entity.nameTh) ident.nameTh = entity.nameTh;
            if (entity.nameEn) ident.nameEn = entity.nameEn;
            if (entity.taxId) ident.taxID = entity.taxId;
            if (entity.address) ident.address = entity.address;
            if (entity.email) ident.email = entity.email;
            if (entity.phone) ident.phone = entity.phone;

            return cleanObj(ident);
        };

        const issuerIdent = getIdent(rawData.issuer || rawData.company || rawData.hospital || rawData.seller || rawData.organizer);

        // 2. Base Subject Data
        let subject = {
            id: docId,
            issueDate: issueDate,
            type: type,
            issuerIdentity: issuerIdent
        };

        // 3. Domain Specific Mapping
        switch (type) {
            case 'e-Tax Invoice':
            case 'e-Receipt':
                subject.invoice = {
                    seller: cleanObj({ ...issuerIdent, branch: rawData.seller?.branch }),
                    buyer: getIdent(rawData.buyer),
                    payment: cleanObj({
                        method: rawData.payment?.method,
                        amount: rawData.payment?.amount || rawData.totals?.grandTotal,
                        currency: "THB"
                    }),
                    totals: cleanObj({
                        subtotal: rawData.totals?.subtotal,
                        vat: rawData.totals?.vat,
                        grandTotal: rawData.totals?.grandTotal
                    })
                };
                break;

            case 'e-Transcript':
            case 'Digital Degree':
            case 'Training Certificate':
                subject.credential = {
                    issuer: cleanObj({ ...issuerIdent, rectorName: rawData.issuer?.rectorName || rawData.organizer?.rectorName }),
                    student: cleanObj({
                        id: rawData.student?.id || rawData.student?.studentId || rawData.trainee?.id,
                        nameTh: rawData.student?.nameTh || rawData.recipient?.name || rawData.trainee?.name,
                        nameEn: rawData.student?.nameEn || rawData.recipient?.nameEn || rawData.trainee?.nameEn,
                        birthDate: rawData.student?.birthDate || rawData.trainee?.birthDate,
                        honors: rawData.recipient?.honors
                    }),
                    academicRecord: cleanObj({
                        degreeTh: rawData.academicRecord?.degreeTh || rawData.degree?.title || rawData.course?.name,
                        degreeEn: rawData.academicRecord?.degreeEn || rawData.degree?.titleEn || rawData.course?.nameEn,
                        gpa: rawData.academicRecord?.cumulativeGpa || rawData.academicRecord?.gpa,
                        facultyTh: rawData.student?.facultyTh || rawData.faculty?.name,
                        facultyEn: rawData.student?.facultyEn || rawData.faculty?.nameEn,
                        majorTh: rawData.student?.majorTh || rawData.degree?.major || rawData.course?.major,
                        majorEn: rawData.student?.majorEn || rawData.course?.majorEn,
                        graduationDate: rawData.academicRecord?.graduationDate || rawData.degree?.conferDate || rawData.course?.completionDate || rawData.issueDate
                    })
                };
                break;

            case 'Salary Certificate':
            case 'Employment Verification':
                subject.employment = {
                    employer: cleanObj({ ...issuerIdent, authorizedSigner: rawData.company?.authorizedSigner }),
                    employee: cleanObj({
                        id: rawData.employee?.employeeId,
                        name: rawData.employee?.name,
                        position: rawData.employee?.position,
                        startDate: rawData.employee?.startDate
                    }),
                    salaryDetails: cleanObj({
                        monthlyBase: rawData.salaryDetails?.monthlyBase,
                        allowance: rawData.salaryDetails?.allowance,
                        totalIncome: rawData.salaryDetails?.totalIncome,
                        currency: rawData.salaryDetails?.currency || "THB"
                    })
                };
                break;

            case 'Medical Certificate':
                subject.medical = {
                    healthcareProvider: cleanObj({ ...issuerIdent, licenseNo: rawData.hospital?.licenseNo }),
                    doctor: cleanObj({
                        name: rawData.doctor?.name,
                        licenseNo: rawData.doctor?.licenseNo
                    }),
                    patient: cleanObj({
                        name: rawData.patient?.name,
                        idCard: rawData.patient?.idCard,
                        age: rawData.patient?.age
                    }),
                    diagnosis: cleanObj({
                        description: rawData.diagnosis
                    }),
                    recommendation: cleanObj({
                        description: rawData.recommendation
                    })
                };
                break;
            case 'Power-of-Attorney':
                subject.powerOfAttorney = {
                    grantor: cleanObj({
                        name: rawData.grantor?.name,
                        idCard: rawData.grantor?.idCard,
                        address: rawData.grantor?.address
                    }),
                    attorney: cleanObj({
                        name: rawData.attorney?.name,
                        idCard: rawData.attorney?.idCard,
                        address: rawData.attorney?.address
                    }),
                    powers: cleanObj({
                        description: rawData.powers?.description,
                        scope: rawData.powers?.scope,
                        expiryDate: rawData.powers?.expiryDate
                    })
                };
                break;
        }

        return subject;
    }

    buildJSON(rawData) {
        const data = this._prepareData(rawData);

        // Return plain JSON without JSON-LD tags
        const jsonData = {
            ...data,
            "raw": rawData
        };

        return JSON.stringify(jsonData, null, 2);
    }

    buildXML(rawData) {
        console.log('Building XML for type:', rawData.type);
        const data = this._prepareData(rawData);
        const builder = create({ version: '1.0', encoding: 'UTF-8' });

        const addEle = (parent, tagName, value) => {
            if (value !== undefined && value !== null && value !== "") {
                parent.ele(tagName).txt(String(value)).up();
            }
        };

        const addIdent = (parent, ident) => {
            if (!ident) return;
            addEle(parent, 'ram:ID', ident.id);
            addEle(parent, 'ram:Name', ident.name);
            addEle(parent, 'ram:NameTh', ident.nameTh);
            addEle(parent, 'ram:NameEn', ident.nameEn);
            addEle(parent, 'ram:TaxID', ident.taxID);
            addEle(parent, 'ram:Address', ident.address);
            addEle(parent, 'ram:Email', ident.email);
            addEle(parent, 'ram:Phone', ident.phone);
        };

        let root;
        const type = data.type;

        if (type === 'e-Tax Invoice' || type === 'e-Receipt') {
            const inv = data.invoice;
            const typeCode = type === 'e-Tax Invoice' ? '380' : '388';
            root = builder.ele('rsm:CrossIndustryInvoice', {
                'xmlns:rsm': 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
                'xmlns:ram': 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100'
            })
                .ele('rsm:ExchangedDocumentContext')
                .ele('ram:GuidelineSpecifiedDocumentContextParameter').ele('ram:ID').txt('ER-EINVOICEV2-V08').up().up()
                .up()
                .ele('rsm:ExchangedDocument')
                .ele('ram:ID').txt(data.id).up()
                .ele('ram:TypeCode').txt(typeCode).up()
                .ele('ram:IssueDateTime').txt(data.issueDate).up()
                .up()
                .ele('rsm:SupplyChainTradeTransaction')
                .ele('ram:ApplicableHeaderTradeAgreement')
                .ele('ram:SellerTradeParty');

            addIdent(root, inv.seller);
            if (inv.seller.branch) root.ele('ram:BranchID').txt(inv.seller.branch).up();
            root.up(); // back to ApplicableHeaderTradeAgreement

            const buyerNode = root.ele('ram:BuyerTradeParty');
            addIdent(buyerNode, inv.buyer);
            root.up(); // back to ApplicableHeaderTradeAgreement
            root.up(); // back to SupplyChainTradeTransaction

            const settleNode = root.ele('ram:ApplicableHeaderTradeSettlement');
            if (inv.payment.method) settleNode.ele('ram:PaymentMethod').txt(inv.payment.method).up();
            const sumNode = settleNode.ele('ram:SpecifiedTradeSettlementMonetarySummation');
            if (inv.totals.subtotal) sumNode.ele('ram:TaxBasisTotalAmount').txt(String(inv.totals.subtotal)).up();
            if (inv.totals.vat) sumNode.ele('ram:TaxTotalAmount').txt(String(inv.totals.vat)).up();
            if (inv.totals.grandTotal) sumNode.ele('ram:GrandTotalAmount', { currencyID: inv.payment.currency }).txt(String(inv.totals.grandTotal)).up();

            root = builder; // Ensure root points to top for .end()
        } else if (type === 'e-Transcript' || type === 'Digital Degree' || type === 'Training Certificate') {
            const cred = data.credential;
            root = builder.ele('rsm:Transcript', {
                'xmlns:rsm': 'https://schema.etda.or.th/v1/transcript',
                'xmlns:ram': 'https://schema.etda.or.th/v1/reusable'
            })
                .ele('rsm:Header');
            addEle(root, 'ram:ID', data.id);
            addEle(root, 'ram:IssueDate', data.issueDate);
            root.up();

            const issuerNode = root.ele('rsm:Issuer');
            if (cred.issuer) {
                addIdent(issuerNode, cred.issuer);
                if (cred.issuer.rectorName) addEle(issuerNode, 'ram:RectorName', cred.issuer.rectorName);
            } else {
                addIdent(issuerNode, data.issuerIdentity);
            }
            root.up();

            const studentNode = root.ele('rsm:Student');
            addEle(studentNode, 'ram:ID', cred.student.id);
            addEle(studentNode, 'ram:NameTh', cred.student.nameTh);
            addEle(studentNode, 'ram:NameEn', cred.student.nameEn);
            addEle(studentNode, 'ram:BirthDate', cred.student.birthDate);
            addEle(studentNode, 'ram:Honors', cred.student.honors);
            root.up();

            const recordNode = root.ele('rsm:AcademicRecord');
            addEle(recordNode, 'ram:DegreeTh', cred.academicRecord.degreeTh);
            addEle(recordNode, 'ram:DegreeEn', cred.academicRecord.degreeEn);
            addEle(recordNode, 'ram:GPA', cred.academicRecord.gpa);
            addEle(recordNode, 'ram:FacultyTh', cred.academicRecord.facultyTh);
            addEle(recordNode, 'ram:FacultyEn', cred.academicRecord.facultyEn);
            addEle(recordNode, 'ram:MajorTh', cred.academicRecord.majorTh);
            addEle(recordNode, 'ram:MajorEn', cred.academicRecord.majorEn);
            addEle(recordNode, 'ram:GraduationDate', cred.academicRecord.graduationDate);
            root.up();
        } else if (type === 'Salary Certificate' || type === 'Employment Verification') {
            const emp = data.employment;
            root = builder.ele('rsm:EmploymentCertificate', {
                'xmlns:rsm': 'https://schema.etda.or.th/v1/employment',
                'xmlns:ram': 'https://schema.etda.or.th/v1/reusable'
            })
                .ele('rsm:Header');
            addEle(root, 'ram:ID', data.id);
            addEle(root, 'ram:IssueDate', data.issueDate);
            root.up();

            const employerNode = root.ele('rsm:Employer');
            addIdent(employerNode, emp.employer);
            if (emp.employer.authorizedSigner) addEle(employerNode, 'ram:AuthorizedSigner', emp.employer.authorizedSigner);
            root.up();

            const employeeNode = root.ele('rsm:Employee');
            addEle(employeeNode, 'ram:ID', emp.employee.id);
            addEle(employeeNode, 'ram:Name', emp.employee.name);
            addEle(employeeNode, 'ram:Position', emp.employee.position);
            addEle(employeeNode, 'ram:StartDate', emp.employee.startDate);
            root.up();

            const salaryNode = root.ele('rsm:SalaryDetails');
            addEle(salaryNode, 'ram:MonthlyBase', emp.salaryDetails.monthlyBase);
            addEle(salaryNode, 'ram:Allowance', emp.salaryDetails.allowance);
            addEle(salaryNode, 'ram:MonthlySalary', emp.salaryDetails.totalIncome);
            addEle(salaryNode, 'ram:Currency', emp.salaryDetails.currency);
            root.up();
        } else if (type === 'Medical Certificate') {
            const med = data.medical;
            root = builder.ele('rsm:MedicalCertificate', {
                'xmlns:rsm': 'https://schema.etda.or.th/v1/medical',
                'xmlns:ram': 'https://schema.etda.or.th/v1/reusable'
            })
                .ele('rsm:Header');
            addEle(root, 'ram:ID', data.id);
            addEle(root, 'ram:IssueDate', data.issueDate);
            root.up();

            const providerNode = root.ele('rsm:HealthcareProvider');
            addIdent(providerNode, med.healthcareProvider);
            if (med.healthcareProvider.licenseNo) addEle(providerNode, 'ram:LicenseNo', med.healthcareProvider.licenseNo);
            root.up();

            const doctorNode = root.ele('rsm:Doctor');
            addEle(doctorNode, 'ram:Name', med.doctor.name);
            addEle(doctorNode, 'ram:LicenseNo', med.doctor.licenseNo);
            root.up();

            const patientNode = root.ele('rsm:Patient');
            addEle(patientNode, 'ram:Name', med.patient.name);
            addEle(patientNode, 'ram:IDCard', med.patient.idCard);
            addEle(patientNode, 'ram:Age', med.patient.age);
            root.up();

            const diagNode = root.ele('rsm:Diagnosis');
            if (med.diagnosis.description) addEle(diagNode, 'ram:Description', med.diagnosis.description);
            root.up();

            const recNode = root.ele('rsm:Recommendation');
            if (med.recommendation.description) addEle(recNode, 'ram:Description', med.recommendation.description);
            root.up();
        } else if (type === 'Power-of-Attorney') {
            const poa = data.powerOfAttorney;
            root = builder.ele('rsm:PowerOfAttorney', {
                'xmlns:rsm': 'https://schema.etda.or.th/v1/poa',
                'xmlns:ram': 'https://schema.etda.or.th/v1/reusable'
            })
                .ele('rsm:Header');
            addEle(root, 'ram:ID', data.id);
            addEle(root, 'ram:IssueDate', data.issueDate);
            root.up();

            const grantorNode = root.ele('rsm:Grantor');
            addEle(grantorNode, 'ram:Name', poa.grantor.name);
            addEle(grantorNode, 'ram:IDCard', poa.grantor.idCard);
            addEle(grantorNode, 'ram:Address', poa.grantor.address);
            root.up();

            const attorneyNode = root.ele('rsm:Attorney');
            addEle(attorneyNode, 'ram:Name', poa.attorney.name);
            addEle(attorneyNode, 'ram:IDCard', poa.attorney.idCard);
            addEle(attorneyNode, 'ram:Address', poa.attorney.address);
            root.up();

            const powersNode = root.ele('rsm:Powers');
            addEle(powersNode, 'ram:Description', poa.powers.description);
            addEle(powersNode, 'ram:Scope', poa.powers.scope);
            addEle(powersNode, 'ram:ExpiryDate', poa.powers.expiryDate);
            root.up();
        } else {
            root = builder.ele('Document', { type: type })
                .ele('Header');
            addEle(root, 'ID', data.id);
            addEle(root, 'IssueDate', data.issueDate);
            root.up();

            const issuerNode = root.ele('Issuer');
            addEle(issuerNode, 'Name', data.issuerIdentity?.name);
            addEle(issuerNode, 'TaxID', data.issuerIdentity?.taxID);
            root.up();
        }

        return builder.end({ prettyPrint: true });
    }
}

module.exports = new XmlJsonBuilder();
