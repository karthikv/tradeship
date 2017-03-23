"use strict";

const { findPkgMeta } = require("./common");
const findExports = require("../visits/find-exports.js");
const walker = require("./walker.js");

exports.run = function(dir, code) {
  return findPkgMeta(dir).then(meta => {
    const context = walker.run(meta, code, [findExports]);
    if (context.error) {
      throw context.error;
    }

    return context.exported;
  });
};
