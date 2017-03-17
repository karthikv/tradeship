const test = require("ava").default;
const fs = require("fs");
const yaml = require("js-yaml");
const path = require("path");

const importer = require("../lib/importer");

const importerYAML = fs.readFileSync(
  path.join(__dirname, "importer.yml"),
  "utf8"
);
const importerTests = yaml.safeLoad(importerYAML);

importerTests.forEach(({ name, input, expected, node }) => {
  test(`importer-node-${name}`, t => {
    return importer
      .run(__dirname, input)
      .then(actual => t.is(actual, expected));
  });

  if (!node) {
    test(`importer-${name}`, t => {
      return importer
        .run(__dirname, input, { env: { node: false } })
        .then(actual => t.is(actual, expected));
    });
  }
});
