(function initializeHotPotatoesFeedbackColors() {
  "use strict";

  var FEEDBACK_CLASSES = ["hp-feedback-correct", "hp-feedback-incorrect"];
  var INCORRECT_MESSAGE = /\b(?:try\s+again|incorrect|wrong|sorry|not\s+(?:correct|right|quite)|partly|partial|this\s+much\s+of\s+your\s+answer|next\s+correct\s+part)\b/i;
  var CORRECT_MESSAGE = /\b(?:correct|well\s+done|excellent|great\s+job|good\s+job|perfect|you\s+got\s+it|that(?:'|’)s\s+right|that\s+is\s+right|congratulations)\b/i;
  var observedContent = null;
  var contentObserver = null;
  var documentObserver = null;

  function classifyMessage(message) {
    var normalized = String(message == null ? "" : message)
      .replace(/\s+/g, " ")
      .trim();
    if (!normalized) return "";
    if (INCORRECT_MESSAGE.test(normalized)) return "incorrect";
    if (CORRECT_MESSAGE.test(normalized)) return "correct";
    return "";
  }

  function updateFeedbackState(modal, content) {
    if (!modal || !content) return;
    for (var index = 0; index < FEEDBACK_CLASSES.length; index += 1) {
      modal.classList.remove(FEEDBACK_CLASSES[index]);
    }

    var state = classifyMessage(content.textContent || "");
    if (state) modal.classList.add("hp-feedback-" + state);
  }

  function observeFeedbackContent() {
    var modal = document.getElementById("FeedbackDiv");
    var content = document.getElementById("FeedbackContent");
    if (!modal || !content) return false;
    if (observedContent === content) return true;

    if (contentObserver) contentObserver.disconnect();
    observedContent = content;
    updateFeedbackState(modal, content);
    contentObserver = new MutationObserver(function () {
      updateFeedbackState(modal, content);
    });
    contentObserver.observe(content, {
      characterData: true,
      childList: true,
      subtree: true,
    });
    return true;
  }

  function initializeFeedbackObserver() {
    if (observeFeedbackContent() && documentObserver) documentObserver.disconnect();
  }

  if (typeof MutationObserver !== "function" || !document.documentElement) return;

  documentObserver = new MutationObserver(initializeFeedbackObserver);
  documentObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeFeedbackObserver, { once: true });
  } else {
    initializeFeedbackObserver();
  }
})();
