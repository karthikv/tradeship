const referencer = require("escope/lib/referencer").default;

const { visitClass, visitProperty } = referencer.prototype;

// visit decorators on classes/properties to resolve their identifiers
referencer.prototype.visitClass = function(node) {
  visitDecorators.call(this, node);
  visitClass.call(this, node);
};

referencer.prototype.visitProperty = function(node) {
  visitDecorators.call(this, node);
  visitProperty.call(this, node);
};

function visitDecorators(node) {
  if (!node.decorators) {
    return;
  }
  node.decorators.forEach(d => this.visit(d));
}

// register class properties by visiting them as regular properties
referencer.prototype.ClassProperty = function(node) {
  this.visitProperty(node);
};

module.exports = require("escope");
