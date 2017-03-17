"use strict";

const { findPkgMeta, lint } = require("./common");
const findExports = require("../rules/find-exports");

exports.run = function(dir, code) {
  return findPkgMeta(dir).then(meta => {
    findExports.reset();
    const { sourceCode } = lint({
      meta,
      code,
      rules: { "find-exports": "error" }
    });

    if (!sourceCode) {
      // couldn't parse code
      return null;
    }
    return findExports.retrieve();
  });
};
