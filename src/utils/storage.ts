import fs from "fs";
const PATH = "./.bot-state.json";

type State = {
    sniped: Record<string, {
        txHash: string;
        timestamp: number;
        status: "pending" | "sold" | "failed";
    }>;
};

let state: State = { sniped: {} };

// Load from disk on startup
if (fs.existsSync(PATH)) {
    try {
        const raw = fs.readFileSync(PATH, "utf-8");
        state = JSON.parse(raw);
    } catch (e) {
        console.warn("⚠️ Failed to load saved state:", e);
    }
}

// Save to disk
function persist() {
    fs.writeFileSync(PATH, JSON.stringify(state, null, 2));
}

export function markSniped(token: string, txHash: string) {
    state.sniped[token.toLowerCase()] = {
        txHash,
        timestamp: Date.now(),
        status: "pending"
    };
    persist();
}

export function updateTokenStatus(token: string, status: "sold" | "failed") {
    if (state.sniped[token.toLowerCase()]) {
        state.sniped[token.toLowerCase()].status = status;
        persist();
    }
}

export function isAlreadySniped(token: string): boolean {
    return !!state.sniped[token.toLowerCase()];
}

export function getState(): State {
    return state;
}

export function flushState(): void {
    persist();
}
