/* eslint no-console: ["error", { allow: ["error"] }] */
"use strict";

const { findVariable, getKey, isGlobal } = require("../lib/common");

let exported = {};
exports.reset = function() {
  exported = {
    idents: new Set(),
    defaults: new Set(),
    props: new Set(),
    hasExports: false,
    hasDefaults: false
  };
};

exports.retrieve = function() {
  return exported;
};

exports.create = function(context) {
  return {
    AssignmentExpression(node) {
      if (node.left.type === "MemberExpression") {
        const { object, property } = node.left;
        const right = node.right;

        if (
          isGlobal(context, object, "module") && getKey(property) === "exports"
        ) {
          addIdents(parseNames(right));
          parsePropsDefaults(context, right);

          let parent = node.parent;
          while (parent.type === "AssignmentExpression") {
            addIdents(parseNames(parent.left));
            parent = parent.parent;
          }
        }

        if (
          object.type === "MemberExpression" &&
            isGlobal(context, object.object, "module") &&
            getKey(object.property) === "exports" ||
          isGlobal(context, object, "exports")
        ) {
          const key = getKey(property);
          if (key === "default") {
            addDefaults(parseNames(right));
          } else {
            addProps([key]);
          }
        }
      }
    },

    Identifier(node) {
      if (
        isGlobal(context, node, "module") || isGlobal(context, node, "exports")
      ) {
        exported.hasExports = true;
      }
    },

    ExportNamedDeclaration(node) {
      if (node.declaration) {
        addProps(parseNames(node.declaration));
      }
      if (node.specifiers) {
        node.specifiers.forEach(s => {
          if (s.exported.name === "default") {
            addDefaults([s.local.name]);
          } else {
            addProps([s.exported.name]);
          }
        });
      }
    },

    ExportDefaultDeclaration(node) {
      addDefaults(parseNames(node.declaration));
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
      console.error(`Didn't consider parsing name from ${node.type}`);
      return [];
  }
}

function parsePropsDefaults(context, node) {
  if (node.type === "ObjectExpression") {
    node.properties.forEach(p => {
      if (p.key.type === "Identifier") {
        if (p.key.name === "default") {
          addDefaults(parseNames(p.value));
        } else {
          addProps([p.key.name]);
        }
      }
    });
  } else if (node.type === "Identifier") {
    const variable = findVariable(context, node);

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
            const key = getKey(ident.parent.property);
            if (key === "default") {
              addDefaults(parseNames(ident.parent.right));
            } else {
              addProps([key]);
            }
          }
        }
      });
    }
  }
}

function addIdents(idents) {
  exported.hasExports = true;
  idents.forEach(i => exported.idents.add(i));
}

function addProps(props) {
  exported.hasExports = true;
  props.forEach(p => exported.props.add(p));
}

function addDefaults(defaults) {
  exported.hasExports = true;
  exported.hasDefaults = true;
  defaults.forEach(d => exported.defaults.add(d));
}
