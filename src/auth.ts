/**
 * Garmin Connect authentication — SSO login + OAuth1/OAuth2 token management.
 * Implements the full flow from scratch with zero external auth dependencies.
 */
import { createHmac, randomBytes } from "node:crypto";
import { getSecret, setSecret, requireSecret } from "./lib/keychain.ts";

const GARMIN_DOMAIN = "garmin.com";
const SSO_ORIGIN = `https://sso.${GARMIN_DOMAIN}`;
const CONNECT_API = `https://connectapi.${GARMIN_DOMAIN}`;
const GC_MODERN = `https://connect.${GARMIN_DOMAIN}/modern`;
const CONSUMER_URL = "https://thegarth.s3.amazonaws.com/oauth_consumer.json";

const UA = "com.garmin.android.apps.connectmobile";

// ── OAuth1 HMAC-SHA1 signing ─────────────────────────────────────

function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function oauth1Header(
  method: string,
  url: string,
  consumerKey: string,
  consumerSecret: string,
  token: string,
  tokenSecret: string,
  extraParams?: Record<string, string>,
): string {
  const nonce = randomBytes(16).toString("hex");
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: token,
    oauth_version: "1.0",
  };

  const allParams: Record<string, string> = { ...oauthParams, ...(extraParams ?? {}) };
  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys
    .map((k) => `${percentEncode(k)}=${percentEncode(allParams[k]!)}`)
    .join("&");

  const baseString = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  const signature = createHmac("sha1", signingKey).update(baseString).digest("base64");

  oauthParams.oauth_signature = signature;

  const headerParts = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k]!)}"`)
    .join(", ");

  return `OAuth ${headerParts}`;
}

function oauth1HeaderNoToken(
  method: string,
  url: string,
  consumerKey: string,
  consumerSecret: string,
  extraParams?: Record<string, string>,
): string {
  const nonce = randomBytes(16).toString("hex");
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_version: "1.0",
  };

  const allParams: Record<string, string> = { ...oauthParams, ...(extraParams ?? {}) };
  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys
    .map((k) => `${percentEncode(k)}=${percentEncode(allParams[k]!)}`)
    .join("&");

  const baseString = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(consumerSecret)}&`;
  const signature = createHmac("sha1", signingKey).update(baseString).digest("base64");

  oauthParams.oauth_signature = signature;

  const headerParts = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k]!)}"`)
    .join(", ");

  return `OAuth ${headerParts}`;
}

// ── Consumer credentials ─────────────────────────────────────────

interface Consumer {
  consumer_key: string;
  consumer_secret: string;
}

async function getConsumer(): Promise<Consumer> {
  const cached = await getSecret("consumer-key");
  if (cached) {
    return {
      consumer_key: cached,
      consumer_secret: await requireSecret("consumer-secret"),
    };
  }

  const res = await fetch(CONSUMER_URL);
  if (!res.ok) throw new Error(`Failed to fetch consumer credentials: ${res.status}`);
  const consumer = (await res.json()) as Consumer;

  await setSecret("consumer-key", consumer.consumer_key);
  await setSecret("consumer-secret", consumer.consumer_secret);

  return consumer;
}

// ── SSO Login flow ───────────────────────────────────────────────

