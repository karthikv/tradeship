const { isGlobal, findVariable, getKey } = require("../common");

const whiteRegex = /^\s*$/;
let reqs;

exports.reset = function() {
  reqs = [];
};

exports.retrieve = function() {
  return reqs;
};

exports.create = function(context) {
  const sourceCode = context.getSourceCode();
  const sourceByLine = sourceCode.lines.slice(0);
  sourceByLine.unshift("");

  return {
    VariableDeclaration(node) {
      const { loc: { start, end } } = node;

      // For simplicity, we only process require()s we have added. All
      // require()s that we add are single variable declarations in the
      // top-most scope that occupy entire lines.
      if (
        node.declarations.length !== 1 ||
        node.parent.type !== "Program" ||
        !whiteRegex.test(sourceByLine[start.line].slice(0, start.column)) ||
        !whiteRegex.test(sourceByLine[end.line].slice(end.column + 1))
      ) {
        return;
      }

      const { init, id } = node.declarations[0];
      if (
        init.type !== "CallExpression" ||
        !isGlobal(context, init.callee, "require") ||
        init.arguments.length !== 1 ||
        init.arguments[0].type !== "Literal" ||
        typeof init.arguments[0].value !== "string"
      ) {
        return;
      }

      const depID = init.arguments[0].value;
      if (id.type === "Identifier") {
        if (isUsed(id, context)) {
          reqs.push({ node, depID, ident: id.name });
        } else {
          reqs.push({ node });
        }
      } else if (
        id.type === "ObjectPattern" &&
        // TODO: what about aliases?
        id.properties.every(
          p => p.value.type === "Identifier" && getKey(p.key) === p.value.name
        )
      ) {
        const left = id.properties.filter(p => isUsed(p.value, context));
        const props = left.map(p => p.value.name);
        reqs.push({ node, depID, props });
      }
    }
  };
};

function isUsed(id, context) {
  const variable = findVariable(context, id.name);
  return variable.references.length !== variable.defs.length;
}
