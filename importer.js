const path = require("path");

const { lint } = require("./common");
const findImports = require("./rules/find-imports");
const findStyle = require("./rules/find-style");
const DepRegistry = require("./dep-registry");

const undefRegex = /^'(.*?)' is not defined.$/;

exports.run = function(code, filePath) {
  return DepRegistry.populate().then(depRegistry => {
    findImports.reset();
    findStyle.reset();

    const { violations, sourceCode } = lint(code, {
      "no-undef": "error",
      "find-imports": "error",
      "find-style": "error"
    });
    if (!sourceCode) {
      console.error(violations);
      throw new Error("couldn't parse code");
    }

    const reqs = findImports.retrieve();
    const missingIdents = findMissingIdents(violations, depRegistry);

    return rewriteCode({
      sourceCode,
      reqs,
      missingIdents,
      depRegistry,
      filePath
    });
  });
};

function findMissingIdents(violations, depRegistry) {
  return violations
    .filter(v => v.ruleId === "no-undef")
    .map(v => {
      const matches = v.message.match(undefRegex);
      if (matches) {
        return matches[1];
      }
      return null;
    })
    .filter(ident => ident !== null && depRegistry.search(ident));
}

function rewriteCode(
  { sourceCode, reqs, missingIdents, depRegistry, filePath }
) {
  // line numbers are 1-indexed, so add a blank line to make indexing easy
  const sourceByLine = sourceCode.lines.slice(0);
  sourceByLine.unshift("");

  const { linesToRemove, libsToAdd } = resolveIdents(
    missingIdents,
    depRegistry,
    reqs
  );
  // remove first blank line we artifically introduced
  linesToRemove.add(0);

  const requiresText = composeRequires(libsToAdd, filePath);
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

function resolveIdents(missingIdents, depRegistry, reqs) {
  const deps = missingIdents.map(ident => depRegistry.search(ident));
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
  missingIdents.forEach((ident, i) => {
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

  return { libsToAdd, linesToRemove };
}

function composeRequires(libs, filePath) {
  const style = findStyle.retrieve();
  const statements = [];

  const depIDs = Object.keys(libs).sort();
  depIDs.forEach(depID => {
    const { idents, defaults, props } = libs[depID];

    if (idents.length === 0 && defaults.length === 0 && props.length === 0) {
      // nothing to require
      return;
    }

    idents.sort();
    defaults.sort();
    props.sort();

    let id;
    // TODO: namespaced imports
    if (depID.indexOf("/") === -1) {
      id = depID;
    } else if (filePath) {
      id = path.relative(path.dirname(filePath), depID);
    } else {
      // can't perform relative import without knowing file path
      return;
    }

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
  });

  return statements.join("\n");
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
    // TODO: detect this in reqs
    return `${kind} ${ident} = ${requireText}.default${semi}`;
  } else {
    const destructure = composeDestructure(style, props, multiline);
    const statement = `${kind} ${destructure} = ${requireText}${semi}`;

    // TODO: line length style
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
    // TODO: space inside braces style
    return `{ ${props.join(", ")} }`;
  }
}
