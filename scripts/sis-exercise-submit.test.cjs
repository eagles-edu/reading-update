const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");

function exerciseFixture(family) {
  const sharedMarkup =
    '<!doctype html><html><head><meta charset="utf-8">' +
    "<title>" +
    (family === "sent"
      ? "Sentence exercise fixture"
      : "Dictation exercise fixture") +
    "</title>" +
    '<link rel="stylesheet" href="/css/sis-exercise-layout.css">' +
    '<link rel="stylesheet" href="/css/sis-cloze-submit.css">' +
    '<link rel="stylesheet" href="/css/sis-hot-potatoes.css">' +
    '<script src="/js/sis-exercise-submit.js" defer data-sis-exercise-family="' +
    family +
    '"></script></head><body id="TheBody"><div class="hp-exercise-shell wrapfit" data-sis-exercise-shell="true" data-sis-exercise-family="' +
    family +
    '">' +
    '<div class="NavButtonBar" id="TopNavBar"><button type="button">Next</button></div>' +
    '<div class="hp-instructions-panel"><div class="Titles"><h2 class="ExerciseTitle">Fixture</h2></div>' +
    '<div id="InstructionsDiv"><div id="Instructions">Complete the questions.</div></div></div>';
  const footerMarkup =
    '<div class="Feedback" id="FeedbackDiv"><div class="FeedbackText" id="FeedbackContent"></div></div>' +
    '<div class="NavButtonBar" id="BottomNavBar"><button type="button">Next</button></div>' +
    '<div class="cenmar"><button class="hp-button btn-74" type="button" data-hp-close aria-label="Close">CLOSE' +
    "</button></div></div></body></html>";

  if (family === "sent") {
    return (
      sharedMarkup +
      '<div id="GuessDiv" class="hp-display-none"></div><div id="MainDiv">' +
      '<button class="FuncButton" type="button" onclick="CheckAnswer(0)">Check</button>' +
      '<button class="FuncButton" type="button" onclick="Undo()">Undo</button>' +
      '<button class="FuncButton" type="button" onclick="location.reload()">Restart</button>' +
      '<button class="FuncButton" type="button" onclick="CheckAnswer(1)">Hint</button>' +
      '<div id="SegmentDiv">Sentence words</div></div>' +
      "<script>var Penalties=0;var Locked=false;var Score=100;var nativeHintCalls=0;" +
      "function CheckAnswer(kind){if(kind===1){nativeHintCalls++;Penalties++;document.getElementById('GuessDiv').textContent='Hint feedback';return false;}Locked=true;Score=100;document.getElementById('GuessDiv').textContent='Checked feedback';return true;}" +
      "function Undo(){}function Finish(){}</script>" +
      footerMarkup
    );
  }

  const questions = Array.from({ length: 5 }, function (_, index) {
    return (
      '<li class="QuizQuestion" id="Q_' +
      index +
      '"><div class="ShortAnswer" id="Q_' +
      index +
      '_SA"><textarea id="Q_' +
      index +
      '_Guess"></textarea><button class="FuncButton" type="button" onclick="CheckShortAnswer(' +
      index +
      ')">Check</button><button class="FuncButton" type="button" onclick="ShowHint(' +
      index +
      ')">Hint</button><button class="FuncButton" type="button" onclick="ShowAnswers(' +
      index +
      ')">Answers</button></div></li>'
    );
  }).join("");
  return (
    sharedMarkup +
    '<div id="MainDiv"><div id="QNav"></div><ol id="Questions">' +
    questions +
    "</ol></div>" +
    "<script>var Locked=false;var Finished=false;var Score=100;" +
    "var State=Array.from({length:5},function(){return [-1,0,0,0,0,''];});" +
    "var I=Array.from({length:5},function(){return [1];});var nativeHintCalls=0;" +
    "function CalculateOverallScore(){var total=0;var count=0;State.forEach(function(item){if(item&&item[0]>=0){total+=item[0];count++;}});Score=count?Math.floor(total/count*100):100;}" +
    "function CheckShortAnswer(index){State[index][0]=1;CalculateOverallScore();if(State.every(function(item){return item&&item[0]>=0;})){Locked=true;Finished=true;}return true;}" +
    "function ShowHint(index){nativeHintCalls++;State[index][2]++;State[index][4]+=0.1;return true;}" +
    "function ShowAnswers(index){State[index][0]=0;CalculateOverallScore();return true;}function Finish(){}</script>" +
    footerMarkup
  );
}

