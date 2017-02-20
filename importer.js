const repl = require("repl");
const { CLIEngine, linter } = require("eslint");

const undefRegex = /^'(.*?)' is not defined.$/;
const whiteRegex = /^\s*$/;

exports.run = code => {
  const { violations, sourceCode } = lint(code);
  const idents = findMissingIdents(violations);

  const reqs = findRequires(sourceCode);
  const ranges = findRangesToRemove(reqs, violations);
  return rewriteCode(sourceCode, reqs, idents, ranges);
};

function lint(code) {
  const cli = new CLIEngine({
    useEslintrc: true,
    rules: {
      "no-undef": "error",
      "no-unused-vars": "error"
    }
  });

  const config = cli.getConfigForFile(".");
  if (Object.getOwnPropertyNames(config.env).length === 0) {
    // assume both node and browser globals
    config.env = {
      node: true,
      browser: true
    };
  }
  if (Object.getOwnPropertyNames(config.parserOptions).length === 0) {
    // assume es6 features
    config.parserOptions = {
      ecmaVersion: 6,
      sourceType: "module",
      ecmaFeatures: {
        impliedStrict: true,
        jsx: true
      }
    };
  }

  const violations = linter.verify(code, config);
  return { violations, sourceCode: linter.getSourceCode() };
}

function findMissingIdents(violations) {
  return violations
    .filter(v => v.ruleId === "no-undef")
    .map(v => {
      const matches = v.message.match(undefRegex);
      if (matches) {
        return matches[1];
      }
      return null;
    })
    .filter(ident => ident !== null && identToLib(ident));
}

function findRequires(sourceCode) {
  const declarations = sourceCode.ast.body.filter(
    node => node.type === "VariableDeclaration"
  );

  return declarations
    .map(d => ({
      declaration: d,
      declarators: d.declarations.filter(
        ({ init }) =>
          init.type === "CallExpression" &&
            init.callee.type === "Identifier" &&
            init.callee.name === "require"
      )
    }))
    .filter(d => d.declarators.length > 0);
}

function findRangesToRemove(reqs, violations) {
  const unused = violations;
  const locs = unused.reduce(
    (locs, v) => {
      if (!locs[v.line]) {
        locs[v.line] = [];
      }
      locs[v.line].push(v.column);
      return locs;
    },
    {}
  );

  // Multiple variable declarations like const x = require(), y = require() are
  // significantly more difficult to remove due to the commas. For simplicitly,
  // we ignore those cases. More generally, it makes sense for us to only remove
  // require()s we have added, and all require()s that we add are single
  // variable declarations.
  return reqs
    .filter(r => r.declarators.length === 1)
    .map(r => {
      let remove = false;
      const { loc: { start, end } } = r.declarators[0];

      if (start.line === end.line && locs[start.line]) {
        remove = locs[start.line].some(
          column => column >= start.column && column <= end.column
        );
      } else {
        for (let i = start.line; i <= end.line; i++) {
          if (
            locs[i] &&
            (i > start.line && i < end.line ||
              i === start.line && locs[i].some(c => c >= start.column) ||
              i === end.line && locs[i].some(c => c <= end.column))
          ) {
            remove = true;
            break;
          }
        }
      }

      if (remove) {
        return r.declaration.loc;
      }
      return null;
    })
    .filter(r => r !== null);
}

function rewriteCode(sourceCode, reqs, idents, ranges) {
  // line numbers are 1-indexed, so add a blank line to make indexing easy
  const sourceLines = sourceCode.lines.slice(0);
  sourceLines.unshift("");

  let line = 1;
  let column = 0;
  let newCode;
  let hasAddedRequires;
  let requiresLine;
  let requiresText;

  if (idents.length === 0) {
    newCode = "";
    hasAddedRequires = true;
  } else {
    const lastReq = reqs.length > 0 ? reqs[reqs.length - 1] : null;
    requiresText = lastReq
      ? composeMatchingRequires(lastReq, sourceCode, idents)
      : composeNewRequires(sourceCode, idents);

    if (lastReq) {
      newCode = "";
      hasAddedRequires = false;
      requiresLine = lastReq.declaration.loc.end.line;
    } else {
      newCode = requiresText + "\n\n";
      hasAddedRequires = true;
    }
  }

  // to ensure we process all the code, add a final range
  ranges.push({ start: { line: sourceLines.length } });

  ranges.forEach(range => {
    for (; line < range.start.line; line++) {
      if (column === 0 || !whiteRegex.test(sourceLines[line].slice(column))) {
        newCode += sourceLines[line].slice(column) + "\n";
      }
      if (!hasAddedRequires && line >= requiresLine) {
        newCode += requiresText + "\n";
        hasAddedRequires = true;
      }
      column = 0;
    }

    if (line >= sourceLines.length) {
      return;
    }

    newCode += sourceLines[line].slice(column, range.start.column);
    line = range.end.line;
    column = range.end.column;
  });

  if (newCode.slice(-2) === "\n\n") {
    newCode = newCode.slice(0, -1);
  }
  return newCode;
}

function composeMatchingRequires(req, { lines, text }, idents) {
  const {
    kind,
    loc: { end: { line, column } }
  } = req.declaration;

  const semi = lines[line - 1][column - 1] === ";" ? ";" : "";
  const args = req.declarators[req.declarators.length - 1].init.arguments;
  let quote;

  if (
    args &&
    args[0].type === "Literal" &&
    (args[0].raw[0] === "'" || args[0].raw[0] === '"')
  ) {
    quote = args[0].raw[0];
  } else {
    quote = mostFreqQuote(text);
  }

  return idents
    .map(
      ident =>
        `${kind} ${ident} = require(${quote}${identToLib(
          ident
        )}${quote})${semi}`
    )
    .join("\n");
}

function composeNewRequires({ lines, text }, idents) {
  let numSemis = count(text, ";");
  let semi = numSemis > 0 && numSemis >= lines.length / 6 ? ";" : "";

  let quote = mostFreqQuote(text);
  let kindFreqs = ["const", "let", "var"].map(kind => ({
    kind,
    count: count(text, kind)
  }));
  let kind = maxBy(kindFreqs, kf => kf.count).kind;

  return idents
    .map(
      ident =>
        `${kind} ${ident} = require(${quote}${identToLib(
          ident
        )}${quote})${semi}`
    )
    .join("\n");
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

function maxBy(array, callback) {
  const keys = array.map(elem => callback(elem));
  const index = array.reduce(
    (maxIndex, _, index) => keys[index] > keys[maxIndex] ? index : maxIndex,
    0
  );
  return array[index];
}

function mostFreqQuote(str) {
  let quoteFreqs = ['"', "'"].map(quote => ({
    quote,
    count: count(str, quote)
  }));
  return maxBy(quoteFreqs, qf => qf.count).quote;
}

function identToLib(ident) {
  const coreLibs = repl._builtinLibs;
  if (coreLibs.indexOf(ident) !== -1) {
    return ident;
  }
  return null;
}
