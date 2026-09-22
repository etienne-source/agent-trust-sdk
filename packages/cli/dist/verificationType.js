export function parseVerificationType(value) {
    if (!value || value === "SSL_CHALLENGE")
        return "SSL_CHALLENGE";
    if (value === "DNS_TXT")
        return "DNS_TXT";
    throw new Error("verification type must be SSL_CHALLENGE or DNS_TXT");
}
//# sourceMappingURL=verificationType.js.map