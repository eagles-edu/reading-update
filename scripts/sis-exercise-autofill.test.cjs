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
  if (file.endsWith(".mp3")) return "audio/mpeg";
  return "application/octet-stream";
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

async function startServer() {
  const submissions = [];
  const server = http.createServer(function (request, response) {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/api/test-submission" && request.method === "POST") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", function (chunk) {
        body += chunk;
      });
      request.on("end", function () {
        submissions.push(JSON.parse(body));
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end('{"ok":true}');
      });
      return;
    }
    if (url.pathname.startsWith("/reading/_audio/")) {
      response.writeHead(204);
      response.end();
      return;
    }
    const pathname = decodeURIComponent(url.pathname);
    const file = path.resolve(ROOT, pathname.replace(/^\/+/, ""));
    if (
      !file.startsWith(ROOT + path.sep) ||
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile()
    ) {
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
    origin: "http://127.0.0.1:" + server.address().port,
    submissions: submissions,
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

test("autofill utility completes the current dropdown workflow for dictation, cloze, and sentence sets", async function (context) {
  const server = await startServer();
  const browser = await chromium.launch({
    ...(findSystemBrowser() ? { executablePath: findSystemBrowser() } : {}),
    headless: true,
  });
  context.after(async function () {
    await browser.close();
    await server.close();
  });

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", function (error) {
    errors.push(error.message);
  });
  page.on("console", function (message) {
    if (message.type() === "error" || message.type() === "warning") {
      errors.push(message.type() + ": " + message.text());
    }
  });
  await page.goto(server.origin + "/tools/sis-exercise-autofill.html");
  await page.locator("#submit-url").fill(server.origin + "/api/test-submission");
  await page.locator("#student").selectOption("ex001|ex001@example.com");
  assert.equal(await page.locator("#eagles-id").inputValue(), "ex001");
  assert.equal(await page.locator("#email").inputValue(), "ex001@example.com");

  async function loadFamily(family) {
    await page.locator('input[name="exercise-type"][value="' + family + '"]').check();
    await page.locator("#load").click();
    await page.waitForFunction(function () {
      const status = document.getElementById("status");
      return status.textContent.startsWith("Loaded ") || status.dataset.kind === "error";
    });
    assert.equal(await page.locator("#status").getAttribute("data-kind"), "success", await page.locator("#status").textContent());
  }

  async function assertPayload(family, expectedTotal) {
    const parsed = JSON.parse(await page.locator("#details").textContent());
    assert.equal(parsed.family, family);
    assert.equal(parsed.payload.totalQuestions, expectedTotal);
    assert.equal(parsed.payload.correctCount, expectedTotal);
    assert.equal(parsed.payload.pendingCount, 0);
    assert.equal(parsed.payload.incorrectCount, 0);
    assert.equal(parsed.payload.scorePercent, 100);
  }

  await loadFamily("dict");
  await page.locator("#fill-hold").click();
  await page.waitForFunction(function () {
    const status = document.getElementById("status");
    return status.textContent.includes("holding 1 exercise page") || status.dataset.kind === "error";
  });
  assert.equal(await page.locator("#status").getAttribute("data-kind"), "success", await page.locator("#status").textContent());
  assert.match(await page.locator("#status").textContent(), /holding 1 exercise page/);
  await assertPayload("dict", 5);
  await page.locator("#submit").click();
  await page.waitForFunction(function () {
    const status = document.getElementById("status");
    return status.textContent.includes("Submitted 1 reviewed") || status.dataset.kind === "error";
  });
  assert.equal(await page.locator("#status").getAttribute("data-kind"), "success", await page.locator("#status").textContent());
  assert.match(await page.locator("#status").textContent(), /Submitted 1 reviewed/);

  await loadFamily("cloze");
  await page.locator("#fill-submit").click();
  await page.waitForFunction(function () {
    const status = document.getElementById("status");
    return status.textContent.includes("Filled and submitted 1") || status.dataset.kind === "error";
  });
  assert.equal(await page.locator("#status").getAttribute("data-kind"), "success", await page.locator("#status").textContent());
  assert.match(await page.locator("#status").textContent(), /Filled and submitted 1/);
  await assertPayload("cloze", 6);

  await loadFamily("sent");
  await page.locator("#fill-submit").click();
  await page.waitForFunction(function () {
    const status = document.getElementById("status");
    return status.textContent.includes("Filled and submitted 5") || status.dataset.kind === "error";
  });
  assert.equal(await page.locator("#status").getAttribute("data-kind"), "success", await page.locator("#status").textContent());
  assert.match(await page.locator("#status").textContent(), /Filled and submitted 5/);
  assert.equal(server.submissions.length, 7);

  const expectedKeys = [
    "completedAt",
    "correctCount",
    "eaglesId",
    "email",
    "incorrectCount",
    "pageTitle",
    "pendingCount",
    "recipients",
    "scorePercent",
    "sourceAttemptId",
    "sourceSystem",
    "totalQuestions",
  ].sort();
  const expectedSources = [
    "dictation-web",
    "cloze-web",
    "sentence-scramble-web",
    "sentence-scramble-web",
    "sentence-scramble-web",
    "sentence-scramble-web",
    "sentence-scramble-web",
  ];
  for (const [index, payload] of server.submissions.entries()) {
    assert.deepEqual(Object.keys(payload).sort(), expectedKeys);
    assert.equal(payload.eaglesId, "ex001");
    assert.equal(payload.email, "ex001@example.com");
    assert.equal(payload.correctCount, payload.totalQuestions);
    assert.equal(payload.pendingCount, 0);
    assert.equal(payload.incorrectCount, 0);
    assert.equal(payload.scorePercent, 100);
    assert.deepEqual(payload.recipients, []);
    assert.match(payload.completedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(typeof payload.pageTitle, "string");
    assert.equal(typeof payload.sourceAttemptId, "string");
    assert.equal(payload.sourceSystem, expectedSources[index]);
  }

  const finalFrame = page.frames().find(function (frame) {
    return frame !== page.mainFrame();
  });
  await finalFrame.evaluate(async function () {
    const bridge = window.SISClozeBridge || window.SISExerciseBridge;
    return bridge.submit();
  });
  assert.equal(server.submissions.length, 7);

  await page.locator("#level").selectOption("begin6");
  await page.waitForFunction(function () {
    return Boolean(document.querySelector('#story option[value="69"]'));
  });
  await page.locator("#story").selectOption("69");
  await page.locator('input[name="exercise-type"][value="all"]').check();
  await page.locator("#load").click();
  await page.waitForFunction(function () {
    return document.getElementById("status").textContent.startsWith("Loaded ");
  });
  await page.locator("#fill-submit").click();
  await page.waitForFunction(function () {
    const status = document.getElementById("status");
    return status.textContent.includes("Filled and submitted 10") || status.dataset.kind === "error";
  });
  assert.equal(await page.locator("#status").getAttribute("data-kind"), "success", await page.locator("#status").textContent());
  assert.match(await page.locator("#status").textContent(), /Filled and submitted 10/);
  const begin6Details = JSON.parse(await page.locator("#details").textContent());
  assert.equal(begin6Details.family, "sent");
  assert.equal(begin6Details.payload.totalQuestions, 8);
  assert.equal(begin6Details.payload.correctCount, 8);
  assert.equal(begin6Details.payload.scorePercent, 100);
  assert.equal(server.submissions.length, 17);
  assert.deepEqual(
    server.submissions.slice(7).map(function (payload) {
      return payload.sourceSystem;
    }),
    [
      "dictation-web",
      "cloze-web",
      "sentence-scramble-web",
      "sentence-scramble-web",
      "sentence-scramble-web",
      "sentence-scramble-web",
      "sentence-scramble-web",
      "sentence-scramble-web",
      "sentence-scramble-web",
      "sentence-scramble-web",
    ],
  );
  assert.deepEqual(errors, []);
});
