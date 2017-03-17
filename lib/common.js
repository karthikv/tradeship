"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

exports.debug = require("debug")("tradeship");
exports.pkgRegex = /^(@[\w\.\-]+\/)?[\w\.\-]+$/;
exports.fileRegex = /^\.?\.?\//;
exports.whiteRegex = /^\s*$/;

exports.readFile = promisify(fs.readFile, fs);
exports.writeFile = promisify(fs.writeFile, fs);
exports.stat = promisify(fs.stat, fs);
exports.readdir = promisify(fs.readdir, fs);

exports.lint = function({ meta, code, rules, override }) {
  const { linter } = requireEslint(meta);
  const config = Object.assign({}, meta.eslintConfig, { rules }, override);
  const violations = linter.verify(code, config);
  return { violations, sourceCode: linter.getSourceCode() };
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
  if (!path.isAbsolute(dir)) {
    dir = path.resolve(dir);
  }

  if (!metaPromises[dir]) {
    metaPromises[dir] = findPkgJSON(dir).then(({ root, json }) => {
      const meta = json ? exports.tryJSONParse(json, {}) : {};
      meta.root = root;

      return getEslintConfig(meta, dir).then(config => {
        meta.eslintConfig = config;
        return meta;
      });
    });
  }

  return metaPromises[dir];
};

exports.tryJSONParse = function(json, defaultValue) {
  try {
    return JSON.parse(json);
  } catch (err) {
    if (err.name !== "SyntaxError" || err.message.indexOf("JSON") === -1) {
      throw err;
    }
    return defaultValue;
  }
};

function findPkgJSON(dir) {
  if (!path.isAbsolute(dir)) {
    dir = path.resolve(dir);
  }

  return exports
    .readFile(path.join(dir, "package.json"), "utf8")
    .then(json => ({ root: dir, json }))
    .catch(err => {
      if (err.code === "ENOENT") {
        const parent = path.join(dir, "..");
        if (parent === dir) {
          // at the root; couldn't find anything
          return { root: null, json: null };
        }
        return findPkgJSON(parent);
      } else {
        throw err;
      }
    });
}

const eslintPriority = {
  ".eslintrc.js": 5,
  ".eslintrc.yaml": 4,
  ".eslintrc.yml": 3,
  ".eslintrc.json": 2,
  ".eslintrc": 1,
  "package.json": 0
};
const eslintFiles = new Set(Object.keys(eslintPriority));

function getEslintConfig(meta, dir) {
  return getConfigMtimes(meta, dir)
    .then(mtimes => {
      const hash = crypto.createHash("sha256");
      hash.update(`eslint-${JSON.stringify(mtimes)}`);

      const cachePath = path.join(
        os.tmpdir(),
        `tradeship-eslint-${hash.digest("hex")}`
      );
      return Promise.all([
        loadEslintCLI(meta),
        readEslintCache(cachePath),
        cachePath
      ]);
    })
    .then(([cli, cache, cachePath]) => {
      if (cache) {
        return cache;
      }

      let config;
      try {
        // directory is what really matters, so use arbitrary file name
        config = cli.getConfigForFile(path.join(dir, "file.js"));
      } catch (err) {
        if (
          err.message.indexOf("No ESLint configuration") === -1 ||
          !cli.options.useEslintrc
        ) {
          throw err;
        } else {
          cli.options.useEslintrc = false;
          config = cli.getConfigForFile(path.join(dir, "file.js"));
        }
      }

      return exports
        .writeFile(cachePath, JSON.stringify(config))
        .then(() => config);
    })
    .then(config => {
      setConfigDefaults(config);
      return config;
    });
}

function loadEslintCLI(meta) {
  const possiblePluginPaths = [
    // if we're developing on tradeship, node_modules is within root folder
    path.join(__dirname, "..", "node_modules", "eslint-plugin-react"),
    // if we installed tradeship, it's contained within node_modules
    path.join(__dirname, "..", "..", "eslint-plugin-react")
  ];

  return Promise
    .all(
      possiblePluginPaths.map(p => exports.stat(p).catch(err => {
        if (err.code === "ENOENT") {
          return null;
        }
        throw err;
      }))
    )
    .then(stats => {
      const index = stats.findIndex(s => s && s.isDirectory());
      if (index === -1) {
        throw new Error("couldn't find eslint-plugin-react");
      }
      return possiblePluginPaths[index];
    })
    .then(pluginPath => {
      const { CLIEngine } = requireEslint(meta);
      return new CLIEngine({
        useEslintrc: true,
        rulePaths: [
          path.join(__dirname, "..", "rules"),
          // Load eslint-plugin-react rules via rulePaths instead of plugins. This
          // allows us to use an eslint installation local to the given dir and
          // still have eslint-plugin-react rules accessible.
          path.join(pluginPath, "lib", "rules")
        ]
      });
    });
}

function readEslintCache(cachePath) {
  return exports
    .readFile(cachePath)
    .catch(err => {
      if (err.code === "ENOENT") {
        return null;
      }
      throw err;
    })
    .then(contents => {
      if (!contents) {
        return null;
      }

      return exports.tryJSONParse(contents, null);
    });
}

function getConfigMtimes(meta, dir) {
  if (!path.isAbsolute(dir)) {
    dir = path.resolve(dir);
  }

  const mtimes = {};
  return exports
    .readdir(dir)
    .then(files => {
      const configFiles = files.filter(f => eslintFiles.has(f));
      if (configFiles.length === 0) {
        return;
      }

      const bestFile = configFiles.reduce(
        (best, file) =>
          eslintPriority[file] > eslintPriority[best] ? file : best,
        configFiles[0]
      );
      const bestFilePath = path.join(dir, bestFile);

      return exports
        .stat(bestFilePath)
        .then(s => mtimes[bestFilePath] = s.mtime.getTime());
    })
    .then(() => {
      const parent = path.join(dir, "..");
      if (parent === dir) {
        // at the root
        return {};
      }
      return getConfigMtimes(meta, parent);
    })
    .then(parentMtimes => Object.assign(parentMtimes, mtimes));
}

function requireEslint(meta) {
  let eslintPath;
  if (
    meta.dependencies && meta.dependencies.eslint ||
    meta.devDependencies && meta.devDependencies.eslint
  ) {
    // use eslint locally installed within package
    eslintPath = path.join(meta.root, "node_modules", "eslint");
  } else {
    eslintPath = "eslint";
  }

  return require(eslintPath);
}

function setConfigDefaults(config) {
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
}

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
