"use strict";

const importer = require("./lib/importer");

exports.import = function(dir, code) {
  return importer.run(dir, code);
};
