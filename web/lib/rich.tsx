// Fills `{name}` placeholders in an already translated sentence with elements (links, bold text, keys), so a sentence
// that carries markup is still translated whole and each language puts the pieces where its grammar wants them.
import { Fragment, type ReactNode } from "react";

export function rich(text: string, parts: Record<string, ReactNode>): ReactNode {
  return text.split(/(\{\w+\})/g).map((piece, i) => {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1];
    return <Fragment key={i}>{name && name in parts ? parts[name] : piece}</Fragment>;
  });
}
