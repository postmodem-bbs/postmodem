// Turns osbb's simple schema declarations into protobuf message descriptors,
// so the CEL type checker knows every field of `viewer`, `doc`, `input`, `scope`.
// That is what turns `viewer.isGust` into an install-time error.
import { create, createFileRegistry, type FileRegistry } from "@bufbuild/protobuf";
import {
  FileDescriptorProtoSchema,
  FieldDescriptorProto_Type as T,
  FieldDescriptorProto_Label as L,
  file_google_protobuf_timestamp,
  file_google_protobuf_duration,
} from "@bufbuild/protobuf/wkt";

export type FieldType = "string" | "bool" | "int" | "number" | "timestamp" | "duration" | "list<string>";
export interface FieldDecl { type: FieldType; optional?: boolean }
export type MessageDecl = Record<string, FieldDecl>;

function fieldProto(name: string, decl: FieldDecl, index: number, oneofIndex?: number) {
  const base = { name, number: index + 1, jsonName: name, label: L.OPTIONAL };
  const scalar = (type: T) => ({ ...base, type });
  let f: Record<string, unknown>;
  switch (decl.type) {
    case "string": f = scalar(T.STRING); break;
    case "bool": f = scalar(T.BOOL); break;
    case "int": f = scalar(T.INT64); break;
    case "number": f = scalar(T.DOUBLE); break;
    case "timestamp": f = { ...base, type: T.MESSAGE, typeName: ".google.protobuf.Timestamp" }; break;
    case "duration": f = { ...base, type: T.MESSAGE, typeName: ".google.protobuf.Duration" }; break;
    case "list<string>": f = { ...base, type: T.STRING, label: L.REPEATED }; break;
  }
  // proto3 `optional` on scalars gives field presence, so has(doc.x) works.
  if (decl.optional && oneofIndex !== undefined) Object.assign(f, { proto3Optional: true, oneofIndex });
  return f;
}

/** Build one file with all messages; returns a registry and the full type names. */
export function buildRegistry(pkg: string, messages: Record<string, MessageDecl>): FileRegistry {
  const messageType = Object.entries(messages).map(([msgName, fields]) => {
    const oneofDecl: { name: string }[] = [];
    const field = Object.entries(fields).map(([name, decl], i) => {
      const isScalar = !["timestamp", "duration", "list<string>"].includes(decl.type);
      let oneofIndex: number | undefined;
      if (decl.optional && isScalar) { oneofIndex = oneofDecl.length; oneofDecl.push({ name: `_${name}` }); }
      return fieldProto(name, decl, i, oneofIndex);
    });
    return { name: msgName, field, oneofDecl };
  });
  const file = create(FileDescriptorProtoSchema, {
    name: `${pkg.replaceAll(".", "/")}.proto`,
    package: pkg,
    syntax: "proto3",
    dependency: ["google/protobuf/timestamp.proto", "google/protobuf/duration.proto"],
    messageType: messageType as never,
  });
  return createFileRegistry(file, (name) =>
    name === "google/protobuf/timestamp.proto" ? file_google_protobuf_timestamp
      : name === "google/protobuf/duration.proto" ? file_google_protobuf_duration
      : undefined);
}
