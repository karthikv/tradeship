#!/usr/bin/env node
/* eslint no-console: ["error", { allow: ["error"] }] */
"use strict";

const path = require("path");

const { readFile, stat, writeFile } = require("./lib/common");
const importer = require("./lib/importer");

const args = process.argv.slice(2);
const options = {
  stdin: false,
  write: false,
  help: false,
  version: false,
  path: null
};

args.forEach(arg => {
  if (arg === "-s" || arg === "--stdin") {
    options.stdin = true;
  } else if (arg === "-w" || arg === "--write") {
    options.write = true;
  } else if (arg === "-h" || arg === "--help") {
    options.help = true;
  } else if (arg === "-v" || arg === "--version") {
    options.version = true;
  } else if (arg[0] !== "-") {
    if (options.path) {
      console.error("Can only specify a single path");
      process.exit(1);
    }
    options.path = arg;
  } else {
    console.error("Unexpected option", arg);
    process.exit(1);
  }
});

if (options.help || args.length === 0) {
  const lines = [
    "Usage: tradeship [options] [path]",
    "Automatically imports missing JS dependencies and removes unused ones.",
    "",
    "Options:",
    "-s, --stdin    read contents from stdin",
    "-w, --write    write output to source file (careful!)",
    "-h, --help     print help",
    "-v, --version  print version",
    "",
    "Arguments:",
    "[path]  Relative imports and available npm packages will be determined",
    "        from this path. If not --stdin, input code will be read from this",
    "        path. If --write, new code will be written to this path."
  ];
  console.error(lines.join("\n"));
  process.exit(0);
}

if (options.version) {
  const pkg = require("./package.json");
  console.error(pkg.version);
  process.exit(0);
}

if (!options.path) {
  let message = "Must specify a path ";
  if (options.stdin) {
    message += "to resolve relative imports and find available npm packages.";
  } else {
    message += "that contains the input source code.";
  }
  console.error(message);
  process.exit(1);
}

let codePromise;
if (options.stdin) {
  codePromise = new Promise((resolve, reject) => {
    let contents = "";
    process.stdin.on("data", chunk => contents += chunk);
    process.stdin.on("end", () => resolve(contents));
    process.stdin.on("error", reject);
  });
} else {
  codePromise = readFile(options.path, "utf8");
}

let code;
codePromise
  .then(c => {
    code = c;
    if (options.stdin) {
      return stat(options.path);
    }
    return null;
  })
  .catch(err => {
    if (err.code === "ENOENT" && options.write) {
      return null;
    }
    throw err;
  })
  .then(s => {
    if (s && s.isDirectory()) {
      return importer.run(options.path, code);
    } else {
      return importer.run(path.dirname(options.path), code);
    }
  })
  .then(newCode => {
    if (options.write) {
      return writeFile(options.path, newCode);
    } else {
      process.stdout.write(newCode);
    }
  })
  .catch(err => {
    if (err instanceof SyntaxError && err.loc) {
      const codeFrame = require("babel-code-frame");
      const { line, column } = err.loc;

      const frame = codeFrame(code, line, column + 1, { highlightCode: true });
      console.error(`${err.message}\n${frame}`);
      process.exit(1);
    }

    console.error(err);
    process.exit(1);
  });
