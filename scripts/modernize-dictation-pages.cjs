#!/usr/bin/env node

const { main } = require("./exercise-page-modernizer.cjs");

process.exitCode = main("dict");
