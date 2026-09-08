#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const glob = require("glob");

const { collectReferencedAssetPaths } = require("./sri-rehash.cjs");

const SCRIPT_DIR = __dirname;
const ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_INTERVAL_MS = 1000;
const ASSET_EXTENSIONS = new Set([".css", ".js", ".mjs", ".cjs"]);
const WATCH_DIRS = ["style", "js"];
const STATUS_PREFIX = "[sri:watch]";

function printUsage() {
  console.log(`Usage: ${path.basename(process.argv[1])} [--root PATH] [--interval MS]

Watch local CSS/JS assets and re-run the SRI rehash apply pass when they change.

Options:
  --root PATH      Repository root to watch. Defaults to the repo root.
  --interval MS    Polling interval in milliseconds. Defaults to 1000.
  --help          Show this help.
`);
}

function parseArgs(argv) {
  const args = {
    intervalMs: DEFAULT_INTERVAL_MS,
    root: ROOT,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") {
      i += 1;
      if (i >= argv.length) throw new Error("--root requires a path");
      args.root = path.resolve(argv[i]);
      continue;
    }
    if (arg === "--interval") {
      i += 1;
      if (i >= argv.length) throw new Error("--interval requires a value");
      const interval = Number(argv[i]);
      if (!Number.isFinite(interval) || interval < 250) {
        throw new Error("--interval must be a number >= 250");
      }
      args.intervalMs = Math.floor(interval);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return args;
}

function shouldIgnoreDir(name) {
  return (
    name === ".git" ||
    name === "node_modules" ||
    name === ".playwright-cli" ||
    name === ".sto"
  );
}

function collectAssetState(root) {
  const files = new Map();

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (shouldIgnoreDir(entry.name)) continue;

      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }

      if (!ASSET_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }

      const stat = fs.statSync(full);
      const rel = path.relative(root, full).split(path.sep).join("/");
      files.set(rel, `${stat.mtimeMs}:${stat.size}`);
    }
  }

  for (const dirName of WATCH_DIRS) {
    const fullDir = path.join(root, dirName);
    if (fs.existsSync(fullDir) && fs.statSync(fullDir).isDirectory()) {
      walk(fullDir);
    }
  }
  return files;
}

function readHtmlTargets(root) {
  return glob.sync("**/*.{html,htm}", {
    absolute: true,
    cwd: root,
    dot: true,
    ignore: [
      "**/.git/**",
      "**/node_modules/**",
      "**/.playwright-cli/**",
      "**/.sto/**",
      "**/*.BAK",
    ],
  });
}

function collectHtmlTargets(root, assetAbsPath, htmlFiles) {
  const matches = [];

  for (const file of htmlFiles) {
    const source = fs.readFileSync(file, "utf8");
    const references = collectReferencedAssetPaths(source, file, root);
    if (references.has(assetAbsPath)) {
      matches.push(file);
    }
  }

  return matches;
}

function summarizeTargets(files, root) {
  const rel = files.map((file) => path.relative(root, file)).sort();
  if (rel.length === 0) {
    return "none";
  }
  if (rel.length <= 5) {
    return rel.join(", ");
  }
  return `${rel.slice(0, 5).join(", ")} ... (+${rel.length - 5} more)`;
}

function printStatus(label, detail = "") {
  const suffix = detail ? ` ${detail}` : "";
  console.log(`${STATUS_PREFIX} [${label}]${suffix}`);
}

function runRehashForFiles(root, files) {
  if (files.length === 0) {
    return;
  }

  const result = cp.spawnSync(
    process.execPath,
    [path.join(SCRIPT_DIR, "sri-rehash.cjs"), "--apply", "--root", root, ...files],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0) {
    throw new Error(`sri-rehash exited with status ${result.status ?? "unknown"}`);
  }
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    return 2;
  }

  if (args.help) {
    printUsage();
    return 0;
  }

  let lastState = null;
  let running = false;
  let pending = false;
  let stopping = false;
  let queuedAssets = new Set();
  const htmlFiles = readHtmlTargets(args.root);

  function scheduleRun(reason, changedAssets = []) {
    if (stopping) return;
    for (const asset of changedAssets) {
      queuedAssets.add(asset);
    }
    if (running) {
      pending = true;
      return;
    }

    running = true;
    const assetsToProcess = [...queuedAssets];
    queuedAssets = new Set();
    printStatus("REHASHING", `after ${reason}`);

    try {
      printStatus("SCANNING", `assets: ${assetsToProcess.join(", ")}`);
      const htmlTargets = new Set();
      for (const assetRelPath of assetsToProcess) {
        const assetAbsPath = path.resolve(args.root, assetRelPath);
        for (const file of collectHtmlTargets(args.root, assetAbsPath, htmlFiles)) {
          htmlTargets.add(file);
        }
      }

      if (htmlTargets.size === 0) {
        printStatus("IDLE", "no matching HTML targets found");
      } else {
        printStatus("SCANNING", `html: ${summarizeTargets([...htmlTargets], args.root)}`);
        runRehashForFiles(args.root, [...htmlTargets]);
      }
    } catch (error) {
      console.error(`[sri:watch] ${error.message}`);
    } finally {
      running = false;
    }

    if (pending && !stopping) {
      pending = false;
      scheduleRun("queued changes");
    }
  }

  function poll() {
    if (stopping) return;

    let nextState;
    try {
      nextState = collectAssetState(args.root);
    } catch (error) {
      console.error(`[sri:watch] failed to scan assets: ${error.message}`);
      return;
    }

    if (lastState === null) {
      lastState = nextState;
      scheduleRun("startup", [...nextState.keys()]);
      return;
    }

    const changedAssets = [];
    for (const [asset, fingerprint] of nextState.entries()) {
      if (lastState.get(asset) !== fingerprint) {
        changedAssets.push(asset);
      }
    }
    for (const asset of lastState.keys()) {
      if (!nextState.has(asset)) {
        changedAssets.push(asset);
      }
    }

    if (changedAssets.length > 0) {
      lastState = nextState;
      scheduleRun("asset change", changedAssets);
    }
  }

  console.log(`[sri:watch] root=${args.root}`);
  console.log(`[sri:watch] interval=${args.intervalMs}ms`);
  lastState = collectAssetState(args.root);
  scheduleRun("startup", [...lastState.keys()]);
  printStatus("IDLE", "ready");

  const timer = setInterval(poll, args.intervalMs);

  const stop = () => {
    stopping = true;
    clearInterval(timer);
    process.exit(0);
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}
