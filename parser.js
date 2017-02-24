const fs = require("fs");
const path = require("path");

const { promisify, lint } = require("./common");
const findExports = require("./rules/find-exports");

const readFile = promisify(fs.readFile, fs);
const readdir = promisify(fs.readdir, fs);
const stat = promisify(fs.stat, fs);

exports.run = function(code) {
  lint(code, { "find-exports": "error" });
  return findExports.retrieve();
};

exports.parsePackages = function() {
  return findNodeModulesDir()
    .then(dir => {
      return readdir(dir).then(paths => {
        // TODO: ensure dir
        const promises = paths
          .filter(p => p === "react") // .filter(
          //   (p, i) => p[0] !== "." && p[0] !== "@" && i >= 270 && i <= 300
          // )
          .map(p => parsePackageExports(path.join(dir, p)));
        return Promise.all(promises);
      });
    })
    .then(exports => {
      const exportMap = {};
      exports.forEach(({ pkg, idents, props }) => {
        exportMap[pkg] = { idents, props };
      });
      return exportMap;
    });
};

function parsePackageExports(dir) {
  return readFile(path.join(dir, "package.json"), "utf8").then(json => {
    const main = JSON.parse(json).main || "index.js";
    const mainPath = path.join(dir, main);
    const pkg = path.basename(dir);

    return readCode(mainPath)
      .then(code => exports.parseExports(path.dirname(mainPath), code))
      .then(({ idents, props }) => ({ pkg, idents, props }));
  });
}

function readCode(codePath) {
  return stat(codePath)
    .then(s => {
      if (s.isFile()) {
        return readFile(codePath, "utf8");
      }
      return readFile(path.join(codePath, "index.js"), "utf8");
    })
    .catch(err => {
      if (err.code === "ENOENT") {
        return readFile(codePath + ".js", "utf8");
      }
      throw err;
    });
}
