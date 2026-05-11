/**
 * Runs cloudflared quick tunnel to localhost:8787 and writes public URLs to config files.
 * Prereq: cloudflared installed (https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/)
 * Usage: in one terminal `npm run dev`, in another `npm run tunnel`
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const publicData = join(root, "public", "data");
const rootData = join(root, "data");

const PORT = process.env.PORT || "8787";
const TARGET = `http://127.0.0.1:${PORT}`;

mkdirSync(publicData, { recursive: true });
mkdirSync(rootData, { recursive: true });

function mergePublicUrl(url) {
  const base = url.replace(/\/+$/, "");
  const pubPath = join(publicData, "config.json");
  const dataPath = join(rootData, "config.json");
  let pub = {};
  if (existsSync(pubPath)) {
    try {
      pub = JSON.parse(readFileSync(pubPath, "utf8"));
    } catch {
      /* ignore */
    }
  }
  pub.publicBaseUrl = base;
  writeFileSync(pubPath, JSON.stringify(pub, null, 2) + "\n", "utf8");
  writeFileSync(dataPath, JSON.stringify(pub, null, 2) + "\n", "utf8");
  console.log("Wrote publicBaseUrl to", pubPath);
  console.log("Wrote publicBaseUrl to", dataPath);
}

const child = spawn("cloudflared", ["tunnel", "--url", TARGET], {
  stdio: ["ignore", "pipe", "inherit"],
  shell: process.platform === "win32",
});

const re = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/gi;

child.stdout.on("data", (chunk) => {
  const text = chunk.toString("utf8");
  process.stdout.write(text);
  const m = text.match(re);
  if (m && m[0]) mergePublicUrl(m[0]);
});

child.on("exit", (code) => process.exit(code ?? 0));
