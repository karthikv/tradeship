const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const test = require("ava").default;

const importer = require("../importer");

const importerYAML = fs.readFileSync(
  path.join(__dirname, "importer.yml"),
  "utf8"
);
const importerTests = yaml.safeLoad(importerYAML);

importerTests.forEach(({ name, input, expected }) => {
  test(`importer-${name}`, t => {
    return importer
      .run(input, __dirname)
      .then(actual => t.is(actual, expected));
  });
});