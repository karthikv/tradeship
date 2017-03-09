"use strict";

const { lint, findPkgMeta } = require("./common");
const findExports = require("../rules/find-exports");

exports.run = function(dir, code) {
  if (!dir || !code) {
    throw new Error("must provide dir and code");
  }

  return findPkgMeta(dir).then(meta => {
    findExports.reset();
    const { sourceCode } = lint({
      meta,
      dir,
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
