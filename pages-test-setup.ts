import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function setup(): Promise<void> {
  const result = spawnSync(
    "npx",
    ["wrangler", "pages", "functions", "build", "--outdir", "dist-functions"],
    { cwd: __dirname, stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error(
      `pages-test-setup: wrangler pages functions build exited with code ${result.status}`,
    );
  }
}

export async function teardown(): Promise<void> {}
