(function () {
  "use strict"

  var SOURCE_SYSTEM = "cloze-web"
  var STORAGE_PREFIX = "sis.cloze"
  var IDENTITY_KEY = STORAGE_PREFIX + ":identity"
  var IDENTITY_COOKIE = "sis_cloze_identity"
  var ATTEMPT_KEY_PREFIX = STORAGE_PREFIX + ":attempt:"
  var IDENTITY_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 2
  var PROTOTYPE_STYLE = "current"
  var DEFAULT_INSTRUCTIONS_TEXT =
    "Review the vocabulary, read the story, then fill in each blank. Click CHECK to see if your answers are correct."
  var TEST_EXERCISE_SUBMIT_HOST = "test.eagles.edu.vn"
  // Change this back to 8787 when the local/test backend moves back to that port.
  var EXERCISE_SUBMIT_PORT = 8786
  var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  var EAGLES_ID_PATTERN = /^[a-z]+\d{3}$/
  var IDENTITY_REQUIRED_STATUS_MESSAGE =
    "Enter your EaglesID and student email to activate Check and Hint."
  var IDLE_STATUS_MESSAGE =
    "Your saved details are ready. Complete the exercise to send your result."
  var CLOSE_BUTTON_HTML =
    '<button class="btn-74 hp-button hp-close-button tm1-5" type="button" data-hp-close aria-label="Close" aria-description="Close this exercise." data-hp-tooltip="Close this exercise.">Close<span></span><span></span><span></span><span></span></button>'

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
    submitButton: null,
    feedbackObserver: null,
    checkButtons: [],
    hintButtons: [],
    attemptId: "",
    answersRevealed: false,
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
    if (state.answersRevealed) {
      return {
        totalQuestions: totalQuestions,
        correctCount: 0,
        pendingCount: 0,
        incorrectCount: totalQuestions,
        scorePercent: 0,
      }
    }
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

    if (state.submitButton) {
      var disableSubmit = !identityReady || state.submitting || state.submitted || window.Locked !== true
      state.submitButton.disabled = disableSubmit
      state.submitButton.setAttribute("aria-disabled", disableSubmit ? "true" : "false")
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

    var cloze = document.getElementById("ClozeDiv")
    var main = document.getElementById("MainDiv")
    if (!cloze || !cloze.parentNode) return

    var panel = document.createElement("section")
    panel.className = "sis-cloze-panel"
    panel.setAttribute("aria-label", "Exercise submission details")
    panel.innerHTML =
      '<p class="sis-cloze-panel__instruction">Enter your EaglesID and student email to activate Check and Hint.</p>' +
      '<div class="sis-cloze-panel__grid">' +
      '<label class="sis-cloze-field" for="sis-cloze-email">' +
      '<span class="sis-cloze-field__label">Student email</span>' +
      '<input id="sis-cloze-email" data-sis-identity-email data-sis-cloze-email type="email" autocomplete="email" inputmode="email" placeholder="name@example.com" required>' +
      "</label>" +
      '<label class="sis-cloze-field" for="sis-cloze-eagles-id">' +
      '<span class="sis-cloze-field__label">Eagles ID</span>' +
      '<input id="sis-cloze-eagles-id" data-sis-identity-eagles-id data-sis-cloze-eagles-id type="text" autocomplete="off" autocapitalize="none" spellcheck="false" inputmode="text" pattern="^[a-z]+\\d{3}$" placeholder="tammy001" required>' +
      "</label>" +
      "</div>" +
      '<p id="sis-cloze-status" class="sis-cloze-status" data-sis-identity-status data-sis-cloze-status aria-live="polite"></p>'

    if (main) {
      main.insertBefore(panel, cloze)
    } else {
      cloze.parentNode.insertBefore(panel, cloze)
    }

    state.emailInput = panel.querySelector("[data-sis-cloze-email]")
    state.eaglesIdInput = panel.querySelector("[data-sis-cloze-eagles-id]")
    state.statusNode = panel.querySelector("[data-sis-cloze-status]")

    if (state.emailInput) state.emailInput.setAttribute("aria-describedby", "sis-cloze-status")
    if (state.eaglesIdInput) state.eaglesIdInput.setAttribute("aria-describedby", "sis-cloze-status")
  }

  function injectInstructionParagraph() {
    var instructionPanel = document.getElementById("InstructionsDiv")
    if (!instructionPanel) return

    var instructions = instructionPanel.querySelector("#Instructions") || instructionPanel
    if (instructions.querySelector("p.sis-exercise-instructions")) return

    var instructionText = normalizeText(
      instructionPanel.getAttribute("data-cloze-instructions") || instructions.textContent
    ).replace(/^CLOZE\s*:\s*/i, "")
    if (!instructionText) instructionText = DEFAULT_INSTRUCTIONS_TEXT

    var paragraph = document.createElement("p")
    paragraph.className = "sis-exercise-instructions"

    var label = document.createElement("strong")
    label.textContent = "CLOZE"
    paragraph.appendChild(label)
    paragraph.appendChild(document.createTextNode(": " + instructionText))

    while (instructions.firstChild) {
      instructions.removeChild(instructions.firstChild)
    }
    instructions.appendChild(paragraph)
  }

  function buildModernShell() {
    var wrapfit = document.querySelector(
      "body#TheBody > [data-sis-exercise-shell].hp-exercise-shell.wrapfit",
    )
    if (!wrapfit || wrapfit.dataset.sisShellBuilt === "true") return

    var titles = wrapfit.querySelector(".Titles")
    var instructions = document.getElementById("InstructionsDiv")
    var instructionPanel = wrapfit.querySelector(".hp-instructions-panel")
    var main = wrapfit.querySelector("#MainDiv")
    var feedback = wrapfit.querySelector("#FeedbackDiv")
    var topNav = wrapfit.querySelector("#TopNavBar")
    var bottomNav = wrapfit.querySelector("#BottomNavBar")
    var identityPanel = document.querySelector(".sis-cloze-panel")

    var shell = document.createElement("main")
    shell.className = "sis-exercise-content hp-exercise-shell wrapfit"
    shell.setAttribute("data-sis-exercise-shell", "true")
    shell.setAttribute("data-sis-exercise-family", "cloze")
    shell.setAttribute("aria-label", "Cloze exercise")

    var header = document.createElement("header")
    header.className = "sis-cloze-region sis-cloze-region--header"
    if (!instructionPanel) {
      instructionPanel = document.createElement("section")
      instructionPanel.className = "hp-instructions-panel"
      if (titles) instructionPanel.appendChild(titles)
      if (instructions && instructions.parentNode) instructionPanel.appendChild(instructions)
    }
    header.appendChild(instructionPanel)

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
      feedbackRegion.classList.add("hp-display-none")
      var feedbackText = feedback.querySelector(".FeedbackText")
      var syncFeedbackRegionVisibility = function () {
        var hasFeedbackText = feedbackText && normalizeText(feedbackText.textContent)
        var isHidden = !hasFeedbackText || window.getComputedStyle(feedback).display === "none"
        feedbackRegion.classList.toggle("hp-display-none", isHidden)
      }
      syncFeedbackRegionVisibility()
      if (typeof window.MutationObserver === "function") {
        state.feedbackObserver = new window.MutationObserver(syncFeedbackRegionVisibility)
        state.feedbackObserver.observe(feedback, { attributes: true, attributeFilter: ["class", "style"] })
        if (feedbackText) {
          state.feedbackObserver.observe(feedbackText, {
            characterData: true,
            childList: true,
            subtree: true,
          })
        }
      }
    }

    var footerRegion = document.createElement("section")
    footerRegion.className = "sis-cloze-region sis-cloze-region--footer"
    footerRegion.setAttribute("aria-label", "Exercise actions")
    footerRegion.innerHTML = CLOSE_BUTTON_HTML

    var submitButton = document.createElement("button")
    submitButton.className = "btn-17 hp-button sis-exercise-submit"
    submitButton.type = "button"
    submitButton.textContent = "Submit"
    submitButton.setAttribute("data-sis-cloze-submit", "")
    submitButton.setAttribute("aria-label", "Submit")
    submitButton.setAttribute("aria-description", "Submit your completed exercise result to SIS.")
    submitButton.setAttribute("data-hp-tooltip", "Submit your completed exercise result to SIS.")
    submitButton.disabled = true
    submitButton.setAttribute("aria-disabled", "true")
    var actionRow = main && main.querySelector(".btn17Container")
    if (main && !actionRow) {
      actionRow = document.createElement("div")
      actionRow.className = "btn17Container"
      main.appendChild(actionRow)
    }
    if (actionRow) {
      actionRow.setAttribute("role", "group")
      actionRow.setAttribute("aria-label", "Cloze answer and submission controls")
      actionRow.appendChild(submitButton)
    }
    state.submitButton = submitButton

    if (topNav) shell.appendChild(topNav)
    shell.appendChild(header)
    shell.appendChild(identityRegion)
    shell.appendChild(exerciseRegion)
    if (feedbackRegion.childNodes.length > 0) {
      shell.appendChild(feedbackRegion)
    }
    if (bottomNav) shell.appendChild(bottomNav)
    shell.appendChild(footerRegion)

    wrapfit.replaceWith(shell)
    shell.dataset.sisShellBuilt = "true"
    document.body.dataset.sisPrototypeStyle = PROTOTYPE_STYLE
    document.body.classList.add("sis-cloze-modernized")
  }

  function stripLegacyHandlers(node, preserveClick) {
    if (!node || typeof node.removeAttribute !== "function") return
    if (!preserveClick) node.removeAttribute("onclick")
    node.removeAttribute("onmouseover")
    node.removeAttribute("onfocus")
    node.removeAttribute("onmouseout")
    node.removeAttribute("onblur")
    node.removeAttribute("onmousedown")
    node.removeAttribute("onmouseup")
  }

  function getButtonAction(button, label, legacyOnClick) {
    var onClick = normalizeText(legacyOnClick).toLowerCase()
    var hasHintSignal =
      button.id === "hint" ||
      label === "hint" ||
      onClick.indexOf("showhint") !== -1
    var hasCheckSignal =
      button.id === "CheckButton1" ||
      button.id === "CheckButton2" ||
      button.id === "check" ||
      label === "check" ||
      onClick.indexOf("checkanswers") !== -1
    var hasAnswerSignal =
      label === "answers" ||
      label === "show answers" ||
      onClick.indexOf("showanswers") !== -1

    if (hasAnswerSignal) return "answer"
    if (hasHintSignal) return "hint"
    if (hasCheckSignal) return "check"
    if (button.id === "FeedbackOKButton" || label === "ok") return "ok"
    if (button.classList && button.classList.contains("btn-74")) return "close"
    return ""
  }

  function focusAfterFeedback() {
    var candidate =
      document.querySelector(".GapBox:not([disabled])") ||
      document.querySelector("#CheckButton1:not([disabled])") ||
      document.querySelector("#CheckButton2:not([disabled])") ||
      document.querySelector("#check:not([disabled])") ||
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
      var legacyOnClick = button.getAttribute("onclick")
      var isModernCheck = button.classList && button.classList.contains("btn-17")
      var isModernClose = button.classList && button.classList.contains("btn-74")
      var isSharedClose = button.hasAttribute("data-hp-close")
      var action = getButtonAction(button, label, legacyOnClick)
      var isModernReplacement = isModernCheck || isModernClose || isSharedClose
      stripLegacyHandlers(button, action === "")

      if (!isModernReplacement && !button.__sisModernButtonBound) {
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

      if (action === "check") {
        button.addEventListener("click", function (event) {
          event.preventDefault()
          if (typeof window.CheckAnswers === "function") window.CheckAnswers()
        })
      } else if (!isSharedClose && (action === "close" || isModernClose || label === "close")) {
        button.addEventListener("click", function (event) {
          event.preventDefault()
          if (typeof window.close === "function") {
            window.close()
          } else {
            location = "JavaScript:window.close() "
          }
          return false
        })
      } else if (action === "answer") {
        var answerCall = /\bShowAnswers\s*\(([^)]*)\)/i.exec(legacyOnClick || "")
        var answerArgs = answerCall && answerCall[1].trim()
          ? answerCall[1].split(",").map(function (argument) {
              var value = argument.trim()
              if (/^\d+$/.test(value)) return Number(value)
              if (/^(?:"[^"]*"|'[^']*')$/.test(value)) return value.slice(1, -1)
              return null
            }).filter(function (value) {
              return value !== null
            })
          : []
        button.addEventListener(
          "click",
          (function (args) {
            return function (event) {
              event.preventDefault()
              if (typeof window.ShowAnswers === "function") {
                window.ShowAnswers.apply(window, args)
              }
            }
          })(answerArgs)
        )
      } else if (action === "hint" || label === "hint") {
        button.addEventListener("click", function (event) {
          event.preventDefault()
          if (typeof window.ShowHint === "function") window.ShowHint()
        })
      } else if (action === "ok") {
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
      throw new Error(IDENTITY_REQUIRED_STATUS_MESSAGE)
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
      var invalidMessage = error && error.message ? String(error.message) : "Enter your EaglesID and student email to activate Check and Hint."
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
        setStatus(IDENTITY_REQUIRED_STATUS_MESSAGE, "error")
        focusMissingIdentityField()
        return false
      }

      state.checkingAnswers = true
      try {
        return original.apply(this, arguments)
      } finally {
        state.checkingAnswers = false
        updateButtonState()
      }
    }
  }

  function guardShowHint(original) {
    if (typeof original !== "function") return function () {}
    return function () {
      if (!isIdentityReady()) {
        setStatus(IDENTITY_REQUIRED_STATUS_MESSAGE, "error")
        focusMissingIdentityField()
        return false
      }
      return original.apply(this, arguments)
    }
  }

  function guardShowAnswers(original) {
    if (typeof original !== "function") return original
    return function () {
      state.answersRevealed = true
      var result = original.apply(this, arguments)
      setStatus("Revealed answers count as incorrect.", "error")
      return result
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
    window.ShowAnswers = guardShowAnswers(window.ShowAnswers)
    window.ShowMessage = guardShowMessage(window.ShowMessage)
    var originalFinish = window.Finish
    if (typeof originalFinish === "function" && !originalFinish.__sisClozeWrapped) {
      var wrappedFinish = function () {
        var result = originalFinish.apply(this, arguments)
        updateButtonState()
        return result
      }
      wrappedFinish.__sisClozeWrapped = true
      window.Finish = wrappedFinish
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
          setStatus(IDLE_STATUS_MESSAGE, "success")
        } else {
          setStatus(IDENTITY_REQUIRED_STATUS_MESSAGE, "error")
        }
        updateButtonState()
      })
      input.addEventListener("blur", function () {
        var identity = readFormIdentity()
        if (isIdentityReady(identity)) {
          persistIdentity(identity)
          setStatus(IDLE_STATUS_MESSAGE, "success")
        } else {
          setStatus(IDENTITY_REQUIRED_STATUS_MESSAGE, "error")
        }
        updateButtonState()
      })
    }

  }

  function collectButtons() {
    state.checkButtons = Array.prototype.slice.call(
      document.querySelectorAll("#CheckButton1, #CheckButton2, #check")
    )
    state.hintButtons = Array.prototype.slice.call(
      document.querySelectorAll('button[onclick*="ShowHint"], #hint')
    )
  }

  function bootstrap() {
    if (state.initialized) return
    injectInstructionParagraph()
    ensureIdentityPanel()
    buildModernShell()
    modernizeLegacyWiring()
    state.emailInput = state.emailInput || document.querySelector("[data-sis-cloze-email]")
    state.eaglesIdInput = state.eaglesIdInput || document.querySelector("[data-sis-cloze-eagles-id]")
    state.statusNode = state.statusNode || document.querySelector("[data-sis-cloze-status]")

    if (!state.emailInput || !state.eaglesIdInput || !state.statusNode) return

    collectButtons()
    state.submitButton = state.submitButton || document.querySelector("[data-sis-cloze-submit]")
    if (state.submitButton) state.submitButton.addEventListener("click", submitAttempt)
    syncIdentityFromStorage()

    if (!readStorage(attemptStorageKey())) {
      writeStorage(attemptStorageKey(), getAttemptId())
    }

    bindEvents()
    wrapGlobalHandlers()
    updateButtonState()

    setStatus(
      isIdentityReady() ? IDLE_STATUS_MESSAGE : IDENTITY_REQUIRED_STATUS_MESSAGE,
      isIdentityReady() ? "success" : "error",
    )

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
