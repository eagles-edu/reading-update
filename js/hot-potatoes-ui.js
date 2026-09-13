(function initializeHotPotatoesUi() {
  "use strict";

  var DISPLAY_CLASSES = ["hp-display-none", "hp-display-block", "hp-display-inline"];
  var VISIBILITY_CLASSES = ["hp-visibility-hidden", "hp-visibility-visible"];
  var activeTooltipButton = null;
  var tooltipElement = null;

  function replaceStateClass(element, classes, value, prefix) {
    if (!element || !element.classList) return value;
    for (var index = 0; index < classes.length; index += 1) {
      element.classList.remove(classes[index]);
    }
    var normalized = String(value == null ? "" : value).trim().toLowerCase();
    if (normalized) {
      var className = prefix + normalized;
      if (classes.indexOf(className) !== -1) element.classList.add(className);
    }
    return value;
  }

  function getState(element, classes, prefix) {
    if (!element || !element.classList) return "";
    for (var index = 0; index < classes.length; index += 1) {
      if (element.classList.contains(classes[index])) {
        return classes[index].slice(prefix.length);
      }
    }
    return "";
  }

  window.HPSetDisplay = function HPSetDisplay(element, value) {
    return replaceStateClass(element, DISPLAY_CLASSES, value, "hp-display-");
  };
  window.HPGetDisplay = function HPGetDisplay(element) {
    return getState(element, DISPLAY_CLASSES, "hp-display-");
  };
  window.HPSetVisibility = function HPSetVisibility(element, value) {
    return replaceStateClass(element, VISIBILITY_CLASSES, value, "hp-visibility-");
  };
  window.HPGetVisibility = function HPGetVisibility(element) {
    return getState(element, VISIBILITY_CLASSES, "hp-visibility-");
  };

  function positionStoryTitle() {
    var titleContainer = document.querySelector("body#TheBody .Titles");
    var instructions = document.querySelector("body#TheBody #InstructionsDiv");
    if (!titleContainer || !instructions || !instructions.parentNode) return;
    var titleFollowsInstructions =
      instructions.compareDocumentPosition(titleContainer) & Node.DOCUMENT_POSITION_FOLLOWING;
    if (titleFollowsInstructions) instructions.parentNode.insertBefore(titleContainer, instructions);
  }

  function closeExerciseFromButton(event) {
    var target = event.target;
    while (target && target !== document && !(target.matches && target.matches("[data-hp-close]"))) {
      target = target.parentElement;
    }
    if (!target || target === document) return;
    event.preventDefault();
    if (typeof window.close === "function") {
      window.close();
    }
  }

  function getTooltipButton(target) {
    if (!target || !target.closest) return null;
    return target.closest("[data-hp-tooltip]");
  }

  function ensureTooltip() {
    if (tooltipElement || !document.body) return tooltipElement;
    tooltipElement = document.createElement("div");
    tooltipElement.className = "hp-tooltip";
    tooltipElement.id = "hp-action-tooltip";
    tooltipElement.setAttribute("role", "tooltip");
    tooltipElement.hidden = true;
    document.body.appendChild(tooltipElement);
    return tooltipElement;
  }

  function hideTooltip() {
    if (tooltipElement) tooltipElement.hidden = true;
    activeTooltipButton = null;
  }

  function showTooltip(button) {
    var message = button && button.getAttribute("data-hp-tooltip");
    if (!message) {
      hideTooltip();
      return;
    }
    var tooltip = ensureTooltip();
    if (!tooltip) return;
    activeTooltipButton = button;
    tooltip.textContent = message;
    tooltip.hidden = false;

    var anchor = button.getBoundingClientRect();
    var bounds = tooltip.getBoundingClientRect();
    var left = anchor.left + (anchor.width - bounds.width) / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - bounds.width - 8));
    var feedbackDialog = button.closest("#FeedbackDiv");
    var dialogBounds = feedbackDialog ? feedbackDialog.getBoundingClientRect() : null;
    var top = dialogBounds
      ? dialogBounds.top - bounds.height - 8
      : anchor.top - bounds.height - 8;
    if (top < 8) top = dialogBounds ? dialogBounds.bottom + 8 : anchor.bottom + 8;
    if (top + bounds.height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - bounds.height - 8);
    }
    tooltip.style.left = Math.round(left) + "px";
    tooltip.style.top = Math.round(top) + "px";
  }

  function normalizeLiveToggle(button) {
    if (!button || !button.matches("[data-hp-tooltip]")) return;
    var current = String(button.textContent || "").replace(/\s+/g, " ").trim();
    var label = current.toLowerCase();
    var nextLabel = "";
    var tooltip = "";
    if (/^(?:all|show all(?: questions)?)$/.test(label)) {
      nextLabel = "All";
      tooltip = "Show all questions at once.";
    } else if (/^(?:one|show (?:questions )?one(?: by one)?)$/.test(label)) {
      nextLabel = "One";
      tooltip = "Show one question at a time.";
    } else if (/^(?:answers?|show answers?)$/.test(label)) {
      nextLabel = "Answers";
      tooltip = "Reveal the correct answer. Revealed answers count as incorrect.";
    }
    if (!nextLabel) return;
    button.textContent = nextLabel;
    button.setAttribute("aria-label", nextLabel);
    button.setAttribute("aria-description", tooltip);
    button.setAttribute("data-hp-tooltip", tooltip);
  }

  function synchronizeDynamicLabels(event) {
    var button = getTooltipButton(event.target);
    if (!button) return;
    window.setTimeout(function () {
      normalizeLiveToggle(button);
      if (activeTooltipButton === button) showTooltip(button);
    }, 0);
  }

  function handleTooltipPointerOver(event) {
    var button = getTooltipButton(event.target);
    if (button && (!event.relatedTarget || !button.contains(event.relatedTarget))) showTooltip(button);
  }

  function handleTooltipPointerOut(event) {
    var button = getTooltipButton(event.target);
    if (button && (!event.relatedTarget || !button.contains(event.relatedTarget))) hideTooltip();
  }

  function handleTooltipFocus(event) {
    var button = getTooltipButton(event.target);
    if (button) showTooltip(button);
  }

  function handleTooltipBlur(event) {
    var button = getTooltipButton(event.target);
    if (button && (!event.relatedTarget || !button.contains(event.relatedTarget))) hideTooltip();
  }

  function initializeBody() {
    if (!document.body || document.body.id !== "TheBody") return;
    document.body.classList.add("hp-modernized");
    positionStoryTitle();
  }

  document.addEventListener("click", closeExerciseFromButton);
  document.addEventListener("click", synchronizeDynamicLabels);
  document.addEventListener("pointerover", handleTooltipPointerOver);
  document.addEventListener("pointerout", handleTooltipPointerOut);
  document.addEventListener("focusin", handleTooltipFocus);
  document.addEventListener("focusout", handleTooltipBlur);
  document.addEventListener("scroll", hideTooltip, true);
  window.addEventListener("resize", hideTooltip);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeBody, { once: true });
  } else {
    initializeBody();
  }
})();
