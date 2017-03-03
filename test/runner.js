const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const test = require("ava").default;

const importer = require("../importer");
const parser = require("../parser");

const importerYAML = fs.readFileSync(
  path.join(__dirname, "importer.yml"),
  "utf8"
);
const importerTests = yaml.safeLoad(importerYAML);

importerTests.forEach(({ name, input, expected }) => {
  test(`importer-${name}`, t => {
    return importer
      .run(input, __filename)
      .then(actual => t.is(actual, expected));
  });
});

const parserYAML = fs.readFileSync(path.join(__dirname, "parser.yml"), "utf8");
const parserTests = yaml.safeLoad(parserYAML);

parserTests.forEach(({ name, input, idents, defaults, props }) => {
  test(`parser-${name}`, t => {
    const actual = parser.run(input);
    t.deepEqual(actual.idents, new Set(idents || []));
    t.deepEqual(actual.defaults, new Set(defaults || []));
    t.deepEqual(actual.props, new Set(props || []));
  });
});
