export function parseReviewPayload(text) {
    const trimmed = text.trim();
    if (!trimmed)
        return null;
    try {
        return JSON.parse(trimmed);
    }
    catch {
        const match = trimmed.match(/\{[\s\S]*\}$/);
        if (!match)
            return null;
        try {
            return JSON.parse(match[0]);
        }
        catch {
            return null;
        }
    }
}
export function formatReason(payload, rawFallback) {
    const lines = ["Codex review gate found issues that should be addressed before stopping."];
    if (payload.summary) {
        lines.push("", payload.summary);
    }
    const findings = payload.findings ?? [];
    if (findings.length) {
        lines.push("", "Findings:");
        for (const finding of findings.slice(0, 8)) {
            const location = finding.file
                ? `${finding.file}${finding.line ? `:${finding.line}` : ""}`
                : "";
            const title = finding.title || "Review finding";
            const severity = finding.severity ? `[${finding.severity}] ` : "";
            lines.push(`- ${severity}${title}${location ? ` (${location})` : ""}`);
            if (finding.description)
                lines.push(`  ${finding.description}`);
            if (finding.recommendation)
                lines.push(`  Recommendation: ${finding.recommendation}`);
        }
    }
    else if (rawFallback.trim()) {
        lines.push("", rawFallback.trim().slice(0, 4000));
    }
    const nextSteps = payload.next_steps ?? [];
    if (nextSteps.length) {
        lines.push("", "Next steps:");
        for (const step of nextSteps.slice(0, 5)) {
            lines.push(`- ${step}`);
        }
    }
    return lines.join("\n");
}
