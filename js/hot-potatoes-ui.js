(function initializeHotPotatoesUi() {
  "use strict";

  var DISPLAY_CLASSES = ["hp-display-none", "hp-display-block", "hp-display-inline"];
  var VISIBILITY_CLASSES = ["hp-visibility-hidden", "hp-visibility-visible"];

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

  function initializeBody() {
    if (!document.body || document.body.id !== "TheBody") return;
    document.body.classList.add("hp-modernized");
    positionStoryTitle();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeBody, { once: true });
  } else {
    initializeBody();
  }
})();
