const test = require("ava").default;
const fs = require("fs");
const yaml = require("js-yaml");
const path = require("path");

const parser = require("../lib/parser");

const parserYAML = fs.readFileSync(path.join(__dirname, "parser.yml"), "utf8");
const parserTests = yaml.safeLoad(parserYAML);

parserTests.forEach(({ name, input, idents, defaults, props }) => {
  test(`parser-${name}`, t => {
    return parser.run(__dirname, input).then(actual => {
      t.deepEqual(actual.idents, new Set(idents || []));
      t.deepEqual(actual.defaults, new Set(defaults || []));
      t.deepEqual(actual.props, new Set(props || []));
    });
  });
});
