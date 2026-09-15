(function () {
  "use strict";

  var activeScript = document.currentScript;
  var family = activeScript
    ? activeScript.getAttribute("data-sis-exercise-family")
    : "";
  if (family !== "dict" && family !== "sent") {
    family = /\/sent\//i.test(window.location.pathname) ? "sent" : "dict";
  }

  var SOURCE_SYSTEM =
    family === "sent" ? "sentence-scramble-web" : "dictation-web";
  var IDENTITY_KEY = "sis.cloze:identity";
  var IDENTITY_COOKIE = "sis_cloze_identity";
  var ATTEMPT_KEY_PREFIX = "sis.exercise:attempt:";
  var EXERCISE_PROGRESS_KEY_PREFIX = "sis.exercise:progress:";
  var REQUIRED_SET_QUESTIONS = 5;
  var HINTS_WITHOUT_PENALTY_PER_QUESTION = 2;
  var MAX_HINTS_PER_SET = 14;
  var HINT_PENALTY_PERCENT_PER_EXTRA_HINT = 7;
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
    guessObserver: null,
    emailInput: null,
    eaglesIdInput: null,
    statusNode: null,
    feedbackObserver: null,
    actionButtons: [],
    submitButton: null,
    retryButton: null,
    attemptId: "",
    attemptIdKey: "",
    answersRevealedAll: false,
    revealedAnswerIndexes: Object.create(null),
    exerciseProgressKey: "",
    exerciseProgress: null,
    adjustedQuestionScores: Object.create(null),
    sentenceScoreAdjusted: false,
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
      if (!parsed || typeof parsed !== "object")
        return { email: "", eaglesId: "" };
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
    var normalized = identity || readFormIdentity();
    return (
      EMAIL_PATTERN.test(normalized.email) &&
      EAGLES_ID_PATTERN.test(normalized.eaglesId)
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

  function exerciseSetInfo() {
    var pathname = normalizeText(location.pathname) || "exercise";
    var filename = pathname.slice(pathname.lastIndexOf("/") + 1);
    if (family === "sent") {
      var sentencePage = /^(.*)([1-5])(\.html?)$/i.exec(filename);
      if (sentencePage) {
        return {
          key:
            pathname.slice(0, pathname.length - filename.length) +
            sentencePage[1],
          questionKey: String(Number(sentencePage[2])).padStart(2, "0"),
          totalQuestions: REQUIRED_SET_QUESTIONS,
        };
      }
      return {
        key: pageKey(),
        questionKey: "01",
        totalQuestions: REQUIRED_SET_QUESTIONS,
      };
    }

    var questionCount = document.querySelectorAll(
      "#Questions > .QuizQuestion",
    ).length;
    return {
      key: pageKey(),
      questionKey: "",
      totalQuestions: questionCount,
    };
  }

  function emptyExerciseProgress() {
    return {
      version: 1,
      hintsByQuestion: Object.create(null),
      completedByQuestion: Object.create(null),
    };
  }

  function readExerciseProgress(key) {
    var progress = emptyExerciseProgress();
    var raw = readStorage(key);
    if (!raw) return progress;
    try {
      var saved = JSON.parse(raw);
      if (!saved || saved.version !== 1 || typeof saved !== "object")
        return progress;
      var hintCounts = saved.hintsByQuestion;
      if (hintCounts && typeof hintCounts === "object") {
        Object.keys(hintCounts).forEach(function (questionKey) {
          var count = Number(hintCounts[questionKey]);
          if (Number.isInteger(count) && count > 0)
            progress.hintsByQuestion[questionKey] = count;
        });
      }
      var completed = saved.completedByQuestion;
      if (completed && typeof completed === "object") {
        Object.keys(completed).forEach(function (questionKey) {
          var result = completed[questionKey];
          var score = Number(result && result.scorePercent);
          if (!result || !Number.isFinite(score)) return;
          progress.completedByQuestion[questionKey] = {
            correct: result.correct === true,
            scorePercent: Math.max(0, Math.min(100, score)),
          };
        });
      }
    } catch {
      return progress;
    }
    return progress;
  }

  function currentExerciseProgress() {
    var identity = readFormIdentity();
    var info = exerciseSetInfo();
    var key =
      EXERCISE_PROGRESS_KEY_PREFIX +
      SOURCE_SYSTEM +
      ":" +
      info.key +
      ":" +
      (identity.eaglesId || "unidentified");
    if (state.exerciseProgressKey !== key) {
      state.exerciseProgressKey = key;
      state.exerciseProgress = readExerciseProgress(key);
    }
    return state.exerciseProgress;
  }

  function saveExerciseProgress() {
    if (!state.exerciseProgressKey || !state.exerciseProgress) return;
    writeStorage(
      state.exerciseProgressKey,
      JSON.stringify(state.exerciseProgress),
    );
  }

  function currentQuestionKey(questionIndex) {
    if (family === "sent") return exerciseSetInfo().questionKey;
    var normalizedIndex = Number(questionIndex);
    return Number.isInteger(normalizedIndex) && normalizedIndex >= 0
      ? String(normalizedIndex)
      : "";
  }

  function hintCountForQuestion(questionKey) {
    if (!questionKey) return 0;
    var progress = currentExerciseProgress();
    var count = Number(progress.hintsByQuestion[questionKey]);
    return Number.isInteger(count) && count > 0 ? count : 0;
  }

  function totalHintsUsed() {
    var progress = currentExerciseProgress();
    return Object.keys(progress.hintsByQuestion).reduce(function (
      total,
      questionKey,
    ) {
      var count = Number(progress.hintsByQuestion[questionKey]);
      return total + (Number.isInteger(count) && count > 0 ? count : 0);
    }, 0);
  }

  function recordHint(questionKey) {
    if (!questionKey) return false;
    var progress = currentExerciseProgress();
    if (totalHintsUsed() >= MAX_HINTS_PER_SET) return false;
    progress.hintsByQuestion[questionKey] =
      hintCountForQuestion(questionKey) + 1;
    saveExerciseProgress();
    return true;
  }

  function extraHintPenalty(questionKey) {
    return (
      Math.max(
        0,
        hintCountForQuestion(questionKey) - HINTS_WITHOUT_PENALTY_PER_QUESTION,
      ) * HINT_PENALTY_PERCENT_PER_EXTRA_HINT
    );
  }

  function getAttemptId() {
    var identity = readFormIdentity();
    var key =
      ATTEMPT_KEY_PREFIX +
      SOURCE_SYSTEM +
      ":" +
      exerciseSetInfo().key +
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
      exerciseSetInfo().key.replace(/[^a-z0-9]+/gi, "-") +
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

  function finiteScore() {
    var score = Number(window.Score);
    return Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null;
  }

  function updateVisibleScore(score) {
    var scoreText = Number(score).toFixed(2).replace(/\.00$/, "");
    var targets = [
      document.querySelector("#InstructionsDiv"),
      document.querySelector("#FeedbackContent"),
    ];
    for (var index = 0; index < targets.length; index += 1) {
      var target = targets[index];
      if (!target || !target.innerHTML) continue;
      target.innerHTML = target.innerHTML.replace(
        /(Your score is\s*)\d+(?:\.\d+)?\s*%/i,
        "$1" + scoreText + "%",
      );
    }
  }

  function dictationQuestionIndexes() {
    var states = Array.isArray(window.State) ? window.State : [];
    var indexes = [];
    for (var index = 0; index < states.length; index += 1) {
      if (Array.isArray(states[index])) indexes.push(index);
    }
    return indexes;
  }

  function dictationQuestionIsComplete(questionIndex) {
    var questionState =
      Array.isArray(window.State) && window.State[questionIndex];
    return Array.isArray(questionState) && Number(questionState[0]) >= 0;
  }

  function restoreAdjustedQuestionScore(questionIndex) {
    var adjustedScore = state.adjustedQuestionScores[String(questionIndex)];
    var questionState =
      Array.isArray(window.State) && window.State[questionIndex];
    if (!adjustedScore || !Array.isArray(questionState)) return;
    if (
      Math.abs(Number(questionState[0]) - adjustedScore.adjusted) < 0.000001
    ) {
      questionState[0] = adjustedScore.raw;
    }
    delete state.adjustedQuestionScores[String(questionIndex)];
  }

  function applyDictationHintPenalties() {
    var indexes = dictationQuestionIndexes();
    var changed = false;
    for (var index = 0; index < indexes.length; index += 1) {
      var questionIndex = indexes[index];
      if (!dictationQuestionIsComplete(questionIndex)) continue;
      var questionKey = String(questionIndex);
      var questionState = window.State[questionIndex];
      var existing = state.adjustedQuestionScores[questionKey];
      if (
        existing &&
        Math.abs(Number(questionState[0]) - existing.adjusted) < 0.000001
      )
        continue;

      var rawScore = Number(questionState[0]);
      if (!Number.isFinite(rawScore)) continue;
      var deduction = extraHintPenalty(questionKey) / 100;
      var adjusted = Math.max(0, rawScore - deduction);
      questionState[0] = adjusted;
      state.adjustedQuestionScores[questionKey] = {
        raw: rawScore,
        adjusted: adjusted,
        correct: rawScore >= 1,
      };
      changed = true;
    }
    if (changed && typeof window.CalculateOverallScore === "function") {
      window.CalculateOverallScore();
      var score = finiteScore();
      if (score != null) updateVisibleScore(score);
    }
  }

  function recordSentenceCompletion() {
    if (
      family !== "sent" ||
      window.Locked !== true ||
      state.sentenceScoreAdjusted
    )
      return;
    var info = exerciseSetInfo();
    var progress = currentExerciseProgress();
    var rawScore = finiteScore();
    if (rawScore == null) rawScore = 100;
    var adjustedScore = Math.max(
      0,
      rawScore - extraHintPenalty(info.questionKey),
    );
    window.Score = adjustedScore;
    state.sentenceScoreAdjusted = true;
    updateVisibleScore(adjustedScore);
    progress.completedByQuestion[info.questionKey] = {
      correct: true,
      scorePercent: adjustedScore,
    };
    saveExerciseProgress();
  }

  function isExerciseSetComplete() {
    var info = exerciseSetInfo();
    if (family === "sent") {
      if (info.totalQuestions !== REQUIRED_SET_QUESTIONS) return false;
      var completed = currentExerciseProgress().completedByQuestion;
      for (
        var questionNumber = 1;
        questionNumber <= REQUIRED_SET_QUESTIONS;
        questionNumber += 1
      ) {
        if (!completed[String(questionNumber).padStart(2, "0")]) return false;
      }
      return true;
    }

    var indexes = dictationQuestionIndexes();
    if (info.totalQuestions <= 0 || indexes.length !== info.totalQuestions)
      return false;
    for (var index = 0; index < indexes.length; index += 1) {
      if (!dictationQuestionIsComplete(indexes[index])) return false;
    }
    return true;
  }

  function getAnswerCounts() {
    var score = finiteScore();
    if (family === "sent") {
      var completedSentences = currentExerciseProgress().completedByQuestion;
      var sentenceCorrectCount = 0;
      var sentenceScoreTotal = 0;
      var completedCount = 0;
      for (
        var sentenceNumber = 1;
        sentenceNumber <= REQUIRED_SET_QUESTIONS;
        sentenceNumber += 1
      ) {
        var sentenceResult =
          completedSentences[String(sentenceNumber).padStart(2, "0")];
        if (!sentenceResult) continue;
        completedCount += 1;
        sentenceScoreTotal += sentenceResult.scorePercent;
        if (sentenceResult.correct) sentenceCorrectCount += 1;
      }
      return {
        totalQuestions: REQUIRED_SET_QUESTIONS,
        correctCount: sentenceCorrectCount,
        pendingCount: Math.max(REQUIRED_SET_QUESTIONS - completedCount, 0),
        incorrectCount: Math.max(completedCount - sentenceCorrectCount, 0),
        scorePercent:
          completedCount === REQUIRED_SET_QUESTIONS
            ? Number((sentenceScoreTotal / REQUIRED_SET_QUESTIONS).toFixed(2))
            : score == null
              ? 0
              : score,
      };
    }

    var states = Array.isArray(window.State) ? window.State : [];
    var questionIndexes = dictationQuestionIndexes();
    var totalQuestions = exerciseSetInfo().totalQuestions;
    var correctCount = 0;
    var pendingCount = 0;
    for (var index = 0; index < questionIndexes.length; index += 1) {
      var questionIndex = questionIndexes[index];
      if (
        state.answersRevealedAll ||
        Object.prototype.hasOwnProperty.call(
          state.revealedAnswerIndexes,
          questionIndex,
        )
      ) {
        continue;
      }
      var adjustedQuestion =
        state.adjustedQuestionScores[String(questionIndex)];
      var questionScore = Number(
        adjustedQuestion ? adjustedQuestion.raw : states[questionIndex][0],
      );
      if (questionScore >= 1) correctCount += 1;
      else if (questionScore < 0) pendingCount += 1;
    }
    var incorrectCount = Math.max(
      totalQuestions - correctCount - pendingCount,
      0,
    );
    var hasRevealedAnswer =
      state.answersRevealedAll ||
      Object.keys(state.revealedAnswerIndexes).length > 0;
    var completedWeight = 0;
    var completedScore = 0;
    for (
      var scoreIndex = 0;
      scoreIndex < questionIndexes.length;
      scoreIndex += 1
    ) {
      var completedQuestionIndex = questionIndexes[scoreIndex];
      var completedQuestionState = states[completedQuestionIndex];
      if (Number(completedQuestionState[0]) < 0) continue;
      var weight =
        Array.isArray(window.I) && window.I[completedQuestionIndex]
          ? Number(window.I[completedQuestionIndex][0]) || 1
          : 1;
      completedWeight += weight;
      completedScore += weight * Number(completedQuestionState[0]);
    }
    var calculatedScore =
      completedWeight > 0
        ? Number(((completedScore / completedWeight) * 100).toFixed(2))
        : 0;
    var scorePercent =
      hasRevealedAnswer || score == null ? calculatedScore : score;
    return {
      totalQuestions,
      correctCount,
      pendingCount,
      incorrectCount,
      scorePercent,
    };
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

  function questionIndexForButton(button) {
    if (family !== "dict" || !button) return -1;
    var onclick = normalizeText(button.getAttribute("onclick"));
    var match = /(?:CheckShortAnswer|ShowHint|ShowAnswers)\s*\(\s*(\d+)/i.exec(
      onclick,
    );
    return match ? Number(match[1]) : -1;
  }

  function updateActionButtons() {
    if (family === "sent") recordSentenceCompletion();
    if (family === "dict") applyDictationHintPenalties();

    var identityValid = identityIsValid();
    var commonDisabled =
      !identityValid ||
      state.submitting ||
      state.submitted ||
      window.Locked === true;
    var hintsExhausted = totalHintsUsed() >= MAX_HINTS_PER_SET;
    for (var index = 0; index < state.actionButtons.length; index += 1) {
      var button = state.actionButtons[index];
      var action = getActionFromButton(button);
      var questionIndex = questionIndexForButton(button);
      var questionComplete =
        family === "dict" &&
        questionIndex >= 0 &&
        dictationQuestionIsComplete(questionIndex);
      var disabled =
        commonDisabled ||
        (action === "hint" && hintsExhausted) ||
        (action === "hint" && questionComplete) ||
        (action === "check" && questionComplete);
      button.disabled = disabled;
      button.setAttribute("aria-disabled", disabled ? "true" : "false");
    }
    if (state.submitButton) {
      var disableSubmit =
        !identityValid ||
        state.submitting ||
        state.submitted ||
        !isExerciseSetComplete();
      state.submitButton.disabled = disableSubmit;
      state.submitButton.setAttribute(
        "aria-disabled",
        disableSubmit ? "true" : "false",
      );
    }
    if (
      hintsExhausted &&
      identityValid &&
      !state.submitting &&
      !state.submitted
    ) {
      setStatus(
        "The 14-hint limit for this exercise set has been reached. No more hints are available.",
        "error",
      );
    }
  }

  function sendWithFetch(url, payload) {
    return window
      .fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        keepalive: true,
      })
      .then(function (response) {
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
    return window.fetch
      ? sendWithFetch(url, payload)
      : sendWithXhr(url, payload);
  }

  function buildPayload() {
    var identity = readFormIdentity();
    if (!identityIsValid(identity)) {
      throw new Error(IDENTITY_REQUIRED_STATUS_MESSAGE);
    }
    if (!isExerciseSetComplete()) {
      throw new Error(
        "Complete all 5 questions in this exercise set before submitting.",
      );
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
    if (!isExerciseSetComplete()) {
      setStatus(
        "Complete all 5 questions in this exercise set before submitting.",
        "error",
      );
      updateActionButtons();
      return Promise.resolve(false);
    }

    var payload;
    try {
      payload = buildPayload();
    } catch (error) {
      setStatus(
        error && error.message
          ? String(error.message)
          : "Enter your EaglesID and student email to activate Check and Hint.",
        "error",
      );
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
        setStatus(
          "Submitted. A receipt has been emailed to " + payload.email + ".",
          "success",
        );
        return true;
      })
      .catch(function (error) {
        var message =
          error && error.message ? String(error.message) : "Submission failed";
        if (state.retryButton) state.retryButton.hidden = false;
        setStatus(
          "Submission failed. Retry when you are back online. " + message,
          "error",
        );
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
    instructionText = instructionText.replace(
      new RegExp("^" + labelText + "\\s*:\\s*", "i"),
      "",
    );
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
      '<p class="sis-cloze-panel__instruction">Enter your EaglesID and student email to activate Check and Hint.</p>' +
      '<div class="sis-cloze-panel__grid">' +
      '<label class="sis-cloze-field" for="sis-exercise-email">' +
      '<span class="sis-cloze-field__label">Student email</span>' +
      '<input id="sis-exercise-email" data-sis-identity-email data-sis-exercise-email type="email" autocomplete="email" inputmode="email" placeholder="name@example.com" required>' +
      "</label>" +
      '<label class="sis-cloze-field" for="sis-exercise-eagles-id">' +
      '<span class="sis-cloze-field__label">Eagles ID</span>' +
      '<input id="sis-exercise-eagles-id" data-sis-identity-eagles-id data-sis-exercise-eagles-id type="text" autocomplete="username" autocapitalize="none" spellcheck="false" inputmode="text" pattern="^[a-z]+\\d{3}$" placeholder="tammy001" required>' +
      "</label>" +
      "</div>" +
      '<p id="sis-exercise-status" class="sis-cloze-status" data-sis-identity-status data-sis-exercise-status aria-live="polite"></p>' +
      '<button class="btn-17 hp-button sis-exercise-retry" type="button" data-sis-exercise-retry aria-label="Retry" aria-description="Retry submitting your result to SIS." data-hp-tooltip="Retry submitting your result to SIS." hidden>Retry</button>';
    main.parentNode.insertBefore(panel, main);
    return panel;
  }

  function buildModernShell() {
    var wrapper = document.querySelector(
      "body#TheBody > [data-sis-exercise-shell].hp-exercise-shell.wrapfit",
    );
    if (!wrapper || wrapper.dataset.sisExerciseShellBuilt === "true") return;
    var instructionPanel = wrapper.querySelector(
      ":scope > .hp-instructions-panel",
    );
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
    var retryButton =
      identityPanel && identityPanel.querySelector("[data-sis-exercise-retry]");
    if ((!instructionPanel && (!titles || !instructions)) || !main) return;

    if (guess) {
      var containsOnlyWhitespace = true;
      for (
        var nodeIndex = 0;
        nodeIndex < guess.childNodes.length;
        nodeIndex += 1
      ) {
        var child = guess.childNodes[nodeIndex];
        if (child.nodeType !== 3 || normalizeText(child.textContent)) {
          containsOnlyWhitespace = false;
          break;
        }
      }
      if (containsOnlyWhitespace) {
        while (guess.firstChild) guess.removeChild(guess.firstChild);
      }
      var syncGuessVisibility = function () {
        guess.classList.toggle(
          "hp-display-none",
          !normalizeText(guess.textContent),
        );
      };
      syncGuessVisibility();
      if (typeof window.MutationObserver === "function") {
        state.guessObserver = new window.MutationObserver(syncGuessVisibility);
        state.guessObserver.observe(guess, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      }
    }

    var shell = document.createElement("main");
    shell.className = "sis-exercise-content";
    shell.setAttribute(
      "aria-label",
      family === "sent" ? "Sentence scramble exercise" : "Dictation exercise",
    );
    wrapper.insertBefore(
      shell,
      topNav || instructionPanel || titles || identityPanel || main,
    );
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
    if (retryButton) submitRegion.appendChild(retryButton);

    if (family === "sent") {
      var segment = main.querySelector(":scope > #SegmentDiv");
      var controls = document.createElement("div");
      controls.className = "sis-exercise-controls";
      controls.setAttribute("role", "group");
      controls.setAttribute("aria-label", "Sentence exercise controls");

      var exerciseButtons = Array.prototype.slice.call(
        main.querySelectorAll(":scope > .FuncButton"),
      );
      for (
        var buttonIndex = 0;
        buttonIndex < exerciseButtons.length;
        buttonIndex += 1
      ) {
        controls.appendChild(exerciseButtons[buttonIndex]);
      }

      if (segment && segment.parentNode === main) {
        main.insertBefore(controls, segment.nextSibling);
      } else {
        main.appendChild(controls);
      }
      controls.appendChild(submitRegion);
      if (guess) exerciseRegion.appendChild(guess);
      exerciseRegion.appendChild(main);
    } else {
      main.appendChild(submitRegion);
      exerciseRegion.appendChild(main);
    }
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
        var hasMessage =
          feedbackText && normalizeText(feedbackText.textContent);
        var isHidden =
          !hasMessage || window.getComputedStyle(feedback).display === "none";
        feedbackRegion.classList.toggle("hp-display-none", isHidden);
      };
      syncFeedbackVisibility();
      if (typeof window.MutationObserver === "function") {
        state.feedbackObserver = new window.MutationObserver(
          syncFeedbackVisibility,
        );
        state.feedbackObserver.observe(feedback, {
          attributes: true,
          attributeFilter: ["class", "style"],
        });
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
      while (
        trailingBreak &&
        trailingBreak.nodeType === 3 &&
        !normalizeText(trailingBreak.textContent)
      ) {
        trailingBreak = trailingBreak.nextSibling;
      }
      if (trailingBreak && trailingBreak.nodeName === "BR")
        trailingBreak.remove();
    }
    state.submitButton = submitButton;
    wrapper.dataset.sisExerciseShellBuilt = "true";
    document.body.dataset.sisExerciseFamily = family;
    document.body.classList.add("sis-exercise-story-theme");
  }

  function getActionFromButton(button) {
    var onclick = normalizeText(button.getAttribute("onclick")).toLowerCase();
    if (family === "sent" && /checkanswer\s*\(\s*1\s*\)/.test(onclick))
      return "hint";
    if (/checkshortanswer\s*\(|checkanswer\s*\(/.test(onclick)) return "check";
    if (/showhint\s*\(/.test(onclick)) return "hint";
    if (/showanswers\s*\(/.test(onclick)) return "answer";
    return "";
  }

  function collectActionButtons() {
    var buttons = Array.prototype.slice.call(
      document.querySelectorAll(
        "button, input[type='button'], input[type='submit']",
      ),
    );
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

  function normalizeDictationControls() {
    var groups = new Map();
    for (var index = 0; index < state.actionButtons.length; index += 1) {
      var button = state.actionButtons[index];
      var parent = button.parentElement;
      if (!parent) continue;
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(button);
    }

    groups.forEach(function (buttons, parent) {
      var controls = parent.querySelector(":scope > .sis-exercise-controls");
      if (!controls) {
        controls = document.createElement("div");
        controls.className = "sis-exercise-controls";
        controls.setAttribute("role", "group");
        controls.setAttribute("aria-label", "Dictation question controls");
        parent.insertBefore(controls, buttons[0]);
      }
      for (
        var buttonIndex = 0;
        buttonIndex < buttons.length;
        buttonIndex += 1
      ) {
        controls.appendChild(buttons[buttonIndex]);
      }

      var preceding = controls.previousElementSibling;
      while (preceding && preceding.tagName === "BR") {
        var previous = preceding.previousElementSibling;
        preceding.remove();
        preceding = previous;
      }
    });
    var finalGroup = Array.from(groups.keys()).pop();
    var submitRow = document.querySelector(".sis-exercise-submit-row");
    if (finalGroup && submitRow) {
      var finalControls = finalGroup.querySelector(
        ":scope > .sis-exercise-controls",
      );
      if (finalControls) finalControls.appendChild(submitRow);
    }
  }

  function normalizeDictationAnswerFields() {
    if (family !== "dict") return;
    var fields = document.querySelectorAll("textarea.ShortAnswerBox");
    for (var index = 0; index < fields.length; index += 1) {
      var field = fields[index];
      field.classList.add("sis-dictation-answer");
      field.rows = 1;
      field.setAttribute("rows", "1");
      var resize = function () {
        this.style.height = "auto";
        this.style.height = `${this.scrollHeight}px`;
      };
      field.addEventListener("input", resize);
      resize.call(field);
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
          setStatus(IDENTITY_READY_STATUS_MESSAGE, "success");
        } else {
          setStatus(IDENTITY_REQUIRED_STATUS_MESSAGE, "error");
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
      var args = arguments;
      var questionIndex = Number(args[0]);
      var isSentenceHint =
        family === "sent" && name === "CheckAnswer" && Number(args[0]) === 1;
      var isHintAction = name === "ShowHint" || isSentenceHint;
      var questionKey = currentQuestionKey(questionIndex);
      if (!identityIsValid()) {
        setStatus(invalidMessage, "error");
        focusMissingIdentity();
        return false;
      }

      if (isHintAction) {
        if (
          (family === "sent" && window.Locked === true) ||
          (family === "dict" && dictationQuestionIsComplete(questionIndex))
        ) {
          return false;
        }
        if (totalHintsUsed() >= MAX_HINTS_PER_SET || !recordHint(questionKey)) {
          setStatus(
            "The 14-hint limit for this exercise set has been reached. No more hints are available.",
            "error",
          );
          updateActionButtons();
          return false;
        }
      } else if (
        family === "sent" &&
        name === "CheckAnswer" &&
        window.Locked === true
      ) {
        return false;
      } else if (
        family === "dict" &&
        name === "CheckShortAnswer" &&
        dictationQuestionIsComplete(questionIndex)
      ) {
        return false;
      }

      var sentencePenaltyBeforeHint = isSentenceHint ? window.Penalties : null;
      var dictationHintState =
        isHintAction &&
        family === "dict" &&
        Array.isArray(window.State) &&
        Array.isArray(window.State[questionIndex])
          ? {
              answerScore: window.State[questionIndex][3],
              hintPenalty: window.State[questionIndex][4],
              score: window.State[questionIndex][0],
              tries: window.State[questionIndex][2],
            }
          : null;

      if (family === "dict" && name !== "ShowHint" && name !== "CheckAnswer") {
        restoreAdjustedQuestionScore(questionIndex);
      }
      if (name === "ShowAnswers") {
        if (Number.isInteger(questionIndex) && questionIndex >= 0) {
          state.revealedAnswerIndexes[questionIndex] = true;
        } else {
          state.answersRevealedAll = true;
        }
      }
      var result = original.apply(this, args);

      if (isSentenceHint && sentencePenaltyBeforeHint != null) {
        window.Penalties = sentencePenaltyBeforeHint;
      }
      if (dictationHintState) {
        var questionState = window.State[questionIndex];
        var becameComplete =
          Number(dictationHintState.score) < 0 && Number(questionState[0]) >= 0;
        if (becameComplete) restoreAdjustedQuestionScore(questionIndex);
        questionState[2] = dictationHintState.tries;
        questionState[4] = dictationHintState.hintPenalty;
        if (becameComplete) {
          var attemptCount =
            Number(questionState[2]) + Number(questionState[4]);
          questionState[0] =
            Number(questionState[4]) >= 1
              ? 0
              : Number(questionState[3]) / (100 * Math.max(attemptCount, 1));
        }
      }
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
    collectActionButtons();
    if (family === "dict") {
      normalizeDictationAnswerFields();
      normalizeDictationControls();
    }
    bindIdentityEvents();
    state.submitButton.addEventListener("click", submitAttempt);
    if (state.retryButton)
      state.retryButton.addEventListener("click", submitAttempt);
    wrapAction("CheckShortAnswer", IDENTITY_REQUIRED_STATUS_MESSAGE);
    wrapAction("CheckAnswer", IDENTITY_REQUIRED_STATUS_MESSAGE);
    wrapAction("ShowHint", IDENTITY_REQUIRED_STATUS_MESSAGE);
    wrapAction("ShowAnswers", IDENTITY_REQUIRED_STATUS_MESSAGE);
    wrapFinish();
    updateActionButtons();
    if (identityIsValid()) {
      setStatus(IDENTITY_READY_STATUS_MESSAGE, "success");
    } else {
      setStatus(IDENTITY_REQUIRED_STATUS_MESSAGE, "error");
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
