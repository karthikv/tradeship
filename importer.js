const fs = require("fs");
const repl = require("repl");
const path = require("path");

const { lint, promisify } = require("./common");
const readFile = promisify(fs.readFile);

const undefRegex = /^'(.*?)' is not defined.$/;
const whiteRegex = /^\s*$/;
const identRegex = /^[$a-z_][0-9a-z_$]*$/i;

exports.run = function(code) {
  return getIdentToLib().then(identToLib => {
    const { violations, sourceCode } = lint(code, {
      "no-undef": "error",
      "no-unused-vars": "error"
    });

    const missingIdents = findMissingIdents(violations, identToLib);
    const reqs = findRequires(sourceCode);
    const linesToRemove = findLinesToRemove(sourceCode, reqs, violations);

    return rewriteCode({
      sourceCode,
      reqs,
      missingIdents,
      linesToRemove,
      identToLib
    });
  });
};

function findMissingIdents(violations, identToLib) {
  return violations
    .filter(v => v.ruleId === "no-undef")
    .map(v => {
      const matches = v.message.match(undefRegex);
      if (matches) {
        return matches[1];
      }
      return null;
    })
    .filter(ident => ident !== null && identToLib[ident]);
}

function getIdentToLib() {
  const identToLib = {};
  repl._builtinLibs.forEach(lib => identToLib[lib] = lib);

  return findPkgMeta(".").then(meta => {
    if (!meta) {
      return identToLib;
    }

    Object.keys(meta.dependencies)
      .concat(Object.keys(meta.devDependencies))
      .forEach(dep => {
        if (identRegex.test(dep)) {
          identToLib[dep] = dep;
        }

        const camelCase = dep
          .split(/\W+/g)
          .filter(p => p !== "")
          .map((p, i) => i === 0 ? p : p[0].toUpperCase() + p.slice(1))
          .join("");

        if (camelCase.length > 0) {
          const classCase = camelCase[0].toUpperCase() + camelCase.slice(1);
          // TODO: handle case of multiple matches for same ident?
          identToLib[camelCase] = dep;
          identToLib[classCase] = dep;
        }
      });

    return identToLib;
  });
}

function findPkgMeta(dir) {
  if (!dir) {
    dir = path.resolve(".");
  }

  return readFile(path.join(dir, "package.json"))
    .catch(err => {
      if (err.code === "ENOENT") {
        if (dir === "/") {
          return null;
        }
        return findPkgMeta(path.join(dir, ".."));
      } else {
        throw err;
      }
    })
    .then(json => JSON.parse(json));
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

function findLinesToRemove(sourceCode, reqs, violations) {
  // line numbers are 1-indexed, so add a blank line to make indexing easy
  const sourceByLine = sourceCode.lines.slice(0);
  sourceByLine.unshift("");

  const unused = {};
  violations
    .filter(v => v.ruleId === "no-unused-vars")
    .forEach(v => unused[v.line] = true);

  return reqs
    // Multiple variable declarations like const x = require(), y = require()
    // are significantly more difficult to remove due to the commas. For
    // simplicitly, we ignore those cases. More generally, it makes sense for
    // us to only remove require()s we have added, and all require()s that we
    // add are single variable declarations.
    .filter(r => r.declarators.length === 1)
    // Limit to declarations that occupy entire lines. If there are other
    // statements, expressions, or comments on the same line as a require()
    // declaration, we don't remove that require(). Like the logic above, this
    // simplifies the code significantly.
    .filter(({ declaration: { loc: { start, end } } }) => {
      const before = sourceByLine[start.line].slice(0, start.column);
      const after = sourceByLine[end.line].slice(end.column + 1);
      return whiteRegex.test(before) && whiteRegex.test(after);
    })
    // Target unused declarations. We don't need to check columns because we've
    // filtered to declarations that occupy entire lines.
    .filter(r => {
      const { loc: { start, end } } = r.declarators[0];
      for (let line = start.line; line <= end.line; line++) {
        if (unused[line]) {
          return true;
        }
      }
      return false;
    })
    .reduce(
      (lines, { declaration: { loc: { start, end } } }) => {
        for (let line = start.line; line <= end.line; line++) {
          lines.add(line);
        }
        return lines;
      },
      new Set()
    );
}

function rewriteCode(
  { sourceCode, reqs, missingIdents, linesToRemove, identToLib }
) {
  // line numbers are 1-indexed, so add a blank line to make indexing easy
  const sourceByLine = sourceCode.lines.slice(0);
  sourceByLine.unshift("");
  linesToRemove.add(0);

  const lastReq = reqs.length > 0 ? reqs[reqs.length - 1] : null;
  const requiresText = lastReq
    ? composeMatchingRequires({
        sourceCode,
        missingIdents,
        identToLib,
        req: lastReq
      })
    : composeNewRequires(sourceCode, missingIdents, identToLib);
  const addRequiresLine = lastReq ? lastReq.declaration.loc.end.line : 0;
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

function composeMatchingRequires(
  { req, sourceCode, missingIdents, identToLib }
) {
  const { lines, text } = sourceCode;
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

  return missingIdents
    .map(
      ident =>
        `${kind} ${ident} = require(${quote}${identToLib[
          ident
        ]}${quote})${semi}`
    )
    .join("\n");
}

function composeNewRequires({ lines, text }, missingIdents, identToLib) {
  let numSemis = count(text, ";");
  let semi = numSemis > 0 && numSemis >= lines.length / 6 ? ";" : "";

  let quote = mostFreqQuote(text);
  let kindFreqs = ["const", "let", "var"].map(kind => ({
    kind,
    count: count(text, kind)
  }));
  let kind = maxBy(kindFreqs, kf => kf.count).kind;

  return missingIdents
    .map(
      ident =>
        `${kind} ${ident} = require(${quote}${identToLib[
          ident
        ]}${quote})${semi}`
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
