const { isGlobal, findVariable, getKey } = require("../common");

let exported = {};
exports.reset = function() {
  exported = {
    idents: new Set(),
    props: new Set(),
    hasExports: false
  };
};

exports.retrieve = function() {
  return exported;
};

exports.create = function(context) {
  const { idents, props } = exported;

  return {
    AssignmentExpression(node) {
      if (node.left.type === "MemberExpression") {
        const { object, property } = node.left;
        const right = node.right;

        if (
          isGlobal(context, object, "module") && getKey(property) === "exports"
        ) {
          parseNames(right).forEach(n => idents.add(n));
          parseProps(context, right).forEach(p => props.add(p));

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
          if (key) {
            props.add(key);
          }
        }
      }
    },

    Identifier(node) {
      if (
        isGlobal(context, node, "module") || isGlobal(context, node, "exports")
      ) {
        setHasExports();
      }
    },
    ExportNamedDeclaration: setHasExports,
    ExportDefaultDeclaration: setHasExports,
    ExportAllDeclaration: setHasExports
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
    case "ClassExpression":
      return node.id ? parseNames(node.id) : [];

    case "NewExpression":
      return parseNames(node.callee);

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

function parseProps(context, node) {
  if (node.type === "ObjectExpression") {
    return node.properties
      .map(p => {
        if (p.key.type === "Identifier") {
          return p.key.name;
        }
        return null;
      })
      .filter(p => p !== null);
  } else if (node.type === "Identifier") {
    const variable = findVariable(context, node.name);
    let props = [];

    variable.references.forEach(ref => {
      if (ref.writeExpr) {
        props = parseProps(context, ref.writeExpr);
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
          if (key) {
            props.push(key);
          }
        }
      }
    });

    return props;
  }

  return [];
}

function setHasExports() {
  exported.hasExports = true;
}
