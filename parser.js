"use strict";

const { lint } = require("./common");
const findExports = require("./rules/find-exports");

exports.run = function(dir, code) {
  if (!dir || !code) {
    throw new Error("must provide dir and code");
  }

  findExports.reset();
  const { sourceCode } = lint({
    dir,
    code,
    rules: { "find-exports": "error" }
  });

  if (!sourceCode) {
    // couldn't parse code
    return null;
  }
  return findExports.retrieve();
};
