const babylon = require("babylon");
const escope = require("escope");
const estraverse = require("estraverse");
const globals = require("globals");

const lineRegex = /\r\n|[\r\n\u2028\u2029]/g;

exports.run = function(meta, code, visits) {
  let ast, scopeManager;
  try {
    ({ ast, scopeManager } = parse(code));
  } catch (err) {
    if (err instanceof SyntaxError) {
      return { error: err };
    }
    throw err;
  }

  const context = createContext(ast, scopeManager, code);
  populateGlobals(scopeManager, meta.env);

  const callbacks = {};
  visits.forEach(visit => {
    const map = visit.init(context);
    for (const type in map) {
      callbacks[type] = callbacks[type] || [];
      callbacks[type].push(map[type]);
    }
  });

  estraverse.traverse(ast.program, {
    enter(node, parent) {
      node.parent = parent;
      context.curNode = node;
      if (callbacks[node.type]) {
        callbacks[node.type].forEach(fn => fn(node));
      }
    },

    fallback(node) {
      return Object.keys(node).filter(k => k !== "parent");
    }
  });

  if (callbacks.finish) {
    callbacks.finish.forEach(fn => fn());
  }
  return context;
};

function parse(code) {
  const ast = babylon.parse(code, {
    sourceType: "module",
    allowImportExportEverywhere: false,
    allowReturnOutsideFunction: true,
    plugins: [
      "estree",
      "jsx",
      "flow",
      "doExpressions",
      "objectRestSpread",
      "decorators",
      "classProperties",
      "exportExtensions",
      "asyncGenerators",
      "functionBind",
      "functionSent",
      "dynamicImport"
    ]
  });

  const scopeManager = escope.analyze(ast, {
    ecmaVersion: 6,
    nodejsScope: false,
    impliedStrict: false,
    ignoreEval: true,
    sourceType: "module"
  });

  return { ast, scopeManager };
}

function createContext(ast, scopeManager, code) {
  return {
    curNode: null,
    textLines: code.split(lineRegex),

    getLine(line) {
      // line numbers start from 1
      return this.textLines[line - 1];
    },

    getLastToken(node, skip = 0) {
      const index = ast.tokens.findIndex(
        t => t.start < node.end && t.end >= node.end
      );
      return ast.tokens[index - skip];
    },

    getTokenAfter(node) {
      return ast.tokens.find(t => t.start > node.end);
    },

    getGlobalScope() {
      return scopeManager.globalScope;
    },

    getKey(node) {
      switch (node.type) {
        case "Identifier":
          return node.name;

        case "StringLiteral":
          return node.value;

        default:
          return null;
      }
    },

    getScope() {
      let scope = null;
      let node = this.curNode;

      do {
        scope = scopeManager.acquire(node);
        node = node.parent;
      } while (!scope);

      // top-most scope should be module scope, not global scope
      if (scope.type === "global" && scope.childScopes.length === 1) {
        scope = scope.childScopes[0];
      }
      return scope;
    },

    findVariable(name) {
      if (name.type === "Identifier") {
        name = name.name;
      }

      let scope = this.getScope();
      do {
        const variable = scope.set.get(name);
        if (variable) {
          return variable;
        }
        scope = scope.upper;
      } while (scope);

      return null;
    },

    isGlobal(node, name) {
      if (node.type === "Identifier" && node.name === name) {
        const variable = this.findVariable(node);
        return variable && variable.scope.type === "global";
      }
      return false;
    }
  };
}

function populateGlobals(scopeManager, env) {
  const envNames = ["builtin"];
  for (const name in env) {
    if (env[name]) {
      envNames.push(name);
    }
  }

  const globalNames = new Set();
  envNames.forEach(e =>
    Object.keys(globals[e]).forEach(g => globalNames.add(g)));

  // to identify imports and exports, we must have these globals
  ["require", "module", "exports"].forEach(g => globalNames.add(g));

  const globalScope = scopeManager.globalScope;
  globalNames.forEach(name => {
    const variable = globalScope.set.get(name);

    if (!variable) {
      const newVariable = new escope.Variable(name, globalScope);
      globalScope.variables.push(newVariable);
      globalScope.set.set(name, newVariable);
    }
  });
}
