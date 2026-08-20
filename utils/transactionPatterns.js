// Trackzo V1 - règles locales de classification.
// Aucun appel IA payant : le moteur combine signaux transactionnels,
// signaux promotionnels, extraction structurée et score de confiance.

const PROMOTION_PATTERNS = [
    /objectif\s+(?:pour|de)\s+.*(?:p[eé]riode|pdv)/i,
    /votre\s+objectif/i,
    /promo(?:tion)?/i,
    /offre\s+(?:sp[eé]ciale|exclusive|du\s+moment)/i,
    /bon\s+plan/i,
    /f[eé]licitations?|bravo/i,
    /gagnant(?:e)?/i,
    /cadeau/i,
    /remise/i,
    /solde\s+de\s+votre\s+compte/i,
    /cher(?:e)?\s+(?:client|partenaire|agent)/i,
    /agent(?:e)?\s+(?:cher|ch[eè]re)/i,
    /payez?\s+en\s+ligne/i,
    /recharge.*via.*lien/i,
    /cliquez?\s+(?:ici|sur\s+le\s+lien)/i,
    /lien\s+(?:de\s+recharge|de\s+paiement)/i,
    /gbairai/i
];

const TRANSACTION_PATTERNS = [
    /montant\s*[:\-]?\s*\d/i,
    /(?:reçu|recu|envoy[eé]|transf[eé]r[eé]|d[eé]p[oô]t|retrait|paiement|recharge)/i,
    /(?:id\s+(?:de\s+)?transaction|trx\s*id|trxid|transid|transactionid)/i,
    /(?:r[eé]f[eé]rence|reference|ref)\s*[:.]?\s*[A-Z0-9]/i,
    /(?:total\s+g[eé]n[eé]ral|total)\s*[:\-]?\s*\d/i,
    /(?:orange\s+money|mtn\s*(?:money|momo)?|moov\s+money|wave)/i,
    /(?:compteur|facture|[eé]lectricit[eé]|recharge\s+pr[eé]pay[eé]e)/i,
    /(?:cash\s*out|cash\s+in|mobile\s+money)/i
];

module.exports = {
    PROMOTION_PATTERNS,
    TRANSACTION_PATTERNS
};
