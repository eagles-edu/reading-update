(function () {
  "use strict";

  var FAMILY_NAMES = ["comp", "dict", "cloze", "sent"];

  function normalizeText(value) {
    return String(value == null ? "" : value).trim();
  }

  function getDocument(targetDocument) {
    return targetDocument || document;
  }

  function getWindow(targetDocument) {
    var currentDocument = getDocument(targetDocument);
    return currentDocument.defaultView || window;
  }

  function detectFamily(targetDocument) {
    var currentDocument = getDocument(targetDocument);
    var shell = currentDocument.querySelector("[data-sis-exercise-family]");
    var marker = shell && shell.getAttribute("data-sis-exercise-family");
    if (FAMILY_NAMES.indexOf(marker) >= 0) return marker;

    var path = normalizeText(
      currentDocument.location && currentDocument.location.pathname,
    );
    if (/\/cloze\//i.test(path)) return "cloze";
    if (/\/dict\//i.test(path)) return "dict";
    if (/\/sent\//i.test(path)) return "sent";
    if (/\/comp\//i.test(path)) return "comp";
    return "";
  }

  function setNativeValue(input, value) {
    if (!input) return false;
    var prototype = Object.getPrototypeOf(input);
    var descriptor =
      prototype && Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor && typeof descriptor.set === "function") {
      descriptor.set.call(input, String(value));
    } else {
      input.value = String(value);
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function identityInputs(targetDocument) {
    var currentDocument = getDocument(targetDocument);
    return {
      email: currentDocument.querySelector(
        "[data-sis-identity-email], [data-sis-cloze-email], [data-sis-exercise-email]",
      ),
      eaglesId: currentDocument.querySelector(
        "[data-sis-identity-eagles-id], [data-sis-cloze-eagles-id], [data-sis-exercise-eagles-id]",
      ),
    };
  }

  function fillIdentity(identity, targetDocument) {
    var values = identity || {};
    var inputs = identityInputs(targetDocument);
    var email = normalizeText(values.email || "sis-autofill@example.com");
    var eaglesId = normalizeText(values.eaglesId || "test001").toLowerCase();
    var filled = {
      email: setNativeValue(inputs.email, email),
      eaglesId: setNativeValue(inputs.eaglesId, eaglesId),
    };
    if (inputs.email) inputs.email.blur();
    if (inputs.eaglesId) inputs.eaglesId.blur();
    if (!filled.email || !filled.eaglesId) {
      throw new Error("The exercise identity fields were not found.");
    }
    return { email: email, eaglesId: eaglesId };
  }

  function correctAnswerIndex(answerRows) {
    if (!Array.isArray(answerRows)) return -1;
    for (var index = 0; index < answerRows.length; index += 1) {
      if (Number(answerRows[index] && answerRows[index][2]) >= 1) return index;
    }
    return -1;
  }

  function callInlineButton(button) {
    if (!button)
      throw new Error("The expected exercise control was not found.");
    button.click();
  }

  function autofillComprehension(targetDocument) {
    var currentDocument = getDocument(targetDocument);
    var exerciseWindow = getWindow(currentDocument);
    if (!Array.isArray(exerciseWindow.I)) {
      throw new Error("This comprehension page has no answer data.");
    }
    var clicked = 0;
    for (var question = 0; question < exerciseWindow.I.length; question += 1) {
      var answers = exerciseWindow.I[question] && exerciseWindow.I[question][3];
      var answerIndex = correctAnswerIndex(answers);
      if (answerIndex < 0)
        throw new Error(
          "No correct comprehension answer was found for question " +
            String(question + 1) +
            ".",
        );
      var questionNode = currentDocument.getElementById(
        "Q_" + String(question),
      );
      var button =
        questionNode &&
        questionNode.querySelector(
          '[onclick*="CheckMCAnswer(' +
            String(question) +
            "," +
            String(answerIndex) +
            '"]',
        );
      if (!button) {
        button = currentDocument.querySelector(
          '[onclick*="CheckMCAnswer(' +
            String(question) +
            "," +
            String(answerIndex) +
            '"]',
        );
      }
      callInlineButton(button);
      clicked += 1;
    }
    return { family: "comp", filled: clicked, checked: clicked };
  }

  function autofillDictation(targetDocument) {
    var currentDocument = getDocument(targetDocument);
    var exerciseWindow = getWindow(currentDocument);
    if (!Array.isArray(exerciseWindow.I)) {
      throw new Error("This dictation page has no answer data.");
    }
    if (typeof exerciseWindow.completeDictPageTask !== "function") {
      exerciseWindow.completeDictPageTask = function () {};
    }
    var checked = 0;
    for (var question = 0; question < exerciseWindow.I.length; question += 1) {
      var answers = exerciseWindow.I[question] && exerciseWindow.I[question][3];
      var answerIndex = correctAnswerIndex(answers);
      var answer =
        answerIndex >= 0 && answers[answerIndex] && answers[answerIndex][0];
      var input = currentDocument.getElementById(
        "Q_" + String(question) + "_Guess",
      );
      if (!input || !normalizeText(answer)) {
        throw new Error(
          "The expected dictation answer field was not found for question " +
            String(question + 1) +
            ".",
        );
      }
      setNativeValue(input, answer);
      if (typeof exerciseWindow.CheckShortAnswer !== "function") {
        throw new Error("The native dictation checker is not available.");
      }
      exerciseWindow.CheckShortAnswer(question);
      checked += 1;
    }
    return { family: "dict", filled: checked, checked: checked };
  }

  function autofillCloze(targetDocument) {
    var currentDocument = getDocument(targetDocument);
    var exerciseWindow = getWindow(currentDocument);
    if (typeof exerciseWindow.completeDictPageTask !== "function") {
      exerciseWindow.completeDictPageTask = function () {};
    }
    if (!Array.isArray(exerciseWindow.I)) {
      throw new Error("This cloze page has no answer data.");
    }
    var inputs = Array.prototype.slice.call(
      currentDocument.querySelectorAll(".GapBox, #Cloze input[type='text']"),
    );
    if (inputs.length !== exerciseWindow.I.length) {
      throw new Error(
        "The cloze answer count does not match the page answer data.",
      );
    }
    for (var index = 0; index < inputs.length; index += 1) {
      var answer = exerciseWindow.I[index] && exerciseWindow.I[index][1];
      var value = answer && answer[0] && answer[0][0];
      if (!normalizeText(value))
        throw new Error(
          "No correct cloze answer was found for blank " +
            String(index + 1) +
            ".",
        );
      setNativeValue(inputs[index], value);
    }
    var checkButton = currentDocument.querySelector(
      "#check, #CheckButton1, #CheckButton2",
    );
    if (checkButton) {
      callInlineButton(checkButton);
    } else if (typeof exerciseWindow.CheckAnswers === "function") {
      exerciseWindow.CheckAnswers();
    } else {
      throw new Error("The native cloze checker is not available.");
    }
    return { family: "cloze", filled: inputs.length, checked: 1 };
  }

  function autofillSentence(targetDocument) {
    var currentDocument = getDocument(targetDocument);
    var exerciseWindow = getWindow(currentDocument);
    if (typeof exerciseWindow.completeDictPageTask !== "function") {
      exerciseWindow.completeDictPageTask = function () {};
    }
    var answers = exerciseWindow.Answers;
    if (!Array.isArray(answers) || !Array.isArray(answers[0])) {
      throw new Error("This sentence page has no answer sequence.");
    }
    var anchors = Array.prototype.slice.call(
      currentDocument.querySelectorAll(
        "#SegmentDiv a.ExSegment, #SegmentDiv a[onclick*='AddSegment']",
      ),
    );
    var clicked = 0;
    for (var index = 0; index < answers[0].length; index += 1) {
      var segmentNumber = Number(answers[0][index]);
      var button = anchors.find(function (anchor) {
        var onclick = normalizeText(anchor.getAttribute("onclick"));
        var match = /AddSegment\s*\(\s*(\d+)\s*\)/i.exec(onclick);
        return match && Number(match[1]) === segmentNumber;
      });
      callInlineButton(button);
      clicked += 1;
    }
    var checkButton = currentDocument.querySelector(
      '#CheckButton1, button[onclick*="CheckAnswer(0)"]',
    );
    callInlineButton(checkButton);
    return { family: "sent", filled: clicked, checked: 1 };
  }

  function autofillAndCheck(options, targetDocument) {
    var values = options || {};
    var currentDocument = getDocument(targetDocument);
    fillIdentity(values, currentDocument);
    var family = values.family || detectFamily(currentDocument);
    if (family === "comp") return autofillComprehension(currentDocument);
    if (family === "dict") return autofillDictation(currentDocument);
    if (family === "cloze") return autofillCloze(currentDocument);
    if (family === "sent") return autofillSentence(currentDocument);
    throw new Error("Unable to detect a supported exercise family.");
  }

  function getPayload(targetDocument) {
    var currentWindow = getWindow(targetDocument);
    var bridge =
      currentWindow.SISClozeBridge || currentWindow.SISExerciseBridge;
    if (!bridge || typeof bridge.getPayload !== "function") {
      throw new Error(
        "The SIS submission bridge is not available on this page.",
      );
    }
    return bridge.getPayload();
  }

  function submit(targetDocument) {
    var currentWindow = getWindow(targetDocument);
    var bridge =
      currentWindow.SISClozeBridge || currentWindow.SISExerciseBridge;
    if (!bridge || typeof bridge.submit !== "function") {
      throw new Error(
        "The SIS submission bridge is not available on this page.",
      );
    }
    return bridge.submit();
  }

  function inspect(targetDocument) {
    var currentDocument = getDocument(targetDocument);
    var currentWindow = getWindow(currentDocument);
    var result = {
      family: detectFamily(currentDocument),
      pageTitle: normalizeText(currentDocument.title),
      locked: currentWindow.Locked === true,
      score: Number.isFinite(Number(currentWindow.Score))
        ? Number(currentWindow.Score)
        : null,
    };
    try {
      result.payload = getPayload(currentDocument);
    } catch (error) {
      result.payloadError =
        error && error.message
          ? String(error.message)
          : "Payload is not ready.";
    }
    return result;
  }

  window.SISExerciseAutofill = {
    detectFamily: detectFamily,
    fillIdentity: fillIdentity,
    autofillAndCheck: autofillAndCheck,
    getPayload: getPayload,
    submit: submit,
    inspect: inspect,
  };
})();
