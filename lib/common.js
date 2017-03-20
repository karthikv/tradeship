"use strict";

const fs = require("fs");
const yaml = require("js-yaml");
const path = require("path");

exports.debug = require("debug")("tradeship");
exports.pkgRegex = /^(@[\w\.\-]+\/)?[\w\.\-]+$/;
exports.fileRegex = /^\.?\.?\//;
exports.whiteRegex = /^\s*$/;

exports.readFile = promisify(fs.readFile, fs);
exports.writeFile = promisify(fs.writeFile, fs);
exports.stat = promisify(fs.stat, fs);
exports.readdir = promisify(fs.readdir, fs);

const metaPromises = {};
exports.findPkgMeta = function(dir) {
  if (!path.isAbsolute(dir)) {
    dir = path.resolve(dir);
  }

  if (!metaPromises[dir]) {
    metaPromises[dir] = findPkgJSON(dir).then(({ root, contents }) => {
      const meta = contents ? exports.tryJSONParse(contents, {}) : {};
      meta.root = root;

      return getEslintEnv(meta, dir).then(env => {
        meta.env = env;
        return meta;
      });
    });
  }

  return metaPromises[dir];
};

exports.tryJSONParse = function(contents, defaultValue) {
  try {
    return JSON.parse(contents) || {};
  } catch (err) {
    if (err instanceof SyntaxError && err.message.indexOf("JSON") !== -1) {
      return defaultValue;
    }
    throw err;
  }
};

function findPkgJSON(dir) {
  if (!path.isAbsolute(dir)) {
    dir = path.resolve(dir);
  }

  return exports
    .readFile(path.join(dir, "package.json"), "utf8")
    .then(contents => ({ root: dir, contents }))
    .catch(err => {
      if (err.code === "ENOENT") {
        const parent = path.join(dir, "..");
        if (parent === dir) {
          // at the root; couldn't find anything
          return { root: null, contents: null };
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

function getEslintEnv(meta, dir) {
  if (!path.isAbsolute(dir)) {
    dir = path.resolve(dir);
  }

  return exports
    .readdir(dir)
    .then(files => {
      const configFiles = files.filter(f => eslintFiles.has(f));
      if (configFiles.length === 0) {
        return null;
      }

      const bestFile = configFiles.reduce(
        (best, file) =>
          eslintPriority[file] > eslintPriority[best] ? file : best,
        configFiles[0]
      );
      const bestFilePath = path.join(dir, bestFile);

      return exports.readFile(bestFilePath, "utf8").then(
        contents => parseConfig(bestFilePath, contents).env,
        // ignore errors if we can't read the file
        () => null
      );
    })
    .then(env => {
      if (env) {
        return env;
      }

      const parent = path.join(dir, "..");
      if (parent === dir) {
        // at the root; return default env
        return {
          node: true,
          browser: true,
          es6: true
        };
      }
      return getEslintEnv(meta, parent);
    });
}

function parseConfig(filePath, contents) {
  let config;
  switch (path.basename(filePath)) {
    case ".eslintrc.js":
      return require(filePath);

    case ".eslintrc.yaml":
    case ".eslintrc.yml":
      return tryYAMLParse(contents, {});

    case ".eslintrc.json":
      return exports.tryJSONParse(contents, {});

    case ".eslintrc":
      config = exports.tryJSONParse(contents, null);
      if (config) {
        return config;
      }
      return tryYAMLParse(contents, {});

    case "package.json":
      return exports.tryJSONParse(contents, {}).eslintConfig || {};

    default:
      throw new Error(`bad eslint file: ${file}`);
  }
}

function tryYAMLParse(contents, defaultValue) {
  try {
    return yaml.safeLoad(contents) || {};
  } catch (err) {
    if (err instanceof yaml.YAMLException) {
      return defaultValue;
    }
    throw err;
  }
}

function promisify(fn, context) {
  return function(...args) {
    return new Promise((resolve, reject) => {
      args.push(function(err, ...callbackArgs) {
        if (err) {
          reject(err);
        } else {
          if (callbackArgs.length === 0) {
            resolve();
          } else if (callbackArgs.length === 1) {
            resolve(callbackArgs[0]);
          } else {
            resolve(callbackArgs);
          }
        }
      });

      fn.apply(context, args);
    });
  };
}
