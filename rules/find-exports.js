let exported = {};
exports.retrieve = function() {
  return exported;
};

exports.create = function(context) {
  const idents = new Set();
  const props = new Set();
  exported.idents = idents;
  exported.props = props;

  return {
    AssignmentExpression(node) {
      if (node.left.type === "MemberExpression") {
        const { object, property } = node.left;
        const right = node.right;

        if (isGlobal(object, context, "module") && isKey(property, "exports")) {
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
            isGlobal(object.object, context, "module") &&
            isKey(object.property, "exports") ||
          isGlobal(object, context, "exports")
        ) {
          const key = getKey(property);
          if (key) {
            props.add(key);
          }
        }
      }
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
      console.log(`Didn't consider parsing name from ${node.type}`);
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

function isGlobal(node, context, name) {
  if (node.type === "Identifier" && node.name === name) {
    const variable = findVariable(context, name);
    return variable && variable.scope.type === "global";
  }
  return false;
}

function findVariable(context, name) {
  let scope = context.getScope();

  do {
    const variable = scope.set.get(name);
    if (variable) {
      return variable;
    }
    scope = scope.upper;
  } while (scope);

  return null;
}

function isKey(node, key) {
  return getKey(node) === key;
}

function getKey(node) {
  switch (node.type) {
    case "Identifier":
      return node.name;

    case "StringLiteral":
      return node.value;

    default:
      return null;
  }
}
