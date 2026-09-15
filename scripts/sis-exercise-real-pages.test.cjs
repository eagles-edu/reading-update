const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");

function contentType(file) {
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

async function startRealPageServer() {
  const server = http.createServer(function (request, response) {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    if (pathname === "/favicon.ico" || pathname === "/reading/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    const relative = pathname.replace(/^\/+/, "");
    const file = path.resolve(ROOT, relative || "index.html");
    if (!file.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": contentType(file) });
    response.end(fs.readFileSync(file));
  });
  await new Promise(function (resolve) {
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: function () {
      return new Promise(function (resolve, reject) {
        server.close(function (error) {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

function findSystemBrowser() {
  return [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].find(function (candidate) {
    return candidate && fs.existsSync(candidate);
  });
}

const families = [
  { family: "cloze", page: "/begin1/cloze/b1cloze001.html", checkSelector: "#check", hintSelector: "#hint" },
  { family: "dict", page: "/begin1/dict/b1d001.html", checkSelector: '[onclick*="CheckShortAnswer"]', hintSelector: '[onclick*="ShowHint"]' },
  { family: "sent", page: "/begin1/sent/b1mx00101.html", checkSelector: '[onclick*="CheckAnswer(0)"]', hintSelector: '[onclick*="CheckAnswer(1)"]' },
  { family: "cloze", page: "/begin2/cloze/b2cloze001.html", checkSelector: "#check", hintSelector: "#hint" },
  { family: "dict", page: "/begin2/dict/b2d001.html", checkSelector: '[onclick*="CheckShortAnswer"]', hintSelector: '[onclick*="ShowHint"]' },
  { family: "sent", page: "/begin2/sent/b2mx00101.html", checkSelector: '[onclick*="CheckAnswer(0)"]', hintSelector: '[onclick*="CheckAnswer(1)"]' },
];

test("actual B1 and B2 family pages meet canonical shell, identity, control, and feedback requirements", async (context) => {
  const server = await startRealPageServer();
  const browser = await chromium.launch({
    ...(findSystemBrowser() ? { executablePath: findSystemBrowser() } : {}),
    headless: true,
  });
  context.after(async function () {
    await browser.close();
    await server.close();
  });

  for (const fixture of families) {
    const pageErrors = [];
    const consoleProblems = [];
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on("pageerror", function (error) {
      pageErrors.push(error.message);
    });
    page.on("console", function (message) {
      if (message.type() === "error" || message.type() === "warning") {
        const location = message.location();
        consoleProblems.push(`${message.type()}: ${message.text()} at ${location.url || "unknown"}`);
      }
    });
    page.on("response", function (response) {
      if (response.status() >= 400) {
        consoleProblems.push(`HTTP ${response.status()}: ${response.url()}`);
      }
    });
    await page.goto(server.origin + fixture.page, { waitUntil: "load" });
    await page.evaluate(function () {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: "load" });

    const evidence = await page.evaluate(function (family) {
      const shell = document.querySelector("body#TheBody > [data-sis-exercise-shell].hp-exercise-shell.wrapfit");
      const title = document.querySelector(".hp-instructions-panel > .Titles > h1.ExerciseTitle");
      const submit = document.querySelector("[data-sis-cloze-submit], [data-sis-exercise-submit]");
      const close = document.querySelector(".btn-74");
      const activeButtons = [...document.querySelectorAll("button, input[type=button], input[type=submit], input[type=reset]")]
        .filter((control) => !control.classList.contains("btn-74"));
      return {
        shell: Boolean(shell),
        legacyShell: Boolean(document.querySelector("body#TheBody > .wrapit, body#TheBody > .exercise-wrapper")),
        titleInsidePanel: Boolean(title),
        identityEmail: Boolean(document.querySelector("[data-sis-identity-email]")),
        identityEaglesId: Boolean(document.querySelector("[data-sis-identity-eagles-id]")),
        identityStatus: Boolean(document.querySelector("[data-sis-identity-status]")),
        identityInstruction: document.querySelector(".sis-cloze-panel__instruction")?.textContent.trim() || "",
        submitDisabled: Boolean(submit && submit.disabled),
        submitInline: Boolean(submit && submit.closest(family === "cloze" ? ".btn17Container" : family === "dict" ? '[aria-label="Dictation question controls"]' : ".sis-exercise-controls")),
        closeSeparate: Boolean(close && !close.classList.contains("btn-17")),
        animatedActions: activeButtons.length > 0 && activeButtons.every((control) => control.classList.contains("btn-17") && control.classList.contains("hp-button")),
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        emptyGuessHidden: family !== "sent" || !document.getElementById("GuessDiv") || document.getElementById("GuessDiv").classList.contains("hp-display-none"),
      };
    }, fixture.family);
    assert.deepEqual(evidence, {
      shell: true,
      legacyShell: false,
      titleInsidePanel: true,
      identityEmail: true,
      identityEaglesId: true,
      identityStatus: true,
      identityInstruction: "Enter your EaglesID and student email to activate Check and Hint.",
      submitDisabled: true,
      submitInline: true,
      closeSeparate: true,
      animatedActions: true,
      noHorizontalOverflow: true,
      emptyGuessHidden: true,
    });

    const check = page.locator(fixture.checkSelector).first();
    const hint = page.locator(fixture.hintSelector).first();
    assert.equal(await check.isDisabled(), true);
    assert.equal(await hint.isDisabled(), true);
    await page.locator("[data-sis-identity-email]").fill("student@example.org");
    await page.locator("[data-sis-identity-eagles-id]").fill("b001");
    assert.equal(await check.isDisabled(), false);
    assert.equal(await hint.isDisabled(), false);
    assert.equal(pageErrors.length, 0, `${fixture.family} page errors: ${pageErrors.join(" | ")}`);
    assert.equal(consoleProblems.length, 0, `${fixture.family} console: ${consoleProblems.join(" | ")}`);
    await page.close();
  }
});
