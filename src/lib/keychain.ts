// Credentials are stored in the OS keychain via Bun's native secrets API
// (macOS Keychain through Security.framework) — no secret ever passes through
// argv or a subprocess.

const SERVICE = "cadence";

export async function setSecret(account: string, value: string): Promise<void> {
  await Bun.secrets.set({ service: SERVICE, name: account, value });
}

export async function getSecret(account: string): Promise<string | null> {
  return await Bun.secrets.get({ service: SERVICE, name: account });
}

export async function requireSecret(account: string): Promise<string> {
  const value = await getSecret(account);
  if (value === null) {
    throw new Error(
      `No secret found in Keychain for account "${account}". Run: ${SERVICE} login`
    );
  }
  return value;
}

export async function deleteSecret(account: string): Promise<boolean> {
  return await Bun.secrets.delete({ service: SERVICE, name: account });
}

export async function hasSecret(account: string): Promise<boolean> {
  return (await getSecret(account)) !== null;
}
