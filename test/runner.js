const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const test = require("ava").default;

const importer = require("../importer");

const testsPath = path.join(__dirname, "tests.yml");
const tests = yaml.safeLoad(fs.readFileSync(testsPath, "utf8"));

function runTest(input, expected, t) {
  const actual = importer.run(input);
  t.is(actual, expected);
}

tests.forEach(({ name, input, expected }) => {
  test(name, runTest.bind(this, input, expected));
});
