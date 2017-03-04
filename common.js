const path = require("path");
const { CLIEngine, linter } = require("eslint");

exports.lint = function(code, rules) {
  const cli = new CLIEngine({
    useEslintrc: true,
    rulePaths: [path.join(__dirname, "rules")]
  });
  const config = cli.getConfigForFile(".");

  if (Object.getOwnPropertyNames(config.env).length === 0) {
    // assume node, browser, and es6 globals
    config.env = {
      node: true,
      browser: true,
      es6: true
    };
  }
  if (Object.getOwnPropertyNames(config.parserOptions).length === 0) {
    // assume es6 features
    config.parserOptions = {
      ecmaVersion: 6,
      sourceType: "module",
      ecmaFeatures: {
        impliedStrict: true,
        jsx: true
      }
    };
  }

  config.rules = rules;
  const violations = linter.verify(code, config);
  return { violations, sourceCode: linter.getSourceCode() };
};

exports.promisify = (fn, context) => {
  return function() {
    return new Promise((resolve, reject) => {
      const args = Array.from(arguments);
      args.push(function(err) {
        if (err) {
          reject(err);
        } else {
          const callbackArgs = Array.from(arguments).slice(1);
          if (callbackArgs.length === 1) {
            resolve(callbackArgs[0]);
          } else {
            resolve(callbackArgs);
          }
        }
      });

      return fn.apply(context, args);
    });
  };
};

exports.isGlobal = function(context, node, name) {
  if (node.type === "Identifier" && node.name === name) {
    const variable = exports.findVariable(context, node);
    return variable && variable.scope.type === "global";
  }
  return false;
};

exports.findVariable = function(context, node) {
  let scope = context.getScope();

  do {
    const variable = scope.set.get(node.name);
    if (variable) {
      return variable;
    }
    scope = scope.upper;
  } while (scope);

  return null;
};

exports.getKey = function(node) {
  switch (node.type) {
    case "Identifier":
      return node.name;

    case "StringLiteral":
      return node.value;

    default:
      return null;
  }
};

exports.pkgRegex = /^(@[\w\.\-]+\/)?[\w\.\-]+$/;
