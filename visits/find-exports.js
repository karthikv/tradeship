/* eslint no-console: ["error", { allow: ["error"] }] */
"use strict";

const astHelpers = require("../lib/ast-helpers.js");
const { debug } = require("../lib/common.js");

exports.init = function(context) {
  context.exported = {
    idents: new Set(),
    defaults: new Set(),
    props: new Set(),
    hasExports: false,
    hasDefault: false
  };
  const { exported } = context;

  return {
    AssignmentExpression(node) {
      if (node.left.type === "MemberExpression") {
        const { object, property } = node.left;
        const right = node.right;

        if (
          context.isGlobal(object, "module") &&
          context.getKey(property) === "exports"
        ) {
          addIdents(exported, parseNames(right));
          parsePropsDefaults(context, right);

          let parent = node.parent;
          while (parent.type === "AssignmentExpression") {
            addIdents(exported, parseNames(parent.left));
            parent = parent.parent;
          }
        }

        if (
          object.type === "MemberExpression" &&
            context.isGlobal(object.object, "module") &&
            context.getKey(object.property) === "exports" ||
          context.isGlobal(object, "exports")
        ) {
          const key = context.getKey(property);
          if (key === "default") {
            addIdents(exported, parseNames(right), true);
          } else {
            addProps(exported, [key]);
          }
        }
      }
    },

    Identifier(node) {
      if (
        context.isGlobal(node, "module") || context.isGlobal(node, "exports")
      ) {
        exported.hasExports = true;
      }
    },

    ExportNamedDeclaration(node) {
      if (astHelpers.isFlowExport(node)) {
        return;
      }
      if (node.declaration) {
        addProps(exported, parseNames(node.declaration));
      }
      if (node.specifiers) {
        node.specifiers.forEach(s => {
          if (s.exported.name === "default") {
            addIdents(exported, [s.local.name], true);
          } else if (s.type === "ExportDefaultSpecifier") {
            addIdents(exported, [s.exported.name], true);
          } else {
            addProps(exported, [s.exported.name]);
          }
        });
      }
    },

    ExportDefaultDeclaration(node) {
      addIdents(exported, parseNames(node.declaration), true);
    },

    ExportAllDeclaration() {
      exported.hasExports = true;
    }
  };
};

function parseNames(node) {
  switch (node.type) {
    case "Identifier":
      return [node.name];

    case "AssignmentExpression":
      return parseNames(node.left).concat(parseNames(node.right));

    case "MemberExpression":
      return parseNames(node.property);

    case "FunctionExpression":
    case "FunctionDeclaration":
    case "ClassExpression":
    case "ClassDeclaration":
      return node.id ? parseNames(node.id) : [];

    case "NewExpression":
      return parseNames(node.callee);

    case "VariableDeclaration":
      return node.declarations.reduce(
        (names, d) => names.concat(parseNames(d.id)),
        []
      );

    // can't deduce a name from these nodes
    case "ArrowFunctionExpression":
    case "ObjectExpression":
    case "CallExpression":
    case "Literal":
      return [];

    default:
      debug("Didn't consider parsing name from %s", node.type);
      return [];
  }
}

function parsePropsDefaults(context, node) {
  const { exported } = context;

  if (node.type === "ObjectExpression") {
    node.properties.forEach(p => {
      if (p.key.type === "Identifier") {
        if (p.key.name === "default") {
          addIdents(exported, parseNames(p.value), true);
        } else {
          addProps(exported, [p.key.name]);
        }
      }
    });
  } else if (node.type === "Identifier") {
    const variable = context.findVariable(node);

    if (variable) {
      let lastWriteIndex = 0;
      variable.references.forEach((ref, i) => {
        if (ref.writeExpr) {
          lastWriteIndex = i;
        }
      });

      variable.references.slice(lastWriteIndex).forEach(ref => {
        if (ref.writeExpr) {
          parsePropsDefaults(context, ref.writeExpr);
        } else {
          const ident = ref.identifier;
          if (
            ident.parent &&
            ident.parent.type === "MemberExpression" &&
            ident.parent.object === ident &&
            ident.parent.parent &&
            ident.parent.parent.type === "AssignmentExpression" &&
            ident.parent.parent.left === ident.parent
          ) {
            const key = context.getKey(ident.parent.property);
            if (key === "default") {
              addIdents(exported, parseNames(ident.parent.right), true);
            } else {
              addProps(exported, [key]);
            }
          }
        }
      });
    }
  }
}

function addIdents(exported, idents, hasDefault = false) {
  if (hasDefault) {
    exported.hasDefault = true;
  }
  exported.hasExports = true;
  idents.forEach(i => exported.idents.add(i));
}

function addProps(exported, props) {
  exported.hasExports = true;
  props.forEach(p => exported.props.add(p));
}