export async function login(email: string, password: string): Promise<void> {
  const consumer = await getConsumer();

  // Step 1: Get SSO cookies
  const embedUrl = `${SSO_ORIGIN}/sso/embed?clientId=GarminConnect&locale=en&service=${encodeURIComponent(GC_MODERN)}`;
  const embedRes = await fetch(embedUrl, {
    headers: { "User-Agent": UA },
    redirect: "manual",
  });
  const cookies = extractCookies(embedRes);

  // Step 2: Get CSRF token
  const signinParams = new URLSearchParams({
    id: "gauth-widget",
    embedWidget: "true",
    clientId: "GarminConnect",
    locale: "en",
    service: GC_MODERN,
  });
  const csrfRes = await fetch(`${SSO_ORIGIN}/sso/signin?${signinParams}`, {
    headers: { "User-Agent": UA, Cookie: cookies },
  });
  const csrfHtml = await csrfRes.text();
  const csrfMatch = csrfHtml.match(/name="_csrf"\s+value="(.+?)"/);
  if (!csrfMatch) throw new Error("Could not extract CSRF token from SSO page");
  const csrf = csrfMatch[1]!;
  const allCookies = mergeCookies(cookies, extractCookies(csrfRes));

  // Step 3: Submit credentials
  const loginBody = new URLSearchParams({
    username: email,
    password: password,
    embed: "true",
    _csrf: csrf,
  });
  const loginRes = await fetch(`${SSO_ORIGIN}/sso/signin?${signinParams}`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: allCookies,
    },
    body: loginBody.toString(),
    redirect: "manual",
  });
  const loginHtml = await loginRes.text();

  if (loginHtml.includes("locked")) {
    throw new Error("Account is locked. Try logging in via web browser first.");
  }

  const ticketMatch = loginHtml.match(/ticket=([^"&\s]+)/);
  if (!ticketMatch) {
    if (loginHtml.includes("MFA")) {
      throw new Error("MFA is enabled. Please disable MFA or use the web browser to log in, then import tokens.");
    }
    throw new Error("Login failed: could not extract ticket. Check credentials.");
  }
  const ticket = ticketMatch[1]!;

  // Step 4: Exchange ticket for OAuth1 token
  const oauth1Url = `${CONNECT_API}/oauth-service/oauth/preauthorized`;
  const authHeader = oauth1HeaderNoToken(
    "GET",
    oauth1Url,
    consumer.consumer_key,
    consumer.consumer_secret,
    { ticket },
  );

  const oauth1Res = await fetch(`${oauth1Url}?ticket=${encodeURIComponent(ticket)}`, {
    headers: {
      "User-Agent": UA,
      Authorization: authHeader,
    },
  });
  if (!oauth1Res.ok) {
    throw new Error(`OAuth1 exchange failed: ${oauth1Res.status} ${await oauth1Res.text()}`);
  }

  const oauth1Text = await oauth1Res.text();
  const oauth1Params = new URLSearchParams(oauth1Text);
  const oauthToken = oauth1Params.get("oauth_token");
  const oauthTokenSecret = oauth1Params.get("oauth_token_secret");
  if (!oauthToken || !oauthTokenSecret) {
    throw new Error("Failed to extract OAuth1 tokens from response");
  }

  await setSecret("oauth1-token", oauthToken);
  await setSecret("oauth1-secret", oauthTokenSecret);

  // Step 5: Exchange OAuth1 for OAuth2
  await exchangeOAuth2(consumer, oauthToken, oauthTokenSecret);

  console.log("Login successful! Tokens saved to Keychain.");
}

// ── OAuth2 exchange ──────────────────────────────────────────────

async function exchangeOAuth2(
  consumer: Consumer,
  oauthToken: string,
  oauthTokenSecret: string,
): Promise<void> {
  const exchangeUrl = `${CONNECT_API}/oauth-service/oauth/exchange/user/2.0`;
  const authHeader = oauth1Header(
    "POST",
    exchangeUrl,
    consumer.consumer_key,
    consumer.consumer_secret,
    oauthToken,
    oauthTokenSecret,
  );

  const res = await fetch(exchangeUrl, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Authorization: authHeader,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (!res.ok) {
    throw new Error(`OAuth2 exchange failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    refresh_token_expires_in: number;
  };

  const now = Math.floor(Date.now() / 1000);
  await setSecret("access-token", data.access_token);
  await setSecret("refresh-token", data.refresh_token);
  await setSecret("expires-at", String(now + data.expires_in - 60));
  await setSecret("refresh-expires-at", String(now + data.refresh_token_expires_in - 60));
}

// ── Token management ─────────────────────────────────────────────

export async function getValidAccessToken(): Promise<string> {
  const accessToken = await getSecret("access-token");
  if (!accessToken) throw new Error("Not logged in. Run: cadence login");

  const expiresAt = parseInt(await getSecret("expires-at") ?? "0", 10);
  const now = Math.floor(Date.now() / 1000);

  if (now < expiresAt) {
    return accessToken;
  }

  const oauth1Token = await getSecret("oauth1-token");
  const oauth1Secret = await getSecret("oauth1-secret");
  if (!oauth1Token || !oauth1Secret) {
    throw new Error("OAuth1 tokens missing. Run: cadence login");
  }

  const refreshExpiresAt = parseInt(await getSecret("refresh-expires-at") ?? "0", 10);
  if (now >= refreshExpiresAt) {
    throw new Error("Refresh token expired. Run: cadence login");
  }

  const consumer = await getConsumer();
  await exchangeOAuth2(consumer, oauth1Token, oauth1Secret);

  return await requireSecret("access-token");
}

// ── Import tokens from garth/garmy ───────────────────────────────

export async function importTokens(dir: string): Promise<void> {
  const fs = require("fs");
  const path = require("path");

  const oauth1Path = path.join(dir, "oauth1_token.json");
  const oauth2Path = path.join(dir, "oauth2_token.json");

  if (!fs.existsSync(oauth1Path)) throw new Error(`Not found: ${oauth1Path}`);
  if (!fs.existsSync(oauth2Path)) throw new Error(`Not found: ${oauth2Path}`);

  const oauth1 = JSON.parse(fs.readFileSync(oauth1Path, "utf-8"));
  const oauth2 = JSON.parse(fs.readFileSync(oauth2Path, "utf-8"));

  await setSecret("oauth1-token", oauth1.oauth_token);
  await setSecret("oauth1-secret", oauth1.oauth_token_secret);
  await setSecret("access-token", oauth2.access_token);
  await setSecret("refresh-token", oauth2.refresh_token);
  await setSecret("expires-at", String(oauth2.expires_at));
  await setSecret("refresh-expires-at", String(oauth2.refresh_token_expires_at));

  console.log("Tokens imported to Keychain from", dir);
}

// ── Cookie helpers ───────────────────────────────────────────────

function extractCookies(res: Response): string {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  return setCookies.map((c) => c.split(";")[0]).join("; ");
}

function mergeCookies(existing: string, fresh: string): string {
  if (!existing) return fresh;
  if (!fresh) return existing;
  return `${existing}; ${fresh}`;
}
