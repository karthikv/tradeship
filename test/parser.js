const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const test = require("ava").default;

const parser = require("../parser");

const parserYAML = fs.readFileSync(path.join(__dirname, "parser.yml"), "utf8");
const parserTests = yaml.safeLoad(parserYAML);

parserTests.forEach(({ name, input, idents, defaults, props }) => {
  test(`parser-${name}`, t => {
    const actual = parser.run(__dirname, input);
    t.deepEqual(actual.idents, new Set(idents || []));
    t.deepEqual(actual.defaults, new Set(defaults || []));
    t.deepEqual(actual.props, new Set(props || []));
  });
});
