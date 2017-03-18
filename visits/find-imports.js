"use strict";

const { whiteRegex } = require("../lib/common");

exports.init = function(context) {
  const reqs = [];

  return {
    VariableDeclaration(node) {
      const { loc: { start, end } } = node;

      // For simplicity, we only process require()s we have added. All
      // require()s that we add are single variable declarations in the
      // top-most scope that occupy entire lines.
      if (
        node.declarations.length !== 1 ||
        node.parent.type !== "Program" ||
        !whiteRegex.test(context.getLine(start.line).slice(0, start.column)) ||
        !whiteRegex.test(context.getLine(end.line).slice(end.column + 1))
      ) {
        return;
      }

      const { init, id } = node.declarations[0];

      let call = init;
      let isDefault = false;

      // might be require().default
      if (
        init &&
        init.type === "MemberExpression" &&
        context.getKey(init.property) === "default"
      ) {
        isDefault = true;
        call = init.object;
      }

      if (
        !call ||
        call.type !== "CallExpression" ||
        !context.isGlobal(call.callee, "require") ||
        call.arguments.length !== 1 ||
        call.arguments[0].type !== "Literal" ||
        typeof call.arguments[0].value !== "string"
      ) {
        return;
      }

      const depID = call.arguments[0].value;
      if (id.type === "Identifier") {
        const varsKey = isDefault ? "defaultVars" : "identVars";
        reqs.push({ node, depID, [varsKey]: [context.findVariable(id)] });
      } else if (
        id.type === "ObjectPattern" &&
        id.properties.every(
          p =>
            p.value.type === "Identifier" &&
              context.getKey(p.key) === p.value.name
        ) &&
        // we don't support destructuring the default
        !isDefault
      ) {
        const propVars = id.properties.map(p => context.findVariable(p.value));
        reqs.push({ node, depID, propVars });
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
            if (
              s.imported.name === s.local.name &&
              s.imported.start === s.local.start &&
              s.imported.end === s.local.end
            ) {
              req.propVars.push(context.findVariable(s.local));
            } else {
              valid = false;
            }
            break;

          case "ImportDefaultSpecifier":
            req.defaultVars.push(context.findVariable(s.local));
            break;

          case "ImportNamespaceSpecifier":
            req.identVars.push(context.findVariable(s.local));
            break;
        }
      });

      if (valid) {
        reqs.push(req);
      }
    },

    finish() {
      context.reqs = reqs.map((
        { node, depID, identVars, defaultVars, propVars }
      ) => ({
        node,
        depID,
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
      return v.used ||
        v.references.some(r => v.defs.every(d => d.name !== r.identifier));
    })
    .map(v => v.name);
}
