"use strict";

const fs = require("fs");
const path = require("path");

exports.pkgRegex = /^(@[\w\.\-]+\/)?[\w\.\-]+$/;
exports.fileRegex = /^\.?\.?\//;

exports.readFile = promisify(fs.readFile, fs);
exports.writeFile = promisify(fs.writeFile, fs);
exports.stat = promisify(fs.stat, fs);
exports.readdir = promisify(fs.readdir, fs);

exports.lint = function({ meta, dir, code, rules, useEslintrc, override }) {
  let eslintPath;
  if (
    meta &&
    (meta.dependencies && meta.dependencies.eslint ||
      meta.devDependencies && meta.devDependencies.eslint)
  ) {
    // use eslint locally installed within package
    eslintPath = path.join(meta.root, "node_modules", "eslint");
  } else {
    eslintPath = "eslint";
  }

  const { CLIEngine, linter } = require(eslintPath);
  const cli = new CLIEngine({
    useEslintrc,
    rulePaths: [
      path.join(__dirname, "..", "rules"),
      // Load eslint-plugin-react rules via rulePaths instead of plugins. This
      // allows us to use an eslint installation local to the given dir and
      // still have eslint-plugin-react rules accessible.
      path.join(
        __dirname,
        "..",
        "node_modules",
        "eslint-plugin-react",
        "lib",
        "rules"
      )
    ]
  });

  let config;
  try {
    // directory is what really matters, so use arbitrary file name
    config = cli.getConfigForFile(path.join(dir, "file.js"));
  } catch (err) {
    if (err.message.indexOf("No ESLint configuration") === -1) {
      throw err;
    } else {
      return exports.lint({
        meta,
        dir,
        code,
        rules,
        override,
        useEslintrc: false
      });
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

  config.rules = rules;
  if (override) {
    Object.assign(config, override);
  }

  const violations = linter.verify(code, config);
  return { config, violations, sourceCode: linter.getSourceCode() };
};

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

const metaPromises = {};
exports.findPkgMeta = function(dir) {
  if (dir[0] !== "/") {
    dir = path.resolve(dir);
  }
  if (metaPromises[dir]) {
    return metaPromises[dir];
  }

  const promise = exports
    .readFile(path.join(dir, "package.json"), "utf8")
    .then(json => {
      const meta = JSON.parse(json);
      meta.root = dir;
      return meta;
    })
    .catch(err => {
      if (err.code === "ENOENT") {
        if (dir === "/") {
          return null;
        }
        return exports.findPkgMeta(path.join(dir, ".."));
      } else {
        throw err;
      }
    });

  metaPromises[dir] = promise;
  return promise;
};

function promisify(fn, context) {
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
}
