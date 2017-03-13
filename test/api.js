"use strict";

const os = require("os");
const test = require("ava").default;

const api = require("../api");

const input = "fs.readFile();\n";
const expected = 'const fs = require("fs");\n\n' + input;

test("api", t =>
  api.import(os.tmpdir(), input).then(actual => t.is(actual, expected)));
