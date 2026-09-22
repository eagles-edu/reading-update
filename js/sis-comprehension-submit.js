(function () {
  "use strict";

  var SOURCE_SYSTEM = "comprehension-web";
  var IDENTITY_KEY = "sis.comprehension:identity";
  var IDENTITY_COOKIE = "sis_comprehension_identity";
  var ATTEMPT_KEY_PREFIX = "sis.comprehension:attempt:";
  var IDENTITY_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 2;
  var TEST_EXERCISE_SUBMIT_HOST = "test.eagles.edu.vn";
  var EXERCISE_SUBMIT_PORT = 8786;
  var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var EAGLES_ID_PATTERN = /^[a-z]+\d{3}$/;
  var IDENTITY_REQUIRED_STATUS_MESSAGE =
    "Enter your EaglesID and student email to activate Check and Hint.";
  var IDENTITY_READY_STATUS_MESSAGE =
    "Your saved details are ready. Complete the exercise to send your result.";
  var state = {
    initialized: false,
    submitting: false,
    submitted: false,
    submitPromise: null,
    emailInput: null,
    eaglesIdInput: null,
    statusNode: null,
    submitButton: null,
    retryButton: null,
    attemptId: "",
    attemptIdKey: "",
    feedbackObserver: null,
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
      return;
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
      return;
    }
  }

  function readIdentity() {
    var raw = readStorage(IDENTITY_KEY) || readCookie(IDENTITY_COOKIE);
    if (!raw) return { email: "", eaglesId: "" };
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return { email: "", eaglesId: "" };
      }
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
      eaglesId: normalizeText(
        state.eaglesIdInput && state.eaglesIdInput.value,
      ).toLowerCase(),
    };
  }

  function identityIsValid(identity) {
    var value = identity || readFormIdentity();
    return (
      EMAIL_PATTERN.test(value.email) && EAGLES_ID_PATTERN.test(value.eaglesId)
    );
  }

  function persistIdentity(identity) {
    if (!identityIsValid(identity)) return;
    var serialized = JSON.stringify({
      email: identity.email,
      eaglesId: identity.eaglesId,
    });
    writeStorage(IDENTITY_KEY, serialized);
    writeCookie(IDENTITY_COOKIE, serialized);
  }

  function pageKey() {
    return (
      normalizeText(location.pathname)
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-+|-+$/g, "") || "exercise"
    );
  }

  function questions() {
    return Array.prototype.slice.call(
      document.querySelectorAll("#Questions > .QuizQuestion"),
    );
  }

  function questionIndex(question, fallback) {
    var match = /^Q_(\d+)$/i.exec(question && question.id ? question.id : "");
    return match ? Number(match[1]) : fallback;
  }

  function questionComplete(index) {
    var questionState = Array.isArray(window.State) && window.State[index];
    return Array.isArray(questionState) && Number(questionState[0]) >= 0;
  }

  function allQuestionsComplete() {
    var items = questions();
    if (!items.length || !Array.isArray(window.State)) return false;
    for (var index = 0; index < items.length; index += 1) {
      if (!questionComplete(questionIndex(items[index], index))) return false;
    }
    return true;
  }

  function getAnswerCounts() {
    var items = questions();
    var correctCount = 0;
    var pendingCount = 0;
    for (var index = 0; index < items.length; index += 1) {
      var scoreState =
        Array.isArray(window.State) &&
        window.State[questionIndex(items[index], index)];
      var questionScore = Array.isArray(scoreState)
        ? Number(scoreState[0])
        : -1;
      if (questionScore >= 1) correctCount += 1;
      else if (questionScore < 0) pendingCount += 1;
    }
    var totalQuestions = items.length;
    var incorrectCount = Math.max(
      totalQuestions - correctCount - pendingCount,
      0,
    );
    return {
      totalQuestions: totalQuestions,
      correctCount: correctCount,
      pendingCount: pendingCount,
      incorrectCount: incorrectCount,
      scorePercent:
        totalQuestions > 0
          ? Number(((correctCount / totalQuestions) * 100).toFixed(2))
          : 0,
    };
  }

  function getAttemptId() {
    var identity = readFormIdentity();
    var key =
      ATTEMPT_KEY_PREFIX +
      pageKey() +
      ":" +
      (identity.eaglesId || "unidentified");
    if (state.attemptId && state.attemptIdKey === key) return state.attemptId;
    state.attemptIdKey = key;
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
        : Date.now().toString(36) +
          "-" +
          Math.random().toString(36).slice(2, 10));
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
      return (
        "http://127.0.0.1:" +
        String(EXERCISE_SUBMIT_PORT) +
        "/api/exercise-submission"
      );
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

  function setStatus(message, kind) {
    if (!state.statusNode) return;
    state.statusNode.textContent = message || "";
    state.statusNode.classList.remove(
      "sis-cloze-status--error",
      "sis-cloze-status--success",
    );
    if (kind === "error")
      state.statusNode.classList.add("sis-cloze-status--error");
    if (kind === "success")
      state.statusNode.classList.add("sis-cloze-status--success");
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

  function ensureIdentityPanel() {
    var existing = document.querySelector(".sis-cloze-panel");
    if (existing) return existing;
    var main = document.getElementById("MainDiv");
    if (!main || !main.parentNode) return null;
    var panel = document.createElement("section");
    panel.className = "sis-cloze-panel";
    panel.setAttribute("aria-label", "SIS result details");
    panel.innerHTML =
      '<p class="sis-cloze-panel__instruction">Enter your EaglesID and student email to activate Check and Hint.</p>' +
      '<div class="sis-cloze-panel__grid">' +
      '<label class="sis-cloze-field" for="sis-exercise-email"><span class="sis-cloze-field__label">Student email</span><input id="sis-exercise-email" data-sis-identity-email data-sis-exercise-email type="email" autocomplete="email" inputmode="email" placeholder="name@example.com" required></label>' +
      '<label class="sis-cloze-field" for="sis-exercise-eagles-id"><span class="sis-cloze-field__label">Eagles ID</span><input id="sis-exercise-eagles-id" data-sis-identity-eagles-id data-sis-exercise-eagles-id type="text" autocomplete="username" autocapitalize="none" spellcheck="false" inputmode="text" pattern="^[a-z]+\\d{3}$" placeholder="tammy001" required></label>' +
      '</div><p id="sis-exercise-status" class="sis-cloze-status" data-sis-identity-status data-sis-exercise-status aria-live="polite"></p>' +
      '<button class="btn-17 hp-button sis-exercise-retry" type="button" data-sis-exercise-retry aria-label="Retry" aria-description="Retry submitting your result to SIS." data-hp-tooltip="Retry submitting your result to SIS." hidden>Retry</button>';
    main.parentNode.insertBefore(panel, main);
    return panel;
  }

  function buildModernShell(identityPanel) {
    var wrapper = document.querySelector(
      "body#TheBody > [data-sis-exercise-shell].hp-exercise-shell.wrapfit",
    );
    if (!wrapper || wrapper.dataset.sisExerciseShellBuilt === "true") return;
    var instructionPanel = wrapper.querySelector(
      ":scope > .hp-instructions-panel",
    );
    var main = wrapper.querySelector(":scope > #MainDiv");
    var feedback = wrapper.querySelector(":scope > #FeedbackDiv");
    var topNav = wrapper.querySelector(":scope > #TopNavBar");
    var bottomNav = wrapper.querySelector(":scope > #BottomNavBar");
    var closeContainer = wrapper.querySelector(":scope > .cenmar");
    if (!instructionPanel || !main) return;

    var shell = document.createElement("main");
    shell.className = "sis-exercise-content";
    shell.setAttribute("aria-label", "Comprehension exercise");
    var header = document.createElement("header");
    header.className = "sis-cloze-region sis-cloze-region--header";
    header.appendChild(instructionPanel);
    var identityRegion = document.createElement("section");
    identityRegion.className = "sis-cloze-region sis-cloze-region--identity";
    identityRegion.setAttribute("aria-label", "SIS result details");
    if (identityPanel) identityRegion.appendChild(identityPanel);
    var exerciseRegion = document.createElement("section");
    exerciseRegion.className = "sis-cloze-region sis-cloze-region--exercise";
    exerciseRegion.setAttribute("aria-label", "Comprehension questions");
    var submitRegion = document.createElement("div");
    submitRegion.className = "sis-exercise-submit-row";
    submitRegion.setAttribute("aria-label", "Submit exercise result");
    var submitButton = document.createElement("button");
    submitButton.className = "btn-17 hp-button sis-exercise-submit";
    submitButton.type = "button";
    submitButton.textContent = "Submit";
    submitButton.setAttribute("data-sis-exercise-submit", "");
    submitButton.setAttribute("aria-label", "Submit");
    submitButton.setAttribute(
      "aria-description",
      "Submit your completed exercise result to SIS.",
    );
    submitButton.setAttribute(
      "data-hp-tooltip",
      "Submit your completed exercise result to SIS.",
    );
    submitButton.disabled = true;
    submitButton.setAttribute("aria-disabled", "true");
    submitRegion.appendChild(submitButton);
    main.appendChild(submitRegion);
    exerciseRegion.appendChild(main);
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
      var syncFeedback = function () {
        var hidden =
          !feedbackText ||
          !normalizeText(feedbackText.textContent) ||
          window.getComputedStyle(feedback).display === "none";
        feedbackRegion.classList.toggle("hp-display-none", hidden);
      };
      syncFeedback();
      if (typeof window.MutationObserver === "function") {
        state.feedbackObserver = new window.MutationObserver(syncFeedback);
        state.feedbackObserver.observe(feedback, {
          attributes: true,
          attributeFilter: ["class", "style"],
          childList: true,
          subtree: true,
        });
      }
    }
    var footerRegion = document.createElement("footer");
    footerRegion.className = "sis-cloze-region sis-cloze-region--footer";
    footerRegion.setAttribute("aria-label", "Close exercise");
    if (closeContainer) footerRegion.appendChild(closeContainer);
    if (topNav) shell.appendChild(topNav);
    shell.appendChild(header);
    shell.appendChild(identityRegion);
    shell.appendChild(exerciseRegion);
    if (feedback) shell.appendChild(feedbackRegion);
    if (bottomNav) shell.appendChild(bottomNav);
    if (closeContainer) shell.appendChild(footerRegion);
    wrapper.insertBefore(shell, wrapper.firstChild);
    state.submitButton = submitButton;
    wrapper.dataset.sisExerciseShellBuilt = "true";
    document.body.dataset.sisExerciseFamily = "comp";
    document.body.classList.add("sis-exercise-story-theme");
  }

  function collectAnswerButtons() {
    return Array.prototype.slice
      .call(
        document.querySelectorAll(
          "button, input[type='button'], input[type='submit']",
        ),
      )
      .filter(function (button) {
        return /\bCheckMCAnswer\s*\(/i.test(
          normalizeText(button.getAttribute("onclick")),
        );
      });
  }

  function updateButtonState() {
    var identityValid = identityIsValid();
    var locked = window.Locked === true || state.submitted;
    var buttons = collectAnswerButtons();
    for (var index = 0; index < buttons.length; index += 1) {
      var button = buttons[index];
      var match = /CheckMCAnswer\s*\(\s*(\d+)/i.exec(
        button.getAttribute("onclick") || "",
      );
      var questionNumber = match ? Number(match[1]) : -1;
      var disabled =
        !identityValid ||
        state.submitting ||
        locked ||
        (questionNumber >= 0 && questionComplete(questionNumber));
      button.disabled = disabled;
      button.setAttribute("aria-disabled", disabled ? "true" : "false");
      button.classList.add("btn-17");
    }
    if (state.submitButton) {
      var submitDisabled =
        !identityValid ||
        state.submitting ||
        state.submitted ||
        !allQuestionsComplete();
      state.submitButton.disabled = submitDisabled;
      state.submitButton.setAttribute(
        "aria-disabled",
        submitDisabled ? "true" : "false",
      );
    }
    if (questions().length && identityValid && !allQuestionsComplete()) {
      setStatus(IDENTITY_READY_STATUS_MESSAGE, "success");
    }
  }

  function wrapCheckMCAnswer() {
    var original = window.CheckMCAnswer;
    if (typeof original !== "function" || original.__sisComprehensionWrapped)
      return;
    var wrapped = function () {
      var questionNumber = Number(arguments[0]);
      if (!identityIsValid()) {
        setStatus(IDENTITY_REQUIRED_STATUS_MESSAGE, "error");
        focusMissingIdentity();
        return false;
      }
      if (questionNumber >= 0 && questionComplete(questionNumber)) return false;
      var result = original.apply(this, arguments);
      updateButtonState();
      return result;
    };
    wrapped.__sisComprehensionWrapped = true;
    window.CheckMCAnswer = wrapped;
  }

  function buildPayload() {
    var identity = readFormIdentity();
    if (!identityIsValid(identity))
      throw new Error(IDENTITY_REQUIRED_STATUS_MESSAGE);
    if (!allQuestionsComplete())
      throw new Error(
        "Complete all questions in this exercise before submitting.",
      );
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
    var payload;
    try {
      payload = buildPayload();
    } catch (error) {
      setStatus(
        error && error.message
          ? String(error.message)
          : IDENTITY_REQUIRED_STATUS_MESSAGE,
        "error",
      );
      focusMissingIdentity();
      updateButtonState();
      return Promise.resolve(false);
    }
    state.submitting = true;
    persistIdentity({ email: payload.email, eaglesId: payload.eaglesId });
    setStatus("Submitting your result to SIS...", "");
    updateButtonState();
    var request = window.fetch
      ? window
          .fetch(resolveSubmitUrl(), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(payload),
          })
          .then(function (response) {
            if (response.ok) return response;
            return response.text().then(function (text) {
              throw new Error(
                text || "Submission failed (" + response.status + ")",
              );
            });
          })
      : new Promise(function (resolve, reject) {
          var xhr = new XMLHttpRequest();
          xhr.open("POST", resolveSubmitUrl(), true);
          xhr.setRequestHeader("Content-Type", "application/json");
          xhr.setRequestHeader("Accept", "application/json");
          xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            if (xhr.status >= 200 && xhr.status < 300)
              resolve(xhr.responseText);
            else reject(new Error("Submission failed (" + xhr.status + ")"));
          };
          xhr.onerror = function () {
            reject(new Error("Submission failed"));
          };
          xhr.send(JSON.stringify(payload));
        });
    state.submitPromise = request
      .then(function () {
        state.submitted = true;
        setStatus(
          "Submitted. A receipt has been emailed to " + payload.email + ".",
          "success",
        );
        return true;
      })
      .catch(function (error) {
        if (state.retryButton) state.retryButton.hidden = false;
        setStatus(
          "Submission failed. Retry when you are back online. " +
            (error && error.message ? error.message : ""),
          "error",
        );
        return false;
      })
      .finally(function () {
        state.submitting = false;
        updateButtonState();
      });
    return state.submitPromise;
  }

  function bind() {
    state.emailInput = document.querySelector("[data-sis-exercise-email]");
    state.eaglesIdInput = document.querySelector(
      "[data-sis-exercise-eagles-id]",
    );
    state.statusNode = document.querySelector("[data-sis-exercise-status]");
    state.submitButton = document.querySelector("[data-sis-exercise-submit]");
    state.retryButton = document.querySelector("[data-sis-exercise-retry]");
    if (
      !state.emailInput ||
      !state.eaglesIdInput ||
      !state.statusNode ||
      !state.submitButton
    )
      return;
    var saved = readIdentity();
    state.emailInput.value = saved.email;
    state.eaglesIdInput.value = saved.eaglesId;
    state.emailInput.setAttribute("aria-describedby", "sis-exercise-status");
    state.eaglesIdInput.setAttribute("aria-describedby", "sis-exercise-status");
    [state.emailInput, state.eaglesIdInput].forEach(function (input) {
      input.addEventListener("input", function () {
        var identity = readFormIdentity();
        if (identityIsValid(identity)) {
          persistIdentity(identity);
          setStatus(IDENTITY_READY_STATUS_MESSAGE, "success");
        } else {
          setStatus(IDENTITY_REQUIRED_STATUS_MESSAGE, "error");
        }
        updateButtonState();
      });
      input.addEventListener("blur", updateButtonState);
    });
    state.submitButton.addEventListener("click", submitAttempt);
    if (state.retryButton)
      state.retryButton.addEventListener("click", submitAttempt);
    wrapCheckMCAnswer();
    updateButtonState();
    if (identityIsValid()) setStatus(IDENTITY_READY_STATUS_MESSAGE, "success");
    else setStatus("", "");
  }

  function bootstrap() {
    if (state.initialized) return;
    var identityPanel = ensureIdentityPanel();
    buildModernShell(identityPanel);
    bind();
    state.initialized = true;
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", bootstrap);
  else bootstrap();

  window.SISExerciseBridge = {
    sourceSystem: SOURCE_SYSTEM,
    getAttemptId: getAttemptId,
    getPayload: buildPayload,
    submit: submitAttempt,
  };
})();
