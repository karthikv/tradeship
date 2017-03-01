const { lint } = require("./common");
const findExports = require("./rules/find-exports");

exports.run = function(code) {
  findExports.reset();
  lint(code, { "find-exports": "error" });
  return findExports.retrieve();
};
