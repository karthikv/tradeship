const referencer = require("escope/lib/referencer").default;

// register class properties by visiting them as regular properties
referencer.prototype.ClassProperty = function(node) {
  this.visitProperty(node);
};

module.exports = require("escope");
