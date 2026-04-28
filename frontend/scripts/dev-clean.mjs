import { spawn, execFileSync } from "node:child_process";
import { join } from "node:path";
import process from "node:process";

const port = process.env.PORT ?? "3000";
const forwardedArgs = process.argv.slice(2);
const nextBin = join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "next.cmd" : "next",
);

function findPidsUsingPort(targetPort) {
  try {
    const output = execFileSync("lsof", ["-ti", `tcp:${targetPort}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (!output) {
      return [];
    }

    return [...new Set(output.split(/\s+/).filter(Boolean))];
  } catch (error) {
    if (typeof error === "object" && error && "status" in error && error.status === 1) {
      return [];
    }

    throw error;
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function stopProcesses(pids) {
  const numericPids = pids
    .map((pid) => Number(pid))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);

  for (const pid of numericPids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }

  await wait(500);

  for (const pid of numericPids) {
    if (!isAlive(pid)) {
      continue;
    }

    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
}

async function main() {
  await stopProcesses(findPidsUsingPort(port));

  const child = spawn(nextBin, ["dev", "--turbopack", ...forwardedArgs], {
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
