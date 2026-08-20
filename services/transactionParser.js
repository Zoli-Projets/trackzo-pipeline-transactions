// services/transactionParser.js

function normalizeText(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}


// ======================================
// MONTANT
// ======================================

function extractAmount(message) {

    const text = String(message || "");

    // CIE : priorité au total général
    if (
        /recharge prépayée|recharge prepayee|cie|électricité|electricite|energie/i
            .test(text)
    ) {

        const ciePatterns = [

            /total\s+g(?:é|e)n(?:é|e)ral\s*[:\-]?\s*([0-9][0-9\s.,]*)\s*(f(?:cfa)?|f\.?cfa|fcf|xof)?/i,

            /total\s*[:\-]?\s*([0-9][0-9\s.,]*)\s*(f(?:cfa)?|f\.?cfa|fcf|xof)?/i

        ];

        for (const regex of ciePatterns) {

            const match = text.match(regex);

            if (match) {

                const value =
                    parseNumber(match[1]);

                if (value > 0) {

                    return {
                        value,
                        display: `${value} FCFA`
                    };

                }

            }

        }

    }


    // Retirer les numéros de téléphone
    const cleaned =
        text.replace(
            /\b(?:\+225)?0\d{7,9}\b/g,
            " "
        );


    const patterns = [

        /montant\s*[:\-]?\s*([0-9][0-9\s.,]*)\s*(?:f(?:cfa)?|f\.?cfa|fcf|xof|usd|eur|₦)?/i,

        /([0-9][0-9\s.,]*)\s*(?:f(?:cfa)?|f\.?cfa|fcf|xof|usd|eur|₦)\b/i

    ];


    for (const regex of patterns) {

        const match =
            cleaned.match(regex);

        if (match) {

            const value =
                parseNumber(match[1]);

            if (value >= 0) {

                return {
                    value,
                    display:
                        value > 0
                            ? `${value} FCFA`
                            : "0"
                };

            }

        }

    }


    return {
        value: 0,
        display: "0"
    };

}


// ======================================
// PARSE NUMBER
// ======================================

function parseNumber(value) {

    if (!value) return 0;

    let normalized =
        String(value)
            .replace(/\s/g, "")
            .replace(/,/g, ".");

    const number =
        parseFloat(normalized);

    return Number.isFinite(number)
        ? Math.round(number)
        : 0;
}


// ======================================
// OPERATEUR
// ======================================

function detectOperator(message) {

    const text =
        normalizeText(message);

    if (
        text.includes("orange") ||
        /\b07\d{8}\b/.test(text) ||
        /\b22507\d{7,}\b/.test(text)
    ) {
        return "Orange Money";
    }

    if (
        text.includes("mtn") ||
        text.includes("momo") ||
        text.includes("bundlebypos") ||
        /\b05\d{8}\b/.test(text) ||
        /\b22505\d{7,}\b/.test(text)
    ) {
        return "MTN Money";
    }

    if (
        text.includes("moov") ||
        /\b01\d{8}\b/.test(text) ||
        /\b22501\d{7,}\b/.test(text)
    ) {
        return "Moov Money";
    }

    if (
        text.includes("wave") ||
        /\b(?:225)?(?:30|40)\d{6}\b/.test(text)
    ) {
        return "Wave";
    }

    return "Inconnu";
}


// ======================================
// REFERENCE
// ======================================

function detectReference(message) {

    const text =
        String(message || "");


    const patterns = [

        /recu\s*[:.]?\s*([A-Z0-9]{8,})/i,

        /(?:reference|référence|ref)\s*[:.]?\s*([0-9]{10,})/i,

        /(?:reference|référence|ref)\s*[:.]?\s*([A-Z][A-Z0-9]+\.[A-Z0-9]+\.[A-Z0-9]+)/i,

        /\bID\s+Transaction\s*[:.]?\s*([A-Za-z0-9][A-Za-z0-9.-]{5,})/i,

        /\b(?:Trx\s*ID|TRXID|TrxID|Trx)\s*[:.]?\s*([A-Za-z0-9][A-Za-z0-9.-]{5,})/i,

        /\bNo\.?\s*(?:de\s+)?transaction\s*[:.]?\s*([A-Za-z0-9][A-Za-z0-9.-]{5,})/i,

        /\bTransaction\s*[:.]?\s*([0-9]{8,})/i

    ];


    for (const regex of patterns) {

        const match =
            text.match(regex);

        if (match) {

            return match[1]
                .replace(/\.$/, "")
                .toUpperCase()
                .trim();

        }

    }


    return "";
}


// ======================================
// TYPE
// ======================================

function detectType(message) {

    const text =
        normalizeText(message);


    const hasReference =
        !!detectReference(message);


    if (
        hasReference &&
        (
            text.includes("compte marchand") ||
            text.includes("vous avez recu") ||
            text.includes("vous avez reçu")
        )
    ) {
        return "Recharge";
    }


    if (
        hasReference &&
        (
            text.includes("transfere") ||
            text.includes("transféré") ||
            text.includes("le transfert")
        )
    ) {

        return "U.V en espèce";

    }


    // ======================================
// RETRAIT — PRIORITAIRE
// ======================================

if (
    lower.includes("retrait") ||
    lower.includes("vous avez retiré") ||
    lower.includes("vous avez retire") ||
    lower.includes("cash out initiated") ||
    lower.includes("cash out")
) {

    return "Retrait";

}


// ======================================
// PAIEMENT FACTURE
// ======================================

if (hasRef ||
    lower.includes("recharge prépayée") ||
    lower.includes("recharge prepaye") ||
    lower.includes("total general") ||
    lower.includes("compteur") ||
    lower.includes("facture") ||
    lower.includes("electricite")
) {

    return "Paiement facture";

}


    if (
        text.includes("depot") ||
        text.includes("dépôt") ||
        text.includes("vous avez envoye") ||
        text.includes("vous avez envoyé")
    ) {

        return "Dépôt";

    }


    if (
        text.includes("transfert international")
    ) {

        return "Transf. International";

    }


    if (
        text.includes("achat groupe de") ||
        text.includes("bundlebypos") ||
        text.includes("credit de communication") ||
        text.includes("recharge de")
    ) {

        return "Transfère Unité";

    }


    return "Autre";
}


// ======================================
// ANALYSE STRUCTURELLE
// ======================================

function parseTransaction(message) {

    const amount =
        extractAmount(message);

    const operator =
        detectOperator(message);

    const reference =
        detectReference(message);

    const type =
        detectType(message);


    return {

        amount: amount.value,

        amountDisplay:
            amount.display,

        operator,

        reference,

        type

    };

}


module.exports = {
    parseTransaction,
    extractAmount,
    detectOperator,
    detectReference,
    detectType
};