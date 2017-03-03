const { lint } = require("./common");
const findExports = require("./rules/find-exports");

exports.run = function(code) {
  findExports.reset();
  const { violations, sourceCode } = lint(code, { "find-exports": "error" });

  // TODO: better printing / error handling?
  if (!sourceCode) {
    console.error(violations);
    throw new Error("couldn't parse code");
  }

  return findExports.retrieve();
};
