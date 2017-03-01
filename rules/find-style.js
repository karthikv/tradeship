let style;
exports.reset = function() {
  style = {};
};

exports.retrieve = function() {
  return style;
};

const leadingWhiteRegex = /^\s*/;

exports.create = function(context) {
  const kindFreqs = {};
  const quoteFreqs = {};
  const semiFreqs = {};
  const tabFreqs = {};
  const trailingCommaFreqs = {};

  const sourceCode = context.getSourceCode();

  let lastIndent = 0;
  sourceCode.lines.forEach(line => {
    const indent = line.match(leadingWhiteRegex)[0];
    // ignore blank lines
    if (indent.length === line.length) {
      return;
    }

    if (indent.length > lastIndent.length) {
      const tab = indent.slice(lastIndent.length);
      tabFreqs[tab]++;
    } else if (indent.length < lastIndent.length) {
      const tab = lastIndent.slice(indent.length);
      tabFreqs[tab]++;
    }

    lastIndent = indent;
  });

  // Taken from: https://github.com/eslint/eslint/blob/a30eb8d19f407643d35f5af8e270c9a150b9d015/lib/rules/semi.js#L171-181
  function countSemis(node) {
    const token = sourceCode.getLastToken(node);
    const semi = token.type === "Punctuator" && token.value === ";" ? ";" : "";

    if (!semiFreqs[semi]) {
      semiFreqs[semi] = 0;
    }
    semiFreqs[semi]++;
  }

  // Taken from: https://github.com/eslint/eslint/blob/a30eb8d19f407643d35f5af8e270c9a150b9d015/lib/rules/comma-dangle.js#L251-L274
  function countTrailingCommas(node) {
    const lastItem = getLastItem(node);

    if (
      !lastItem ||
      node.type === "ImportDeclaration" && lastItem.type !== "ImportSpecifier"
    ) {
      return;
    }
    if (!isTrailingCommaAllowed(lastItem) || !isMultiline(node)) {
      return;
    }

    const token = getTrailingToken(node, lastItem);
    const trailingComma = token.value === "," ? "," : "";

    if (!trailingCommaFreqs[trailingComma]) {
      trailingCommaFreqs[trailingComma] = 0;
    }
    trailingCommaFreqs[trailingComma]++;
  }

  // Taken from: https://github.com/eslint/eslint/blob/a30eb8d19f407643d35f5af8e270c9a150b9d015/lib/rules/comma-dangle.js#L139-160
  function getLastItem(node) {
    switch (node.type) {
      case "ObjectExpression":
      case "ObjectPattern":
        return node.properties[node.properties.length - 1];
      case "ArrayExpression":
      case "ArrayPattern":
        return node.elements[node.elements.length - 1];
      case "ImportDeclaration":
      case "ExportNamedDeclaration":
        return node.specifiers[node.specifiers.length - 1];
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        return node.params[node.params.length - 1];
      case "CallExpression":
      case "NewExpression":
        return node.arguments[node.arguments.length - 1];
      default:
        return null;
    }
  }

  // Taken from: https://github.com/eslint/eslint/blob/a30eb8d19f407643d35f5af8e270c9a150b9d015/lib/rules/comma-dangle.js#L33-39
  function isTrailingCommaAllowed(lastItem) {
    return lastItem.type !== "RestElement" &&
      lastItem.type !== "RestProperty" &&
      lastItem.type !== "ExperimentalRestProperty";
  }

  // Taken from: https://github.com/eslint/eslint/blob/a30eb8d19f407643d35f5af8e270c9a150b9d015/lib/rules/comma-dangle.js#L197-208
  function isMultiline(node) {
    const lastItem = getLastItem(node);

    if (!lastItem) {
      return false;
    }

    const penultimateToken = getTrailingToken(node, lastItem);
    const lastToken = sourceCode.getTokenAfter(penultimateToken);

    return lastToken.loc.end.line !== penultimateToken.loc.end.line;
  }

  // Taken from: https://github.com/eslint/eslint/blob/a30eb8d19f407643d35f5af8e270c9a150b9d015/lib/rules/comma-dangle.js#L171-187
  function getTrailingToken(node, lastItem) {
    switch (node.type) {
      case "ObjectExpression":
      case "ArrayExpression":
      case "CallExpression":
      case "NewExpression":
        return sourceCode.getLastToken(node, 1);
      default: {
        const nextToken = sourceCode.getTokenAfter(lastItem);

        if (nextToken.value === ",") {
          return nextToken;
        }
        return sourceCode.getLastToken(lastItem);
      }
    }
  }

  return {
    VariableDeclaration(node) {
      const kind = node.kind;
      if (!kindFreqs[kind]) {
        kindFreqs[kind] = 0;
      }
      kindFreqs[kind]++;

      // Taken from: https://github.com/eslint/eslint/blob/a30eb8d19f407643d35f5af8e270c9a150b9d015/lib/rules/semi.js#L197-L205
      const ancestors = context.getAncestors();
      const parentIndex = ancestors.length - 1;
      const parent = ancestors[parentIndex];

      if (
        (parent.type !== "ForStatement" || parent.init !== node) &&
        (!/^For(?:In|Of)Statement/.test(parent.type) || parent.left !== node)
      ) {
        countSemis(node);
      }
    },

    Literal(node) {
      if (typeof node.value === "string") {
        const quote = node.raw[0];
        if (!quoteFreqs[quote]) {
          quoteFreqs[quote] = 0;
        }
        quoteFreqs[quote]++;
      }
    },

    // Taken from: https://github.com/eslint/eslint/blob/a30eb8d19f407643d35f5af8e270c9a150b9d015/lib/rules/semi.js#L213-L232
    ExpressionStatement: countSemis,
    ReturnStatement: countSemis,
    ThrowStatement: countSemis,
    DoWhileStatement: countSemis,
    DebuggerStatement: countSemis,
    BreakStatement: countSemis,
    ContinueStatement: countSemis,
    ExportAllDeclaration: countSemis,
    ExportDefaultDeclaration(node) {
      if (!/(?:Class|Function)Declaration/.test(node.declaration.type)) {
        countSemis(node);
      }
    },

    // Taken from: https://github.com/eslint/eslint/blob/a30eb8d19f407643d35f5af8e270c9a150b9d015/lib/rules/comma-dangle.js#L319-333
    // Excluding function/call
    ObjectExpression: countTrailingCommas,
    ObjectPattern: countTrailingCommas,
    ArrayExpression: countTrailingCommas,
    ArrayPattern: countTrailingCommas,

    ImportDeclaration(node) {
      countSemis(node);
      countTrailingCommas(node);
    },
    ExportNamedDeclaration(node) {
      if (!node.declaration) {
        countSemis(node);
      }
      countTrailingCommas(node);
    },

    "Program:exit"() {
      style.kind = maxKey(kindFreqs) || "const";
      style.quote = maxKey(quoteFreqs) || '"';
      style.tab = maxKey(tabFreqs) || "  ";

      // empty string is falsy, must explicitly check for null
      style.semi = maxKey(semiFreqs);
      if (style.semi === null) {
        style.semi = ";";
      }
      style.trailingComma = maxKey(trailingCommaFreqs);
      if (style.trailingComma === null) {
        style.trailingComma = "";
      }
    }
  };
};

function maxKey(freqs) {
  const keys = Object.keys(freqs);
  if (keys.length === 0) {
    return null;
  }

  return keys.reduce(
    (maxKey, key) => freqs[key] > freqs[maxKey] ? key : maxKey,
    keys[0]
  );
}