async function startFixtureServer() {
  const server = http.createServer(function (request, response) {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (
      [
        "/js/sis-exercise-submit.js",
        "/css/sis-exercise-layout.css",
        "/css/sis-cloze-submit.css",
        "/css/sis-hot-potatoes.css",
      ].includes(pathname)
    ) {
      const file = path.join(ROOT, pathname.slice(1));
      response.writeHead(200, {
        "Content-Type": pathname.endsWith(".css")
          ? "text/css; charset=utf-8"
          : "text/javascript; charset=utf-8",
      });
      response.end(fs.readFileSync(file));
      return;
    }
    if (/^\/begin1\/sent\/b1mx0010[1-5]\.html$/.test(pathname)) {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(exerciseFixture("sent"));
      return;
    }
    if (pathname === "/begin1/dict/b1d001.html") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(exerciseFixture("dict"));
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

test("sentence scramble requires all five linked questions and caps the set at 14 hints", async (context) => {
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
  const page = await browser.newPage({
    viewport: { width: 1024, height: 900 },
  });
  page.on("pageerror", function (error) {
    pageErrors.push(error.message);
  });
  page.on("console", function (message) {
    if (message.type() === "error" || message.type() === "warning") {
      consoleProblems.push(message.type() + ": " + message.text());
    }
  });
  await page.goto(server.origin + "/begin1/sent/b1mx00101.html");
  assert.match(await page.url(), /\/begin1\/sent\/b1mx00101\.html$/);
  assert.equal(await page.title(), "Sentence exercise fixture");
  assert.match(
    await page.locator("body").innerText(),
    /Complete the questions/,
  );
  const guessFeedback = page.locator("#GuessDiv");
  assert.equal(await guessFeedback.isVisible(), false);
  await page.locator("[data-sis-exercise-email]").fill("student@example.com");
  await page.locator("[data-sis-exercise-eagles-id]").fill("hug001");
  const firstAttemptId = await page.evaluate(function () {
    return window.SISExerciseBridge.getAttemptId();
  });

  const submit = page.locator("[data-sis-exercise-submit]");
  assert.equal(await submit.isDisabled(), true);
  const hint = page.locator('#MainDiv button[onclick="CheckAnswer(1)"]');
  await hint.click();
  await page.waitForFunction(function () {
    const panel = document.getElementById("GuessDiv");
    return panel && panel.textContent.includes("Hint feedback");
  });
  assert.equal(await guessFeedback.isVisible(), true);
  await hint.click();
  await hint.click();
  assert.equal(
    await page.evaluate(function () {
      return window.Penalties;
    }),
    0,
  );
  await page.locator('#MainDiv button[onclick="CheckAnswer(0)"]').click();
  await page.waitForFunction(function () {
    const panel = document.getElementById("GuessDiv");
    return panel && panel.textContent.includes("Checked feedback");
  });
  assert.equal(await guessFeedback.isVisible(), true);
  assert.equal(
    await page.evaluate(function () {
      return window.Score;
    }),
    93,
  );
  assert.equal(await submit.isDisabled(), true);

  for (let questionNumber = 2; questionNumber <= 5; questionNumber += 1) {
    const filename = "b1mx0010" + questionNumber + ".html";
    await page.goto(server.origin + "/begin1/sent/" + filename);
    const nextHint = page.locator('#MainDiv button[onclick="CheckAnswer(1)"]');
    const hintsToUse = questionNumber === 2 ? 11 : 0;
    for (let hintNumber = 0; hintNumber < hintsToUse; hintNumber += 1) {
      await nextHint.click();
    }
    if (questionNumber === 2) {
      assert.equal(await nextHint.isDisabled(), true);
      assert.equal(
        await page.evaluate(function () {
          return window.nativeHintCalls;
        }),
        11,
      );
      assert.equal(
        await page.evaluate(function () {
          return window.CheckAnswer(1);
        }),
        false,
      );
      assert.equal(
        await page.evaluate(function () {
          return window.nativeHintCalls;
        }),
        11,
      );
    }
    await page.locator('#MainDiv button[onclick="CheckAnswer(0)"]').click();
    assert.equal(await submit.isDisabled(), questionNumber !== 5);
  }

  const payload = await page.evaluate(function () {
    return window.SISExerciseBridge.getPayload();
  });
  assert.equal(payload.totalQuestions, 5);
  assert.equal(payload.correctCount, 5);
  assert.equal(payload.pendingCount, 0);
  assert.equal(payload.incorrectCount, 0);
  assert.equal(payload.scorePercent, 86);
  assert.equal(
    await page.evaluate(function () {
      return window.SISExerciseBridge.getAttemptId();
    }),
    firstAttemptId,
  );

  const layout = await page.evaluate(function () {
    const main = document.getElementById("MainDiv");
    const submitRow = document.querySelector(
      "[data-sis-exercise-submit]",
    ).parentElement;
    const controls = main.querySelector(".sis-exercise-controls");
    const controlChildren = Array.from(controls.children);
    const bottomNavigation = document.getElementById("BottomNavBar");
    const closeButton = document.querySelector("[data-hp-close]");
    return {
      submitInsideQuestionPanel: main.contains(submitRow),
      submitInActionGroup: controls.contains(submitRow),
      submitAfterHint:
        controlChildren.indexOf(submitRow) >
        controlChildren.findIndex(function (control) {
          return /hint/i.test(control.textContent);
        }),
      controlOrder: controlChildren.map(function (control) {
        if (control.querySelector("[data-sis-exercise-submit]"))
          return "Submit";
        return control.textContent.trim();
      }),
      navigationToClose:
        closeButton.getBoundingClientRect().top -
        bottomNavigation.getBoundingClientRect().bottom,
    };
  });
  assert.equal(layout.submitInsideQuestionPanel, true);
  assert.equal(layout.submitInActionGroup, true);
  assert.equal(layout.submitAfterHint, true);
  assert.deepEqual(layout.controlOrder, [
    "Check",
    "Undo",
    "Restart",
    "Hint",
    "Submit",
  ]);
  assert.ok(
    Math.abs(layout.navigationToClose - 24) < 1,
    "Close should be 24px below the bottom panel; measured " +
      layout.navigationToClose +
      "px",
  );
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleProblems, []);
  assert.doesNotMatch(
    await page.locator("body").innerText(),
    /Vite|Webpack|Next\.js error/i,
  );
  await page.screenshot({
    path: "/tmp/sis-exercise-submit-sentence-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLayout = await page.evaluate(function () {
    const main = document.getElementById("MainDiv");
    const submit = document.querySelector("[data-sis-exercise-submit]");
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      submitInsideQuestionPanel: main.contains(submit),
      navigationToClose:
        document.querySelector("[data-hp-close]").getBoundingClientRect().top -
        document.getElementById("BottomNavBar").getBoundingClientRect().bottom,
    };
  });
  assert.ok(mobileLayout.documentWidth <= mobileLayout.viewportWidth);
  assert.equal(mobileLayout.submitInsideQuestionPanel, true);
  assert.ok(Math.abs(mobileLayout.navigationToClose - 24) < 1);
  await page.screenshot({
    path: "/tmp/sis-exercise-submit-sentence-mobile.png",
    fullPage: true,
  });
});

test("dictation requires all five answers and charges seven points per extra hint on that question", async (context) => {
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
  const page = await browser.newPage({
    viewport: { width: 1024, height: 900 },
  });
  page.on("pageerror", function (error) {
    pageErrors.push(error.message);
  });
  page.on("console", function (message) {
    if (message.type() === "error" || message.type() === "warning") {
      consoleProblems.push(message.type() + ": " + message.text());
    }
  });
  await page.goto(server.origin + "/begin1/dict/b1d001.html");
  assert.match(await page.url(), /\/begin1\/dict\/b1d001\.html$/);
  assert.equal(await page.title(), "Dictation exercise fixture");
  assert.match(
    await page.locator("body").innerText(),
    /Complete the questions/,
  );
  await page.locator("[data-sis-exercise-email]").fill("student@example.com");
  await page.locator("[data-sis-exercise-eagles-id]").fill("hug001");
  const submit = page.locator("[data-sis-exercise-submit]");
  assert.equal(await submit.isDisabled(), true);

  const firstHint = page.locator('#MainDiv button[onclick="ShowHint(0)"]');
  await firstHint.click();
  await firstHint.click();
  assert.equal(
    await page.evaluate(function () {
      return window.State[0][4];
    }),
    0,
  );
  await firstHint.click();
  assert.equal(
    await page.evaluate(function () {
      return window.State[0][4];
    }),
    0,
  );
  await page.locator('#MainDiv button[onclick="CheckShortAnswer(0)"]').click();
  assert.ok(
    Math.abs(
      (await page.evaluate(function () {
        return window.State[0][0];
      })) - 0.93,
    ) < 0.000001,
  );
  assert.equal(await submit.isDisabled(), true);

  const secondHint = page.locator('#MainDiv button[onclick="ShowHint(1)"]');
  for (let hintNumber = 0; hintNumber < 11; hintNumber += 1) {
    await secondHint.click();
  }
  assert.equal(await secondHint.isDisabled(), true);
  assert.equal(
    await page.evaluate(function () {
      return window.nativeHintCalls;
    }),
    14,
  );
  assert.equal(
    await page.evaluate(function () {
      return window.ShowHint(1);
    }),
    false,
  );
  assert.equal(
    await page.evaluate(function () {
      return window.nativeHintCalls;
    }),
    14,
  );
  assert.equal(
    await page.evaluate(function () {
      return window.State[1][4];
    }),
    0,
  );
  await page.locator('#MainDiv button[onclick="CheckShortAnswer(1)"]').click();
  assert.ok(
    Math.abs(
      (await page.evaluate(function () {
        return window.State[1][0];
      })) - 0.37,
    ) < 0.000001,
  );

  for (let questionIndex = 2; questionIndex < 5; questionIndex += 1) {
    await page
      .locator(
        '#MainDiv button[onclick="CheckShortAnswer(' + questionIndex + ')"]',
      )
      .click();
    assert.equal(await submit.isDisabled(), questionIndex !== 4);
  }

  const payload = await page.evaluate(function () {
    return window.SISExerciseBridge.getPayload();
  });
  const dictationLayout = await page.evaluate(function () {
    const main = document.getElementById("MainDiv");
    const submit = document.querySelector("[data-sis-exercise-submit]");
    return {
      submitInsideQuestionPanel: main.contains(submit),
      submitInFinalActionGroup: Boolean(
        submit.closest('[aria-label="Dictation question controls"]'),
      ),
      submissionGroupIsLastInPanel:
        main.querySelector("#Q_4 .sis-exercise-controls")?.contains(submit),
    };
  });
  assert.equal(dictationLayout.submitInsideQuestionPanel, true);
  assert.equal(dictationLayout.submitInFinalActionGroup, true);
  assert.equal(dictationLayout.submissionGroupIsLastInPanel, true);
  assert.equal(payload.totalQuestions, 5);
  assert.equal(payload.correctCount, 5);
  assert.equal(payload.pendingCount, 0);
  assert.equal(payload.incorrectCount, 0);
  assert.equal(payload.scorePercent, 86);
  assert.equal(
    await page.evaluate(function () {
      return window.Score;
    }),
    86,
  );
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleProblems, []);
  assert.doesNotMatch(
    await page.locator("body").innerText(),
    /Vite|Webpack|Next\.js error/i,
  );
});
