const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { execFileSync } = require("node:child_process");

const scriptPath = path.join(__dirname, "normalize-codacy-sarif.cjs");

test("cli rewrites a read-only SARIF file by replacing it atomically", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "normalize-codacy-sarif-"));

  try {
    const sarifPath = path.join(root, "results.sarif");
    fs.writeFileSync(
      sarifPath,
      `${JSON.stringify({
        runs: [
          {
            results: [
              {
                locations: [
                  {
                    physicalLocation: {
                      artifactLocation: {
                        uri: "file:///codacy/docs/R2 Object Storage _new- Admin@eagles.edu.vn's Account _ Cloudflare_files/file.js",
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      })}\n`,
    );
    fs.chmodSync(sarifPath, 0o444);

    execFileSync(process.execPath, [scriptPath, sarifPath], {
      cwd: root,
      env: { ...process.env, GITHUB_WORKSPACE: root },
      stdio: "pipe",
    });

    const normalized = JSON.parse(fs.readFileSync(sarifPath, "utf8"));
    assert.equal(
      normalized.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri,
      "docs/R2%20Object%20Storage%20_new-%20Admin%40eagles.edu.vn%27s%20Account%20_%20Cloudflare_files/file.js",
    );
  } finally {
    const sarifPath = path.join(root, "results.sarif");
    if (fs.existsSync(sarifPath)) {
      fs.chmodSync(sarifPath, 0o644);
    }
    fs.rmSync(root, { force: true, recursive: true });
  }
});
