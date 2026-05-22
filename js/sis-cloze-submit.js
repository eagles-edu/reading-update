(function () {
  "use strict"

  var SOURCE_SYSTEM = "cloze-web"
  var STORAGE_PREFIX = "sis.cloze"
  var IDENTITY_KEY = STORAGE_PREFIX + ":identity"
  var IDENTITY_COOKIE = "sis_cloze_identity"
  var ATTEMPT_KEY_PREFIX = STORAGE_PREFIX + ":attempt:"
  var IDENTITY_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 2
  var PROTOTYPE_STYLE = "current"
  var TEST_EXERCISE_SUBMIT_HOST = "test.eagles.edu.vn"
  // Change this back to 8787 when the local/test backend moves back to that port.
  var EXERCISE_SUBMIT_PORT = 8786
  var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  var EAGLES_ID_PATTERN = /^[a-z]+\d{3}$/

  var state = {
    initialized: false,
    checkingAnswers: false,
    submitting: false,
    submitted: false,
    submitPromise: null,
    lastError: "",
    emailInput: null,
    eaglesIdInput: null,
    statusNode: null,
    checkButtons: [],
    hintButtons: [],
    attemptId: "",
  }

  function normalizeText(value) {
    return String(value == null ? "" : value).trim()
  }

  function readStorage(key) {
    try {
      if (!window.localStorage) return ""
      return window.localStorage.getItem(key) || ""
    } catch {
      return ""
    }
  }

  function writeStorage(key, value) {
    try {
      if (!window.localStorage) return
      if (value === null || value === undefined || value === "") {
        window.localStorage.removeItem(key)
      } else {
        window.localStorage.setItem(key, String(value))
      }
    } catch {
      // Ignore storage failures in privacy-restricted browsers.
    }
  }

  function readCookie(name) {
    if (!document.cookie) return ""
    var parts = document.cookie.split(";")
    for (var i = 0; i < parts.length; i += 1) {
      var entry = parts[i].trim()
      if (!entry || entry.indexOf(name + "=") !== 0) continue
      return decodeURIComponent(entry.slice(name.length + 1))
    }
    return ""
  }

  function writeCookie(name, value, maxAgeSeconds) {
    try {
      var encoded = encodeURIComponent(value)
      document.cookie =
        name +
        "=" +
        encoded +
        "; Path=/; Max-Age=" +
        String(maxAgeSeconds) +
        "; SameSite=Lax"
    } catch {
      // Cookie persistence is best-effort.
    }
  }

  function pageKey() {
    return normalizeText(location.pathname)
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "") || "exercise"
  }

  function attemptStorageKey() {
    return ATTEMPT_KEY_PREFIX + pageKey()
  }

  function identityStorageKey() {
    return IDENTITY_KEY
  }

  function readIdentity() {
    var raw = readStorage(identityStorageKey()) || readCookie(IDENTITY_COOKIE)
    if (!raw) return { email: "", eaglesId: "" }

    try {
      var parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== "object") return { email: "", eaglesId: "" }
      return {
        email: normalizeText(parsed.email),
        eaglesId: normalizeText(parsed.eaglesId),
      }
    } catch {
      return { email: "", eaglesId: "" }
    }
  }

  function persistIdentity(identity) {
    var email = normalizeText(identity && identity.email)
    var eaglesId = normalizeText(identity && identity.eaglesId)
    if (!email || !eaglesId) return

    var payload = JSON.stringify({ email: email, eaglesId: eaglesId })
    writeStorage(identityStorageKey(), payload)
    writeCookie(IDENTITY_COOKIE, payload, IDENTITY_COOKIE_MAX_AGE_SECONDS)
  }

  function getPageTitle() {
    return normalizeText(document.title).replace(/\s+/g, " ")
  }

  function getAttemptId() {
    if (state.attemptId) return state.attemptId

    var existing = readStorage(attemptStorageKey())
    if (existing) {
      state.attemptId = existing
      return existing
    }

    var created =
      SOURCE_SYSTEM +
      ":" +
      pageKey() +
      ":" +
      (window.crypto && typeof window.crypto.randomUUID === "function"
        ? window.crypto.randomUUID()
        : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10))

    state.attemptId = created
    writeStorage(attemptStorageKey(), created)
    return created
  }

  function resolveSubmitUrl() {
    var configured = normalizeText(window.SIS_EXERCISE_SUBMIT_URL || "")
    if (configured) return configured

    if (
      location.protocol === "file:" ||
      location.host === "localhost:5500" ||
      location.host === "127.0.0.1:5500"
    ) {
      return "http://127.0.0.1:" + String(EXERCISE_SUBMIT_PORT) + "/api/exercise-submission"
    }

    if (location.host === TEST_EXERCISE_SUBMIT_HOST) {
      return (
        location.protocol +
        "//" +
        TEST_EXERCISE_SUBMIT_HOST +
        ":" +
        String(EXERCISE_SUBMIT_PORT) +
        "/api/exercise-submission"
      )
    }

    return location.origin + "/api/exercise-submission"
  }

  function getQuestionCount() {
    return Array.isArray(window.I) ? window.I.length : 0
  }

  function getAnswerCounts() {
    var totalQuestions = getQuestionCount()
    var correctCount = 0

    if (Array.isArray(window.State)) {
      for (var i = 0; i < window.State.length; i += 1) {
        if (window.State[i] && window.State[i].AnsweredCorrectly === true) {
          correctCount += 1
        }
      }
    } else {
      correctCount = totalQuestions
    }

    if (correctCount > totalQuestions) correctCount = totalQuestions

    var pendingCount = 0
    var incorrectCount = Math.max(totalQuestions - correctCount - pendingCount, 0)
    var scorePercent =
      totalQuestions > 0 ? Number(((correctCount / totalQuestions) * 100).toFixed(2)) : 0

    return {
      totalQuestions: totalQuestions,
      correctCount: correctCount,
      pendingCount: pendingCount,
      incorrectCount: incorrectCount,
      scorePercent: scorePercent,
    }
  }

  function readFormIdentity() {
    return {
      email: normalizeText(state.emailInput && state.emailInput.value),
      eaglesId: normalizeText(state.eaglesIdInput && state.eaglesIdInput.value).toLowerCase(),
    }
  }

  function isValidEmail(value) {
    return EMAIL_PATTERN.test(normalizeText(value))
  }

  function isValidEaglesId(value) {
    return EAGLES_ID_PATTERN.test(normalizeText(value).toLowerCase())
  }

  function isIdentityReady(identity) {
    var normalized = identity || readFormIdentity()
    return isValidEmail(normalized.email) && isValidEaglesId(normalized.eaglesId)
  }

  function setStatus(message, kind) {
    if (!state.statusNode) return
    state.statusNode.textContent = message || ""
    state.statusNode.classList.remove("sis-cloze-status--error", "sis-cloze-status--success")
    if (kind === "error") {
      state.statusNode.classList.add("sis-cloze-status--error")
    } else if (kind === "success") {
      state.statusNode.classList.add("sis-cloze-status--success")
    }
  }

  function getFeedbackButton() {
    return document.getElementById("FeedbackOKButton")
  }

  function setFeedbackButtonLabel(label) {
    var button = getFeedbackButton()
    if (!button) return

    var safeLabel = label || "OK"
    button.innerHTML = "&nbsp;" + safeLabel + "&nbsp;"
    button.setAttribute("aria-label", safeLabel)
  }

  function setFeedbackLabelForScore(scorePercent) {
    setFeedbackButtonLabel(scorePercent < 100 ? "Retry" : "OK")
  }

  function updateButtonState() {
    var identityReady = isIdentityReady()
    var isLocked = window.Locked === true || state.submitted
    var disableChecks = !identityReady || state.submitting || isLocked
    var disableHints = !identityReady || state.submitting || isLocked

    for (var i = 0; i < state.checkButtons.length; i += 1) {
      state.checkButtons[i].disabled = disableChecks
      state.checkButtons[i].setAttribute("aria-disabled", disableChecks ? "true" : "false")
    }

    for (var j = 0; j < state.hintButtons.length; j += 1) {
      state.hintButtons[j].disabled = disableHints
      state.hintButtons[j].setAttribute("aria-disabled", disableHints ? "true" : "false")
    }

  }

  function focusMissingIdentityField() {
    var identity = readFormIdentity()
    if (!isValidEmail(identity.email) && state.emailInput) {
      state.emailInput.focus()
      return
    }
    if (!isValidEaglesId(identity.eaglesId) && state.eaglesIdInput) {
      state.eaglesIdInput.focus()
    }
  }

  function syncIdentityFromStorage() {
    var stored = readIdentity()
    if (!stored.email || !stored.eaglesId) return

    var currentEmail = normalizeText(state.emailInput && state.emailInput.value)
    var currentEaglesId = normalizeText(state.eaglesIdInput && state.eaglesIdInput.value)

    if (state.emailInput && !currentEmail) {
      state.emailInput.value = stored.email
    }
    if (state.eaglesIdInput && !currentEaglesId) {
      state.eaglesIdInput.value = stored.eaglesId
    }
  }

  function ensureIdentityPanel() {
    if (document.querySelector(".sis-cloze-panel")) return

    var instructions = document.getElementById("InstructionsDiv")
    var titles = document.querySelector(".Titles")
    if (!instructions || !instructions.parentNode) return

    var panel = document.createElement("section")
    panel.className = "sis-cloze-panel"
    panel.setAttribute("aria-label", "Exercise submission details")
    panel.innerHTML =
      '<p class="sis-cloze-panel__instruction">Enter your details before checking answers.</p>' +
      '<div class="sis-cloze-panel__grid">' +
      '<label class="sis-cloze-field" for="sis-cloze-email">' +
      '<span class="sis-cloze-field__label">Email</span>' +
      '<input id="sis-cloze-email" data-sis-cloze-email type="email" autocomplete="email" inputmode="email" placeholder="name@example.com" required>' +
      "</label>" +
      '<label class="sis-cloze-field" for="sis-cloze-eagles-id">' +
      '<span class="sis-cloze-field__label">Eagles ID</span>' +
      '<input id="sis-cloze-eagles-id" data-sis-cloze-eagles-id type="text" autocomplete="off" autocapitalize="none" spellcheck="false" inputmode="text" pattern="^[a-z]+\\d{3}$" placeholder="tammy001" required>' +
      "</label>" +
      "</div>" +
      '<p id="sis-cloze-status" class="sis-cloze-status" data-sis-cloze-status aria-live="polite"></p>'

    if (titles && titles.parentNode === instructions.parentNode) {
      titles.parentNode.insertBefore(panel, instructions)
    } else {
      instructions.parentNode.insertBefore(panel, instructions)
    }

    state.emailInput = panel.querySelector("[data-sis-cloze-email]")
    state.eaglesIdInput = panel.querySelector("[data-sis-cloze-eagles-id]")
    state.statusNode = panel.querySelector("[data-sis-cloze-status]")

    if (state.emailInput) state.emailInput.setAttribute("aria-describedby", "sis-cloze-status")
    if (state.eaglesIdInput) state.eaglesIdInput.setAttribute("aria-describedby", "sis-cloze-status")
  }

  function buildModernShell() {
    var wrapfit = document.querySelector("body#TheBody > .wrapfit")
    if (!wrapfit || wrapfit.dataset.sisShellBuilt === "true") return

    var titles = wrapfit.querySelector(".Titles")
    var main = wrapfit.querySelector("#MainDiv")
    var feedback = wrapfit.querySelector("#FeedbackDiv")
    var identityPanel = document.querySelector(".sis-cloze-panel")

    var shell = document.createElement("main")
    shell.className = "sis-cloze-shell"
    shell.setAttribute("aria-label", "Cloze exercise")

    var header = document.createElement("header")
    header.className = "sis-cloze-region sis-cloze-region--header"
    if (titles) {
      header.appendChild(titles)
    }

    var identityRegion = document.createElement("section")
    identityRegion.className = "sis-cloze-region sis-cloze-region--identity"
    identityRegion.setAttribute("aria-label", "Exercise submission details")
    if (identityPanel && identityPanel.parentNode) {
      identityRegion.appendChild(identityPanel)
    }

    var exerciseRegion = document.createElement("section")
    exerciseRegion.className = "sis-cloze-region sis-cloze-region--exercise"
    exerciseRegion.setAttribute("aria-label", "Exercise content")
    if (main) {
      exerciseRegion.appendChild(main)
    }

    var feedbackRegion = document.createElement("section")
    feedbackRegion.className = "sis-cloze-region sis-cloze-region--feedback"
    feedbackRegion.setAttribute("aria-label", "Exercise feedback")
    if (feedback && feedback.parentNode) {
      feedback.setAttribute("role", "dialog")
      feedback.setAttribute("aria-modal", "true")
      feedback.setAttribute("aria-live", "assertive")
      feedbackRegion.appendChild(feedback)
    }

    shell.appendChild(header)
    shell.appendChild(identityRegion)
    shell.appendChild(exerciseRegion)
    if (feedbackRegion.childNodes.length > 0) {
      shell.appendChild(feedbackRegion)
    }

    wrapfit.replaceWith(shell)
    shell.dataset.sisShellBuilt = "true"
    document.body.dataset.sisPrototypeStyle = PROTOTYPE_STYLE
    document.body.classList.add("sis-cloze-modernized")
  }

  function stripLegacyHandlers(node) {
    if (!node || typeof node.removeAttribute !== "function") return
    node.removeAttribute("onclick")
    node.removeAttribute("onmouseover")
    node.removeAttribute("onfocus")
    node.removeAttribute("onmouseout")
    node.removeAttribute("onblur")
    node.removeAttribute("onmousedown")
    node.removeAttribute("onmouseup")
  }

  function focusAfterFeedback() {
    var candidate =
      document.querySelector(".GapBox:not([disabled])") ||
      document.querySelector("#CheckButton1:not([disabled])") ||
      document.querySelector("#CheckButton2:not([disabled])") ||
      document.querySelector(".sis-cloze-panel input:not([disabled])")
    if (candidate && typeof candidate.focus === "function") {
      candidate.focus()
    }
  }

  function modernizeLegacyWiring() {
    var buttons = Array.prototype.slice.call(
      document.querySelectorAll("button, input[type='submit'], input[type='button']")
    )
    for (var i = 0; i < buttons.length; i += 1) {
      var button = buttons[i]
      var label = normalizeText(button.textContent || button.value).toLowerCase()
      stripLegacyHandlers(button)

      if (!button.__sisModernButtonBound) {
        button.__sisModernButtonBound = true
        button.addEventListener("mouseover", function () {
          if (typeof window.FuncBtnOver === "function") window.FuncBtnOver(this)
        })
        button.addEventListener("focus", function () {
          if (typeof window.FuncBtnOver === "function") window.FuncBtnOver(this)
        })
        button.addEventListener("mouseout", function () {
          if (typeof window.FuncBtnOut === "function") window.FuncBtnOut(this)
        })
        button.addEventListener("blur", function () {
          if (typeof window.FuncBtnOut === "function") window.FuncBtnOut(this)
        })
        button.addEventListener("mousedown", function () {
          if (typeof window.FuncBtnDown === "function") window.FuncBtnDown(this)
        })
        button.addEventListener("mouseup", function () {
          if (typeof window.FuncBtnOut === "function") window.FuncBtnOut(this)
        })
      }

      if (button.id === "CheckButton1" || button.id === "CheckButton2" || label === "check") {
        button.addEventListener("click", function (event) {
          event.preventDefault()
          if (typeof window.CheckAnswers === "function") window.CheckAnswers()
        })
      } else if (label === "hint") {
        button.addEventListener("click", function (event) {
          event.preventDefault()
          if (typeof window.ShowHint === "function") window.ShowHint()
        })
      } else if (button.id === "FeedbackOKButton" || label === "ok") {
        button.addEventListener("click", function (event) {
          event.preventDefault()
          if (typeof window.HideFeedback === "function") window.HideFeedback()
          setTimeout(focusAfterFeedback, 0)
        })
      }
    }

    var gapInputs = Array.prototype.slice.call(document.querySelectorAll(".GapBox"))
    for (var j = 0; j < gapInputs.length; j += 1) {
      var gap = gapInputs[j]
      stripLegacyHandlers(gap)
      if (!gap.dataset.sisGapIndex) {
        gap.dataset.sisGapIndex = String(j)
      }
      if (!gap.__sisModernFocusBound) {
        gap.__sisModernFocusBound = true
        gap.addEventListener("focus", function () {
          var index = Number(this.dataset.sisGapIndex)
          if (typeof window.TrackFocus === "function" && Number.isFinite(index)) {
            window.TrackFocus(index)
          }
        })
        gap.addEventListener("blur", function () {
          if (typeof window.LeaveGap === "function") {
            window.LeaveGap()
          }
        })
      }
    }
  }

  function readAttemptIdFromState() {
    return getAttemptId()
  }

  function buildSubmissionPayload() {
    var identity = readFormIdentity()
    if (!isIdentityReady(identity)) {
      throw new Error("Enter your email and Eagles ID before checking answers.")
    }

    var counts = getAnswerCounts()
    return {
      eaglesId: identity.eaglesId,
      email: identity.email,
      pageTitle: getPageTitle(),
      completedAt: new Date().toISOString(),
      totalQuestions: counts.totalQuestions,
      correctCount: counts.correctCount,
      pendingCount: counts.pendingCount,
      incorrectCount: counts.incorrectCount,
      scorePercent: counts.scorePercent,
      recipients: [],
      sourceSystem: SOURCE_SYSTEM,
      sourceAttemptId: readAttemptIdFromState(),
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
        if (response.ok) return response
        return response.text().then(
          function (text) {
            var message = "Submission failed (" + response.status + ")"
            if (text) {
              try {
                var parsed = JSON.parse(text)
                if (parsed && parsed.error) message = String(parsed.error)
              } catch {
                message = text || message
              }
            }
            throw new Error(message)
          },
          function () {
            throw new Error("Submission failed (" + response.status + ")")
          }
        )
      })
  }

  function sendWithXHR(url, payload) {
    return new Promise(function (resolve, reject) {
      try {
        var xhr = new XMLHttpRequest()
        xhr.open("POST", url, true)
        xhr.setRequestHeader("Content-Type", "application/json")
        xhr.setRequestHeader("Accept", "application/json")
        xhr.onreadystatechange = function () {
          if (xhr.readyState !== 4) return
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(xhr.responseText)
          } else {
            reject(new Error("Submission failed (" + xhr.status + ")"))
          }
        }
        xhr.onerror = function () {
          reject(new Error("Submission failed"))
        }
        xhr.send(JSON.stringify(payload))
      } catch (error) {
        reject(error)
      }
    })
  }

  function sendSubmission(payload) {
    var url = resolveSubmitUrl()
    if (window.fetch) return sendWithFetch(url, payload)
    return sendWithXHR(url, payload)
  }

  function submitAttempt() {
    if (state.submitted) return Promise.resolve(true)
    if (state.submitting && state.submitPromise) return state.submitPromise

    if (window.Locked !== true) {
      setStatus("Check your answers before the result is sent.", "error")
      updateButtonState()
      return Promise.resolve(false)
    }

    var payload
    try {
      payload = buildSubmissionPayload()
    } catch (error) {
      var invalidMessage = error && error.message ? String(error.message) : "Enter your details first."
      setStatus(invalidMessage, "error")
      focusMissingIdentityField()
      updateButtonState()
      return Promise.resolve(false)
    }

    persistIdentity({
      email: payload.email,
      eaglesId: payload.eaglesId,
    })

    state.submitting = true
    state.lastError = ""
    setStatus("Submitting your result to SIS...", "")
    updateButtonState()

    state.submitPromise = sendSubmission(payload)
      .then(function () {
        state.submitted = true
        state.submitting = false
        state.lastError = ""
        setStatus(
          "Submitted. A receipt has been emailed to " + payload.email + ".",
          "success"
        )
        updateButtonState()
        return true
      })
      .catch(function (error) {
        state.submitting = false
        state.submitted = false
        state.lastError = error && error.message ? String(error.message) : "Submission failed"
        setStatus(
          "Submission failed. Retry when you are back online. " + state.lastError,
          "error"
        )
        updateButtonState()
        return false
      })
      .finally(function () {
        state.submitting = false
        updateButtonState()
      })

    return state.submitPromise
  }

  function guardCheckAnswers(original) {
    if (typeof original !== "function") return function () {}
    return function () {
      if (!isIdentityReady()) {
        setStatus("Enter your email and Eagles ID before checking answers.", "error")
        focusMissingIdentityField()
        return false
      }

      state.checkingAnswers = true
      try {
        var result = original.apply(this, arguments)
        var scorePercent = typeof window.Score === "number" ? Number(window.Score) : getAnswerCounts().scorePercent
        if (scorePercent >= 100 && window.Locked === true) {
          submitAttempt()
        }
        return result
      } finally {
        state.checkingAnswers = false
      }
    }
  }

  function guardShowHint(original) {
    if (typeof original !== "function") return function () {}
    return function () {
      if (!isIdentityReady()) {
        setStatus("Enter your email and Eagles ID before using a hint.", "error")
        focusMissingIdentityField()
        return false
      }
      return original.apply(this, arguments)
    }
  }

  function guardShowMessage(original) {
    if (typeof original !== "function") return function () {}
    return function () {
      var result = original.apply(this, arguments)
      if (state.checkingAnswers) {
        var scorePercent =
          typeof window.Score === "number" ? Number(window.Score) : getAnswerCounts().scorePercent
        setFeedbackLabelForScore(scorePercent)
      } else {
        setFeedbackButtonLabel("OK")
      }
      return result
    }
  }

  function wrapGlobalHandlers() {
    window.CheckAnswers = guardCheckAnswers(window.CheckAnswers)
    window.ShowHint = guardShowHint(window.ShowHint)
    window.ShowMessage = guardShowMessage(window.ShowMessage)
    window.Finish = function () {
      return submitAttempt()
    }
  }

  function bindEvents() {
    var inputs = [state.emailInput, state.eaglesIdInput]
    for (var i = 0; i < inputs.length; i += 1) {
      var input = inputs[i]
      if (!input) continue
      input.addEventListener("input", function () {
        var identity = readFormIdentity()
        if (isIdentityReady(identity)) {
          persistIdentity(identity)
          setStatus("", "")
        }
        updateButtonState()
      })
      input.addEventListener("blur", function () {
        var identity = readFormIdentity()
        if (isIdentityReady(identity)) {
          persistIdentity(identity)
          setStatus("", "")
        }
        updateButtonState()
      })
    }

  }

  function collectButtons() {
    state.checkButtons = Array.prototype.slice.call(
      document.querySelectorAll("#CheckButton1, #CheckButton2")
    )
    state.hintButtons = Array.prototype.slice.call(
      document.querySelectorAll('button[onclick*="ShowHint"]')
    )
  }

  function bootstrap() {
    if (state.initialized) return
    ensureIdentityPanel()
    buildModernShell()
    modernizeLegacyWiring()
    state.emailInput = state.emailInput || document.querySelector("[data-sis-cloze-email]")
    state.eaglesIdInput = state.eaglesIdInput || document.querySelector("[data-sis-cloze-eagles-id]")
    state.statusNode = state.statusNode || document.querySelector("[data-sis-cloze-status]")

    if (!state.emailInput || !state.eaglesIdInput || !state.statusNode) return

    collectButtons()
    syncIdentityFromStorage()

    if (!readStorage(attemptStorageKey())) {
      writeStorage(attemptStorageKey(), getAttemptId())
    }

    bindEvents()
    wrapGlobalHandlers()
    updateButtonState()

    if (!isIdentityReady()) {
      var stored = readIdentity()
      if (stored.email || stored.eaglesId) {
        setStatus("Finish the email and Eagles ID fields to continue.", "")
      } else {
        setStatus("Enter your email and Eagles ID to unlock Check and Hint.", "")
      }
    }

    state.initialized = true
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap)
  } else {
    bootstrap()
  }

  window.SISClozeBridge = {
    sourceSystem: SOURCE_SYSTEM,
    getAttemptId: getAttemptId,
    getPayload: buildSubmissionPayload,
    submit: submitAttempt,
  }
})()
