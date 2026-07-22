import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";

const STORE_DIR = join(homedir(), ".clipdetector-notifier");
const VODS_FILE = join(STORE_DIR, "vods.json");
const TOKENS_FILE = join(STORE_DIR, "tokens.json");

interface Store {
  knownVodIds: string[];
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string[];
}

function ensureStoreDir(): void {
  if (!existsSync(STORE_DIR)) {
    mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 });
  }
}

function loadStore(): Store {
  ensureStoreDir();
  if (!existsSync(VODS_FILE)) {
    return { knownVodIds: [] };
  }
  try {
    const data = readFileSync(VODS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return { knownVodIds: [] };
  }
}

function saveStore(store: Store): void {
  ensureStoreDir();
  writeFileSync(VODS_FILE, JSON.stringify(store, null, 2));
}

export function isVodKnown(vodId: string): boolean {
  const store = loadStore();
  return store.knownVodIds.includes(vodId);
}

export function markVodAsKnown(vodId: string): void {
  const store = loadStore();
  if (!store.knownVodIds.includes(vodId)) {
    store.knownVodIds.push(vodId);
    saveStore(store);
  }
}

export function getKnownVodIds(): string[] {
  return loadStore().knownVodIds;
}

export function loadTokens(): OAuthTokens | null {
  ensureStoreDir();
  if (!existsSync(TOKENS_FILE)) {
    return null;
  }
  try {
    const data = readFileSync(TOKENS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function saveTokens(tokens: OAuthTokens): void {
  ensureStoreDir();
  writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  chmodSync(TOKENS_FILE, 0o600);
}

export function clearTokens(): void {
  if (existsSync(TOKENS_FILE)) {
    unlinkSync(TOKENS_FILE);
  }
}
