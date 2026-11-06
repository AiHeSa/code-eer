import React, { useState as state } from 'react';
export function App({ title }: { title: string }) {
  const [count] = state(0);
  return <><button {...{ title }} onClick={() => count}>{title}😀</button></>;
}
export class Panel extends React.Component {
  render() { return <section><App title="hello" /></section>; }
}
