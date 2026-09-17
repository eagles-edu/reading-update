const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");

function comprehensionFixture() {
  const questions = Array.from({ length: 5 }, function (_, index) {
    return (
      '<li class="QuizQuestion" id="Q_' +
      index +
      '"><p>Question ' +
      String(index + 1) +
      '</p><ol class="MCAnswers"><li><button class="FuncButton" type="button" onclick="CheckMCAnswer(' +
      index +
      ', 0, this)">Wrong</button></li><li><button class="FuncButton" type="button" onclick="CheckMCAnswer(' +
      index +
      ', 1, this)">Correct</button></li></ol></li>'
    );
  }).join("");
  return (
    '<!doctype html><html><head><meta charset="utf-8"><title>Comprehension fixture</title>' +
    '<script src="/js/sis-comprehension-submit.js" defer data-sis-exercise-family="comp"></script></head>' +
    '<body id="TheBody"><div class="hp-exercise-shell wrapfit" data-sis-exercise-shell="true" data-sis-exercise-family="comp">' +
    '<div class="hp-instructions-panel"><div class="Titles"><h1 class="ExerciseTitle">Comprehension fixture</h1></div>' +
    '<div id="InstructionsDiv"><div id="Instructions">Read and answer every question.</div></div></div>' +
    '<div id="MainDiv"><ol id="Questions">' +
    questions +
    '</ol></div><div id="FeedbackDiv"><div class="FeedbackText" id="FeedbackContent"></div></div>' +
    '<div class="cenmar"><button class="hp-button btn-74" type="button" data-hp-close aria-label="Close">Close</button></div></div>' +
    "<script>" +
    'var Locked=false;var Score=0;var State=Array.from({length:5},function(){return [-1,0,0,0,0,""];});' +
    "function CheckMCAnswer(index,answer){if(State[index][0]>=0)return false;State[index][0]=answer===1?1:0;Score=State.filter(function(item){return item[0]>=0;}).length/5*100;if(State.every(function(item){return item[0]>=0;}))Locked=true;return true;}" +
    "</script></body></html>"
  );
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

async function startFixtureServer() {
  let postedPayload = null;
  let resolvePost;
  const postReceived = new Promise(function (resolve) {
    resolvePost = resolve;
  });
  const server = http.createServer(function (request, response) {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (
      pathname === "/js/sis-comprehension-submit.js" &&
      request.method === "GET"
    ) {
      response.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
      });
      response.end(
        fs.readFileSync(path.join(ROOT, "js/sis-comprehension-submit.js")),
      );
      return;
    }
    if (pathname === "/comprehension.html" && request.method === "GET") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(comprehensionFixture());
      return;
    }
    if (pathname === "/api/exercise-submission" && request.method === "POST") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", function (chunk) {
        body += chunk;
      });
      request.on("end", function () {
        postedPayload = JSON.parse(body);
        resolvePost(postedPayload);
        const responseBody = '{"ok":true}';
        response.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(responseBody)),
          Connection: "close",
        });
        response.end(responseBody);
      });
      return;
    }
    response.writeHead(404);
    response.end("Not found");
  });
  await new Promise(function (resolve) {
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    origin: "http://127.0.0.1:" + server.address().port,
    postReceived,
    getPostedPayload: function () {
      return postedPayload;
    },
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

test("comprehension requires identity, preserves native MC scoring, and sends an SIS package", async function (context) {
  const server = await startFixtureServer();
  const browser = await chromium.launch({
    ...(findSystemBrowser() ? { executablePath: findSystemBrowser() } : {}),
    headless: true,
  });
  context.after(async function () {
    await browser.close();
    await server.close();
  });

  const pageErrors = [];
  const consoleProblems = [];
  const page = await browser.newPage();
  page.on("pageerror", function (error) {
    pageErrors.push(error.stack || error.message);
  });
  page.on("console", function (message) {
    if (message.type() === "error" || message.type() === "warning") {
      consoleProblems.push(message.type() + ": " + message.text());
    }
  });
  await page.addInitScript(function (url) {
    window.SIS_EXERCISE_SUBMIT_URL = url;
  }, server.origin + "/api/exercise-submission");
  await page.goto(server.origin + "/comprehension.html");

  const answers = page.locator('#Questions button[onclick*="CheckMCAnswer"]');
  assert.equal(await answers.count(), 10);
  assert.equal(await answers.nth(1).isDisabled(), true);
  assert.equal(
    await page.evaluate(function () {
      return window.State[0][0];
    }),
    -1,
  );
  await page.locator("[data-sis-exercise-email]").fill("student@example.com");
  await page.locator("[data-sis-exercise-eagles-id]").fill("hug001");
  assert.equal(await answers.nth(1).isDisabled(), false);

  for (let index = 0; index < 5; index += 1) {
    await answers.nth(index * 2 + 1).click();
  }

  const submit = page.locator("[data-sis-exercise-submit]");
  assert.equal(await submit.isDisabled(), false);
  const payload = await page.evaluate(function () {
    return window.SISExerciseBridge.getPayload();
  });
  assert.equal(payload.sourceSystem, "comprehension-web");
  assert.equal(payload.totalQuestions, 5);
  assert.equal(payload.correctCount, 5);
  assert.equal(payload.pendingCount, 0);
  assert.equal(payload.incorrectCount, 0);
  assert.equal(payload.scorePercent, 100);
  assert.equal(
    await page.evaluate(function () {
      return window.Score;
    }),
    100,
  );

  const responsePromise = page.waitForResponse(function (response) {
    return response.url() === server.origin + "/api/exercise-submission";
  });
  await submit.click();
  const response = await responsePromise;
  assert.equal(response.status(), 200);
  const posted = await Promise.race([
    server.postReceived,
    new Promise(function (_, reject) {
      setTimeout(function () {
        reject(new Error("Timed out waiting for SIS submission"));
      }, 3000);
    }),
  ]);
  assert.deepEqual(
    { ...posted, completedAt: "" },
    { ...payload, completedAt: "" },
  );
  assert.match(posted.completedAt, /^2026-09-16T/);
  assert.equal(await submit.isDisabled(), true);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleProblems, []);
});
