const {
    PROMOTION_PATTERNS,
    TRANSACTION_PATTERNS
} = require("../utils/transactionPatterns");

const OPERATORS = [
    "Orange Money",
    "MTN Money",
    "Moov Money",
    "Wave"
];

function normalizeText(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

function detectOperator(message) {
    const lower = normalizeText(message);

    if (
        lower.includes("orange") ||
        /\b225?07\d{6,9}\b/.test(lower) ||
        /\b07\d{8}\b/.test(lower)
    ) return "Orange Money";

    if (
        lower.includes("mtn") ||
        lower.includes("momo") ||
        lower.includes("bundlebypos") ||
        /\b225?05\d{6,9}\b/.test(lower) ||
        /\b05\d{8}\b/.test(lower)
    ) return "MTN Money";

    if (
        lower.includes("moov") ||
        /\b225?01\d{6,9}\b/.test(lower) ||
        /\b01\d{8}\b/.test(lower)
    ) return "Moov Money";

    if (
        lower.includes("wave") ||
        /\b(?:225)?(?:30|40)\d{6}\b/.test(lower)
    ) return "Wave";

    return "Inconnu";
}

function extractAmount(message) {
    const original = String(message || "");
    const lower = normalizeText(original);

    // CIE / électricité : privilégier Total général puis Total.
    if (
        lower.includes("recharge prepaye") ||
        lower.includes("cie") ||
        lower.includes("electricite") ||
        lower.includes("energie")
    ) {
        const ciePatterns = [
            /total\s+g(?:é|e)n(?:é|e)ral\s*[:\-]?\s*([0-9][0-9\s.,]*)\s*(f(?:cfa)?|f\.?cfa|fcf|xof|usd|eur|₦)?\b/i,
            /total\s*[:\-]?\s*([0-9][0-9\s.,]*)\s*(f(?:cfa)?|f\.?cfa|fcf|xof|usd|eur|₦)?\b/i
        ];

        for (const pattern of ciePatterns) {
            const match = original.match(pattern);
            if (match) {
                const value = parseNumeric(match[1]);
                if (value > 0) {
                    return {
                        value,
                        display: `${formatNumber(value)} ${normalizeCurrency(match[2])}`,
                        currency: normalizeCurrency(match[2])
                    };
                }
            }
        }
    }

    const amountLabel = original.match(
        /montant\s*[:\-]?\s*([0-9][0-9\s.,]*)\s*(f(?:cfa)?|f\.?cfa|fcf|xof|usd|eur|₦)?\b/i
    );

    if (amountLabel) {
        const value = parseNumeric(amountLabel[1]);
        return {
            value,
            display: value > 0
                ? `${formatNumber(value)} ${normalizeCurrency(amountLabel[2])}`
                : "0",
            currency: normalizeCurrency(amountLabel[2])
        };
    }

    const currencyMatches = [
        ...original.matchAll(
            /([0-9][0-9\s.,]*)\s*(f(?:cfa)?|f\.?cfa|fcf|xof|usd|eur|₦)\b/gi
        )
    ];

    if (currencyMatches.length) {
        // Préférer une occurrence proche du mot montant.
        const nearby = currencyMatches.find(m => {
            const start = Math.max(0, m.index - 60);
            return /montant/i.test(original.slice(start, m.index));
        });

        const match = nearby || currencyMatches[0];
        const value = parseNumeric(match[1]);

        return {
            value,
            display: value > 0
                ? `${formatNumber(value)} ${normalizeCurrency(match[2])}`
                : "0",
            currency: normalizeCurrency(match[2])
        };
    }

    const noCurrency = original.match(
        /montant\s*[:\-]?\s*([0-9][0-9\s.,]*)/i
    );

    if (noCurrency) {
        const value = parseNumeric(noCurrency[1]);
        return {
            value,
            display: value > 0
                ? `${formatNumber(value)} FCFA`
                : "0",
            currency: "FCFA"
        };
    }

    return {
        value: 0,
        display: "0",
        currency: ""
    };
}

function parseNumeric(value) {
    let raw = String(value || "")
        .replace(/\s/g, "")
        .trim();

    if (!raw) return 0;

    // 1 500 / 1,500 / 1.500 => 1500
    if (/^\d{1,3}(?:[.,]\d{3})+$/.test(raw)) {
        raw = raw.replace(/[.,]/g, "");
    } else {
        raw = raw.replace(",", ".");
    }

    const valueNumber = Number.parseFloat(raw);

    if (!Number.isFinite(valueNumber)) return 0;

    return Math.abs(
        valueNumber - Math.round(valueNumber)
    ) < 0.01
        ? Math.round(valueNumber)
        : Number(valueNumber.toFixed(2));
}

function formatNumber(value) {
    return Number(value).toLocaleString("fr-FR");
}

function normalizeCurrency(value) {
    const currency = String(value || "FCFA")
        .toUpperCase()
        .replace(/\./g, "");

    if (!currency || currency === "F") return "FCFA";
    return currency;
}

function extractReference(message) {
    const original = String(message || "");

    // CIE : reçu.
    const cieReceipt = original.match(
        /(?:recu|reçu)\s*[:.]?\s*([A-Z0-9]{8,})/i
    );
    if (cieReceipt) {
        return cieReceipt[1].toUpperCase().trim();
    }

    // Référence CIE numérique.
    const cieRef = original.match(
        /(?:Reference|Référence|Ref|Réf)\s*[:.]?\s*(\b[0-9]{10,}\b)/i
    );
    if (cieRef) return cieRef[1].trim();

    // Référence Orange / formats alphanumériques.
    const orangeRef = original.match(
        /(?:Reference|Référence|Ref|Réf)\s*[:.]?\s*([A-Z][A-Z0-9]+\.[A-Z0-9]+\.[A-Z0-9]+)/i
    );
    if (orangeRef) return orangeRef[1].toUpperCase().trim();

    const patterns = [
        /\bID\s+Transaction\s*[:.]?\s*([A-Za-z0-9][A-Za-z0-9.-]{5,}[A-Za-z0-9])/i,
        /\b(?:Trx\s*ID|TRX\s*ID|TRXID|TrxID|Trx)\s*[:.]?\s*([A-Za-z0-9][A-Za-z0-9.-]{5,}[A-Za-z0-9])/i,
        /\bNo\.?\s*(?:de\s+)?transaction\s*[:.]?\s*([A-Za-z0-9][A-Za-z0-9.-]{5,}[A-Za-z0-9])/i,
        /\bID\s+(?:de\s+)?transaction\s*[:.]?\s*([0-9]{8,})/i,
        /\b(?:Transaction|Trans)\s*[:.]?\s*([0-9]{8,})/i,
        /\b(?:Reference|Référence|Ref|Réf)\s*[:.]?\s*([A-Z0-9.-]{6,})/i
    ];

    for (const pattern of patterns) {
        const match = original.match(pattern);
        if (match) {
            let id = match[1].toUpperCase().trim();
            id = id.replace(/\.(TOUS|Tous)$/i, "");
            id = id.endsWith(".") ? id.slice(0, -1) : id;
            return id;
        }
    }

    return "";
}

function detectType(message, reference, operator) {
    const lower = normalizeText(message);
    const hasRef = Boolean(reference);
    const hasId = /(?:id transaction|trx id|transactionid|transid|trxid)/i.test(lower);
    const moovNumber = /01\d{8}/.test(lower);
    const mtnNumber = /05\d{8}/.test(lower);

    if (
        hasId &&
        (lower.includes("compte mobile") ||
         lower.includes("vous avez recu") ||
         lower.includes("vous avez reçu")) &&
        !lower.includes("compte marchand") &&
        !hasRef &&
        !mtnNumber
    ) return "Bonus";

    // Les verbes d'opération explicites sont prioritaires sur la présence
    // d'une simple référence.
    if (
        lower.includes("retrait") ||
        lower.includes("vous avez retiré") ||
        lower.includes("vous avez retire") ||
        lower.includes("cash out initiated") ||
        lower.includes("cash out")
    ) return "Retrait";

    if (
        (hasRef || hasId) &&
        (
            lower.includes("compte marchand") ||
            lower.includes("vous avez recu") ||
            lower.includes("vous avez reçu")
        )
    ) return "Recharge";

    if (
        (hasRef || hasId) &&
        (
            lower.includes("vous avez transfere") ||
            lower.includes("vous avez transféré") ||
            lower.includes("le transfert")
        )
    ) return "U.V en espèce";

    if (
        lower.includes("recharge prépayée") ||
        lower.includes("recharge prepaye") ||
        lower.includes("total general") ||
        lower.includes("total général") ||
        lower.includes("compteur") ||
        lower.includes("facture") ||
        lower.includes("electricite") ||
        lower.includes("électricité")
    ) return "Paiement facture";

    if (
        lower.includes("vous avez envoyé") ||
        lower.includes("vous avez envoye") ||
        lower.includes("depot") ||
        lower.includes("dépôt")
    ) return "Dépôt";

    if (lower.includes("transfert international")) {
        return "Transf. International";
    }

    if (
        lower.includes("achat groupe de") ||
        lower.includes("bundlebypos") ||
        lower.includes("credit de communication") ||
        lower.includes("recharge de") ||
        (lower.includes("credit") && lower.includes("via"))
    ) return "Transfère Unité";

    if (
        (hasRef || hasId) &&
        moovNumber &&
        lower.includes("transfert")
    ) return "Transfère Unité";

    if (
        moovNumber &&
        !hasId &&
        !hasRef &&
        (
            lower.includes("offert") ||
            lower.includes("forfait") ||
            lower.includes("internet") ||
            lower.includes("data") ||
            lower.includes("appel") ||
            lower.includes("etoile")
        )
    ) return "Transfère Unité";

    return "Autre";
}

function scoreMessage(message, parsed) {
    const original = String(message || "");
    const lower = normalizeText(original);

    const promotions = PROMOTION_PATTERNS.filter(p => p.test(original));
    const transactions = TRANSACTION_PATTERNS.filter(p => p.test(original));

    let score = 0;

    score += transactions.length * 2;

    if (parsed.amount.value > 0) score += 4;
    if (parsed.reference) score += 4;
    if (parsed.operator !== "Inconnu") score += 2;
    if (parsed.type !== "Autre") score += 3;

    score -= promotions.length * 5;

    // Les messages contenant explicitement une opération sont prioritaires.
    if (
        /vous\s+avez\s+(?:envoy[eé]|re[cç]u|retir[eé]|transf[eé]r[eé])/i.test(lower)
    ) score += 4;

    return {
        score,
        promotionHits: promotions.length,
        transactionHits: transactions.length
    };
}

function classifyMessage(message) {
    const text = String(message || "").trim();

    if (!text) {
        return {
            isTransaction: false,
            confidence: 1,
            reason: "Message vide",
            amount: extractAmount(""),
            operator: "Inconnu",
            type: "Autre",
            reference: ""
        };
    }

    const amount = extractAmount(text);
    const operator = detectOperator(text);
    const reference = extractReference(text);
    const type = detectType(text, reference, operator);

    const scoreInfo = scoreMessage(text, {
        amount,
        operator,
        type,
        reference
    });

    // Une promotion explicite sans preuve transactionnelle est rejetée.
    if (
        scoreInfo.promotionHits > 0 &&
        scoreInfo.transactionHits < 2 &&
        !reference &&
        amount.value <= 0
    ) {
        return {
            isTransaction: false,
            confidence: 0.98,
            reason: "Message promotionnel ou système",
            amount,
            operator,
            type,
            reference,
            score: scoreInfo.score
        };
    }

    const strongEvidence =
        Boolean(reference) ||
        (
            amount.value > 0 &&
            operator !== "Inconnu" &&
            type !== "Autre"
        );

    const transaction =
        amount.value > 0 &&
        (
            strongEvidence ||
            scoreInfo.score >= 8
        );

    let reason = "Transaction non confirmée";

    if (transaction) {
        reason = strongEvidence
            ? "Transaction confirmée par plusieurs indices"
            : "Transaction détectée par score";
    } else if (scoreInfo.promotionHits > 0) {
        reason = "Promotion / message système";
    } else if (amount.value <= 0) {
        reason = "Montant transactionnel introuvable";
    } else {
        reason = "Informations transactionnelles insuffisantes";
    }

    const confidence = Math.max(
        0.05,
        Math.min(
            0.99,
            transaction
                ? 0.65 + Math.min(scoreInfo.score, 12) * 0.025
                : 0.25 + Math.min(scoreInfo.promotionHits, 4) * 0.1
        )
    );

    return {
        isTransaction: transaction,
        confidence,
        reason,
        amount,
        operator,
        type,
        reference,
        score: scoreInfo.score
    };
}

module.exports = {
    classifyMessage,
    extractAmount,
    extractReference,
    detectOperator,
    detectType,
    normalizeText,
    OPERATORS
};
