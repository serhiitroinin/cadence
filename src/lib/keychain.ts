import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Keychain access goes through the Apple-signed `/usr/bin/security` tool. Because
// that reader has a stable code signature, macOS's "Always Allow" persists — unlike
// an ad-hoc-signed compiled binary, which would re-prompt on every run.
const run = promisify(execFile);
const SERVICE = "cadence";

export async function setSecret(account: string, value: string): Promise<void> {
  // Recreate the item so its ACL trusts /usr/bin/security, keeping reads prompt-free.
  try { await run("security", ["delete-generic-password", "-s", SERVICE, "-a", account]); } catch {}
  await run("security", ["add-generic-password", "-s", SERVICE, "-a", account, "-w", value]);
}

export async function getSecret(account: string): Promise<string | null> {
  try {
    const { stdout } = await run("security", ["find-generic-password", "-s", SERVICE, "-a", account, "-w"]);
    return stdout.replace(/\n$/, "") || null;
  } catch {
    return null;
  }
}

export async function requireSecret(account: string): Promise<string> {
  const value = await getSecret(account);
  if (value === null) {
    throw new Error(`No secret found in Keychain for account "${account}". Run: ${SERVICE} login`);
  }
  return value;
}

export async function deleteSecret(account: string): Promise<boolean> {
  try {
    await run("security", ["delete-generic-password", "-s", SERVICE, "-a", account]);
    return true;
  } catch {
    return false;
  }
}

export async function hasSecret(account: string): Promise<boolean> {
  return (await getSecret(account)) !== null;
}
