"use strict";

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

  const allReqs = [];

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

      // might be require().default
      let call = init;
      let isDefault = false;
      if (
        init.type === "MemberExpression" && getKey(init.property) === "default"
      ) {
        isDefault = true;
        call = init.object;
      }

      if (
        call.type !== "CallExpression" ||
        !isGlobal(context, call.callee, "require") ||
        call.arguments.length !== 1 ||
        call.arguments[0].type !== "Literal" ||
        typeof call.arguments[0].value !== "string"
      ) {
        return;
      }

      const depID = call.arguments[0].value;
      if (id.type === "Identifier") {
        const varsKey = isDefault ? "defaultVars" : "identVars";
        allReqs.push({ node, depID, [varsKey]: [findVariable(context, id)] });
      } else if (
        id.type === "ObjectPattern" &&
        // TODO: what about aliases?
        id.properties.every(
          p => p.value.type === "Identifier" && getKey(p.key) === p.value.name
        ) &&
        // we don't support destructuring the default
        !isDefault
      ) {
        const propVars = id.properties.map(p => findVariable(context, p.value));
        allReqs.push({ node, depID, propVars });
      }
    },

    ImportDeclaration(node) {
      const depID = node.source.value;
      const req = {
        node,
        depID,
        identVars: [],
        defaultVars: [],
        propVars: []
      };
      let valid = true;

      node.specifiers.forEach(s => {
        switch (s.type) {
          case "ImportSpecifier":
            // TODO: aliases?
            if (s.imported === s.local) {
              req.propVars.push(findVariable(context, s.local));
            } else {
              valid = false;
            }
            break;

          case "ImportDefaultSpecifier":
            req.defaultVars.push(findVariable(context, s.local));
            break;

          case "ImportNamespaceSpecifier":
            req.identVars.push(findVariable(context, s.local));
            break;
        }
      });

      if (valid) {
        allReqs.push(req);
      }
    },

    "Program:exit"() {
      reqs = allReqs.map((
        { node, depID, identVars, defaultVars, propVars }
      ) => ({
        node,
        depID,
        // TODO: what about React for JSX?
        // remove unused names
        idents: getUsedNames(identVars || []),
        defaults: getUsedNames(defaultVars || []),
        props: getUsedNames(propVars || [])
      }));
    }
  };
};

function getUsedNames(vars) {
  return vars
    .filter(v => {
      return v.eslintUsed ||
        v.references.some(r => v.defs.every(d => d.name !== r.identifier));
    })
    .map(v => v.name);
}
