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
    addRequiresLine = reqs[0].node.declarations[0].loc.start.line;
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
  depIDs.forEach(id => libsToAdd[id] = { props: [], ident: null });

  missingIdents.forEach((ident, i) => {
    const { id, isProp } = deps[i];
    const lib = libsToAdd[id];

    if (isProp) {
      lib.props.push(ident);
    } else {
      lib.ident = ident;
    }
  });

  const nodesToRemove = [];
  reqs.forEach(({ node, depID, props, ident }) => {
    const lib = libsToAdd[depID];
    if (ident) {
      lib.ident = ident;
    }
    if (props) {
      lib.props.push(...props);
    }
    if (node) {
      nodesToRemove.push(node);
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
  const { kind, quote, semi, tab, trailingComma } = findStyle.retrieve();
  const statements = [];

  const deps = Object.keys(libs).sort();
  deps.forEach(dep => {
    const { props, ident } = libs[dep];

    let resolvedPath;
    if (dep.indexOf("/") === -1) {
      resolvedPath = dep;
    } else if (filePath) {
      resolvedPath = path.relative(path.dirname(filePath), dep);
    } else {
      // can't perform relative import without knowing file path
      return;
    }
    const requireText = `require(${quote}${resolvedPath}${quote})${semi}`;

    if (ident) {
      statements.push(`${kind} ${ident} = ${requireText}`);
    }
    if (props.length > 0) {
      let statement = `${kind} { ${props.join(", ")} } = ${requireText}`;

      // TODO: line length?
      if (statement.length > 80) {
        const propsText = tab + props.join(`,\n${tab}`) + trailingComma;
        statement = `${kind} {\n${propsText}\n} = ${requireText}`;
      }

      statements.push(statement);
    }
  });

  return statements.join("\n");
}
