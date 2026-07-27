export function readLocalSetting(key: string): string | null {
  try {
    return window.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeLocalSetting(key: string, value: string): void {
  try {
    window.localStorage?.setItem(key, value);
  } catch {
    // SQLite remains the source of truth when web storage is unavailable.
  }
}

export function removeLocalSetting(key: string): void {
  try {
    window.localStorage?.removeItem(key);
  } catch {
    // A restricted webview may deny local storage; there is nothing to remove.
  }
}
