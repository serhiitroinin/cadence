import { execFileSync } from "node:child_process";

const SERVICE = "cadence";

export function setSecret(account: string, value: string): void {
  try {
    // Pass the secret via argv (-w value): macOS `security` reading the password from
    // a stdin/tty prompt truncates at ~128 chars, which silently corrupts OAuth tokens.
    execFileSync("security", [
      "add-generic-password", "-s", SERVICE, "-a", account, "-w", value, "-U",
    ], { stdio: "pipe" });
  } catch (e: unknown) {
    throw new Error(
      `Failed to store secret in Keychain (account=${account}): ${(e as Error).message}`
    );
  }
}

export function getSecret(account: string): string | null {
  try {
    const result = execFileSync("security", [
      "find-generic-password", "-s", SERVICE, "-a", account, "-w",
    ], { stdio: "pipe", encoding: "utf-8" });
    return result.trim();
  } catch {
    return null;
  }
}

export function requireSecret(account: string): string {
  const value = getSecret(account);
  if (value === null) {
    throw new Error(
      `No secret found in Keychain for account "${account}". Run: ${SERVICE} login`
    );
  }
  return value;
}

export function deleteSecret(account: string): boolean {
  try {
    execFileSync("security", [
      "delete-generic-password", "-s", SERVICE, "-a", account,
    ], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function hasSecret(account: string): boolean {
  return getSecret(account) !== null;
}
