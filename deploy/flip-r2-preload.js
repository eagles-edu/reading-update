(function () {
  "use strict";

  var assetOrigin = "https://eagles.io.vn";
  var imageBase =
    assetOrigin + "/turn4js/flip/_image/" + getBookDirectory() + "/";
  var preloadQueue = [];
  var preloadActive = 0;
  var preloadCursor = 0;
  var preloadConcurrency = 2;
  var primedImages = {};

  function getBookDirectory() {
    var parts = window.location.pathname.split("/").filter(Boolean);
    var flipIndex = parts.indexOf("flip");
    if (flipIndex < 0 || !parts[flipIndex + 1]) return "";
    return parts[flipIndex + 1];
  }

  function pageImageUrl(page, large) {
    var filename = String(page) + (large ? "-large" : "") + ".jpg";
    return imageBase + "pages/" + filename;
  }

  function setImageSource(image, page, large) {
    image.attr("src", pageImageUrl(page, large));
  }

  function findPageElement(page, pageElement) {
    if (pageElement && pageElement.length) return pageElement;

    return $(
      '.page-wrapper[page="' + page + '"] .page, .page.p' + page,
    ).first();
  }

  function replaceLargeImage(image, page, pageElement, attempts) {
    var target = findPageElement(page, pageElement);
    if (!target.length) {
      if (attempts < 100) {
        window.setTimeout(function () {
          replaceLargeImage(image, page, pageElement, attempts + 1);
        }, 20);
      }
      return;
    }

    var previousImage = target.find("img");
    image.css({ width: "100%", height: "100%" });
    image.appendTo(target);
    previousImage.remove();
  }

  function imageKey(page, large) {
    return String(page) + (large ? ":large" : ":medium");
  }

  function primeImage(page, large, priority) {
    var key = imageKey(page, large);
    if (primedImages[key]) return;

    primedImages[key] = true;
    var image = new Image();
    image.decoding = "async";
    if ("fetchPriority" in image) image.fetchPriority = priority;
    image.src = pageImageUrl(page, large);
  }

  function primeBookBootPage(page) {
    primeImage(page, true, "high");
    primeImage(page, false, "high");
  }

  function loadPage(page, pageElement) {
    primeBookBootPage(page);
    var image = $("<img />");
    image.on("mousedown", function (event) {
      event.preventDefault();
    });
    image.on("load", function () {
      $(this).css({ width: "100%", height: "100%" });
      $(this).appendTo(pageElement);
      pageElement.find(".loader").remove();
    });
    setImageSource(image, page, false);
  }

  function loadLargePage(page, pageElement) {
    var image = $("<img />");
    image.on("load", function () {
      replaceLargeImage($(this), page, pageElement, 0);
    });
    setImageSource(image, page, true);
  }

  function loadSmallPage(page, pageElement) {
    var target = findPageElement(page, pageElement);
    if (!target.length) return;

    var image = target.find("img");
    if (!image.length) return;

    image.css({ width: "100%", height: "100%" });
    image.off("load");
    setImageSource(image, page, false);
  }

  function preloadNext() {
    while (
      preloadActive < preloadConcurrency &&
      preloadCursor < preloadQueue.length
    ) {
      var request = preloadQueue[preloadCursor++];
      var key = imageKey(request.page, request.large);
      if (primedImages[key]) continue;

      primedImages[key] = true;
      var image = new Image();
      preloadActive += 1;
      image.decoding = "async";
      if ("fetchPriority" in image) image.fetchPriority = request.priority;
      image.onload = image.onerror = function () {
        preloadActive -= 1;
        preloadNext();
      };
      image.src = pageImageUrl(request.page, request.large);
    }
  }

  function preloadPageWindow(centerPage, pages) {
    var firstPage = Math.max(1, centerPage - 1);
    var lastPage = Math.min(pages, centerPage + 3);

    for (var page = firstPage; page <= lastPage; page += 1) {
      if (page === centerPage) continue;
      preloadQueue.push({ page: page, large: false, priority: "low" });
    }
    preloadNext();
  }

  function preloadBookImages() {
    var book = $(".magazine");
    if (!book.turn("is")) return;
    var pages = book.turn("pages");
    if (!pages) return;

    var currentPage = book.turn("page") || 1;
    preloadPageWindow(currentPage, pages);
    book.off("turned.r2Preload").on("turned.r2Preload", function (event, page) {
      preloadPageWindow(page || currentPage, pages);
    });
  }

  window.loadPage = loadPage;
  window.loadLargePage = loadLargePage;
  window.loadSmallPage = loadSmallPage;

  $(function () {
    var attempts = 0;
    function waitForFlipbook() {
      if ($(".magazine").turn("is")) {
        preloadBookImages();
        return;
      }
      attempts += 1;
      if (attempts < 100) window.setTimeout(waitForFlipbook, 50);
    }
    waitForFlipbook();
  });
})();
