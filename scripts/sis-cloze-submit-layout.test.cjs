const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const CLOZE_PAGE = "/begin1/cloze/b1cloze001.html";
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".webp": "image/webp",
};

function startRepositoryServer() {
  const server = http.createServer(function (request, response) {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === "/favicon.ico" || pathname === "/reading/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }

    let file;
    try {
      file = path.resolve(ROOT, "." + decodeURIComponent(pathname));
    } catch {
      response.writeHead(400);
      response.end("Bad request");
      return;
    }
    if (
      !file.startsWith(ROOT + path.sep) ||
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile()
    ) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type":
        MIME_TYPES[path.extname(file).toLowerCase()] ||
        "application/octet-stream",
    });
    response.end(fs.readFileSync(file));
  });

  return new Promise(function (resolve) {
    server.listen(0, "127.0.0.1", function () {
      resolve({
        origin: "http://127.0.0.1:" + server.address().port,
        close: function () {
          return new Promise(function (closeResolve, closeReject) {
            server.close(function (error) {
              if (error) closeReject(error);
              else closeResolve();
            });
          });
        },
      });
    });
  });
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

async function readLayout(page) {
  return page.evaluate(function () {
    const shell = document.querySelector(".sis-exercise-content");
    const mainPanel = document.getElementById("MainDiv");
    const controls = mainPanel.querySelector(".btn17Container");
    const submit = document.querySelector("[data-sis-cloze-submit]");
    const close = document.querySelector("[data-hp-close]");
    const footer = close.parentElement;
    const controlButtons = Array.from(controls.children);
    const hintIndex = controlButtons.findIndex(function (button) {
      return button.id === "hint";
    });

    return {
      closeIsLastInFooter: footer.lastElementChild === close,
      footerIsLastInShell: shell.lastElementChild === footer,
      panelToCloseGap:
        close.getBoundingClientRect().top -
        mainPanel.getBoundingClientRect().bottom,
      submitAfterHint:
        controlButtons.indexOf(submit) > hintIndex && hintIndex !== -1,
      submitInControls: controls.contains(submit),
      submitInsidePanel: mainPanel.contains(submit),
      controlOrder: controlButtons.map(function (button) {
        return button.textContent.trim();
      }),
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
}

test("current cloze Submit sits after Hint inside the exercise panel and Close is last, 24px below", async function (context) {
  const server = await startRepositoryServer();
  const browser = await chromium.launch({
    ...(findSystemBrowser() ? { executablePath: findSystemBrowser() } : {}),
    headless: true,
  });
  context.after(async function () {
    await browser.close();
    await server.close();
  });

  const pageErrors = [];
  const consoleErrors = [];
  const page = await browser.newPage({
    viewport: { width: 1350, height: 900 },
  });
  page.on("pageerror", function (error) {
    pageErrors.push(error.message);
  });
  page.on("console", function (message) {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto(server.origin + CLOZE_PAGE, { waitUntil: "networkidle" });
  await page.locator("[data-sis-cloze-submit]").waitFor();

  const desktop = await readLayout(page);
  assert.equal(desktop.submitInControls, true);
  assert.equal(desktop.submitInsidePanel, true);
  assert.equal(desktop.submitAfterHint, true);
  assert.equal(desktop.closeIsLastInFooter, true);
  assert.equal(desktop.footerIsLastInShell, true);
  assert.ok(
    Math.abs(desktop.panelToCloseGap - 24) <= 1,
    "Close should be 24px below the exercise panel; measured " +
      desktop.panelToCloseGap +
      "px",
  );
  await page.screenshot({
    path: "/tmp/sis-cloze-submit-layout-desktop.png",
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await readLayout(page);
  assert.equal(mobile.submitInControls, true);
  assert.equal(mobile.submitInsidePanel, true);
  assert.equal(mobile.closeIsLastInFooter, true);
  assert.equal(mobile.footerIsLastInShell, true);
  assert.ok(mobile.documentWidth <= mobile.viewportWidth);
  assert.ok(Math.abs(mobile.panelToCloseGap - 24) <= 1);
  await page.screenshot({
    path: "/tmp/sis-cloze-submit-layout-mobile.png",
    fullPage: true,
  });

  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});
