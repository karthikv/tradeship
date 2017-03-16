"use strict";

const path = require("path");

const { lint, fileRegex, findPkgMeta, whiteRegex } = require("./common");
const findImports = require("../rules/find-imports");
const findStyle = require("../rules/find-style");
const DepRegistry = require("./dep-registry");

const undefRegex = /^'(.*?)' is not defined.$/;
const inScopeRegex = /^'(.*?)' must be in scope when using JSX$/;
const backslashRegex = /\\/g;

exports.run = function(dir, code, override) {
  return findPkgMeta(dir).then(meta => {
    findImports.reset();
    findStyle.reset();

    const { violations, sourceCode } = lint({
      meta,
      code,
      override,
      rules: {
        "no-undef": "error",
        "find-imports": "error",
        "find-style": "error",
        "jsx-uses-react": "error",
        "jsx-no-undef": "error",
        "jsx-uses-vars": "error",
        "react-in-jsx-scope": "error"
      }
    });

    if (!sourceCode) {
      if (violations.length > 0) {
        throw violations[0];
      }
      throw new Error("couldn't parse code and no violations");
    }

    const { eslintConfig: { parserOptions } } = meta;
    if (parserOptions && parserOptions.ecmaVersion < 6) {
      const message = "only es6 (es2015) and higher is supported; eslint " +
        `config says you're using es${parserOptions.ecmaVersion}`;
      throw new Error(message);
    }

    const reqs = findImports.retrieve();
    const style = findStyle.retrieve();

    // resolve all relative dependency paths
    reqs.forEach(req => {
      if (fileRegex.test(req.depID)) {
        // must split on forward slash so resolving works correctly on Windows
        req.depID = path.resolve(dir, ...req.depID.split("/"));
      }
    });

    const missingIdents = findMissingIdents(violations);
    return DepRegistry.populate(dir, meta).then(depRegistry => rewriteCode({
      sourceCode,
      reqs,
      missingIdents,
      depRegistry,
      style,
      dir
    }));
  });
};

function findMissingIdents(violations) {
  const idents = violations
    .map(v => {
      let regex;
      if (v.ruleId === "no-undef" || v.ruleId === "jsx-no-undef") {
        regex = undefRegex;
      } else if (v.ruleId === "react-in-jsx-scope") {
        regex = inScopeRegex;
      } else {
        throw new Error(`unexpected rule ${v.ruleId}`);
      }

      const matches = v.message.match(regex);
      return matches ? matches[1] : null;
    })
    .filter(i => i !== null);
  return Array.from(new Set(idents));
}

function rewriteCode(
  { sourceCode, reqs, missingIdents, depRegistry, style, dir }
) {
  // line numbers are 1-indexed, so add a blank line to make indexing easy
  const sourceByLine = sourceCode.lines.slice(0);
  sourceByLine.unshift("");

  const { linesToRemove, libsToAdd } = resolveIdents({
    sourceByLine,
    depRegistry,
    reqs,
    missingIdents
  });
  // remove first blank line we artifically introduced
  linesToRemove.add(0);

  const requiresText = composeRequires(style, dir, libsToAdd);
  let addRequiresLine = 0;
  if (reqs.length > 0) {
    addRequiresLine = reqs[0].node.loc.start.line;
  }

  let newCode = "";
  for (let line = 0; line < sourceByLine.length; line++) {
    if (!linesToRemove.has(line)) {
      newCode += sourceByLine[line] + "\n";
    }
    if (line === addRequiresLine && requiresText.length > 0) {
      // when prepending requires, add extra blank line between requires and code
      newCode += requiresText + (reqs.length > 0 ? "\n" : "\n\n");
    }
  }

  if (newCode.slice(-1) !== "\n") {
    newCode = newCode + "\n";
  } else if (newCode.slice(-2) === "\n\n") {
    newCode = newCode.slice(0, -1);
  }
  return newCode;
}

function resolveIdents({ sourceByLine, depRegistry, reqs, missingIdents }) {
  const fixableIdents = missingIdents.filter(i => depRegistry.search(i));
  const deps = fixableIdents.map(i => depRegistry.search(i));
  const depIDs = reqs.map(req => req.depID).concat(deps.map(d => d.id));

  const libsToAdd = {};
  depIDs.forEach(
    id => libsToAdd[id] = {
      idents: [],
      defaults: [],
      props: []
    }
  );

  const { types } = DepRegistry;
  fixableIdents.forEach((ident, i) => {
    const { id, type } = deps[i];
    const lib = libsToAdd[id];

    switch (type) {
      case types.ident:
        lib.idents.push(ident);
        break;
      case types.default:
        lib.defaults.push(ident);
        break;
      case types.prop:
        lib.props.push(ident);
        break;
      default:
        throw new Error("unexpected type " + type);
    }
  });

  const nodesToRemove = [];
  reqs.forEach(({ node, depID, idents, defaults, props }) => {
    const lib = libsToAdd[depID];

    if (node) {
      nodesToRemove.push(node);
    }
    if (idents) {
      lib.idents.push(...idents);
    }
    if (defaults) {
      lib.defaults.push(...defaults);
    }
    if (props) {
      lib.props.push(...props);
    }
  });

  const linesToRemove = new Set();
  nodesToRemove.forEach(({ loc: { start, end } }) => {
    for (let line = start.line; line <= end.line; line++) {
      linesToRemove.add(line);
    }
  });

  const sortedLinesToRemove = Array.from(linesToRemove)
    .sort((l1, l2) => l1 - l2);
  let lastLine = sortedLinesToRemove[0];

  // If the intermediate lines between two subsequent lines to remove are all
  // blank, remove the intermediate lines as well.
  sortedLinesToRemove.slice(1).forEach(line => {
    let allBlank = true;
    for (let j = lastLine + 1; j < line; j++) {
      allBlank = allBlank && whiteRegex.test(sourceByLine[j]);
    }

    if (allBlank) {
      for (let j = lastLine + 1; j < line; j++) {
        linesToRemove.add(j);
      }
    }
    lastLine = line;
  });

  return { libsToAdd, linesToRemove };
}

