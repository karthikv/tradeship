const { lint } = require("./common");
const findImports = require("./rules/find-imports");
const IdentLib = require("./ident-lib");

const undefRegex = /^'(.*?)' is not defined.$/;

exports.run = function(code) {
  return IdentLib.populate().then(identLib => {
    const { violations, sourceCode } = lint(code, {
      "no-undef": "error",
      "no-unused-vars": "error",
      "find-imports": "error"
    });

    const { reqs, reqsToAdd, reqsToRemove } = findImports.retrieve();
    const missingIdents = findMissingIdents(violations, identLib);

    return rewriteCode({
      sourceCode,
      reqs,
      reqsToAdd,
      reqsToRemove,
      missingIdents,
      identLib
    });
  });
};

function findMissingIdents(violations, identLib) {
  return violations
    .filter(v => v.ruleId === "no-undef")
    .map(v => {
      const matches = v.message.match(undefRegex);
      if (matches) {
        return matches[1];
      }
      return null;
    })
    .filter(ident => ident !== null && identLib.search(ident));
}

function rewriteCode(
  { sourceCode, reqs, reqsToAdd, reqsToRemove, missingIdents, identLib }
) {
  // line numbers are 1-indexed, so add a blank line to make indexing easy
  const sourceByLine = sourceCode.lines.slice(0);
  sourceByLine.unshift("");

  const { linesToRemove, libsToAdd } = resolveIdents({
    missingIdents,
    identLib,
    reqs,
    reqsToAdd,
    reqsToRemove
  });
  // remove first blank line we artifically introduced
  linesToRemove.add(0);

  const lastReq = reqs[reqs.length - 1] ||
    reqsToRemove[reqsToRemove.length - 1];
  const addRequiresLine = lastReq
    ? lastReq.node.declarations[0].loc.end.line
    : 0;

  let requiresText;
  if (lastReq) {
    requiresText = composeMatchingRequires(sourceCode, lastReq, libsToAdd);
  } else {
    requiresText = composeNewRequires(sourceCode, libsToAdd);
  }

  let newCode = "";
  for (let line = 0; line < sourceByLine.length; line++) {
    if (!linesToRemove.has(line)) {
      newCode += sourceByLine[line] + "\n";
    }
    if (line === addRequiresLine && requiresText.length > 0) {
      // when prepending requires, add extra blank line between requires and code
      newCode += requiresText + (lastReq ? "\n" : "\n\n");
    }
  }

  if (newCode.slice(-1) !== "\n") {
    newCode = newCode + "\n";
  } else if (newCode.slice(-2) === "\n\n") {
    newCode = newCode.slice(0, -1);
  }
  return newCode;
}

function resolveIdents(
  {
    missingIdents,
    identLib,
    reqs,
    reqsToAdd,
    reqsToRemove
  }
) {
  const results = missingIdents.map(ident => identLib.search(ident));
  const deps = reqsToAdd.map(req => req.dep).concat(results.map(r => r.dep));

  const libsToAdd = {};
  deps.forEach(dep => libsToAdd[dep] = { props: [], ident: null });

  reqsToAdd.forEach(({ dep, props }) => {
    libsToAdd[dep].props.push(...props);
  });

  missingIdents.forEach((ident, i) => {
    const { dep, isProp } = results[i];
    const lib = libsToAdd[dep];

    if (isProp) {
      lib.props.push(ident);
    } else {
      lib.ident = ident;
    }
  });

  reqs.forEach(({ node, dep, props, ident }) => {
    const lib = libsToAdd[dep];
    if (lib) {
      if (props) {
        lib.props.push(...props);
      } else {
        lib.ident = ident;
      }
      reqsToRemove.push({ node });
    }
  });

  const linesToRemove = new Set();
  reqsToRemove.forEach(({ node: { loc } }) => {
    for (let line = loc.start.line; line <= loc.end.line; line++) {
      linesToRemove.add(line);
    }
  });

  return { libsToAdd, linesToRemove };
}

function composeMatchingRequires(sourceCode, { node }, libs) {
  const { lines, text } = sourceCode;
  const {
    kind,
    loc: { end: { line, column } }
  } = node;

  const semi = lines[line - 1][column - 1] === ";" ? ";" : "";
  const arg = node.declarations[0].init.arguments[0].raw;
  let quote;

  if (arg[0] === "'" || arg[0] === '"') {
    quote = arg[0];
  } else {
    quote = mostFreqQuote(text);
  }

  return composeRequires({ kind, quote, semi, libs });
}

function composeNewRequires({ lines, text }, libs) {
  let numSemis = count(text, ";");
  let semi = numSemis > 0 && numSemis >= lines.length / 6 ? ";" : "";

  let quote = mostFreqQuote(text);
  let kindFreqs = ["const", "let", "var"].map(kind => ({
    kind,
    count: count(text, kind)
  }));
  let kind = maxBy(kindFreqs, kf => kf.count).kind;

  return composeRequires({ kind, quote, semi, libs });
}

function composeRequires({ kind, quote, semi, libs }) {
  const statements = [];
  const tab = "  ";

  // TODO: ordering requires?
  for (let dep in libs) {
    const { props, ident } = libs[dep];
    const requireText = `require(${quote}${dep}${quote})${semi}`;

    if (ident) {
      statements.push(`${kind} ${ident} = ${requireText}`);
    }
    if (props.length > 0) {
      let statement = `${kind} { ${props.join(", ")} } = ${requireText}`;

      // TODO: line length?
      if (statement.length > 80) {
        // TODO: trailing comma?
        // TODO: ident level
        const propsText = props.join(`,\n${tab}`);
        statement = `${kind} {\n${tab}${propsText}\n} = ${requireText}`;
      }

      statements.push(statement);
    }
  }

  return statements.join("\n");
}

function mostFreqQuote(str) {
  let quoteFreqs = ['"', "'"].map(quote => ({
    quote,
    count: count(str, quote)
  }));
  return maxBy(quoteFreqs, qf => qf.count).quote;
}

function maxBy(array, callback) {
  const keys = array.map(elem => callback(elem));
  const index = array.reduce(
    (maxIndex, _, index) => keys[index] > keys[maxIndex] ? index : maxIndex,
    0
  );
  return array[index];
}

function count(str, substr) {
  let count = 0;
  let index = 0;

  while ((index = str.indexOf(substr, index)) !== -1) {
    count = count + 1;
    index += substr.length;
  }
  return count;
}
