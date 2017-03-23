const flowNodes = new Set([
  "DeclaredPredicate",
  "InferredPredicate",
  "DeclareClass",
  "FunctionTypeAnnotation",
  "TypeAnnotation",
  "DeclareFunction",
  "DeclareVariable",
  "DeclareModule",
  "DeclareModuleExports",
  "DeclareTypeAlias",
  "DeclareInterface",
  "InterfaceExtends",
  "InterfaceDeclaration",
  "TypeAlias",
  "TypeParameter",
  "TypeParameterDeclaration",
  "TypeParameterInstantiation",
  "ObjectTypeIndexer",
  "ObjectTypeProperty",
  "ObjectTypeCallProperty",
  "ObjectTypeAnnotation",
  "QualifiedTypeIdentifier",
  "GenericTypeAnnotation",
  "TypeofTypeAnnotation",
  "TupleTypeAnnotation",
  "FunctionTypeParam",
  "AnyTypeAnnotation",
  "VoidTypeAnnotation",
  "BooleanTypeAnnotation",
  "MixedTypeAnnotation",
  "EmptyTypeAnnotation",
  "NumberTypeAnnotation",
  "StringTypeAnnotation",
  "BooleanLiteralTypeAnnotation",
  "NullLiteralTypeAnnotation",
  "ThisTypeAnnotation",
  "ExistsTypeAnnotation",
  "ArrayTypeAnnotation",
  "NullableTypeAnnotation",
  "IntersectionTypeAnnotation",
  "UnionTypeAnnotation",
  "Variance",
  "TypeCastExpression",
  "ClassImplements"
]);

exports.isFlowNode = function(node) {
  return flowNodes.has(node.type);
};

exports.isFlowImport = function(node) {
  return node.importKind && node.importKind !== "value";
};

exports.isFlowExport = function(node) {
  return node.exportKind && node.exportKind !== "value";
};
