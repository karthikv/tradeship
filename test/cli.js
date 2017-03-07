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

test("cli-help", t => {
  return cli(["-h"]).then(({ stderr, code }) => {
    t.regex(stderr, /Usage:/);
    t.is(code, 0);
  });
});

test("cli-version", t => {
  return cli(["-v"]).then(({ stderr, code }) => {
    t.regex(stderr, /\d+\.\d+\.\d+/);
    t.is(code, 0);
  });
});

test("cli-path", t => {
  const { input, expected } = importerTests.find(
    t => t.name === "prop-wrap-trailing-comma"
  );
  const inputPath = path.join(os.tmpdir(), "test-cli-path.js");

  return writeFile(inputPath, input).then(() => cli([inputPath])).then((
    { stdout, code }
  ) => {
    t.is(stdout, expected);
    t.is(code, 0);
  });
});

test("cli-write", t => {
  const { input, expected } = importerTests.find(t => t.name === "append-all");
  const inputPath = path.join(os.tmpdir(), "test-cli-write.js");

  return writeFile(inputPath, input)
    .then(() => cli(["-w", inputPath]))
    .then(({ stdout, code }) => {
      t.is(stdout, "");
      t.is(code, 0);
      return readFile(inputPath, "utf8");
    })
    .then(actual => t.is(actual, expected));
});

test("cli-stdin", t => {
  const { input, expected } = importerTests.find(
    t => t.name === "import-default-prop"
  );
  return cli(["-s", __dirname], input).then(({ stdout, code }) => {
    t.is(stdout, expected);
    t.is(code, 0);
  });
});

test("cli-write-stdin", t => {
  const { input, expected } = importerTests.find(
    t => t.name === "import-multi-ident"
  );
  const outputPath = path.join(os.tmpdir(), "test-cli-write-stdin.js");

  return cli(["-s", "-w", outputPath], input)
    .then(({ stdout, code }) => {
      t.is(stdout, "");
      t.is(code, 0);
      return readFile(outputPath, "utf8");
    })
    .then(actual => t.is(actual, expected));
});

test("cli-parsing-error", t => {
  const inputPath = path.join(__dirname, "..", "fixtures", "parsing-error.js");
  return cli([inputPath]).then(({ stderr, code }) => {
    t.regex(stderr, /class A extends/);
    t.is(code, 1);
  });
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

    cmd.on("close", code => resolve({ stdout, stderr, code }));
    cmd.on("error", err => reject(err));
  });
}
