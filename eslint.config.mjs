import js from "@eslint/js";
import globals from "globals";
import json from "@eslint/json";
import markdown from "@eslint/markdown";
import css from "@eslint/css";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores([
    ".backups/**",
    ".cache/**",
    ".sto/**",
    "begin*/**/*.js",
    "css/bootstrap.css",
    "docs/*.json",
    "docs/**/*.css",
    "docs/**/*.js",
    "docs/**/*_files/**",
    "easydialogs/**/*.js",
    "easyread/**/*.js",
    "essays/**/*.js",
    "images/icons/**/*.js",
    "kidsenglish*/**/*.js",
    "output/**",
    "package-lock.json",
    "people/**/*.js",
    "poc/**/*.json",
    "scripts/dict_original.js",
    "scripts/experimental-hotpotato.js",
    "scripts/extract-inline-css.js",
    "supereasy/**/*.js",
    "tmp/**",
    "vendor/**",
    ".vscode/launch.json",
    "markdown-cheat-sheet.md",
    "docs/ffs-dev-sync.md",
  ]),
  { files: ["**/*.{js,mjs,cjs}"], plugins: { js }, extends: ["js/recommended"], languageOptions: { globals: globals.browser } },
  { files: ["scripts/**/*.{js,mjs,cjs}"], languageOptions: { globals: globals.node } },
  { files: ["**/*.js"], languageOptions: { sourceType: "script" } },
  { files: ["**/*.json"], plugins: { json }, language: "json/json", extends: ["json/recommended"] },
  { files: ["**/*.md"], plugins: { markdown }, language: "markdown/commonmark", extends: ["markdown/recommended"] },
  {
    files: ["**/*.css"],
    plugins: { css },
    language: "css/css",
    extends: ["css/recommended"],
    rules: {
      "css/no-invalid-properties": ["error", { allowUnknownVariables: true }],
    },
  },
  {
    files: ["deploy/**/*.js"],
    languageOptions: { globals: { $: "readonly" } },
  },
]);
