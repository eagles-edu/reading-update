const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { chromium } = require("playwright");

test("exercise button animation stays inside the button and retains keyboard focus", async (context) => {
  const root = path.resolve(__dirname, "..");
  const systemBrowser = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].find((candidate) => candidate && fs.existsSync(candidate));
  const browser = await chromium.launch({
    ...(systemBrowser ? { executablePath: systemBrowser } : {}),
    headless: true,
  });
  context.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 390, height: 220 } });
  await page.setContent(`<!doctype html>
    <html><head><meta charset="utf-8"></head>
    <body id="TheBody">
      <main class="sis-cloze-shell">
        <div class="sis-exercise-controls">
          <button id="check" class="hp-button btn-17">Check</button>
          <button id="hint" class="hp-button btn-17">Hint</button>
          <button id="submit" class="hp-button btn-17" disabled>Submit</button>
        </div>
      </main>
    </body></html>`);

  for (const stylesheet of ["sis-cloze-submit.css", "sis-hot-potatoes.css"]) {
    await page.addStyleTag({
      content: fs.readFileSync(path.join(root, "css", stylesheet), "utf8"),
    });
  }

  const initialState = await page
    .locator("#check, #hint, #submit")
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const style = getComputedStyle(button);
        return {
          afterAnimation: getComputedStyle(button, "::after").animationName,
          afterContent: getComputedStyle(button, "::after").content,
          afterBackground: getComputedStyle(button, "::after").backgroundColor,
          beforeAnimation: getComputedStyle(button, "::before").animationName,
          beforeContent: getComputedStyle(button, "::before").content,
          beforeBackground: getComputedStyle(button, "::before")
            .backgroundColor,
          buttonAnimation: style.animationName,
          backgroundImage: style.backgroundImage,
          overflow: style.overflow,
          shadow: style.boxShadow,
          disabled: button.disabled,
        };
      }),
    );

  for (const button of initialState) {
    assert.equal(button.overflow, "hidden");
    assert.equal(button.shadow, "none");
    assert.equal(button.buttonAnimation, "sis-btn17-surface");
    assert.match(button.backgroundImage, /^repeating-linear-gradient\(/);
    assert.equal(button.beforeAnimation, "none");
    assert.equal(button.afterAnimation, "none");
    assert.equal(button.beforeContent, "none");
    assert.equal(button.afterContent, "none");
  }
  assert.equal(initialState[2].disabled, true);

  const submitPositionBefore = await page
    .locator("#submit")
    .evaluate((button) => getComputedStyle(button).backgroundPosition);
  await page.waitForTimeout(200);
  const submitPositionAfter = await page
    .locator("#submit")
    .evaluate((button) => getComputedStyle(button).backgroundPosition);
  assert.notEqual(submitPositionAfter, submitPositionBefore);

  await page.locator("#check").hover();
  assert.equal(
    await page
      .locator("#check")
      .evaluate((button) => getComputedStyle(button).boxShadow),
    "none",
  );

  await page.keyboard.press("Tab");
  const focusState = await page.locator(":focus").evaluate((button) => ({
    id: button.id,
    outlineStyle: getComputedStyle(button).outlineStyle,
    outlineWidth: getComputedStyle(button).outlineWidth,
    overflow: getComputedStyle(button).overflow,
  }));
  assert.equal(focusState.id, "check");
  assert.equal(focusState.outlineStyle, "solid");
  assert.ok(Number.parseFloat(focusState.outlineWidth) >= 2);
  assert.equal(focusState.overflow, "hidden");

  await page.screenshot({ path: "/tmp/cloze-buttons-boundary-after.png" });
});
