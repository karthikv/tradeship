"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const os = require("os");
const yaml = require("js-yaml");
const test = require("ava").default;

const { readFile, writeFile } = require("../common");

const importerYAML = fs.readFileSync(
  path.join(__dirname, "importer.yml"),
  "utf8"
);
const importerTests = yaml.safeLoad(importerYAML);

test("cli-help", t =>
  cli(["-h"]).then(([, stderr]) => t.regex(stderr, /Usage:/)));

test("cli-version", t =>
  cli(["-v"]).then(([, stderr]) => t.regex(stderr, /\d+\.\d+\.\d+/)));

test("cli-path", t => {
  const { input, expected } = importerTests.find(
    t => t.name === "prop-wrap-trailing-comma"
  );
  const inputPath = path.join(os.tmpdir(), "test-cli-path.js");

  return writeFile(inputPath, input)
    .then(() => cli([inputPath]))
    .then(([stdout]) => t.is(stdout, expected));
});

test("cli-write", t => {
  const { input, expected } = importerTests.find(t => t.name === "append-all");
  const inputPath = path.join(os.tmpdir(), "test-cli-write.js");

  return writeFile(inputPath, input)
    .then(() => cli(["-w", inputPath]))
    .then(([stdout]) => {
      t.is(stdout, "");
      return readFile(inputPath, "utf8");
    })
    .then(actual => t.is(actual, expected));
});

test("cli-stdin", t => {
  const { input, expected } = importerTests.find(
    t => t.name === "import-default-prop"
  );
  return cli(["-s", __dirname], input).then(([stdout]) =>
    t.is(stdout, expected));
});

test("cli-write-stdin", t => {
  const { input, expected } = importerTests.find(
    t => t.name === "import-multi-ident"
  );
  const outputPath = path.join(os.tmpdir(), "test-cli-write-stdin.js");

  return cli(["-s", "-w", outputPath], input)
    .then(([stdout]) => {
      t.is(stdout, "");
      return readFile(outputPath, "utf8");
    })
    .then(actual => t.is(actual, expected));
});

function cli(args, stdin = null) {
  const cli = path.resolve(__dirname, "..", "cli.js");
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const cmd = spawn(cli, args);
    cmd.stdout.on("data", chunk => stdout += chunk);
    cmd.stderr.on("data", chunk => stderr += chunk);

    if (stdin) {
      cmd.stdin.end(stdin);
    }

    cmd.on("close", code => {
      if (code === 0) {
        resolve([stdout, stderr]);
      } else {
        reject(new Error(`bad code: ${code}; stderr: ${stderr}`));
      }
    });
    cmd.on("error", err => reject(err));
  });
}
