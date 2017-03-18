"use strict";

const { tokTypes } = require("babylon");

const leadingWhiteRegex = /^\s*/;

exports.init = function(context) {
  const kindFreqs = {};
  const quoteFreqs = {};
  const semiFreqs = {};
  const tabFreqs = {};
  const trailingCommaFreqs = {};
  const requireKeywordFreqs = {};

  const countSemisNode = countSemis.bind(null, context, semiFreqs);
  const countTrailingCommasNode = countTrailingCommas.bind(
    null,
    context,
    trailingCommaFreqs
  );
  countTabs(context, tabFreqs);

  return {
    VariableDeclaration(node) {
      const kind = node.kind;
      inc(kindFreqs, kind);

      // Taken from: https://github.com/eslint/eslint/blob/a30eb8d19f407643d35f5af8e270c9a150b9d015/lib/rules/semi.js#L197-L205
      const parent = node.parent;
      if (
        (parent.type !== "ForStatement" || parent.init !== node) &&
        (!/^For(?:In|Of)Statement/.test(parent.type) || parent.left !== node)
      ) {
        countSemisNode(node);
      }
    },

    Literal(node) {
      if (typeof node.value === "string") {
        const quote = node.raw[0];
        if (quote[0] === "'" || quote[0] === '"') {
          inc(quoteFreqs, quote);
        }
      }
    },

    // Taken from: https://github.com/eslint/eslint/blob/a30eb8d19f407643d35f5af8e270c9a150b9d015/lib/rules/semi.js#L213-L232
    ExpressionStatement: countSemisNode,
    ReturnStatement: countSemisNode,
    ThrowStatement: countSemisNode,
    DoWhileStatement: countSemisNode,
    DebuggerStatement: countSemisNode,
    BreakStatement: countSemisNode,
    ContinueStatement: countSemisNode,
    ExportAllDeclaration: countSemisNode,
    ExportDefaultDeclaration(node) {
      if (!/(?:Class|Function)Declaration/.test(node.declaration.type)) {
        countSemisNode(node);
      }
    },

    // Taken from: https://github.com/eslint/eslint/blob/a30eb8d19f407643d35f5af8e270c9a150b9d015/lib/rules/comma-dangle.js#L319-333
    // Excluding function/call
    ObjectExpression: countTrailingCommasNode,
    ObjectPattern: countTrailingCommasNode,
    ArrayExpression: countTrailingCommasNode,
    ArrayPattern: countTrailingCommasNode,

    ImportDeclaration(node) {
      countSemisNode(node);
      countTrailingCommasNode(node);
      inc(requireKeywordFreqs, "import");
    },
    ExportNamedDeclaration(node) {
      if (!node.declaration) {
        countSemisNode(node);
      }
      countTrailingCommasNode(node);
    },

    CallExpression(node) {
      if (context.isGlobal(node.callee, "require")) {
        inc(requireKeywordFreqs, "require");
      }
    },

    finish() {
      context.style = {
        kind: maxKey(kindFreqs, "const"),
        quote: maxKey(quoteFreqs, '"'),
        tab: maxKey(tabFreqs, "  "),
        requireKeyword: maxKey(requireKeywordFreqs, "require"),
        semi: maxKey(semiFreqs, ";"),
        trailingComma: maxKey(trailingCommaFreqs, "")
      };
    }
  };
};

function countTabs(context, tabFreqs) {
  let lastIndent = 0;
  context.textLines.forEach(textLine => {
    const indent = textLine.match(leadingWhiteRegex)[0];
    // ignore blank lines
    if (indent.length === textLine.length) {
      return;
    }

    if (indent.length > lastIndent.length) {
      const tab = indent.slice(lastIndent.length);
      inc(tabFreqs, tab);
    } else if (indent.length < lastIndent.length) {
      const tab = lastIndent.slice(indent.length);
      inc(tabFreqs, tab);
    }

    lastIndent = indent;
  });
}

// Taken from: https://github.com/eslint/eslint/blob/a30eb8d19f407643d35f5af8e270c9a150b9d015/lib/rules/semi.js#L171-181
function countSemis(context, semiFreqs, node) {
  const token = context.getLastToken(node);
  const semi = token.type === tokTypes.semi ? ";" : "";
  inc(semiFreqs, semi);
}

// Taken from: https://github.com/eslint/eslint/blob/a30eb8d19f407643d35f5af8e270c9a150b9d015/lib/rules/comma-dangle.js#L251-L274
function countTrailingCommas(context, trailingCommaFreqs, node) {
  const lastItem = getLastItem(node);

  if (
    !lastItem ||
    node.type === "ImportDeclaration" && lastItem.type !== "ImportSpecifier"
  ) {
    return;
  }
  if (!isTrailingCommaAllowed(lastItem) || !isMultiline(context, node)) {
    return;
  }

  const token = getTrailingToken(context, node, lastItem);
  const trailingComma = token.type === tokTypes.comma ? "," : "";

  inc(trailingCommaFreqs, trailingComma);
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
function isMultiline(context, node) {
  const lastItem = getLastItem(node);

  if (!lastItem) {
    return false;
  }

  const penultimateToken = getTrailingToken(context, node, lastItem);
  const lastToken = context.getTokenAfter(penultimateToken);

  return lastToken.loc.end.line !== penultimateToken.loc.end.line;
}

// Taken from: https://github.com/eslint/eslint/blob/a30eb8d19f407643d35f5af8e270c9a150b9d015/lib/rules/comma-dangle.js#L171-187
function getTrailingToken(context, node, lastItem) {
  switch (node.type) {
    case "ObjectExpression":
    case "ArrayExpression":
    case "CallExpression":
    case "NewExpression":
      return context.getLastToken(node, 1);
    default: {
      const nextToken = context.getTokenAfter(lastItem);

      if (nextToken.type === tokTypes.comma) {
        return nextToken;
      }
      return context.getLastToken(lastItem);
    }
  }
}

function inc(freqs, key) {
  if (!freqs[key]) {
    freqs[key] = 0;
  }
  freqs[key]++;
}

function maxKey(freqs, defaultKey) {
  const keys = Object.keys(freqs);
  if (keys.length === 0) {
    return defaultKey;
  }

  return keys.reduce(
    (maxKey, key) => freqs[key] > freqs[maxKey] ? key : maxKey,
    keys[0]
  );
}
