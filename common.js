"use strict";

const fs = require("fs");
const path = require("path");
const { CLIEngine, linter } = require("eslint");

exports.lint = function({ dir, code, rules, override }) {
  const cli = new CLIEngine({
    useEslintrc: true,
    rulePaths: [path.join(__dirname, "rules")]
  });

  let config;
  try {
    // directory is what really matters, so use arbitrary file name
    config = cli.getConfigForFile(path.join(dir, "file.js"));
  } catch (err) {
    if (err.message.indexOf("No ESLint configuration") === -1) {
      throw err;
    } else {
      config = {};
    }
  }

  if (!config.env || Object.getOwnPropertyNames(config.env).length === 0) {
    // assume node, browser, and es6 globals
    config.env = {
      node: true,
      browser: true,
      es6: true
    };
  }
  if (
    !config.parserOptions ||
    Object.getOwnPropertyNames(config.parserOptions).length === 0
  ) {
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

  // to detect require() calls and exports, we must have these globals
  config.globals = config.globals || {};
  ["require", "module", "exports"].forEach(
    global => config.globals[global] = false
  );

  if (override) {
    Object.assign(config, override);
  }

  config.rules = rules;
  const violations = linter.verify(code, config);
  return { config, violations, sourceCode: linter.getSourceCode() };
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

exports.readFile = exports.promisify(fs.readFile, fs);
exports.writeFile = exports.promisify(fs.writeFile, fs);
exports.stat = exports.promisify(fs.stat, fs);
exports.readdir = exports.promisify(fs.readdir, fs);

exports.isGlobal = function(context, node, name) {
  if (node.type === "Identifier" && node.name === name) {
    const variable = exports.findVariable(context, node);
    return variable && variable.scope.type === "global";
  }
  return false;
};

exports.findVariable = function(context, node) {
  return exports.findVariableByName(context, node.name);
};

exports.findVariableByName = function(context, name) {
  let scope = context.getScope();

  do {
    const variable = scope.set.get(name);
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