function composeRequires(style, dir, libs) {
  // turn absolute dep ids into relative ones
  Object.keys(libs).forEach(id => {
    if (path.isAbsolute(id)) {
      // node module ids always have unix-style separators
      let newID = path.relative(dir, id).replace(backslashRegex, "/");
      if (newID[0] !== ".") {
        newID = `./${newID}`;
      }
      libs[newID] = libs[id];
      delete libs[id];
    }
  });

  const ids = Object.keys(libs);
  const externalIDs = ids
    .filter(i => !fileRegex.test(i))
    .sort(compareByBasename);
  const localIDs = ids.filter(i => fileRegex.test(i)).sort(compareByBasename);

  const externalStatements = [];
  const localStatements = [];

  externalIDs.forEach(id =>
    externalStatements.push(...composeStatements(style, libs[id], id)));
  localIDs.forEach(id =>
    localStatements.push(...composeStatements(style, libs[id], id)));

  const statements = externalStatements;
  if (externalStatements.length > 0 && localStatements.length > 0) {
    // add blank line between external and local imports
    statements.push("");
  }
  statements.push(...localStatements);

  return statements.join("\n");
}

function compareByBasename(id1, id2) {
  const base1 = path.basename(id1);
  const base2 = path.basename(id2);

  if (base1 !== base2) {
    return base1 < base2 ? -1 : 1;
  }
  return id1 < id2 ? -1 : 1;
}

function composeStatements(style, lib, id) {
  const statements = [];
  const { idents, defaults, props } = lib;

  if (idents.length === 0 && defaults.length === 0 && props.length === 0) {
    // nothing to require
    return statements;
  }

  idents.sort();
  defaults.sort();
  props.sort();

  if (style.requireKeyword === "require") {
    statements.push(
      ...idents.map(ident => composeRequireStatement({ style, id, ident })),
      ...defaults.map(def => composeRequireStatement({ style, id, def }))
    );

    if (props.length > 0) {
      statements.push(composeRequireStatement({ style, id, props }));
    }
  } else {
    statements.push(
      composeImportStatement({
        style,
        id,
        props,
        ident: idents[0],
        def: defaults[0]
      }),
      ...idents
        .slice(1)
        .map((ident, i) =>
          composeImportStatement({ style, id, ident, def: defaults[i + 1] })),
      ...defaults
        .slice(Math.max(idents.length, 1))
        .map(def => composeImportStatement({ style, id, def }))
    );
  }

  return statements;
}

function composeRequireStatement({ style, id, ident, def, props, multiline }) {
  if (ident && def || ident && props || def && props) {
    throw new Error("only one of ident, default, and props must be specified");
  }

  const { kind, quote, semi } = style;
  const requireText = `require(${quote}${id}${quote})`;

  if (ident) {
    return `${kind} ${ident} = ${requireText}${semi}`;
  } else if (def) {
    return `${kind} ${def} = ${requireText}.default${semi}`;
  } else {
    const destructure = composeDestructure(style, props, multiline);
    const statement = `${kind} ${destructure} = ${requireText}${semi}`;

    if (!multiline && statement.length > 80) {
      return composeRequireStatement({
        style,
        id,
        props,
        multiline: true
      });
    }
    return statement;
  }
}

function composeImportStatement({ style, id, ident, def, props, multiline }) {
  const parts = [];
  if (def) {
    parts.push(def);
  }
  if (ident) {
    parts.push(`* as ${ident}`);
  }
  if (props && props.length > 0) {
    parts.push(composeDestructure(style, props, multiline));
  }

  const { quote, semi } = style;
  const names = parts.join(", ");
  const statement = `import ${names} from ${quote}${id}${quote}${semi}`;

  if (props && !multiline && statement.length > 80) {
    return composeImportStatement({
      style,
      id,
      ident,
      def,
      props,
      multiline: true
    });
  }
  return statement;
}

function composeDestructure(style, props, multiline) {
  if (multiline) {
    const { tab, trailingComma } = style;
    const propsText = tab + props.join(`,\n${tab}`) + trailingComma;
    return `{\n${propsText}\n}`;
  } else {
    return `{ ${props.join(", ")} }`;
  }
}
