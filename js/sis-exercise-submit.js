(function () {
  "use strict";

  var activeScript = document.currentScript;
  var family = activeScript ? activeScript.getAttribute("data-sis-exercise-family") : "";
  if (family !== "dict" && family !== "sent") {
    family = /\/sent\//i.test(window.location.pathname) ? "sent" : "dict";
  }

  var SOURCE_SYSTEM = family === "sent" ? "sentence-scramble-web" : "dictation-web";
  var IDENTITY_KEY = "sis.cloze:identity";
  var IDENTITY_COOKIE = "sis_cloze_identity";
  var ATTEMPT_KEY_PREFIX = "sis.exercise:attempt:";
  var IDENTITY_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 2;
  var TEST_EXERCISE_SUBMIT_HOST = "test.eagles.edu.vn";
  var EXERCISE_SUBMIT_PORT = 8786;
  var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var EAGLES_ID_PATTERN = /^[a-z]+\d{3}$/;
  var state = {
    initialized: false,
    submitting: false,
    submitted: false,
    submitPromise: null,
    emailInput: null,
    eaglesIdInput: null,
    statusNode: null,
    feedbackObserver: null,
    actionButtons: [],
    submitButton: null,
    retryButton: null,
    attemptId: "",
    answersRevealedAll: false,
    revealedAnswerIndexes: Object.create(null),
  };

  function normalizeText(value) {
    return String(value == null ? "" : value).trim();
  }

  function readStorage(key) {
    try {
      return window.localStorage ? window.localStorage.getItem(key) || "" : "";
    } catch {
      return "";
    }
  }

  function writeStorage(key, value) {
    try {
      if (!window.localStorage) return;
      if (value) window.localStorage.setItem(key, String(value));
      else window.localStorage.removeItem(key);
    } catch {
      // Storage can be unavailable in privacy-restricted browsing contexts.
    }
  }

  function readCookie(name) {
    if (!document.cookie) return "";
    var entries = document.cookie.split(";");
    for (var index = 0; index < entries.length; index += 1) {
      var entry = entries[index].trim();
      if (!entry || entry.indexOf(name + "=") !== 0) continue;
      try {
        return decodeURIComponent(entry.slice(name.length + 1));
      } catch {
        return "";
      }
    }
    return "";
  }

  function writeCookie(name, value) {
    try {
      var secure = location.protocol === "https:" ? "; Secure" : "";
      document.cookie =
        name +
        "=" +
        encodeURIComponent(value) +
        "; Path=/; Max-Age=" +
        String(IDENTITY_COOKIE_MAX_AGE_SECONDS) +
        "; SameSite=Lax" +
        secure;
    } catch {
      // Cookie persistence is best-effort.
    }
  }

  function readIdentity() {
    var raw = readStorage(IDENTITY_KEY) || readCookie(IDENTITY_COOKIE);
    if (!raw) return { email: "", eaglesId: "" };
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return { email: "", eaglesId: "" };
      return {
        email: normalizeText(parsed.email),
        eaglesId: normalizeText(parsed.eaglesId).toLowerCase(),
      };
    } catch {
      return { email: "", eaglesId: "" };
    }
  }

  function readFormIdentity() {
    return {
      email: normalizeText(state.emailInput && state.emailInput.value),
      eaglesId: normalizeText(state.eaglesIdInput && state.eaglesIdInput.value).toLowerCase(),
    };
  }

  function identityIsValid(identity) {
    var normalized = identity || readFormIdentity();
    return EMAIL_PATTERN.test(normalized.email) && EAGLES_ID_PATTERN.test(normalized.eaglesId);
  }

  function persistIdentity(identity) {
    if (!identityIsValid(identity)) return;
    var serialized = JSON.stringify({ email: identity.email, eaglesId: identity.eaglesId });
    writeStorage(IDENTITY_KEY, serialized);
    writeCookie(IDENTITY_COOKIE, serialized);
  }

  function pageKey() {
    return normalizeText(location.pathname).replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "exercise";
  }

  function getAttemptId() {
    if (state.attemptId) return state.attemptId;
    var key = ATTEMPT_KEY_PREFIX + SOURCE_SYSTEM + ":" + pageKey();
    var existing = readStorage(key);
    if (existing) {
      state.attemptId = existing;
      return existing;
    }
    state.attemptId =
      SOURCE_SYSTEM +
      ":" +
      pageKey() +
      ":" +
      (window.crypto && typeof window.crypto.randomUUID === "function"
        ? window.crypto.randomUUID()
        : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10));
    writeStorage(key, state.attemptId);
    return state.attemptId;
  }

  function resolveSubmitUrl() {
    var configured = normalizeText(window.SIS_EXERCISE_SUBMIT_URL || "");
    if (configured) return configured;
    if (
      location.protocol === "file:" ||
      location.host === "localhost:5500" ||
      location.host === "127.0.0.1:5500"
    ) {
      return "http://127.0.0.1:" + String(EXERCISE_SUBMIT_PORT) + "/api/exercise-submission";
    }
    if (location.host === TEST_EXERCISE_SUBMIT_HOST) {
      return (
        location.protocol +
        "//" +
        TEST_EXERCISE_SUBMIT_HOST +
        ":" +
        String(EXERCISE_SUBMIT_PORT) +
        "/api/exercise-submission"
      );
    }
    return location.origin + "/api/exercise-submission";
  }

  function finiteScore() {
    var score = Number(window.Score);
    return Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null;
  }

  function getAnswerCounts() {
    var score = finiteScore();
    if (family === "sent") {
      var sentenceAnswerRevealed =
        state.answersRevealedAll || Object.keys(state.revealedAnswerIndexes).length > 0;
      var completed = window.Locked === true;
      var sentenceCorrectCount = completed && !sentenceAnswerRevealed ? 1 : 0;
      return {
        totalQuestions: 1,
        correctCount: sentenceCorrectCount,
        pendingCount: 0,
        incorrectCount: 1 - sentenceCorrectCount,
        scorePercent: sentenceAnswerRevealed
          ? 0
          : score == null
            ? completed
              ? 100
              : 0
            : score,
      };
    }

    var states = Array.isArray(window.State) ? window.State : [];
    var questionIndexes = [];
    for (var stateIndex = 0; stateIndex < states.length; stateIndex += 1) {
      if (Array.isArray(states[stateIndex])) questionIndexes.push(stateIndex);
    }
    var totalQuestions = questionIndexes.length || (Array.isArray(window.I) ? window.I.length : 0);
    var correctCount = 0;
    var pendingCount = 0;
    for (var index = 0; index < questionIndexes.length; index += 1) {
      var questionIndex = questionIndexes[index];
      if (
        state.answersRevealedAll ||
        Object.prototype.hasOwnProperty.call(state.revealedAnswerIndexes, questionIndex)
      ) {
        continue;
      }
      var questionScore = Number(states[questionIndex][0]);
      if (questionScore >= 1) correctCount += 1;
      else if (questionScore < 0) pendingCount += 1;
    }
    var incorrectCount = Math.max(totalQuestions - correctCount - pendingCount, 0);
    var hasRevealedAnswer =
      state.answersRevealedAll || Object.keys(state.revealedAnswerIndexes).length > 0;
    var calculatedScore = totalQuestions > 0
      ? Number(((correctCount / totalQuestions) * 100).toFixed(2))
      : 0;
    var scorePercent = hasRevealedAnswer || score == null ? calculatedScore : score;
    return { totalQuestions, correctCount, pendingCount, incorrectCount, scorePercent };
  }

  function setStatus(message, kind) {
    if (!state.statusNode) return;
    state.statusNode.textContent = message || "";
    state.statusNode.classList.remove("sis-cloze-status--error", "sis-cloze-status--success");
    if (kind === "error") state.statusNode.classList.add("sis-cloze-status--error");
    if (kind === "success") state.statusNode.classList.add("sis-cloze-status--success");
  }

  function focusMissingIdentity() {
    var identity = readFormIdentity();
    if (!EMAIL_PATTERN.test(identity.email) && state.emailInput) {
      state.emailInput.focus();
      return;
    }
    if (!EAGLES_ID_PATTERN.test(identity.eaglesId) && state.eaglesIdInput) {
      state.eaglesIdInput.focus();
    }
  }

  function updateActionButtons() {
    var disabled =
      !identityIsValid() || state.submitting || state.submitted || window.Locked === true;
    for (var index = 0; index < state.actionButtons.length; index += 1) {
      state.actionButtons[index].disabled = disabled;
      state.actionButtons[index].setAttribute("aria-disabled", disabled ? "true" : "false");
    }
    if (state.submitButton) {
      var disableSubmit =
        !identityIsValid() || state.submitting || state.submitted || window.Locked !== true;
      state.submitButton.disabled = disableSubmit;
      state.submitButton.setAttribute("aria-disabled", disableSubmit ? "true" : "false");
    }
  }

  function sendWithFetch(url, payload) {
    return window.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).then(function (response) {
      if (response.ok) return response;
      return response.text().then(function (text) {
        var message = "Submission failed (" + response.status + ")";
        if (text) {
          try {
            var parsed = JSON.parse(text);
            if (parsed && parsed.error) message = String(parsed.error);
          } catch {
            message = text;
          }
        }
        throw new Error(message);
      });
    });
  }

  function sendWithXhr(url, payload) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", url, true);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.setRequestHeader("Accept", "application/json");
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
        else reject(new Error("Submission failed (" + xhr.status + ")"));
      };
      xhr.onerror = function () {
        reject(new Error("Submission failed"));
      };
      xhr.send(JSON.stringify(payload));
    });
  }

  function sendSubmission(payload) {
    var url = resolveSubmitUrl();
    return window.fetch ? sendWithFetch(url, payload) : sendWithXhr(url, payload);
  }

  function buildPayload() {
    var identity = readFormIdentity();
    if (!identityIsValid(identity)) {
      throw new Error("Enter your student email and Eagles ID before checking answers.");
    }
    var counts = getAnswerCounts();
    return {
      eaglesId: identity.eaglesId,
      email: identity.email,
      pageTitle: normalizeText(document.title).replace(/\s+/g, " "),
      completedAt: new Date().toISOString(),
      totalQuestions: counts.totalQuestions,
      correctCount: counts.correctCount,
      pendingCount: counts.pendingCount,
      incorrectCount: counts.incorrectCount,
      scorePercent: counts.scorePercent,
      recipients: [],
      sourceSystem: SOURCE_SYSTEM,
      sourceAttemptId: getAttemptId(),
    };
  }

  function submitAttempt() {
    if (state.submitted) return Promise.resolve(true);
    if (state.submitting && state.submitPromise) return state.submitPromise;
    if (window.Locked !== true) return Promise.resolve(false);

    var payload;
    try {
      payload = buildPayload();
    } catch (error) {
      setStatus(error && error.message ? String(error.message) : "Enter your details first.", "error");
      focusMissingIdentity();
      updateActionButtons();
      return Promise.resolve(false);
    }

    persistIdentity({ email: payload.email, eaglesId: payload.eaglesId });
    state.submitting = true;
    setStatus("Submitting your result to SIS...", "");
    updateActionButtons();
    state.submitPromise = Promise.resolve()
      .then(function () {
        return sendSubmission(payload);
      })
      .then(function () {
        state.submitted = true;
        if (state.retryButton) state.retryButton.hidden = true;
        setStatus("Submitted. A receipt has been emailed to " + payload.email + ".", "success");
        return true;
      })
      .catch(function (error) {
        var message = error && error.message ? String(error.message) : "Submission failed";
        if (state.retryButton) state.retryButton.hidden = false;
        setStatus("Submission failed. Retry when you are back online. " + message, "error");
        return false;
      })
      .finally(function () {
        state.submitting = false;
        updateActionButtons();
      });
    return state.submitPromise;
  }

  function instructionLabel() {
    var instructions = document.getElementById("InstructionsDiv");
    if (!instructions) return;
    var target = instructions.querySelector("#Instructions") || instructions;
    if (target.querySelector(".sis-exercise-instructions")) return;
    var instructionText = normalizeText(target.textContent);
    var labelText = family === "sent" ? "SENTENCE SCRAMBLE" : "DICTATION";
    instructionText = instructionText.replace(new RegExp("^" + labelText + "\\s*:\\s*", "i"), "");
    var paragraph = document.createElement("p");
    paragraph.className = "sis-exercise-instructions";
    var label = document.createElement("strong");
    label.textContent = labelText;
    paragraph.appendChild(label);
    paragraph.appendChild(document.createTextNode(": " + instructionText));
    while (target.firstChild) target.removeChild(target.firstChild);
    target.appendChild(paragraph);
  }

  function ensureIdentityPanel() {
    var existing = document.querySelector(".sis-cloze-panel");
    if (existing) return existing;
    var main = document.getElementById("MainDiv");
    if (!main || !main.parentNode) return null;
    var panel = document.createElement("section");
    panel.className = "sis-cloze-panel";
    panel.setAttribute("aria-label", "SIS result details");
    panel.innerHTML =
      '<p class="sis-cloze-panel__instruction">Enter your Eagles ID and student email to send your result to SIS.</p>' +
      '<div class="sis-cloze-panel__grid">' +
      '<label class="sis-cloze-field" for="sis-exercise-eagles-id">' +
      '<span class="sis-cloze-field__label">Eagles ID</span>' +
      '<input id="sis-exercise-eagles-id" data-sis-exercise-eagles-id type="text" autocomplete="username" autocapitalize="none" spellcheck="false" inputmode="text" pattern="^[a-z]+\\d{3}$" placeholder="tammy001" required>' +
      "</label>" +
      '<label class="sis-cloze-field" for="sis-exercise-email">' +
      '<span class="sis-cloze-field__label">Student email</span>' +
      '<input id="sis-exercise-email" data-sis-exercise-email type="email" autocomplete="email" inputmode="email" placeholder="name@example.com" required>' +
      "</label>" +
      "</div>" +
      '<p id="sis-exercise-status" class="sis-cloze-status" data-sis-exercise-status aria-live="polite"></p>' +
      '<button class="btn-17 hp-button sis-exercise-retry" type="button" data-sis-exercise-retry aria-label="Retry" aria-description="Retry submitting your result to SIS." data-hp-tooltip="Retry submitting your result to SIS." hidden>Retry</button>';
    main.parentNode.insertBefore(panel, main);
    return panel;
  }

  function buildModernShell() {
    var wrapper = document.querySelector("body#TheBody > .wrapit, body#TheBody > .wrapfit");
    if (!wrapper || wrapper.dataset.sisExerciseShellBuilt === "true") return;
    var instructionPanel = wrapper.querySelector(":scope > .hp-instructions-panel");
    var titles = instructionPanel
      ? instructionPanel.querySelector(":scope > .Titles")
      : wrapper.querySelector(":scope > .Titles");
    var instructions = instructionPanel
      ? instructionPanel.querySelector(":scope > #InstructionsDiv")
      : wrapper.querySelector(":scope > #InstructionsDiv");
    var guess = wrapper.querySelector(":scope > #GuessDiv");
    var main = wrapper.querySelector(":scope > #MainDiv");
    var feedback = wrapper.querySelector(":scope > #FeedbackDiv");
    var topNav = wrapper.querySelector(":scope > #TopNavBar");
    var bottomNav = wrapper.querySelector(":scope > #BottomNavBar");
    var identityPanel = wrapper.querySelector(":scope > .sis-cloze-panel");
    var closeContainer = wrapper.querySelector(":scope > .cenmar");
    var trailingBreak = closeContainer && closeContainer.nextSibling;
    var retryButton = identityPanel && identityPanel.querySelector("[data-sis-exercise-retry]");
    if ((!instructionPanel && (!titles || !instructions)) || !main) return;

    if (guess) {
      var containsOnlyWhitespace = true;
      for (var nodeIndex = 0; nodeIndex < guess.childNodes.length; nodeIndex += 1) {
        var child = guess.childNodes[nodeIndex];
        if (child.nodeType !== 3 || normalizeText(child.textContent)) {
          containsOnlyWhitespace = false;
          break;
        }
      }
      if (containsOnlyWhitespace) {
        while (guess.firstChild) guess.removeChild(guess.firstChild);
      }
    }

    var shell = document.createElement("main");
    shell.className = "sis-cloze-shell sis-exercise-shell";
    shell.setAttribute("aria-label", family === "sent" ? "Sentence scramble exercise" : "Dictation exercise");
    wrapper.insertBefore(shell, topNav || instructionPanel || titles || identityPanel || main);
    if (topNav) shell.appendChild(topNav);
    var header = document.createElement("header");
    header.className = "sis-cloze-region sis-cloze-region--header";
    if (instructionPanel) {
      header.appendChild(instructionPanel);
    } else {
      var contentPanel = document.createElement("section");
      contentPanel.className = "hp-instructions-panel";
      contentPanel.appendChild(titles);
      contentPanel.appendChild(instructions);
      header.appendChild(contentPanel);
    }
    var identityRegion = document.createElement("section");
    identityRegion.className = "sis-cloze-region sis-cloze-region--identity";
    identityRegion.setAttribute("aria-label", "SIS result details");
    if (identityPanel) identityRegion.appendChild(identityPanel);
    var exerciseRegion = document.createElement("section");
    exerciseRegion.className = "sis-cloze-region sis-cloze-region--exercise";
    exerciseRegion.setAttribute("aria-label", "Exercise content");
    if (guess) exerciseRegion.appendChild(guess);
    exerciseRegion.appendChild(main);
    var submitRegion = document.createElement("div");
    submitRegion.className = "sis-exercise-submit-row";
    submitRegion.setAttribute("aria-label", "Submit exercise result");
    var submitButton = document.createElement("button");
    submitButton.className = "btn-17 hp-button sis-exercise-submit";
    submitButton.type = "button";
    submitButton.textContent = "Submit";
    submitButton.setAttribute("data-sis-exercise-submit", "");
    submitButton.setAttribute("aria-label", "Submit");
    submitButton.setAttribute("aria-description", "Submit your completed exercise result to SIS.");
    submitButton.setAttribute("data-hp-tooltip", "Submit your completed exercise result to SIS.");
    submitButton.disabled = true;
    submitButton.setAttribute("aria-disabled", "true");
    submitRegion.appendChild(submitButton);
    if (retryButton) submitRegion.appendChild(retryButton);
    exerciseRegion.appendChild(submitRegion);
    var feedbackRegion = document.createElement("section");
    feedbackRegion.className = "sis-cloze-region sis-cloze-region--feedback";
    feedbackRegion.setAttribute("aria-label", "Exercise feedback");
    if (feedback) {
      feedback.setAttribute("role", "dialog");
      feedback.setAttribute("aria-modal", "true");
      feedback.setAttribute("aria-live", "assertive");
      feedbackRegion.appendChild(feedback);
      feedbackRegion.classList.add("hp-display-none");
      var feedbackText = feedback.querySelector(".FeedbackText");
      var syncFeedbackVisibility = function () {
        var hasMessage = feedbackText && normalizeText(feedbackText.textContent);
        var isHidden = !hasMessage || window.getComputedStyle(feedback).display === "none";
        feedbackRegion.classList.toggle("hp-display-none", isHidden);
      };
      syncFeedbackVisibility();
      if (typeof window.MutationObserver === "function") {
        state.feedbackObserver = new window.MutationObserver(syncFeedbackVisibility);
        state.feedbackObserver.observe(feedback, { attributes: true, attributeFilter: ["class", "style"] });
        if (feedbackText) {
          state.feedbackObserver.observe(feedbackText, {
            characterData: true,
            childList: true,
            subtree: true,
          });
        }
      }
    }
    shell.appendChild(header);
    shell.appendChild(identityRegion);
    shell.appendChild(exerciseRegion);
    if (feedback) shell.appendChild(feedbackRegion);
    if (bottomNav) shell.appendChild(bottomNav);
    if (closeContainer) {
      var footerRegion = document.createElement("footer");
      footerRegion.className = "sis-cloze-region sis-cloze-region--footer";
      footerRegion.setAttribute("aria-label", "Close exercise");
      footerRegion.appendChild(closeContainer);
      shell.appendChild(footerRegion);
      while (trailingBreak && trailingBreak.nodeType === 3 && !normalizeText(trailingBreak.textContent)) {
        trailingBreak = trailingBreak.nextSibling;
      }
      if (trailingBreak && trailingBreak.nodeName === "BR") trailingBreak.remove();
    }
    state.submitButton = submitButton;
    wrapper.dataset.sisExerciseShellBuilt = "true";
    document.body.dataset.sisExerciseFamily = family;
    document.body.classList.add("sis-exercise-story-theme");
  }

  function getActionFromButton(button) {
    var onclick = normalizeText(button.getAttribute("onclick")).toLowerCase();
    if (/checkshortanswer\s*\(|checkanswer\s*\(/.test(onclick)) return "check";
    if (/showhint\s*\(/.test(onclick)) return "hint";
    if (/showanswers\s*\(/.test(onclick)) return "answer";
    return "";
  }

  function collectActionButtons() {
    var buttons = Array.prototype.slice.call(document.querySelectorAll("button, input[type='button'], input[type='submit']"));
    state.actionButtons = [];
    for (var index = 0; index < buttons.length; index += 1) {
      var button = buttons[index];
      var action = getActionFromButton(button);
      if (!action) continue;
      state.actionButtons.push(button);
      button.classList.add("btn-17");
      button.setAttribute("aria-disabled", "true");
      button.removeAttribute("onmouseover");
      button.removeAttribute("onfocus");
      button.removeAttribute("onmouseout");
      button.removeAttribute("onblur");
      button.removeAttribute("onmousedown");
      button.removeAttribute("onmouseup");
      if (!button.getAttribute("type")) button.setAttribute("type", "button");
    }
  }

  function bindIdentityEvents() {
    var inputs = [state.emailInput, state.eaglesIdInput];
    for (var index = 0; index < inputs.length; index += 1) {
      var input = inputs[index];
      if (!input) continue;
      input.addEventListener("input", function () {
        var identity = readFormIdentity();
        if (identityIsValid(identity)) {
          persistIdentity(identity);
          setStatus("Your details are ready. Complete the exercise to send your result.", "");
        } else {
          setStatus("Enter a valid student email and Eagles ID to continue.", "");
        }
        updateActionButtons();
      });
      input.addEventListener("blur", function () {
        var identity = readFormIdentity();
        if (identityIsValid(identity)) persistIdentity(identity);
        updateActionButtons();
      });
    }
  }

  function wrapAction(name, invalidMessage) {
    var original = window[name];
    if (typeof original !== "function" || original.__sisExerciseWrapped) return;
    var wrapped = function () {
      if (!identityIsValid()) {
        setStatus(invalidMessage, "error");
        focusMissingIdentity();
        return false;
      }
      if (name === "ShowAnswers") {
        var questionIndex = Number(arguments[0]);
        if (Number.isInteger(questionIndex) && questionIndex >= 0) {
          state.revealedAnswerIndexes[questionIndex] = true;
        } else {
          state.answersRevealedAll = true;
        }
      }
      var result = original.apply(this, arguments);
      if (name === "ShowAnswers") {
        setStatus("Revealed answers count as incorrect.", "error");
      }
      updateActionButtons();
      return result;
    };
    wrapped.__sisExerciseWrapped = true;
    window[name] = wrapped;
  }

  function wrapFinish() {
    var original = window.Finish;
    if (typeof original !== "function" || original.__sisExerciseWrapped) return;
    var wrapped = function () {
      var result = original.apply(this, arguments);
      updateActionButtons();
      return result;
    };
    wrapped.__sisExerciseWrapped = true;
    window.Finish = wrapped;
  }

  function bind() {
    state.emailInput = document.querySelector("[data-sis-exercise-email]");
    state.eaglesIdInput = document.querySelector("[data-sis-exercise-eagles-id]");
    state.statusNode = document.querySelector("[data-sis-exercise-status]");
    state.submitButton = document.querySelector("[data-sis-exercise-submit]");
    state.retryButton = document.querySelector("[data-sis-exercise-retry]");
    if (!state.emailInput || !state.eaglesIdInput || !state.statusNode || !state.submitButton) return;

    var saved = readIdentity();
    state.emailInput.value = saved.email;
    state.eaglesIdInput.value = saved.eaglesId;
    state.emailInput.setAttribute("aria-describedby", "sis-exercise-status");
    state.eaglesIdInput.setAttribute("aria-describedby", "sis-exercise-status");
    collectActionButtons();
    bindIdentityEvents();
    state.submitButton.addEventListener("click", submitAttempt);
    if (state.retryButton) state.retryButton.addEventListener("click", submitAttempt);
    wrapAction("CheckShortAnswer", "Enter your student email and Eagles ID before checking answers.");
    wrapAction("CheckAnswer", "Enter your student email and Eagles ID before checking or using a hint.");
    wrapAction("ShowHint", "Enter your student email and Eagles ID before using a hint.");
    wrapAction("ShowAnswers", "Enter your student email and Eagles ID before viewing answers.");
    wrapFinish();
    updateActionButtons();
    if (identityIsValid()) {
      setStatus("Your saved details are ready. Complete the exercise to send your result.", "");
    } else {
      setStatus("Enter your student email and Eagles ID to unlock Check and Hint.", "");
    }
  }

  function bootstrap() {
    if (state.initialized) return;
    document.body.classList.add("sis-exercise-story-theme");
    instructionLabel();
    ensureIdentityPanel();
    buildModernShell();
    bind();
    state.initialized = true;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootstrap);
  else bootstrap();

  window.SISExerciseBridge = {
    sourceSystem: SOURCE_SYSTEM,
    getAttemptId: getAttemptId,
    getPayload: buildPayload,
    submit: submitAttempt,
  };
})();
