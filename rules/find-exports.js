const { isGlobal, findVariable, getKey } = require("../common");

let exported = {};
exports.reset = function() {
  exported = {
    // TODO: duplicate values?
    idents: new Set(),
    defaults: new Set(),
    props: new Set(),
    hasExports: false
  };
};

exports.retrieve = function() {
  return exported;
};

exports.create = function(context) {
  const { idents, defaults, props } = exported;

  return {
    AssignmentExpression(node) {
      if (node.left.type === "MemberExpression") {
        const { object, property } = node.left;
        const right = node.right;

        if (
          isGlobal(context, object, "module") && getKey(property) === "exports"
        ) {
          parseNames(right).forEach(n => idents.add(n));
          const { props: newProps, defaults: newDefaults } = parsePropsDefaults(
            context,
            right
          );
          newProps.forEach(p => props.add(p));
          newDefaults.forEach(d => defaults.add(d));

          let parent = node.parent;
          while (parent.type === "AssignmentExpression") {
            parseNames(parent.left).forEach(n => idents.add(n));
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
            parseNames(right).forEach(n => defaults.add(n));
          } else {
            props.add(key);
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
      exported.hasExports = true;

      if (node.declaration) {
        parseNames(node.declaration).forEach(n => props.add(n));
      }
      if (node.specifiers) {
        node.specifiers.forEach(s => {
          if (s.exported.name === "default") {
            defaults.add(s.local.name);
          } else {
            props.add(s.exported.name);
          }
        });
      }
    },

    ExportDefaultDeclaration(node) {
      exported.hasExports = true;
      parseNames(node.declaration).forEach(n => defaults.add(n));
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

    // TODO: handle error better
    default:
      console.error(`Didn't consider parsing name from ${node.type}`);
      return [];
  }
}

function parsePropsDefaults(context, node) {
  let props = new Set();
  let defaults = new Set();

  if (node.type === "ObjectExpression") {
    node.properties.forEach(p => {
      if (p.key.type === "Identifier") {
        if (p.key.name === "default") {
          parseNames(p.value).forEach(n => defaults.add(n));
        } else {
          props.add(p.key.name);
        }
      }
    });
  } else if (node.type === "Identifier") {
    const variable = findVariable(context, node);

    // TODO: looping in right order?
    variable.references.forEach(ref => {
      if (ref.writeExpr) {
        ({ props, defaults } = parsePropsDefaults(context, ref.writeExpr));
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
            parseNames(ident.parent.right).forEach(n => defaults.add(n));
          } else {
            props.add(key);
          }
        }
      }
    });
  }

  return { props, defaults };
}
