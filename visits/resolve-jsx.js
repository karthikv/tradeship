"use strict";

const tagNameRegex = /^[a-z]|\-/;

exports.init = function(context) {
  return {
    JSXOpeningElement(node) {
      const react = context.findVariable("react");
      if (react) {
        react.used = true;
      } else {
        const ref = { identifier: { name: "React" } };
        context.getGlobalScope().through.push(ref);
      }

      let identNode;
      // Taken from: https://github.com/yannickcr/eslint-plugin-react/blob/master/lib/rules/jsx-uses-vars.js#L24-L44
      if (node.name.namespace && node.name.namespace.name) {
        // <Foo:Bar>
        identNode = node.name.namespace;
      } else if (node.name.name) {
        // <Foo>
        identNode = node.name;
        if (tagNameRegex.test(identNode.name)) {
          return;
        }
      } else if (node.name.object) {
        // <Foo...Bar>
        let parent = node.name.object;
        while (parent.object) {
          parent = parent.object;
        }
        identNode = parent;
      } else {
        return;
      }

      if (identNode.name === "this") {
        return;
      }

      const variable = context.findVariable(identNode);
      if (variable) {
        variable.used = true;
      } else {
        context.getGlobalScope().through.push({ identifier: identNode });
      }
    }
  };
};
