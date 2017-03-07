"use strict";

const { lint } = require("./common");
const findExports = require("./rules/find-exports");

exports.run = function(code) {
  findExports.reset();
  const { sourceCode } = lint(code, { "find-exports": "error" });

  if (!sourceCode) {
    // couldn't parse code
    return null;
  }
  return findExports.retrieve();
};
