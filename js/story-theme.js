(function applyStoryTheme() {
  "use strict";

  var pageBackgrounds = [
    "bluegreenGrunge2.webp.jpg",
    "blueGrunge2.webp",
    "blueGrunge.webp",
    "blueGrunge2.webp.jpg",
    "blueGrunge.webp.jpg",
    "brushed_alu_dark.webp",
    "bsyellowGrunge2.webp.jpg",
    "dk-rusttan_grunge.webp.fw.png",
    "dk-rusttan_grunge.webp.jpg",
    "green_dust_scratch.jpg",
    "greenGrunge.webp.jpg",
    "greenGrunge2.webp.jpg",
    "greenGrunge3.webp.jpg",
    "Grunge01.webp.jpg",
    "Grunge02.webp.jpg",
    "Grunge03.webp.jpg",
    "Grunge04.webp.jpg",
    "Grunge05.webp.jpg",
    "Grunge06.webp.jpg",
    "Grunge07.webp.jpg",
    "Grunge09.webp.jpg",
    "Grunge10.webp.jpg",
    "Grunge11.webp.jpg",
    "mochaGrunge.png",
    "mochaGrunge.fw.webp.jpg",
    "mochaGrunge.webp.jpg",
    "purpGrunge.webp.jpg",
    "redGrunge2.webp.jpg",
    "redGrunge3.webp.jpg",
    "royalblueGrunge.webp.jpg",
    "rustGrunge3.webp.jpg",
    "rustGrunge4.webp.jpg",
    "subtle-tan_grunge.webp.jpg",
    "vertical-waves.png.png",
  ];
  var paperTextures = [
    "binding_light.png",
    "ep_naturalwhite.webp",
    "fabric_1.webp",
    "ricepaper_v3.webp",
    "roughcloth.jpg",
    "seamless_paper_texture.webp",
    "subtle_grunge.webp",
  ];
  var pageName = window.location.pathname.split("/").pop() || "story";
  var hash = 0;

  for (var index = 0; index < pageName.length; index += 1) {
    hash = (hash * 31 + pageName.charCodeAt(index)) >>> 0;
  }

  var pageBackground = pageBackgrounds[hash % pageBackgrounds.length];
  var paperTexture = paperTextures[hash % paperTextures.length];
  var imageRoot = new URL("../../images/bg/", document.baseURI).href;
  var paperRoot = new URL("../../images/bg/paper/", document.baseURI).href;
  var root = document.documentElement;

  function preloadImage(url) {
    var preload = document.createElement("link");
    preload.rel = "preload";
    preload.as = "image";
    preload.href = url;
    preload.fetchPriority = "high";
    document.head.appendChild(preload);
  }

  var pageBackgroundUrl = imageRoot + pageBackground;
  var paperTextureUrl = paperRoot + paperTexture;

  preloadImage(pageBackgroundUrl);
  preloadImage(paperTextureUrl);

  root.style.setProperty(
    "--story-page-bg-image",
    'url("' + pageBackgroundUrl + '")',
  );
  root.style.setProperty(
    "--story-paper-image",
    'url("' + paperTextureUrl + '")',
  );
  document.body?.setAttribute("data-story-theme", pageName);
})();
